//! Everything a solve can tell you about itself, and none of it on the hot path.

use super::lifecycle::{eval, eval_json};
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::path::Path;
use veri_core::Diagnostics;

thread_local! {
    static GLOBAL_MISSES: RefCell<BTreeMap<String, usize>> = const { RefCell::new(BTreeMap::new()) };
    static MISS_ARMED: Cell<bool> = const { Cell::new(false) };
}

pub struct MissGuard {
    _private: (),
}

impl MissGuard {
    pub fn install() -> Self {
        GLOBAL_MISSES.with(|m| m.borrow_mut().clear());
        MISS_ARMED.with(|a| a.set(false));
        Self { _private: () }
    }

    /// Start counting. Call once the environment is fully materialised.
    pub fn arm(&self) {
        MISS_ARMED.with(|a| a.set(true));
    }

    pub fn take(&self) -> Vec<(String, usize)> {
        GLOBAL_MISSES.with(|m| most_used(m.borrow().iter().map(|(k, c)| (k.clone(), *c))))
    }
}

fn most_used(counts: impl Iterator<Item = (String, usize)>) -> Vec<(String, usize)> {
    let mut v: Vec<(String, usize)> = counts.collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v
}

impl Drop for MissGuard {
    fn drop(&mut self) {
        MISS_ARMED.with(|a| a.set(false));
        GLOBAL_MISSES.with(|m| m.borrow_mut().clear());
    }
}

/// Fires only for global names that normal lookup does not find.
pub fn global_miss(
    scope: &mut v8::HandleScope,
    key: v8::Local<v8::Name>,
    _args: v8::PropertyCallbackArguments,
    _rv: v8::ReturnValue<v8::Value>,
) -> v8::Intercepted {
    if !MISS_ARMED.with(|a| a.get()) {
        return v8::Intercepted::No;
    }
    if let Ok(s) = v8::Local::<v8::String>::try_from(key) {
        let name = s.to_rust_string_lossy(scope);
        // `__`-prefixed names are the host's own.
        if !name.starts_with("__") {
            GLOBAL_MISSES.with(|m| *m.borrow_mut().entry(name).or_default() += 1);
        }
    }
    v8::Intercepted::No
}

const RENDERED: &str = r#"
(function () {
  const out = [];
  try { if (document.title) out.push('title: ' + document.title); } catch (e) {}
  for (const el of (globalThis.__ELEMENTS || [])) {
    try {
      for (const k of ['textContent', 'innerHTML', 'value']) {
        const v = el[k];
        if (typeof v === 'string' && v.trim().length > 2) {
          out.push(el.tagName + '.' + k + ': ' + v.trim().slice(0, 400));
        }
      }
    } catch (e) {}
  }
  return JSON.stringify([...new Set(out)]);
})()
"#;

/// `__REC` runs to hundreds of thousands of entries, so it is counted inside
/// the isolate rather than serialised across the boundary.
const SURFACE: &str = r#"
(function () {
  const kinds = new Map(), missing = new Map(), known = new Map(), calls = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const r of __REC) {
    bump(kinds, r[0]);
    switch (r[0]) {
      case 'get:MISSING': case 'has:MISSING': bump(missing, r[1]); break;
      case 'get:known':   case 'has:known':   bump(known, r[1]);   break;
      case 'call':        case 'new':         bump(calls, r[1]);   break;
    }
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
  return JSON.stringify({
    kinds: top(kinds, 32),
    missing: top(missing, 200),
    known: top(known, 100),
    calls: top(calls, 100),
  });
})()
"#;

#[derive(Default, serde::Deserialize)]
struct Surface {
    #[serde(default)]
    kinds: Vec<(String, usize)>,
    #[serde(default)]
    missing: Vec<(String, usize)>,
    #[serde(default)]
    known: Vec<(String, usize)>,
    #[serde(default)]
    calls: Vec<(String, usize)>,
}

pub fn collect(
    scope: &mut v8::HandleScope,
    misses: &MissGuard,
    catch_sites: &[usize],
    payload: &str,
    capture_dir: Option<&Path>,
) -> Diagnostics {
    let surface: Surface = eval_json(scope, SURFACE);
    let mut d = Diagnostics {
        operations_by_kind: surface.kinds,
        missing_surface: surface.missing,
        satisfied_surface: surface.known,
        invocations: surface.calls,
        rendered: eval_json(scope, RENDERED),
        fn_threw: eval_json(scope, "JSON.stringify(globalThis.__FN_THREW || [])"),
        fn_trace: eval_json(scope, "JSON.stringify(globalThis.__FN_TRACE || [])"),
        fn_bodies: eval_json(scope, "JSON.stringify(globalThis.__FN_BODIES || [])"),
        undef_calls: most_used(
            eval_json::<BTreeMap<String, usize>>(
                scope,
                "JSON.stringify(globalThis.__UNDEF_CALLS || {})",
            )
            .into_iter(),
        ),
        attribute_log: eval_json(scope, "JSON.stringify(globalThis.__ATTR_LOG || [])"),
        profile_stats: None,
        scripts_loaded: eval_json::<Vec<serde_json::Value>>(
            scope,
            "JSON.stringify(globalThis.__SCRIPTS_LOADED || [])",
        )
        .iter()
        .map(|s| s.to_string())
        .collect(),
        caught: Vec::new(),
        global_misses: misses.take(),
        decoded_fragments: eval(scope, "String(__CODE.length)").parse().unwrap_or(0),
    };

    let stats = eval(scope, "JSON.stringify(globalThis.__PROFILE_STATS || {})");
    if stats.len() > 2 {
        d.profile_stats = Some(stats);
    }

    let caught: Vec<serde_json::Value> = eval_json(scope, "JSON.stringify(__CAUGHT_LOG)");
    d.caught = caught.iter().map(|e| swallowed(e, catch_sites, payload)).collect();

    if let Some(dir) = capture_dir {
        capture(scope, dir);
    }
    d
}

fn swallowed(e: &serde_json::Value, catch_sites: &[usize], payload: &str) -> String {
    let site = e["site"].as_u64().unwrap_or(u64::MAX) as usize;
    let ctx = catch_sites
        .get(site)
        .map(|&off| {
            let lo = off.saturating_sub(220);
            format!("  @orig[{off}] ...{}", payload.get(lo..off).unwrap_or(""))
        })
        .unwrap_or_default();
    let near = e["near"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" | "))
        .unwrap_or_default();
    format!(
        "{}\n     thrown at: {}\n     decoded names: {}\n     read just before: {near}\n     {ctx}",
        e["msg"].as_str().unwrap_or(""),
        e["stack"].as_str().unwrap_or(""),
        e["names"].as_str().unwrap_or(""),
    )
}

/// Explicit directory: where a library writes is not its own to decide.
fn capture(scope: &mut v8::HandleScope, dir: &Path) {
    let loaded: Vec<serde_json::Value> =
        eval_json(scope, "JSON.stringify(globalThis.__SCRIPT_SOURCES || [])");
    write_all(
        &dir.join("loaded"),
        loaded.iter().enumerate().map(|(i, s)| {
            (
                format!("{i:02}.js"),
                format!(
                    "// {}\n{}",
                    s["src"].as_str().unwrap_or("inline"),
                    s["code"].as_str().unwrap_or("")
                ),
            )
        }),
    );

    let decoded: Vec<serde_json::Value> = eval_json(scope, "JSON.stringify(__CODE)");
    write_all(
        &dir.join("decoded"),
        decoded.iter().enumerate().map(|(i, c)| {
            (
                format!("{i:03}_{}.js", c["kind"].as_str().unwrap_or("x")),
                c["src"].as_str().unwrap_or("").to_string(),
            )
        }),
    );
}

fn write_all(dir: &Path, files: impl Iterator<Item = (String, String)>) {
    let mut files = files.peekable();
    if files.peek().is_none() {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(dir) {
        tracing::warn!(dir = %dir.display(), error = %e, "could not create capture directory");
        return;
    }
    for (name, body) in files {
        let path = dir.join(name);
        match std::fs::write(&path, &body) {
            Ok(()) => tracing::debug!(path = %path.display(), bytes = body.len(), "captured"),
            Err(e) => tracing::warn!(path = %path.display(), error = %e, "capture failed"),
        }
    }
}
