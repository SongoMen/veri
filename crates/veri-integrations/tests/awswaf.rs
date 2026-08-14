use veri_core::{ClearError, Demand, Headers, Outcome, Protection, Verdict};
use veri_integrations::awswaf::AwsWaf;
use veri_testkit::{dead_bridge, headers, parts, Jar, StubSolver};

fn action(value: &str) -> Headers {
    headers([("server", "CloudFront"), ("x-amzn-waf-action", value)])
}

const ORDINARY_PAGE: &str = "<html><head>\
     <script data-n-head=\"ssr\" src=\"https://a1b2c3d4e5f6.edge.sdk.awswaf.com/a1b2c3d4e5f6/0f1e2d3c4b5a/challenge.js\" defer></script>\
     <script data-n-head=\"ssr\" src=\"https://a1b2c3d4e5f6.edge.captcha-sdk.awswaf.com/a1b2c3d4e5f6/jsapi.js\" defer></script>\
     </head><body>the real page</body></html>";

fn cloudfront() -> Headers {
    headers([("server", "CloudFront"), ("via", "1.1 abc.cloudfront.net (CloudFront)")])
}

#[test]
fn the_embedded_sdk_alone_is_not_a_challenge() {
    let h = cloudfront();
    let p = parts(200, &h, ORDINARY_PAGE);
    assert_eq!(AwsWaf::demand(&p), None, "no action header means no demand");
    assert_eq!(AwsWaf::detect_only().inspect(&p), Outcome::Passed);
}

#[test]
fn the_action_header_decides() {
    let ch = action("challenge");
    assert_eq!(AwsWaf::demand(&parts(202, &ch, "")), Some(Demand::Script));
    assert_eq!(AwsWaf::detect_only().inspect(&parts(202, &ch, "")), Outcome::Challenge);

    let cap = action("captcha");
    assert_eq!(AwsWaf::demand(&parts(405, &cap, "")), Some(Demand::Captcha));
}

#[test]
fn a_captcha_is_a_refusal_not_a_question() {
    let h = action("captcha");
    let outcome = AwsWaf::detect_only().inspect(&parts(405, &h, ""));
    assert_eq!(outcome, Outcome::Blocked);

    let verdict = Verdict::from_outcome(outcome);
    assert_eq!(verdict, Some(Verdict::Blocked));
    assert_ne!(
        verdict,
        Some(Verdict::Challenged),
        "a challenged verdict tells the caller a solver would help, and none can"
    );
}

#[test]
fn a_scripted_challenge_stays_a_question() {
    let h = action("challenge");
    let outcome = AwsWaf::detect_only().inspect(&parts(202, &h, ""));
    assert_eq!(outcome, Outcome::Challenge);
    assert_eq!(Verdict::from_outcome(outcome), Some(Verdict::Challenged));
}

#[test]
fn an_unknown_action_is_not_guessed_at() {
    let h = action("something-new");
    assert_eq!(AwsWaf::demand(&parts(202, &h, "")), None);
}

#[test]
fn the_action_value_is_read_leniently() {
    let h = headers([("X-Amzn-WAF-Action", " Challenge ")]);
    assert_eq!(AwsWaf::demand(&parts(202, &h, "")), Some(Demand::Script));
}

#[test]
fn an_unrelated_response_is_not_claimed() {
    let h = headers([("server", "nginx")]);
    let p = parts(200, &h, "<html>ordinary</html>");
    assert!(!AwsWaf::is_present(&p));
    assert_eq!(AwsWaf::detect_only().inspect(&p), Outcome::NotMine);
}

#[test]
fn cloudfront_without_waf_is_not_claimed() {
    let h = cloudfront();
    let p = parts(403, &h, "<html>access denied</html>");
    assert!(!AwsWaf::is_present(&p));
    assert_eq!(AwsWaf::detect_only().inspect(&p), Outcome::NotMine);
}

#[test]
fn the_sdk_endpoints_are_read_off_the_page() {
    let cfg = AwsWaf::config(ORDINARY_PAGE).expect("the page carries both SDKs");
    assert_eq!(
        cfg.sdk_url,
        "https://a1b2c3d4e5f6.edge.sdk.awswaf.com/a1b2c3d4e5f6/0f1e2d3c4b5a/challenge.js"
    );
    assert_eq!(
        cfg.captcha_sdk_url,
        "https://a1b2c3d4e5f6.edge.captcha-sdk.awswaf.com/a1b2c3d4e5f6/jsapi.js"
    );
    assert_eq!(cfg.key, "a1b2c3d4e5f6");
}

#[test]
fn the_two_sdk_hosts_are_told_apart() {
    let only_captcha = "<script src=\"https://x.edge.captcha-sdk.awswaf.com/x/jsapi.js\"></script>";
    let cfg = AwsWaf::config(only_captcha).expect("captcha SDK alone still parses");
    assert!(cfg.sdk_url.is_empty(), "a captcha SDK URL is not a challenge SDK URL");
    assert_eq!(cfg.captcha_sdk_url, "https://x.edge.captcha-sdk.awswaf.com/x/jsapi.js");
}

#[test]
fn a_page_with_no_sdk_has_no_config() {
    assert!(AwsWaf::config("<html><script src=\"/app.js\"></script></html>").is_none());
}

#[test]
fn clearance_is_the_token_cookie() {
    let waf = AwsWaf::detect_only();
    assert!(waf.holds_clearance(Jar::holding(&["aws-waf-token"]).as_ref()));
    assert!(!waf.holds_clearance(Jar::holding(&["session"]).as_ref()));
}

#[test]
fn detect_only_never_claims_to_have_cleared() {
    let h = action("challenge");
    let err = AwsWaf::detect_only()
        .clear(&parts(202, &h, ""), "ua", dead_bridge(), Jar::empty().as_ref())
        .unwrap_err();
    assert!(matches!(err, ClearError::Failed(_)), "got {err:?}");
}

#[test]
fn clearing_a_non_challenge_is_refused_before_any_work() {
    let h = cloudfront();
    let err = AwsWaf::detect_only()
        .clear(&parts(200, &h, ORDINARY_PAGE), "ua", dead_bridge(), Jar::empty().as_ref())
        .unwrap_err();
    assert!(matches!(err, ClearError::NotAChallenge), "got {err:?}");
}

/// A 202 reduced to what the parser reads: the two declarations and the script
/// tag. The values are the awkward ones from a real capture, since those are
/// what the parser has to survive.
const CHALLENGE_PAGE: &str = include_str!("../fixtures/challenge_page.html");

/// The challenge page loads its script from `token.awswaf.com`, a different
/// host from the `edge.sdk.awswaf.com` an ordinary page carries.
#[test]
fn a_challenge_page_parses() {
    let h = action("challenge");
    let p = parts(202, &h, CHALLENGE_PAGE);
    assert_eq!(AwsWaf::demand(&p), Some(Demand::Script));
    assert_eq!(AwsWaf::detect_only().inspect(&p), Outcome::Challenge);
    assert!(AwsWaf::is_present(&p));

    let cfg = AwsWaf::config(CHALLENGE_PAGE).expect("a challenge page carries a config");
    assert!(cfg.sdk_url.contains("token.awswaf.com"), "sdk_url was {}", cfg.sdk_url);
    assert!(cfg.sdk_url.ends_with("/challenge.js"));
    assert_eq!(cfg.key, "a1b2c3d4e5f6");

    let goku = cfg.goku.expect("a 202 page declares gokuProps");
    assert_eq!(goku.key.len(), 248, "the whole key must survive parsing");
    assert_eq!(goku.iv, "A6xWaAHT/gAAA1Uw", "the iv carries a '/' that must survive parsing");
    assert!(goku.context.len() > 500, "context was {} chars", goku.context.len());
}

#[test]
fn an_ordinary_page_declares_no_goku_props() {
    let cfg = AwsWaf::config(ORDINARY_PAGE).expect("the page carries both SDKs");
    assert!(cfg.goku.is_none());
}

#[test]
fn a_challenge_page_is_recognised_without_the_header() {
    let h = cloudfront();
    assert!(AwsWaf::is_present(&parts(202, &h, CHALLENGE_PAGE)));
}

#[test]
fn a_run_that_sets_no_cookie_is_not_clearance() {
    let h = action("challenge");
    let err = AwsWaf::with_solver(StubSolver::quiet())
        .clear(&parts(202, &h, CHALLENGE_PAGE), "ua", dead_bridge(), Jar::empty().as_ref())
        .unwrap_err();
    assert!(matches!(err, ClearError::Rejected(_)), "got {err:?}");
}
