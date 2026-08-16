use veri_core::{ClearError, Demand, Headers, Outcome, Protection};
use veri_integrations::cloudflare::{Cloudflare, CLEARANCE_COOKIE};
use veri_testkit::{dead_bridge, headers, parts, Jar, StubSolver};

fn cf() -> Headers {
    headers([("cf-ray", "a29b65273da6f17e"), ("server", "cloudflare")])
}

fn interstitial() -> String {
    "<!DOCTYPE html><html lang=\"en-US\"><head><title>Just a moment...</title>\
     <meta name=\"robots\" content=\"noindex,nofollow\"></head>\
     <body><div class=\"main-wrapper\" role=\"main\"></div>\
     <script>window._cf_chl_opt = {cRay: 'a29b65273da6f17e',cTplV: 5,\
     cType: 'non-interactive'};</script></body></html>"
        .to_string()
}

#[test]
fn a_live_interstitial_is_a_challenge() {
    let h = headers([("cf-mitigated", "challenge"), ("cf-ray", "a29b65273da6f17e")]);
    let page = interstitial();
    assert_eq!(Cloudflare::demand(&parts(403, &h, &page)), Some(Demand::Script));
    assert_eq!(Cloudflare::detect_only().inspect(&parts(403, &h, &page)), Outcome::Challenge);
    // The header is not what carries it: a zone that omits it is still one.
    assert_eq!(Cloudflare::demand(&parts(403, &cf(), &page)), Some(Demand::Script));
}

#[test]
fn challenge_beats_status() {
    let h = headers([("cf-mitigated", "challenge")]);
    assert_eq!(Cloudflare::detect_only().inspect(&parts(403, &h, "")), Outcome::Challenge);

    let page = "<title>Just a moment...</title>";
    assert_eq!(Cloudflare::detect_only().inspect(&parts(403, &cf(), page)), Outcome::Challenge);
}

#[test]
fn ordinary_pages_are_not_challenges() {
    let body = r#"<html><body>real content
        <script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/abc/main.js"></script>
        </body></html>"#;
    assert_eq!(Cloudflare::detect_only().inspect(&parts(200, &cf(), body)), Outcome::Passed);
    assert_eq!(Cloudflare::demand(&parts(200, &cf(), body)), None);
}

#[test]
fn challenge_title_alone_does_not_condemn_a_success() {
    let body = "<p>Just a moment while we load your portfolio…</p>";
    assert_eq!(Cloudflare::detect_only().inspect(&parts(200, &cf(), body)), Outcome::Passed);
    assert_eq!(Cloudflare::demand(&parts(403, &cf(), body)), Some(Demand::Script));
}

#[test]
fn config_object_is_definitive_at_any_status() {
    let body = "window._cf_chl_opt={cRay:'x'}";
    assert_eq!(Cloudflare::demand(&parts(403, &cf(), body)), Some(Demand::Script));
    assert_eq!(Cloudflare::demand(&parts(200, &cf(), body)), Some(Demand::Script));
}

#[test]
fn the_marker_alone_is_not_enough() {
    let none = headers([]);
    let other = headers([("server", "nginx")]);
    let body = "an article about window._cf_chl_opt and how challenges work";
    assert_eq!(Cloudflare::demand(&parts(200, &none, body)), None);
    assert_eq!(Cloudflare::demand(&parts(200, &other, body)), None);
    assert_eq!(Cloudflare::detect_only().inspect(&parts(200, &other, body)), Outcome::NotMine);
}

#[test]
fn hard_block_is_not_a_challenge() {
    let page = "<!DOCTYPE html><html><head><title>Access denied</title></head>\
                <body>Sorry, you have been blocked</body></html>";
    assert_eq!(Cloudflare::detect_only().inspect(&parts(403, &cf(), page)), Outcome::Blocked);
}

#[test]
fn an_origins_own_403_behind_the_edge_is_left_alone() {
    let h = headers([
        ("cf-ray", "a29b65273da6f17e"),
        ("server", "cloudflare"),
        ("content-type", "application/json"),
    ]);
    let body = r#"{"error":"invalid api key"}"#;
    assert_eq!(Cloudflare::demand(&parts(403, &h, body)), None);
    assert_eq!(Cloudflare::detect_only().inspect(&parts(403, &h, body)), Outcome::NotMine);
}

#[test]
fn another_provider_is_not_claimed() {
    let h = headers([("x-datadome", "protected"), ("server", "CloudFront")]);
    assert_eq!(Cloudflare::detect_only().inspect(&parts(401, &h, "")), Outcome::NotMine);
}

#[test]
fn plain_responses_are_not_claimed() {
    let h = headers([("server", "nginx")]);
    assert_eq!(Cloudflare::detect_only().inspect(&parts(200, &h, "{}")), Outcome::NotMine);
}

#[test]
fn cloudflare_success_is_recognised() {
    assert_eq!(Cloudflare::detect_only().inspect(&parts(200, &cf(), "{}")), Outcome::Passed);
}

#[test]
fn origin_errors_are_left_alone() {
    assert_eq!(Cloudflare::detect_only().inspect(&parts(500, &cf(), "")), Outcome::NotMine);
}

#[test]
fn clearing_a_non_challenge_is_refused() {
    let err = Cloudflare::detect_only()
        .clear(&parts(200, &headers([]), "{}"), "ua", dead_bridge(), Jar::empty().as_ref())
        .unwrap_err();
    assert!(matches!(err, ClearError::NotAChallenge));
}

#[test]
fn a_clean_script_run_is_not_a_solve() {
    let h = headers([("cf-mitigated", "challenge")]);
    let cf = Cloudflare::with_solver(StubSolver::quiet());
    let err = cf
        .clear(&parts(403, &h, "cf_chl_opt"), "ua", dead_bridge(), Jar::empty().as_ref())
        .unwrap_err();
    assert!(matches!(err, ClearError::Rejected(_)), "no cf_clearance means no solve, got {err:?}");
}

#[test]
fn clearance_cookie_makes_it_a_solve() {
    let h = headers([("cf-mitigated", "challenge")]);
    let jar = Jar::holding(&[CLEARANCE_COOKIE]);
    let cf = Cloudflare::with_solver(StubSolver::quiet());
    assert!(cf.clear(&parts(403, &h, "cf_chl_opt"), "ua", dead_bridge(), jar.as_ref()).is_ok());
}

/// A stack trace is not a verdict.
///
/// Turnstile's own failure path throws and Cloudflare still issues clearance
/// off the fallback beacon, so the cookie decides and escaped errors are only
/// diagnostics. Checking errors first would throw away a working solve.
#[test]
fn errors_do_not_discard_a_real_clearance() {
    let h = headers([("cf-mitigated", "challenge")]);
    let jar = Jar::holding(&[CLEARANCE_COOKIE]);
    let noisy = StubSolver::erroring(&["TypeError: shadow root"]);
    let cf = Cloudflare::with_solver(noisy);
    assert!(cf.clear(&parts(403, &h, "cf_chl_opt"), "ua", dead_bridge(), jar.as_ref()).is_ok());
}

#[test]
fn an_interactive_challenge_is_not_scriptable() {
    let h = headers([("cf-mitigated", "challenge"), ("cf-ray", "a29b65273da6f17e")]);
    let managed = interstitial().replace("non-interactive", "managed");
    assert_eq!(Cloudflare::demand(&parts(403, &h, &managed)), Some(Demand::Script));
    assert_eq!(Cloudflare::detect_only().inspect(&parts(403, &h, &managed)), Outcome::Challenge);

    let interactive = interstitial().replace("non-interactive", "interactive");
    assert_eq!(Cloudflare::demand(&parts(403, &h, &interactive)), Some(Demand::Captcha));
    assert_eq!(Cloudflare::detect_only().inspect(&parts(403, &h, &interactive)), Outcome::Blocked);

    // Double-quoted and spaced, as some deliveries write it.
    let spaced = interstitial().replace("cType: 'non-interactive'", "cType:  \"interactive\"");
    assert_eq!(Cloudflare::demand(&parts(403, &h, &spaced)), Some(Demand::Captcha));
}
