use veri_core::{ClearError, Demand, Headers, Outcome, Protection};
use veri_integrations::vercel::{Vercel, CLEARANCE_COOKIE};
use veri_testkit::{dead_bridge, headers, parts, Jar, StubSolver};

fn challenged() -> veri_core::Headers {
    headers([
        ("server", "Vercel"),
        ("x-vercel-id", "arn1::1786396465-hBpdlr48owm4IAGWb3HMnGkBwir4"),
        ("x-vercel-mitigated", "challenge"),
        ("x-vercel-challenge-token", "2.1786396465.60.YTZiNGE2NGQyZmI1"),
        ("cache-control", "private, no-store, max-age=0"),
    ])
}

fn passing() -> veri_core::Headers {
    headers([
        ("server", "Vercel"),
        ("x-vercel-id", "arn1::iad1::vmjjs-1786396465339-acc81814c727"),
        ("x-vercel-cache", "MISS"),
        ("cache-control", "public, max-age=0, must-revalidate"),
    ])
}

#[test]
fn a_challenge_arriving_as_429_is_not_rate_limiting() {
    let h = challenged();
    let p = parts(429, &h, "<html><title>Vercel Security Checkpoint</title></html>");

    let unmarked = Headers::new(vec![]);
    assert_eq!(
        Outcome::from_unmarked(&parts(429, &unmarked, "")),
        Outcome::RateLimited,
        "the status alone says rate limited, which is what this corrects"
    );
    assert_eq!(Vercel::detect_only().inspect(&p), Outcome::Challenge);
    assert_eq!(Vercel::demand(&p), Some(Demand::Script));
}

#[test]
fn an_ordinary_vercel_response_is_not_a_challenge() {
    let h = passing();
    let p = parts(200, &h, "<?xml version=\"1.0\"?><urlset><url><loc>x</loc></url></urlset>");
    assert!(Vercel::is_present(&p), "the provider is in front of the host");
    assert_eq!(Vercel::demand(&p), None, "present, but asking for nothing");
    assert_eq!(Vercel::detect_only().inspect(&p), Outcome::Passed);
}

#[test]
fn a_429_without_the_mitigation_header_stays_rate_limited() {
    let h = passing();
    let p = parts(429, &h, "slow down");
    assert_eq!(Vercel::detect_only().inspect(&p), Outcome::RateLimited);
}

#[test]
fn the_token_and_mitigation_are_read_off_the_headers() {
    let h = challenged();
    let p = parts(429, &h, "");
    let cfg = Vercel::config(&p).expect("config");
    assert_eq!(cfg.mitigated, "challenge");
    assert!(cfg.token.starts_with("2.1786396465"), "{}", cfg.token);
}

#[test]
fn an_unknown_mitigation_is_treated_as_a_block() {
    let h = headers([("server", "Vercel"), ("x-vercel-mitigated", "deny")]);
    let p = parts(403, &h, "");
    assert_eq!(Vercel::demand(&p), Some(Demand::Block));
    assert_eq!(Vercel::detect_only().inspect(&p), Outcome::Blocked);
}

#[test]
fn a_host_with_no_vercel_is_not_ours() {
    let h = headers([("server", "cloudflare"), ("cf-ray", "abc")]);
    let p = parts(403, &h, "<html>Just a moment</html>");
    assert!(!Vercel::is_present(&p));
    assert_eq!(Vercel::detect_only().inspect(&p), Outcome::NotMine);
    assert!(matches!(
        Vercel::detect_only().clear(&p, "ua", dead_bridge(), Jar::empty().as_ref()),
        Err(ClearError::NotAChallenge)
    ));
}

#[test]
fn clearing_without_a_solver_says_so() {
    let h = challenged();
    let err = Vercel::detect_only()
        .clear(&parts(429, &h, ""), "ua", dead_bridge(), Jar::empty().as_ref())
        .expect_err("detect_only cannot clear");
    match err {
        ClearError::Failed(m) => assert!(m.contains("detects only"), "{m}"),
        other => panic!("expected a stated absence, got {other:?}"),
    }
}

#[test]
fn a_hard_mitigation_is_refused_without_solving() {
    let h = headers([("server", "Vercel"), ("x-vercel-mitigated", "deny")]);
    let solver = StubSolver::quiet();
    let err = Vercel::with_solver(solver.clone())
        .clear(&parts(403, &h, ""), "ua", dead_bridge(), Jar::empty().as_ref())
        .expect_err("a refusal is not solvable");
    assert!(matches!(err, ClearError::Rejected(_)), "{err:?}");
}

#[test]
fn a_solve_that_earns_no_cookie_is_not_cleared() {
    let h = challenged();
    let err = Vercel::with_solver(StubSolver::quiet())
        .clear(&parts(429, &h, ""), "ua", dead_bridge(), Jar::empty().as_ref())
        .expect_err("no clearance was issued");
    assert!(matches!(err, ClearError::Rejected(_)), "{err:?}");
}

#[test]
fn a_solve_that_earns_the_cookie_is_cleared() {
    let h = challenged();
    let jar = Jar::empty();
    let solver = StubSolver::setting(&[&format!("{CLEARANCE_COOKIE}=1.1786404098.3600.abc")]);
    Vercel::with_solver(solver)
        .clear(&parts(429, &h, ""), "ua", dead_bridge(), jar.as_ref())
        .expect("the cookie proves it");
    assert!(Vercel::detect_only().holds_clearance(jar.as_ref()));
}

#[test]
fn a_script_error_is_reported_rather_than_swallowed() {
    let h = challenged();
    let err = Vercel::with_solver(StubSolver::erroring(&["worker: boom"]))
        .clear(&parts(429, &h, ""), "ua", dead_bridge(), Jar::empty().as_ref())
        .expect_err("the solve failed");
    match err {
        ClearError::Failed(m) => assert!(m.contains("worker: boom"), "{m}"),
        other => panic!("expected the script error, got {other:?}"),
    }
}

#[test]
fn clearance_is_the_cookie_and_nothing_else() {
    let v = Vercel::detect_only();
    assert!(v.holds_clearance(Jar::holding(&[CLEARANCE_COOKIE]).as_ref()));
    assert!(!v.holds_clearance(Jar::empty().as_ref()));
    assert!(!v.holds_clearance(Jar::holding(&["x-vercel-id"]).as_ref()));
}
