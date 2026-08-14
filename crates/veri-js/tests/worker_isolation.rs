//! A worker is a separate global, not a `with` block over the page's.

mod common;
use common::{echoed, Spy, CHROME_UA};
use std::sync::Arc;
use veri_core::Solver;
use veri_js::V8Solver;

fn page(body: &str) -> String {
    format!(
        "<html><body><script>\
         function done(v) {{ \
           var x = new XMLHttpRequest(); \
           x.open('GET', 'https://echo.test/' + encodeURIComponent(String(v))); \
           x.send(); \
         }}\
         {body}\
         </script></body></html>"
    )
}

fn worker_from(src: &str) -> String {
    format!(
        "var b = new Blob([{}], {{ type: 'text/javascript' }});\
         var w = new Worker(URL.createObjectURL(b));",
        serde_json::to_string(src).unwrap()
    )
}

#[test]
fn a_worker_assignment_does_not_reach_the_page() {
    let out = echoed(
        &page(&format!(
            "var pageValue = 'page';\
             {}\
             done('page-still-' + pageValue + ' global-' + typeof globalThis.leaked);",
            worker_from("pageValue = 'clobbered-by-worker'; leaked = 'escaped';")
        )),
        CHROME_UA,
    );
    assert_eq!(out, "page-still-page global-undefined");
}

#[test]
fn a_worker_still_sees_the_ordinary_globals() {
    let out = echoed(
        &page(&format!(
            "{}\
             w.onmessage = function (e) {{ done(e.data); }};\
             w.postMessage('go');",
            worker_from(
                "self.onmessage = function () { \
                   postMessage(typeof JSON + ',' + typeof Promise + ',' + typeof crypto \
                     + ',' + typeof navigator.userAgent); \
                 };"
            )
        )),
        CHROME_UA,
    );
    assert_eq!(out, "object,function,object,string");
}

#[test]
fn a_worker_script_named_by_url_is_fetched_through_the_bridge() {
    let bridge =
        Spy::new("self.onmessage = function () { postMessage('from-the-fetched-worker'); };");
    let html = page(
        "var w = new Worker('/static/worker.js');\
         w.onmessage = function (e) { done(e.data); };\
         w.postMessage('go');",
    );
    let report = V8Solver::new()
        .shadow_dom(true)
        .solve(&html, "https://x.test/page", CHROME_UA, bridge.clone())
        .expect("the page must run");
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    let urls = bridge.urls();
    assert!(
        urls.iter().any(|u| u.ends_with("/static/worker.js")),
        "the worker source was never fetched: {urls:?}"
    );
    assert!(
        urls.iter().any(|u| u.contains("from-the-fetched-worker")),
        "the fetched worker never ran: {urls:?}"
    );
}

#[test]
fn the_transfer_list_reaches_the_worker() {
    let out = echoed(
        &page(&format!(
            "{}\
             var c = new MessageChannel();\
             c.port1.onmessage = function (e) {{ done(e.data); }};\
             w.postMessage({{ hello: 1 }}, [c.port2]);",
            worker_from(
                "self.onmessage = function (e) { \
                   if (e.ports && e.ports.length) e.ports[0].postMessage('answered-on-the-port'); \
                   else postMessage('no-ports'); \
                 };"
            )
        )),
        CHROME_UA,
    );
    assert_eq!(out, "answered-on-the-port");
}

#[test]
fn a_worker_cannot_see_the_document() {
    let out = echoed(
        &page(&format!(
            "{}\
             w.onmessage = function (e) {{ done(e.data); }};\
             w.postMessage('go');",
            worker_from(
                "self.onmessage = function () { \
                   postMessage(typeof document + ',' + typeof window); \
                 };"
            )
        )),
        CHROME_UA,
    );
    assert_eq!(out, "undefined,undefined");
}

#[test]
fn the_solver_is_still_usable_after_a_worker_ran() {
    let _ = Arc::new(V8Solver::new().shadow_dom(true));
    let out = echoed(
        &page(&format!(
            "var keep = function () {{ return 'intact'; }};\
             {}\
             done(keep());",
            worker_from("keep = 'a string from the worker';")
        )),
        CHROME_UA,
    );
    assert_eq!(out, "intact", "the worker overwrote a page function");
}
