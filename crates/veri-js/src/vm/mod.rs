//! Runs a challenge's own scripts inside an embedded V8 isolate.

pub mod bridge;
pub mod diagnostics;
pub mod env;
pub mod extract;
mod frames;
pub mod lifecycle;
pub mod options;
pub mod watchdog;

pub use env::{init_v8, profile_meta, ProfileMeta, ENV_PARTS, PRELUDE, PROFILE};
pub use extract::{
    all_elements, config_field, extract_config_object, extract_inline_script_at,
    first_inline_script_at, instrument_catches, scripts, Script,
};
pub use options::{SolveOptions, DEFAULT_HEAP_MB, DEFAULT_TIMEOUT};

use lifecycle::{drive_to_complete, eval, eval_json, run, run_at};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use veri_core::{BridgeCall, Diagnostics, HttpBridge, SolveError, SolveReport};

pub fn js(value: impl Serialize) -> String {
    serde_json::to_string(&value).unwrap_or_else(|_| "null".into())
}

/// A network call the challenge queued but did not send through the bridge.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct NetIntent {
    pub kind: String,
    #[serde(default)]
    pub method: Option<String>,
    pub url: String,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Default)]
pub struct SolveOutput {
    pub requests: Vec<BridgeCall>,
    /// Calls the VM intended to make, whether or not they were sent.
    pub net: Vec<NetIntent>,
    pub cookies_set: Vec<String>,
    pub errors: Vec<String>,
    /// Recorded property accesses. 0 unless diagnostics were enabled.
    pub records: usize,
    /// What the script assigned to `__VALUE`, for a caller that asked it for
    /// one. Always `None` on a challenge.
    pub value: Option<String>,
    pub elapsed: Duration,
    pub diagnostics: Option<Diagnostics>,
}

#[derive(Debug)]
pub enum SolveFailure {
    TimedOut(Duration),
    Failed(String),
}

impl std::fmt::Display for SolveFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SolveFailure::TimedOut(d) => write!(f, "challenge did not finish within {d:?}"),
            SolveFailure::Failed(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for SolveFailure {}

impl From<String> for SolveFailure {
    fn from(m: String) -> Self {
        SolveFailure::Failed(m)
    }
}

impl From<SolveFailure> for SolveError {
    fn from(e: SolveFailure) -> Self {
        match e {
            SolveFailure::TimedOut(d) => SolveError::TimedOut(d),
            SolveFailure::Failed(m) => SolveError::Failed(m),
        }
    }
}

impl From<SolveOutput> for SolveReport {
    fn from(out: SolveOutput) -> Self {
        Self {
            requests: out.requests,
            cookies_set: out.cookies_set,
            errors: out.errors,
            operations: out.records,
            diagnostics: out.diagnostics,
        }
    }
}

#[derive(Default)]
pub struct Program<'a> {
    /// Run first: a configuration object the page declared inline and the
    /// payload expects to find already present.
    pub seed: Option<&'a str>,
    /// The page's own bootstrap, which normally fetches the live payload.
    /// Used only when there is a bridge to fetch with.
    pub bootstrap: Option<&'a str>,
    /// Zero-based line and column the bootstrap starts at in its document, so
    /// its stack frames are numbered the way a browser numbers them.
    pub bootstrap_at: (i32, i32),
    /// Never instrumented. Anything carrying the page's own source has to live
    /// here, or `instrument_catches` rewrites it inside its string literal and
    /// the page reads this element back out of `document.scripts`.
    pub prelude: Option<&'a str>,
    pub payload: &'a str,
    /// Globals to wrap in the recording proxy once setup has run.
    pub watch: &'a [&'a str],
}

/// Run `program` in the browser environment.
pub fn execute(
    program: Program<'_>,
    page_url: &str,
    user_agent: &str,
    bridge: Option<Arc<dyn HttpBridge>>,
    options: &SolveOptions,
) -> Result<SolveOutput, SolveFailure> {
    let started = Instant::now();
    let payload = program.payload;

    let live = bridge.is_some();
    let bridge_guard = bridge::BridgeGuard::install(bridge, page_url.to_string());
    let misses = diagnostics::MissGuard::install();

    let mut isolate = env::new_isolate(options);
    // Armed before any challenge code runs, and joined before the isolate drops.
    let mut dog = options.timeout.map(|d| watchdog::Watchdog::arm(isolate.thread_safe_handle(), d));

    let mut out = SolveOutput::default();
    let result = (|| -> Result<(), SolveFailure> {
        let hs = &mut v8::HandleScope::new(&mut isolate);

        let global_tmpl = v8::ObjectTemplate::new(hs);
        let cfg = v8::NamedPropertyHandlerConfiguration::new()
            .getter(diagnostics::global_miss)
            .flags(v8::PropertyHandlerFlags::NON_MASKING);
        global_tmpl.set_named_property_handler(cfg);

        let context = v8::Context::new(
            hs,
            v8::ContextOptions { global_template: Some(global_tmpl), ..Default::default() },
        );
        let scope = &mut v8::ContextScope::new(hs, context);

        bind(scope, context, "__HOST_RUN", bridge::host_run)?;
        if options.frames {
            frames::reset();
            bind(scope, context, "__HOST_FRAME_OPEN", frames::host_frame_open)?;
            bind(scope, context, "__HOST_FRAME_RUN", frames::host_frame_run)?;
            bind(scope, context, "__HOST_FRAME_POST", frames::host_frame_post)?;
            bind(scope, context, "__HOST_FRAME_TAKE", frames::host_frame_take)?;
            bind(scope, context, "__HOST_FRAME_STATE", frames::host_frame_state)?;
            bind(scope, context, "__HOST_WORKER_OPEN", frames::host_worker_open)?;
        }
        if live {
            bind(scope, context, "__HOST_FETCH", bridge::host_fetch)?;
            bind(scope, context, "__HOST_FETCH_BYTES", bridge::host_fetch_bytes)?;
            bind(scope, context, "__HOST_FETCH_HEADERS", bridge::host_fetch_headers)?;
        }

        env::load(scope, page_url, user_agent, options)?;

        if options.diagnostics {
            run(scope, "__setDiag(true);", "diagnostics")?;
        }
        // Ghosts stand in for globals the environment does not define.
        if live {
            run(scope, "__setGhosts(false);", "ghost-mode")?;
        }
        // Last point before page code runs, so the snapshot covers only the environment.
        if std::env::var("VERI_NOSEAL").is_err() {
            run(scope, "__sealInternals();", "seal-internals")?;
        }

        misses.arm();

        // The environment compiles functions of its own before the page runs.
        let _ = run(
            scope,
            "if (globalThis.__FN_TRACE) globalThis.__FN_TRACE.length = 0;",
            "trace-reset",
        );
        if let Some(pre) = program.prelude {
            run(scope, pre, "prelude")?;
        }

        let bootstrap = program.bootstrap.filter(|_| live);
        let mut catch_sites = Vec::new();
        if let Some(src) = bootstrap {
            let (src, sites) = catches_traced(src, options.trace_catch);
            catch_sites = sites;
            let (line, col) = program.bootstrap_at;
            run_at(scope, &src, "page-bootstrap", Some((page_url, line, col)))?;
        } else if let Some(seed) = program.seed {
            run(scope, seed, "seed")?;
        }

        for name in program.watch {
            let src = format!(
                "if (window.{name} && !window.{name}.__watched) {{ \
                   window.{name} = __watch('{name}', window.{name}); }}"
            );
            run(scope, &src, "watch")?;
        }

        if bootstrap.is_none() {
            let (src, sites) = catches_traced(payload, options.trace_catch);
            catch_sites = sites;
            let scoped = format!(
                "(function(){{ with (__GLOBAL_PROXY) {{\n{src}\n}} }})\
                 .call(__GLOBAL_PROXY);"
            );
            if let Err(e) = run(scope, &scoped, "orchestrate") {
                out.errors.push(e);
            }
        }

        drive_to_complete(scope, options.stop_when_cookie.as_deref());
        read_back(scope, &mut out);

        if options.diagnostics {
            out.diagnostics = Some(diagnostics::collect(
                scope,
                &misses,
                &catch_sites,
                payload,
                options.capture_dir.as_deref(),
            ));
        }
        Ok(())
    })();

    out.requests = bridge_guard.calls();
    out.elapsed = started.elapsed();

    if std::env::var("VERI_FLOW").is_ok() {
        let times = bridge_guard.call_times();
        eprintln!("── flow ({:?}) ──", out.elapsed);
        for (i, c) in out.requests.iter().enumerate() {
            eprintln!("   t+{:>6}ms  {c}", times.get(i).copied().unwrap_or(0));
        }
        for c in &out.cookies_set {
            eprintln!("   COOKIE {}", c.split(';').next().unwrap_or(c));
        }
        for e in &out.errors {
            eprintln!("   ERR {e}");
        }
    }

    let timed_out = dog.as_ref().is_some_and(|d| d.fired());
    if let Some(d) = dog.take() {
        drop(d);
    }
    if timed_out {
        return Err(SolveFailure::TimedOut(options.timeout.unwrap_or_default()));
    }
    result?;
    Ok(out)
}

fn catches_traced(src: &str, on: bool) -> (String, Vec<usize>) {
    if on {
        instrument_catches(src)
    } else {
        (src.to_string(), Vec::new())
    }
}

fn read_back(scope: &mut v8::HandleScope, out: &mut SolveOutput) {
    out.net = eval_json(scope, "JSON.stringify(__NET)");
    out.records = eval(scope, "String(__REC.length)").parse().unwrap_or(0);
    out.value = eval_json(
        scope,
        "JSON.stringify(Object.prototype.hasOwnProperty.call(globalThis, '__VALUE') \
         ? String(globalThis.__VALUE) : null)",
    );
    out.cookies_set = eval_json(scope, "JSON.stringify(globalThis.__COOKIES_SET || [])");
    out.errors.extend(eval_json::<Vec<String>>(
        scope,
        "JSON.stringify(__EVENT_ERRORS.map(e => e.ev + ': ' + e.err + \
         (e.stack ? '\\n        ' + e.stack : '')))",
    ));
}

fn bind(
    scope: &mut v8::HandleScope,
    context: v8::Local<v8::Context>,
    name: &str,
    f: impl v8::MapFnTo<v8::FunctionCallback>,
) -> Result<(), SolveFailure> {
    let g = context.global(scope);
    let func = v8::Function::new(scope, f)
        .ok_or_else(|| SolveFailure::Failed(format!("could not bind {name}")))?;
    let key = v8::String::new(scope, name)
        .ok_or_else(|| SolveFailure::Failed(format!("could not name {name}")))?;
    g.set(scope, key.into(), func.into());
    Ok(())
}
