//! Five protection suites judge themselves against these, so a stub that lies
//! does not fail a test - it passes one that should have failed.

use std::sync::Arc;
use veri_core::{CookieJarView, Solver};
use veri_testkit::{dead_bridge, fixed_bridge, headers, parts, Jar, StubSolver};

#[test]
fn a_jar_starts_with_what_it_was_given() {
    let jar = Jar::holding(&["cf_clearance", "_vcrcs"]);
    assert!(jar.has_cookie("cf_clearance"));
    assert!(jar.has_cookie("_vcrcs"));
    assert!(!jar.has_cookie("aws-waf-token"));
    assert!(!Jar::empty().has_cookie("cf_clearance"));
}

#[test]
fn a_jar_records_what_a_protection_installs() {
    let jar = Jar::empty();
    assert!(!jar.has_cookie("token"));
    jar.set_cookie("token=abc; Path=/; HttpOnly");
    assert!(jar.has_cookie("token"), "a cookie set during clear must count");
    assert_eq!(jar.installed(), vec!["token=abc; Path=/; HttpOnly"]);
}

#[test]
fn headers_and_parts_carry_what_they_were_built_from() {
    let h = headers([("x-amzn-waf-action", "challenge"), ("server", "Vercel")]);
    let p = parts(429, &h, "<html>body</html>");
    assert_eq!(p.status, 429);
    assert_eq!(p.body, "<html>body</html>");
    assert_eq!(p.headers.get("x-amzn-waf-action"), Some("challenge"));
    assert!(p.url.starts_with("https://"), "a solver resolves relative URLs against this");
}

#[test]
fn the_dead_bridge_answers_with_nothing() {
    let (status, body) = dead_bridge().request("GET", "https://x.test/", "");
    assert_eq!(status, 0);
    assert!(body.is_empty());
}

#[test]
fn the_fixed_bridge_answers_with_what_it_was_given() {
    let b = fixed_bridge(200, "<html>ok</html>");
    let (status, body) = b.request("POST", "https://x.test/submit", "payload");
    assert_eq!(status, 200);
    assert_eq!(body, "<html>ok</html>");
}

#[test]
fn a_text_only_bridge_still_answers_for_bytes() {
    let (status, bytes) = fixed_bridge(200, "abc").request_bytes("GET", "https://x.test/", "");
    assert_eq!(status, 200);
    assert_eq!(bytes, b"abc".to_vec());
}

#[test]
fn a_quiet_solver_reports_a_clean_run_that_earned_nothing() {
    let s = StubSolver::quiet();
    let r = s.solve("<html></html>", "https://x.test/", "ua", dead_bridge()).expect("clean");
    assert!(r.cookies_set.is_empty());
    assert!(r.errors.is_empty());
}

#[test]
fn a_setting_solver_reports_the_cookies_it_was_told_to() {
    let s = StubSolver::setting(&["cf_clearance=abc"]);
    let r = s.solve("<html></html>", "https://x.test/", "ua", dead_bridge()).expect("clean");
    assert_eq!(r.cookies_set, vec!["cf_clearance=abc"]);
}

#[test]
fn an_erroring_solver_reports_the_errors_it_was_told_to() {
    let s = StubSolver::erroring(&["worker: boom"]);
    let r = s.solve("<html></html>", "https://x.test/", "ua", dead_bridge()).expect("ran");
    assert_eq!(r.errors, vec!["worker: boom"]);
}

#[test]
fn the_solver_counts_the_solves_it_was_asked_for() {
    let s = StubSolver::quiet();
    assert_eq!(s.calls(), 0);
    let _ = s.solve("<html></html>", "https://x.test/", "ua", dead_bridge());
    let _ = s.solve("<html></html>", "https://x.test/", "ua", dead_bridge());
    assert_eq!(s.calls(), 2);
}

#[test]
fn a_stub_solver_is_usable_as_a_registered_solver() {
    let s: Arc<dyn Solver> = StubSolver::quiet();
    assert!(s.solve("<html></html>", "https://x.test/", "ua", dead_bridge()).is_ok());
}
