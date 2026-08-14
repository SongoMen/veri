//! The one door out of the isolate.
//!
//! V8 callbacks carry no user data we control, so a thread-local is the only
//! channel to the caller's HTTP client.

use std::cell::RefCell;
use std::sync::Arc;
use veri_core::{BridgeCall, HttpBridge};

thread_local! {
    /// The caller's HTTP client, reachable from V8 callbacks.
    static BRIDGE: RefCell<Option<Arc<dyn HttpBridge>>> = const { RefCell::new(None) };
    static BRIDGE_LOG: RefCell<Vec<BridgeCall>> = const { RefCell::new(Vec::new()) };
    static PAGE_URL: RefCell<String> = const { RefCell::new(String::new()) };
    static STARTED: RefCell<Option<std::time::Instant>> = const { RefCell::new(None) };
    static CALL_MS: RefCell<Vec<u128>> = const { RefCell::new(Vec::new()) };
}

pub struct BridgeGuard {
    _private: (),
}

impl BridgeGuard {
    pub fn install(bridge: Option<Arc<dyn HttpBridge>>, page_url: String) -> Self {
        BRIDGE.with(|b| *b.borrow_mut() = bridge);
        PAGE_URL.with(|u| *u.borrow_mut() = page_url);
        BRIDGE_LOG.with(|l| l.borrow_mut().clear());
        STARTED.with(|s| *s.borrow_mut() = Some(std::time::Instant::now()));
        CALL_MS.with(|t| t.borrow_mut().clear());
        Self { _private: () }
    }

    pub fn calls(&self) -> Vec<BridgeCall> {
        BRIDGE_LOG.with(|l| l.borrow().clone())
    }

    pub fn call_times(&self) -> Vec<u128> {
        CALL_MS.with(|t| t.borrow().clone())
    }
}

impl Drop for BridgeGuard {
    fn drop(&mut self) {
        BRIDGE.with(|b| *b.borrow_mut() = None);
        PAGE_URL.with(|u| u.borrow_mut().clear());
        BRIDGE_LOG.with(|l| l.borrow_mut().clear());
        STARTED.with(|s| *s.borrow_mut() = None);
        CALL_MS.with(|t| t.borrow_mut().clear());
    }
}

/// Whether the session behind the installed bridge holds `name`.
pub fn holds_cookie(name: &str) -> bool {
    BRIDGE.with(|b| b.borrow().as_ref().is_some_and(|br| br.holds_cookie(name)))
}

pub(super) fn arg(args: &v8::FunctionCallbackArguments, i: i32, s: &mut v8::HandleScope) -> String {
    let a = args.get(i);
    if a.is_null_or_undefined() {
        String::new()
    } else {
        a.to_rust_string_lossy(s)
    }
}

fn fetched<T>(
    method: &str,
    url: &str,
    body: &str,
    len: impl Fn(&T) -> usize,
    send: impl FnOnce(&dyn HttpBridge, &str, &str, &str) -> (u16, T),
) -> Option<(u16, T)> {
    BRIDGE.with(|b| {
        let borrowed = b.borrow();
        let bridge = borrowed.as_ref()?;
        let abs = PAGE_URL.with(|u| veri_core::url::join(&u.borrow(), url));
        let (status, out) = send(bridge.as_ref(), method, &abs, body);
        CALL_MS.with(|t| {
            let ms = STARTED.with(|s| s.borrow().map(|i| i.elapsed().as_millis()).unwrap_or(0));
            t.borrow_mut().push(ms);
        });
        BRIDGE_LOG.with(|l| {
            l.borrow_mut().push(BridgeCall {
                method: method.to_ascii_uppercase(),
                url: abs,
                status,
                request_bytes: body.len(),
                response_bytes: len(&out),
            })
        });
        Some((status, out))
    })
}

fn reply(scope: &mut v8::HandleScope, mut rv: v8::ReturnValue, json: String) {
    if let Some(s) = v8::String::new(scope, &json) {
        rv.set(s.into());
    }
}

fn text_reply(fetched: Option<(u16, String)>) -> String {
    match fetched {
        Some((status, text)) => serde_json::json!({ "status": status, "body": text }).to_string(),
        None => r#"{"status":0,"body":"","error":"no bridge"}"#.to_string(),
    }
}

pub fn host_fetch(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: v8::ReturnValue,
) {
    let (method, url, body) = (arg(&args, 0, scope), arg(&args, 1, scope), arg(&args, 2, scope));
    let got = fetched(&method, &url, &body, String::len, |b, m, u, y| b.request(m, u, y));
    reply(scope, rv, text_reply(got));
}

pub fn host_fetch_headers(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: v8::ReturnValue,
) {
    let (method, url, body) = (arg(&args, 0, scope), arg(&args, 1, scope), arg(&args, 2, scope));
    let headers: Vec<(String, String)> =
        serde_json::from_str(&arg(&args, 3, scope)).unwrap_or_default();
    let got = fetched(&method, &url, &body, String::len, |b, m, u, y| {
        b.request_with_headers(m, u, y, &headers)
    });
    reply(scope, rv, text_reply(got));
}

pub fn host_fetch_bytes(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: v8::ReturnValue,
) {
    let (method, url, body) = (arg(&args, 0, scope), arg(&args, 1, scope), arg(&args, 2, scope));
    let json = match fetched(&method, &url, &body, Vec::len, |b, m, u, y| b.request_bytes(m, u, y))
    {
        Some((status, bytes)) => {
            serde_json::json!({ "status": status, "b64": veri_core::http::base64(&bytes) })
                .to_string()
        }
        None => r#"{"status":0,"b64":""}"#.to_string(),
    };
    reply(scope, rv, json);
}

/// `__HOST_RUN(source)`, injected `<script>` code has to evaluate in global
/// scope, not inside a function. Returns the exception text, or `""`.
pub fn host_run(
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let src = args.get(0).to_rust_string_lossy(scope);
    let mut tc = v8::TryCatch::new(scope);
    let ran = (|| {
        let code = v8::String::new(&mut tc, &src)?;
        let script = v8::Script::compile(&mut tc, code, None)?;
        script.run(&mut tc)?;
        Some(())
    })();
    let out = if ran.is_none() {
        tc.exception().map(|e| e.to_rust_string_lossy(&mut tc)).unwrap_or_else(|| "unknown".into())
    } else {
        String::new()
    };
    if let Some(s) = v8::String::new(&mut tc, &out) {
        rv.set(s.into());
    }
}
