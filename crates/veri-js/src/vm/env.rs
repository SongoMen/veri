//! The browser environment: the harvested profile, the scripts that
//! materialise it, and the isolate they run in.

use super::js;
use super::lifecycle::run;
use super::options::SolveOptions;
use serde::Deserialize;
use std::sync::Once;

pub const PRELUDE: &str = include_str!("../prelude.js");

/// Order matters: later fragments read globals the earlier ones define.
pub const ENV_PARTS: &[(&str, &str)] = &[
    ("00-identity.js", include_str!("../env/00-identity.js")),
    ("01-crypto.js", include_str!("../env/01-crypto.js")),
    ("02-media.js", include_str!("../env/02-media.js")),
    ("03-platform.js", include_str!("../env/03-platform.js")),
    ("04-dom.js", include_str!("../env/04-dom.js")),
    ("05-window.js", include_str!("../env/05-window.js")),
    ("06-profile.js", include_str!("../env/06-profile.js")),
    ("07-shims.js", include_str!("../env/07-shims.js")),
];

pub const PROFILE: &str = include_str!("../../profiles/chrome.json");

const MAX_HEAP_MB: usize = 1024;

#[derive(Debug, Clone)]
pub struct ProfileMeta {
    pub chrome: String,
    pub harvested_at: String,
    pub user_agent: String,
    pub bytes: usize,
}

pub fn profile_meta() -> ProfileMeta {
    #[derive(Deserialize, Default)]
    struct Meta {
        chrome: Option<String>,
        #[serde(alias = "harvestedAt")]
        harvested_at: Option<String>,
        ua: Option<String>,
    }
    #[derive(Deserialize, Default)]
    struct Root {
        #[serde(default)]
        meta: Meta,
    }
    let root: Root = serde_json::from_str(PROFILE).unwrap_or_default();
    ProfileMeta {
        chrome: root.meta.chrome.unwrap_or_else(|| "unknown".into()),
        harvested_at: root.meta.harvested_at.unwrap_or_else(|| "unknown".into()),
        user_agent: root.meta.ua.unwrap_or_default(),
        bytes: PROFILE.len(),
    }
}

extern "C" fn grow_heap_instead_of_aborting(
    _data: *mut std::ffi::c_void,
    current: usize,
    initial: usize,
) -> usize {
    let ceiling = (MAX_HEAP_MB << 20).max(initial);
    if current >= ceiling {
        return current;
    }
    let grown = (current.saturating_mul(2)).min(ceiling);
    grown.max(initial)
}

static V8_INIT: Once = Once::new();
static PLATFORM: std::sync::OnceLock<v8::SharedRef<v8::Platform>> = std::sync::OnceLock::new();

pub fn init_v8() {
    V8_INIT.call_once(|| {
        let platform = v8::new_default_platform(0, false).make_shared();
        let _ = PLATFORM.set(platform.clone());
        v8::V8::initialize_platform(platform);
        v8::V8::initialize();
    });
}

pub fn pump_platform(isolate: &mut v8::Isolate) -> bool {
    match PLATFORM.get() {
        Some(p) => v8::Platform::pump_message_loop(p, isolate, false),
        None => false,
    }
}

pub fn new_isolate(options: &SolveOptions) -> v8::OwnedIsolate {
    init_v8();
    let params = v8::CreateParams::default().heap_limits(0, options.heap_mb << 20);
    let mut isolate = v8::Isolate::new(params);
    isolate.add_near_heap_limit_callback(grow_heap_instead_of_aborting, std::ptr::null_mut());
    isolate
}

fn install_profile(scope: &mut v8::HandleScope) -> Result<(), String> {
    let json = v8::String::new(scope, PROFILE).ok_or("profile too large for a V8 string")?;
    let parsed = v8::json::parse(scope, json).ok_or("bundled profile is not valid JSON")?;
    let key = v8::String::new(scope, "__PROFILE").ok_or("could not name __PROFILE")?;
    let global = scope.get_current_context().global(scope);
    global.set(scope, key.into(), parsed);
    Ok(())
}

pub fn load(
    scope: &mut v8::HandleScope,
    page_url: &str,
    user_agent: &str,
    options: &SolveOptions,
) -> Result<(), String> {
    let overrides = format!(
        "globalThis.__UA_OVERRIDE = {};\nglobalThis.__URL_OVERRIDE = {};\n\
         globalThis.__TZ_OVERRIDE = {};\nglobalThis.__TRACE_UNDEF = {};\n\
         globalThis.__SHADOW_DOM = {};\nglobalThis.__FRAMES = {};\n\
         globalThis.__REALM_URL = {};",
        js(user_agent),
        js(page_url),
        js(&options.timezone),
        options.trace_undef,
        options.shadow_dom,
        options.frames,
        std::env::var("VERI_REALM_URL").is_ok(),
    );
    for (src, name) in [(PRELUDE, "prelude.js"), (overrides.as_str(), "identity")] {
        run(scope, src, name)?;
    }
    install_profile(scope)?;
    for (name, src) in ENV_PARTS {
        run(scope, src, name)?;
    }
    Ok(())
}
