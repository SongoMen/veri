//! A challenge may ship its work as WebAssembly, which needs three things V8
//! alone does not give.

mod common;
use common::CHROME_UA;
use std::sync::{Arc, Mutex};
use veri_core::{HttpBridge, Solver};
use veri_js::V8Solver;

/// The smallest valid module: exports `answer`, returning 42.
const WASM: &[u8] = &[
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic, version
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, // type: () -> i32
    0x03, 0x02, 0x01, 0x00, // function 0 has that type
    0x07, 0x0a, 0x01, 0x06, b'a', b'n', b's', b'w', b'e', b'r', 0x00, 0x00, // export
    0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b, // body: i32.const 42, end
];

struct WasmHost(Mutex<Vec<String>>);

impl HttpBridge for WasmHost {
    fn request(&self, method: &str, url: &str, body: &str) -> (u16, String) {
        let (s, b) = self.request_bytes(method, url, body);
        (s, String::from_utf8_lossy(&b).to_string())
    }

    fn request_bytes(&self, method: &str, url: &str, _body: &str) -> (u16, Vec<u8>) {
        self.0.lock().unwrap().push(format!("{method} {url}"));
        if url.ends_with(".wasm") {
            return (200, WASM.to_vec());
        }
        (200, Vec::new())
    }
}

fn run(script: &str) -> (String, Vec<String>) {
    let host = Arc::new(WasmHost(Mutex::new(Vec::new())));
    let html = format!(
        "<html><body><script>\
         function done(v) {{ \
           var x = new XMLHttpRequest(); \
           x.open('GET', 'https://echo.test/' + encodeURIComponent(String(v))); \
           x.send(); \
         }}\
         {script}\
         </script></body></html>"
    );
    let report = V8Solver::new()
        .shadow_dom(true)
        .solve(&html, "https://x.test/page", CHROME_UA, host.clone())
        .expect("the page must run");
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    let calls = host.0.lock().unwrap().clone();
    let answer = calls
        .iter()
        .find_map(|c| c.split("https://echo.test/").nth(1).map(str::to_string))
        .unwrap_or_default();
    (answer, calls)
}

#[test]
fn a_wasm_body_survives_the_bridge_as_bytes() {
    let (answer, _) = run("fetch('/m.wasm').then(function (r) { return r.arrayBuffer(); })\
         .then(function (b) { \
           var u = new Uint8Array(b); \
           done(u.length + ':' + u[0] + ',' + u[1] + ',' + u[2] + ',' + u[3]); \
         });");
    assert_eq!(
        answer,
        format!("{}%3A0%2C97%2C115%2C109", WASM.len()),
        "the wasm header must arrive as 0x00 'a' 's' 'm'"
    );
}

#[test]
fn the_streaming_entry_points_exist() {
    let (answer, _) = run(
        "done(typeof WebAssembly.instantiateStreaming + ',' + typeof WebAssembly.compileStreaming);",
    );
    assert_eq!(answer, "function%2Cfunction");
}

#[test]
fn instantiate_streaming_compiles_and_runs_a_module() {
    let (answer, _) = run("WebAssembly.instantiateStreaming(fetch('/m.wasm'))\
         .then(function (r) { done(r.instance.exports.answer()); })\
         .catch(function (e) { done('threw ' + e); });");
    assert_eq!(answer, "42");
}

#[test]
fn async_compilation_settles() {
    let (answer, _) = run("fetch('/m.wasm').then(function (r) { return r.arrayBuffer(); })\
         .then(function (b) { return WebAssembly.instantiate(b, {}); })\
         .then(function (r) { done('settled-' + r.instance.exports.answer()); })\
         .catch(function (e) { done('rejected ' + e); });");
    assert_eq!(answer, "settled-42");
}

#[test]
fn compile_streaming_produces_a_module() {
    let (answer, _) = run("WebAssembly.compileStreaming(fetch('/m.wasm'))\
         .then(function (m) { return WebAssembly.instantiate(m, {}); })\
         .then(function (i) { done(i.exports.answer()); })\
         .catch(function (e) { done('threw ' + e); });");
    assert_eq!(answer, "42");
}
