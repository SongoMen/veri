//! A framed document, in a context of its own.
//!
//! A frame cannot share the page's context. Its scripts read their global from
//! `this`, and a nested call in sloppy mode binds that to the realm the function
//! was compiled in, so a page-hosted frame silently initialises itself into the
//! page. Nothing a proxy or a `with` block does changes that; only a second
//! context does.

use super::{bridge::arg, env, lifecycle::run, options::SolveOptions};
use std::cell::RefCell;

thread_local! {
    static FRAMES: RefCell<Vec<v8::Global<v8::Context>>> = const { RefCell::new(Vec::new()) };
    /// Messages a frame sent to its parent, waiting for the page to collect.
    static INBOX: RefCell<Vec<(usize, String)>> = const { RefCell::new(Vec::new()) };
}

pub fn reset() {
    FRAMES.with(|f| f.borrow_mut().clear());
    INBOX.with(|i| i.borrow_mut().clear());
}

const MAX_FRAME_DEPTH: u32 = 3;

fn parent_depth(scope: &mut v8::HandleScope) -> u32 {
    super::lifecycle::eval(scope, "String(globalThis.__FRAME_DEPTH || 0)").parse().unwrap_or(0)
}

/// A child realm is the same browser as the page that opened it, so its
/// options come from the parent's globals rather than from the defaults. A
/// widget that builds its UI in a shadow root got `undefined` back from
/// `attachShadow` here while the page it came from had one.
fn inherited_options(scope: &mut v8::HandleScope) -> SolveOptions {
    let flag =
        |scope: &mut v8::HandleScope, expr: &str| super::lifecycle::eval(scope, expr) == "true";
    let diagnostics = flag(scope, "String(__diagOn())");
    let shadow_dom = flag(scope, "String(!!globalThis.__SHADOW_DOM)");
    let trace_undef = flag(scope, "String(!!globalThis.__TRACE_UNDEF)");
    let tz = super::lifecycle::eval(scope, "String(globalThis.__TZ_OVERRIDE || '')");
    SolveOptions {
        frames: parent_depth(scope) + 1 < MAX_FRAME_DEPTH,
        diagnostics,
        shadow_dom,
        trace_undef,
        timezone: if tz.is_empty() { None } else { Some(tz) },
        ..SolveOptions::default()
    }
}

/// `__HOST_FRAME_OPEN(url, ua)` builds the context and returns its index.
pub fn host_frame_open(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let (url, ua) = (arg(&args, 0, scope), arg(&args, 1, scope));
    let child_depth = parent_depth(scope) + 1;
    let options = inherited_options(scope);
    let diag = options.diagnostics;

    let context = v8::Context::new(scope, v8::ContextOptions::default());
    let index = FRAMES.with(|f| {
        let g = v8::Global::new(scope, context);
        f.borrow_mut().push(g);
        f.borrow().len() - 1
    });

    let ok = {
        let inner = &mut v8::ContextScope::new(scope, context);
        let bound = bind(inner, context, "__HOST_PARENT_POST", host_parent_post)
            && bind(inner, context, "__HOST_FETCH", super::bridge::host_fetch)
            && bind(inner, context, "__HOST_FETCH_BYTES", super::bridge::host_fetch_bytes)
            && bind(inner, context, "__HOST_FETCH_HEADERS", super::bridge::host_fetch_headers)
            && bind(inner, context, "__HOST_WORKER_OPEN", host_worker_open)
            && bind(inner, context, "__HOST_RUN", super::bridge::host_run);
        // The frame's own `parent` is the only way out of its context, and the
        // page reaches in through `__deliverFromParent`.
        let glue = format!(
            "globalThis.__FRAME_INDEX = {index};\n\
             (function () {{\n\
               globalThis.__PORT_PREFIX = 'f{index}_';\n\
               const toParent = function (id, payload) {{\n\
                 try {{ __HOST_PARENT_POST(JSON.stringify({{ __portMsg: {{ id: id, data: payload }} }})); }} catch (e) {{}}\n\
               }};\n\
               const post = function (data, origin, transfer) {{\n\
                 let ports = [];\n\
                 try {{ ports = globalThis.__portsOut ? globalThis.__portsOut(transfer, toParent) : []; }} catch (e) {{}}\n\
                 try {{ __HOST_PARENT_POST(JSON.stringify({{ data: data, __ports: ports }})); }} catch (e) {{}}\n\
               }};\n\
               const up = {{ postMessage: post }};\n\
               up.parent = up; up.top = up; up.window = up; up.self = up;\n\
               globalThis.parent = up;\n\
               globalThis.top = up;\n\
               /* A cross-origin frame reads null here, never undefined, and a\n\
                  widget that tests it for null takes the same-origin branch. */\n\
               globalThis.frameElement = null;\n\
               globalThis.__deliverFromParent = function (json) {{\n\
                 let m;\n\
                 try {{ m = JSON.parse(json); }} catch (e) {{ return; }}\n\
                 if (m.__portMsg) {{\n\
                   if (globalThis.__portDeliver) globalThis.__portDeliver(m.__portMsg.id, m.__portMsg.data);\n\
                   return;\n\
                 }}\n\
                 let inPorts = [];\n\
                 try {{ inPorts = globalThis.__portsIn ? globalThis.__portsIn(m.__ports, toParent) : []; }} catch (e) {{}}\n\
                 for (const p of inPorts) {{ try {{ p.start(); }} catch (e) {{}} }}\n\
                 const ev = {{\n\
                   type: 'message', isTrusted: true, data: m.data, origin: m.origin || '',\n\
                   source: up, lastEventId: '', ports: inPorts, bubbles: false, cancelable: false,\n\
                 }};\n\
                 for (const f of ((globalThis.__LISTENERS.window || {{}}).message || []).slice()) {{\n\
                   try {{ typeof f === 'function' ? f(ev) : f.handleEvent(ev); }} catch (e) {{}}\n\
                 }}\n\
                 if (typeof globalThis.onmessage === 'function') {{\n\
                   try {{ globalThis.onmessage(ev); }} catch (e) {{}}\n\
                 }}\n\
               }};\n\
             }})();"
        );
        // Ghosts make the global proxy claim every name, which swallows the
        // parameters the eval shim passes through its own `with` block. The page
        // turns them off before any page code runs; a frame needs the same.
        bound
            && env::load(inner, &url, &ua, &options).is_ok()
            && {
                let stamp = format!("globalThis.__FRAME_DEPTH = {};", child_depth);
                super::lifecycle::eval(inner, &stamp);
                true
            }
            && run(inner, "__setGhosts(false);", "frame-ghosts").is_ok()
            && (!diag || run(inner, "__setDiag(true);", "frame-diag").is_ok())
            && run(inner, &glue, "frame-glue").is_ok()
            // Everything the environment needs of itself is hidden from the
            // page; a frame that leaves it on show is a frame worth refusing.
            && run(inner, "__sealInternals();", "frame-seal").is_ok()
    };

    rv.set(v8::Integer::new(scope, if ok { index as i32 } else { -1 }).into());
}

/// `__HOST_WORKER_OPEN(source, ua)` gives a worker a realm of its own and runs
/// it there. A worker sharing the page's context reads its global from `this`
/// and lands on the page, exactly as a frame did.
pub fn host_worker_open(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let (src, ua) = (arg(&args, 0, scope), arg(&args, 1, scope));
    let url = arg(&args, 2, scope);
    let child_depth = parent_depth(scope) + 1;
    let options = inherited_options(scope);
    let diag = options.diagnostics;

    let context = v8::Context::new(scope, v8::ContextOptions::default());
    let index = FRAMES.with(|f| {
        let g = v8::Global::new(scope, context);
        f.borrow_mut().push(g);
        f.borrow().len() - 1
    });

    let ok = {
        let inner = &mut v8::ContextScope::new(scope, context);
        let bound = bind(inner, context, "__HOST_PARENT_POST", host_parent_post)
            && bind(inner, context, "__HOST_FETCH", super::bridge::host_fetch)
            && bind(inner, context, "__HOST_FETCH_BYTES", super::bridge::host_fetch_bytes)
            && bind(inner, context, "__HOST_FETCH_HEADERS", super::bridge::host_fetch_headers)
            && bind(inner, context, "__HOST_RUN", super::bridge::host_run);
        let glue = format!("globalThis.__FRAME_INDEX = {index};\n{WORKERISE}");
        bound
            && env::load(inner, &url, &ua, &options).is_ok()
            && {
                let stamp = format!("globalThis.__FRAME_DEPTH = {};", child_depth);
                super::lifecycle::eval(inner, &stamp);
                true
            }
            && run(inner, "__setGhosts(false);", "worker-ghosts").is_ok()
            && (!diag || run(inner, "__setDiag(true);", "worker-diag").is_ok())
            && run(inner, &glue, "worker-glue").is_ok()
            && run(inner, "__sealInternals();", "worker-seal").is_ok()
            && run(inner, &src, "worker-source").is_ok()
    };

    rv.set(v8::Integer::new(scope, if ok { index as i32 } else { -1 }).into());
}

/// Turns a freshly loaded window environment into a worker one: no document, no
/// window, its own interfaces, and `postMessage` pointing at the page.
const WORKERISE: &str = r#"
(function () {
  for (const k of ['window', 'document', 'frames', 'parent', 'top', 'frameElement',
                   'localStorage', 'sessionStorage', 'history', 'screen', 'alert']) {
    try { delete globalThis[k]; } catch (e) {}
  }
  const illegal = (name) => {
    const c = function () { throw new TypeError('Illegal constructor'); };
    Object.defineProperty(c, 'name', { value: name, configurable: true });
    return c;
  };
  const WGS = illegal('WorkerGlobalScope');
  const DWGS = illegal('DedicatedWorkerGlobalScope');
  const WN = illegal('WorkerNavigator');
  const WL = illegal('WorkerLocation');
  try {
    if (globalThis.EventTarget && globalThis.EventTarget.prototype) {
      Object.setPrototypeOf(WGS.prototype, globalThis.EventTarget.prototype);
    }
    Object.setPrototypeOf(DWGS.prototype, WGS.prototype);
    Object.setPrototypeOf(globalThis, DWGS.prototype);
    if (globalThis.navigator) {
      // WorkerNavigator carries a subset of Navigator's members; reprototyping to a
      // bare WN wiped userAgent/userAgentData/platform/... (they live on
      // Navigator.prototype as getters), so the worker fingerprint - which reads
      // navigator.userAgentData.getHighEntropyValues() and posts ~23 signals back -
      // saw an empty navigator. Copy the worker-relevant descriptors onto WN first.
      const navProto = Object.getPrototypeOf(globalThis.navigator);
      const WN_PROPS = ['userAgent', 'userAgentData', 'platform', 'appCodeName', 'appName',
        'appVersion', 'product', 'productSub', 'vendor', 'vendorSub', 'language', 'languages',
        'onLine', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'storage',
        'connection', 'permissions', 'locks', 'gpu', 'sendBeacon', 'clearAppBadge', 'setAppBadge'];
      for (const k of WN_PROPS) {
        try {
          const d = Object.getOwnPropertyDescriptor(navProto, k);
          if (d) Object.defineProperty(WN.prototype, k, d);
        } catch (e) {}
      }
      Object.setPrototypeOf(globalThis.navigator, WN.prototype);
    }
    if (globalThis.location) Object.setPrototypeOf(globalThis.location, WL.prototype);
  } catch (e) {}
  globalThis.WorkerGlobalScope = WGS;
  globalThis.DedicatedWorkerGlobalScope = DWGS;
  globalThis.WorkerNavigator = WN;
  globalThis.WorkerLocation = WL;
  globalThis.self = globalThis;
  // Was a no-op, so a worker built by `importScripts(url)` ran with nothing
  // imported and every later reference threw. reCAPTCHA's worker is exactly one
  // line of importScripts, so its side of the protocol never ran at all.
  // Synchronous by spec, and the bridge is synchronous, so this matches.
  globalThis.importScripts = function () {
    for (let i = 0; i < arguments.length; i++) {
      const raw = String(arguments[i]);
      let abs = raw;
      try { abs = new URL(raw, globalThis.location && globalThis.location.href).href; } catch (e) {}
      let body = '';
      try {
        const r = JSON.parse(__HOST_FETCH('GET', abs, ''));
        if (!(r.status >= 200 && r.status < 400) || !r.body) {
          throw new Error('importScripts failed: ' + abs + ' (' + r.status + ')');
        }
        body = String(r.body);
      } catch (e) {
        throw new Error('importScripts could not fetch ' + abs);
      }
      (0, eval)(body);
    }
  };
  globalThis.close = function () {};
  globalThis.postMessage = function (data) {
    try { __HOST_PARENT_POST(JSON.stringify({ data: data })); } catch (e) {}
  };
  globalThis.__deliverFromParent = function (json) {
    let m;
    try { m = JSON.parse(json); } catch (e) { return; }
    const ev = { type: 'message', isTrusted: true, data: m.data, origin: '', lastEventId: '', ports: [],
                 bubbles: false, cancelable: false, source: null };
    for (const f of ((globalThis.__LISTENERS.window || {}).message || []).slice()) {
      try { typeof f === 'function' ? f(ev) : f.handleEvent(ev); } catch (e) {}
    }
    if (typeof globalThis.onmessage === 'function') {
      try { globalThis.onmessage(ev); } catch (e) {}
    }
  };
})();
"#;

/// `__HOST_FRAME_RUN(index, source)` evaluates a script inside that frame.
pub fn host_frame_run(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let index = args.get(0).int32_value(scope).unwrap_or(-1);
    let src = arg(&args, 1, scope);
    let out = with_frame(scope, index, |inner| match run(inner, &src, "frame-script") {
        Ok(()) => String::new(),
        Err(e) => e,
    })
    .unwrap_or_else(|| "no such frame".to_string());
    if let Some(s) = v8::String::new(scope, &out) {
        rv.set(s.into());
    }
}

/// `__HOST_FRAME_POST(index, json)` delivers a message into the frame.
pub fn host_frame_post(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let index = args.get(0).int32_value(scope).unwrap_or(-1);
    let json = arg(&args, 1, scope);
    let src = format!("__deliverFromParent({});", super::js(&json));
    with_frame(scope, index, |inner| {
        let _ = run(inner, &src, "frame-deliver");
    });
}

/// Called from inside a frame: hands a message up to the page.
pub fn host_parent_post(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let json = arg(&args, 0, scope);
    let index = super::lifecycle::eval(scope, "String(globalThis.__FRAME_INDEX)")
        .parse::<usize>()
        .unwrap_or(0);
    INBOX.with(|i| i.borrow_mut().push((index, json)));
}

/// `__HOST_FRAME_STATE(index, expr)` evaluates inside a frame, for diagnosis.
pub fn host_frame_state(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let index = args.get(0).int32_value(scope).unwrap_or(-1);
    let expr = arg(&args, 1, scope);
    let out = with_frame(scope, index, |inner| super::lifecycle::eval(inner, &expr))
        .unwrap_or_else(|| "no frame".to_string());
    if let Some(s) = v8::String::new(scope, &out) {
        rv.set(s.into());
    }
}

/// `__HOST_FRAME_TAKE()` drains what the frames sent up, as JSON.
pub fn host_frame_take(
    scope: &mut v8::HandleScope,
    _args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let taken = INBOX.with(|i| std::mem::take(&mut *i.borrow_mut()));
    let rows: Vec<String> =
        taken.into_iter().map(|(i, j)| format!("{{\"i\":{i},\"m\":{j}}}")).collect();
    let json = format!("[{}]", rows.join(","));
    if let Some(s) = v8::String::new(scope, &json) {
        rv.set(s.into());
    }
}

/// Runs every frame's timer queue once, so a framed document makes progress
/// alongside the page rather than only when the page happens to poke it.
pub fn drain(scope: &mut v8::HandleScope) -> usize {
    let total = FRAMES.with(|f| f.borrow().len());
    let mut ran = 0;
    for index in 0..total {
        ran += with_frame(scope, index as i32, |inner| {
            super::lifecycle::eval(inner, "String(__drainOnce())").parse::<usize>().unwrap_or(0)
        })
        .unwrap_or(0);
    }
    ran
}

fn bind(
    scope: &mut v8::HandleScope,
    context: v8::Local<v8::Context>,
    name: &str,
    f: impl v8::MapFnTo<v8::FunctionCallback>,
) -> bool {
    let global = context.global(scope);
    let (Some(func), Some(key)) = (v8::Function::new(scope, f), v8::String::new(scope, name))
    else {
        return false;
    };
    global.set(scope, key.into(), func.into());
    true
}

fn with_frame<T>(
    scope: &mut v8::HandleScope,
    index: i32,
    f: impl FnOnce(&mut v8::HandleScope) -> T,
) -> Option<T> {
    if index < 0 {
        return None;
    }
    let global = FRAMES.with(|fr| fr.borrow().get(index as usize).cloned())?;
    let context = v8::Local::new(scope, global);
    let inner = &mut v8::ContextScope::new(scope, context);
    Some(f(inner))
}
