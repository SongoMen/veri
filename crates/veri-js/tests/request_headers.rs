//! A challenge may put its answer in a request header rather than a body.

mod common;
use common::CHROME_UA;
use std::sync::{Arc, Mutex};
use veri_core::{HttpBridge, Solver};
use veri_js::V8Solver;

struct HeaderSpy(Mutex<Vec<String>>);

impl HttpBridge for HeaderSpy {
    fn request(&self, method: &str, url: &str, _body: &str) -> (u16, String) {
        self.0.lock().unwrap().push(format!("{method} {url} headers=<none>"));
        (200, String::new())
    }

    fn request_with_headers(
        &self,
        method: &str,
        url: &str,
        _body: &str,
        headers: &[(String, String)],
    ) -> (u16, String) {
        let named: Vec<String> = headers.iter().map(|(k, v)| format!("{k}={v}")).collect();
        self.0.lock().unwrap().push(format!("{method} {url} headers={}", named.join("&")));
        (200, String::new())
    }
}

fn run(script: &str) -> Vec<String> {
    let spy = Arc::new(HeaderSpy(Mutex::new(Vec::new())));
    let html = format!("<html><body><script>{script}</script></body></html>");
    let report = V8Solver::new()
        .shadow_dom(true)
        .solve(&html, "https://x.test/page", CHROME_UA, spy.clone())
        .expect("the page must run");
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    let calls = spy.0.lock().unwrap().clone();
    calls
}

#[test]
fn fetch_headers_reach_the_bridge() {
    let calls = run("fetch('/submit', { method: 'POST', headers: { \
           'x-proof': 'abc', 'x-proof-version': '2' } });");
    let call = calls.iter().find(|c| c.contains("/submit")).expect("the submit was never made");
    assert!(call.starts_with("POST"), "{call}");
    assert!(call.contains("x-proof=abc"), "{call}");
    assert!(call.contains("x-proof-version=2"), "{call}");
}

#[test]
fn xhr_headers_reach_the_bridge() {
    let calls = run("var x = new XMLHttpRequest();\
         x.open('POST', '/submit');\
         x.setRequestHeader('x-proof', 'def');\
         x.send('');");
    let call = calls.iter().find(|c| c.contains("/submit")).expect("the submit was never made");
    assert!(call.contains("x-proof=def"), "{call}");
}

/// A `Headers` object rather than a plain literal is the other spelling, and it
/// only yields its pairs through `forEach`.
#[test]
fn a_headers_object_is_read_the_same_way() {
    let calls = run("var h = new Headers();\
         h.append('x-proof', '3.1;ghi');\
         fetch('/submit', { method: 'POST', headers: h });");
    let call = calls.iter().find(|c| c.contains("/submit")).expect("the submit was never made");
    assert!(call.contains("x-proof=3.1;ghi"), "{call}");
}

/// A request with nothing to add must not pay for the header path, so an
/// implementation that only overrides `request` keeps working unchanged.
#[test]
fn a_request_with_no_headers_takes_the_plain_route() {
    let calls = run("fetch('/plain');");
    let call = calls.iter().find(|c| c.contains("/plain")).expect("the fetch was never made");
    assert!(call.ends_with("headers=<none>"), "{call}");
}

/// `TextDecoder` over a view has to honour its offset and length. A wasm shim
/// reads every string it passes to JS as a `DataView` into linear memory, so
/// decoding the whole buffer hands it megabytes of heap instead of a name.
#[test]
fn text_decoder_honours_a_views_offset_and_length() {
    let calls = run("var buf = new ArrayBuffer(64);\
         var all = new Uint8Array(buf);\
         all.fill(88);\
         var word = '_makeFuncWrapper';\
         for (var i = 0; i < word.length; i++) all[20 + i] = word.charCodeAt(i);\
         var view = new DataView(buf, 20, word.length);\
         var got = new TextDecoder('utf-8').decode(view);\
         fetch('/submit', { method: 'POST', headers: { 'x-decoded': got } });");
    let call = calls.iter().find(|c| c.contains("/submit")).expect("the submit was never made");
    assert!(call.contains("x-decoded=_makeFuncWrapper"), "the view's window was ignored: {call}");
}

#[test]
fn relative_urls_resolve_against_the_page() {
    let page = "<html><body><script>\
        fetch('sub/one'); fetch('/two'); fetch('//other.test/three');\
        </script></body></html>";
    let spy = Arc::new(HeaderSpy(Mutex::new(Vec::new())));
    V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://x.test/dir/page.html", "ua", spy.clone())
        .expect("the page runs");
    let urls = spy.0.lock().unwrap().clone();
    let hit = |want: &str| urls.iter().any(|u| u.contains(want));
    assert!(hit("https://x.test/dir/sub/one"), "{urls:?}");
    assert!(hit("https://x.test/two"), "{urls:?}");
    assert!(hit("https://other.test/three"), "{urls:?}");
}

#[test]
fn reading_a_response_as_bytes_does_not_send_it_again() {
    let page = "<html><body><script>\
        fetch('/one').then((r) => r.arrayBuffer()).then(() => fetch('/done'));\
        </script></body></html>";
    let spy = Arc::new(HeaderSpy(Mutex::new(Vec::new())));
    V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://x.test/", "ua", spy.clone())
        .expect("the page runs");
    let calls = spy.0.lock().unwrap().clone();
    let ones = calls.iter().filter(|c| c.contains("/one")).count();
    assert_eq!(ones, 1, "sent {ones} times: {calls:?}");
    assert!(calls.iter().any(|c| c.contains("/done")), "the chain never finished: {calls:?}");
}
