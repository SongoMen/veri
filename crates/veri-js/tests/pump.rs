mod common;

use std::sync::Arc;
use veri_core::HttpBridge;
use veri_js::vm::{self, SolveOptions};

/// A page that reschedules itself for ever, counting its turns into `__VALUE`.
fn page(sets_cookie: bool) -> String {
    let cookie = if sets_cookie { "document.cookie = 'token=abc';" } else { "" };
    format!(
        "{cookie}\
         globalThis.__ticks = 0;\
         (function reschedule() {{\
            globalThis.__VALUE = ++globalThis.__ticks;\
            setTimeout(reschedule, 1);\
         }})();"
    )
}

fn ticks(sets_cookie: bool) -> (usize, vm::SolveOutput) {
    let out = vm::execute(
        vm::Program { bootstrap: Some(&page(sets_cookie)), payload: "", ..Default::default() },
        "https://x.test/",
        "ua",
        Some(common::Spy::new("") as Arc<dyn HttpBridge>),
        &SolveOptions { timeout: None, ..SolveOptions::default() },
    )
    .expect("the page must run");
    let n = out.value.as_deref().unwrap_or("0").parse().unwrap_or(0);
    (n, out)
}

/// Setting a cookie is what tells the run the page produced its answer, so the
/// pump stops a bounded number of rounds later rather than letting a page that
/// reschedules for ever hold the thread. Measured 331 turns against 786.
#[test]
fn a_page_that_has_set_its_cookie_stops_early() {
    let (with_cookie, out) = ticks(true);
    let (without, _) = ticks(false);
    assert_eq!(out.cookies_set, vec!["token=abc"]);
    assert!(
        with_cookie * 3 < without * 2,
        "a page that set its cookie ran {with_cookie} turns against {without} without one, \
         which is not an early stop"
    );
}

#[test]
fn a_page_that_sets_no_cookie_is_not_stopped_early() {
    let (without, out) = ticks(false);
    let (with_cookie, _) = ticks(true);
    assert!(out.cookies_set.is_empty());
    assert!(
        without > with_cookie,
        "no cookie was set, yet the page ran {without} turns against {with_cookie} for one that \
         did, so something stopped it early"
    );
}
