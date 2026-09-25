use veri_core::CookieJarView;
use veri_core::{ClearError, Demand, Headers, Outcome, Protection};
use veri_integrations::akamai::{Akamai, CLEARANCE_COOKIE};
use veri_testkit::{dead_bridge, headers, parts, Jar, StubSolver};

fn edge_deny() -> Headers {
    headers([
        ("server", "AkamaiGHost"),
        ("content-type", "text/html"),
        ("akamai-grn", "0.b5611702.1786986443.265a9cad"),
        ("set-cookie", "AKA_GEO=PL; path=/; secure"),
    ])
}

const DENY_BODY: &str = "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>\
     <H1>Access Denied</H1>Reference #18.ae611702</BODY></HTML>";

fn bot_manager() -> Headers {
    headers([
        ("server", "AkamaiGHost"),
        ("content-type", "text/html"),
        ("set-cookie", "_abck=2E2CA540~-1~YAAQ; Path=/"),
        ("set-cookie", "bm_sz=ABCD; Path=/"),
    ])
}

const SENSOR_BODY: &str =
    "<html><head><script type=\"text/javascript\" src=\"/akam/13/1f2e3d4c\"></script>\
     </head><body>loading</body></html>";

#[test]
fn an_edge_deny_is_a_block_not_a_challenge() {
    let h = edge_deny();
    let p = parts(403, &h, DENY_BODY);
    assert_eq!(Akamai::demand(&p), Some(Demand::Block));
    assert_eq!(Akamai::detect_only().inspect(&p), Outcome::Blocked);
    assert!(!Akamai::is_bot_manager(&p));
    assert!(veri_core::Verdict::from_outcome(Outcome::Blocked).unwrap().identity_might_help());
}

#[test]
fn bot_manager_is_a_challenge() {
    let h = bot_manager();
    let p = parts(403, &h, SENSOR_BODY);
    assert!(Akamai::is_bot_manager(&p));
    assert_eq!(Akamai::demand(&p), Some(Demand::Script));
    assert_eq!(Akamai::detect_only().inspect(&p), Outcome::Challenge);
}

#[test]
fn a_success_is_never_a_challenge_whatever_it_carries() {
    let h = bot_manager();
    let p = parts(200, &h, SENSOR_BODY);
    assert!(Akamai::is_bot_manager(&p));
    assert_eq!(Akamai::demand(&p), None);
    assert_eq!(Akamai::detect_only().inspect(&p), Outcome::Passed);
}

#[test]
fn the_cookie_alone_is_not_a_challenge() {
    let h = headers([
        ("server", "AkamaiGHost"),
        ("content-type", "text/html"),
        ("set-cookie", "_abck=valid~0~xyz; Path=/"),
    ]);
    let p = parts(403, &h, "<html><body>no script here</body></html>");
    assert!(!Akamai::is_bot_manager(&p));
    assert_eq!(Akamai::demand(&p), Some(Demand::Block));
}

#[test]
fn a_host_that_is_not_akamai_is_left_alone() {
    let h = headers([("server", "nginx"), ("content-type", "text/html")]);
    let p = parts(403, &h, DENY_BODY);
    assert!(!Akamai::is_present(&p));
    assert_eq!(Akamai::demand(&p), None);
    assert_eq!(Akamai::detect_only().inspect(&p), Outcome::NotMine);
}

#[test]
fn akamai_fronting_a_working_page_says_passed() {
    let h = headers([("server", "AkamaiGHost"), ("content-type", "text/html")]);
    let p = parts(200, &h, "<html><body>hello</body></html>");
    assert_eq!(Akamai::demand(&p), None);
    assert_eq!(Akamai::detect_only().inspect(&p), Outcome::Passed);
}

#[test]
fn clearing_an_edge_deny_is_refused_rather_than_attempted() {
    let h = edge_deny();
    let r = Akamai::with_solver(StubSolver::quiet()).clear(
        &parts(403, &h, DENY_BODY),
        "ua",
        dead_bridge(),
        &Jar::default(),
    );
    assert!(matches!(r, Err(ClearError::NotAChallenge)));
}

#[test]
fn detect_only_says_so_rather_than_pretending_to_clear() {
    let h = bot_manager();
    let r = Akamai::detect_only().clear(
        &parts(403, &h, SENSOR_BODY),
        "ua",
        dead_bridge(),
        &Jar::default(),
    );
    assert!(matches!(r, Err(ClearError::Failed(m)) if m.contains("detects only")));
}

#[test]
fn a_sensor_run_that_earns_nothing_is_rejected() {
    let h = bot_manager();
    let r = Akamai::with_solver(StubSolver::quiet()).clear(
        &parts(403, &h, SENSOR_BODY),
        "ua",
        dead_bridge(),
        &Jar::default(),
    );
    assert!(matches!(r, Err(ClearError::Rejected(_))));

    let jar = Jar::default();
    let ok = Akamai::with_solver(StubSolver::setting(&[&format!("{CLEARANCE_COOKIE}=ABC~0~YAAQ")]))
        .clear(&parts(403, &h, SENSOR_BODY), "ua", dead_bridge(), &jar);
    assert!(ok.is_ok());
}

#[test]
fn clearance_reads_the_cookies_state_not_its_presence() {
    let challenged = Jar::default();
    challenged.set_cookie(&format!("{CLEARANCE_COOKIE}=2E2CA540~-1~YAAQ"));
    assert!(!Akamai::detect_only().holds_clearance(&challenged));

    let cleared = Jar::default();
    cleared.set_cookie(&format!("{CLEARANCE_COOKIE}=2E2CA540~0~YAAQ"));
    assert!(Akamai::detect_only().holds_clearance(&cleared));

    assert!(!Akamai::detect_only().holds_clearance(&Jar::default()));
}
