use veri_core::{ClearError, Demand, Headers, Outcome, Protection};
use veri_integrations::datadome::{DataDome, CLEARANCE_COOKIE};
use veri_testkit::{dead_bridge, fixed_bridge, parts, Jar, StubSolver};

fn dd_headers() -> Headers {
    Headers::new(vec![("x-datadome".into(), "protected".into()), ("x-dd-b".into(), "1".into())])
}

/// The real shape, taken from a live block page with the tokens replaced.
///
/// Note what it is *not*: there is no URL for the delivery host, only a `host`
/// field, and `s` is a bare number , so neither "find a URL" nor a JSON parser
/// reads this.
fn captcha_page(t: &str) -> String {
    format!(
        "<html lang=\"en\"><head><title>example.com</title></head>\
         <body style=\"margin:0\"><p id=\"cmsg\">Please enable JS and disable any ad blocker</p>\
         <script data-cfasync=\"false\">var dd={{'rt':'c','cid':'AAAAtest==','hsh':'D428D5',\
         't':'{t}','qp':'','s':47891,'e':'993b5f','host':'geo.captcha-delivery.com',\
         'cookie':'IR5mbWeMl0X4'}}</script>\
         <script data-cfasync=\"false\" src=\"https://ct.captcha-delivery.com/c.js\"></script>\
         </body></html>"
    )
}

/// An interstitial: `rt:'i'`, a `b`, and **no `t` at all**. Reading `t` first
/// classifies this as a captcha, which is exactly backwards.
fn interstitial_page() -> String {
    "<html lang=\"en\"><head><title>example.com</title></head>\
     <body style=\"margin:0\"><p id=\"cmsg\">Please enable JS and disable any ad blocker</p>\
     <script data-cfasync=\"false\">var dd={'rt':'i','cid':'AAAAtest==','hsh':'D428D5',\
     'b':1559358,'s':47891,'e':'95b77c','qp':'','host':'geo.captcha-delivery.com',\
     'cookie':'mNHKCcey2kYK'}</script>\
     <script data-cfasync=\"false\" src=\"https://ct.captcha-delivery.com/i.js\"></script>\
     </body></html>"
        .to_string()
}

#[test]
fn the_config_object_is_parsed_from_a_real_block_page() {
    let cfg = DataDome::config(&captcha_page("fe")).expect("dd object");
    assert_eq!(cfg.rt, "c");
    assert_eq!(cfg.t, "fe");
    assert_eq!(cfg.cid, "AAAAtest==");
    assert_eq!(cfg.host, "geo.captcha-delivery.com");
}

/// `rt` decides, not `t`, an interstitial carries no `t`.
#[test]
fn the_response_type_decides_not_t() {
    let i = DataDome::config(&interstitial_page()).expect("dd object");
    assert_eq!(i.rt, "i");
    assert_eq!(i.t, "", "an interstitial has no t");
    assert_eq!(i.b, "1559358");
    assert_eq!(i.demand(), Demand::Script);

    // Same page shape, captcha response type: a slider, not a device check.
    assert_eq!(DataDome::config(&captcha_page("fe")).unwrap().demand(), Demand::Captcha);
    assert_eq!(DataDome::config(&captcha_page("bv")).unwrap().demand(), Demand::Block);
}

/// The device check lives at a URL `i.js` only ever builds into an iframe.
#[test]
fn the_interstitial_url_is_reconstructed() {
    let cfg = DataDome::config(&interstitial_page()).unwrap();
    let url = cfg.interstitial_url("https://www.example.com/");
    assert!(url.starts_with("https://geo.captcha-delivery.com/interstitial/?"), "{url}");
    for want in [
        "initialCid=AAAAtest%3D%3D",
        "hash=D428D5",
        "cid=mNHKCcey2kYK",
        "referer=https%3A%2F%2Fwww.example.com%2F",
        "s=47891",
        "e=95b77c",
        "b=1559358",
        "dm=cd",
    ] {
        assert!(url.contains(want), "missing {want} in {url}");
    }
}

/// A 401 device check must not be read as a block just because of its status.
#[test]
fn a_device_check_is_a_challenge_even_on_401() {
    let h = dd_headers();
    let page = interstitial_page();
    assert_eq!(DataDome::detect_only().inspect(&parts(401, &h, &page)), Outcome::Challenge);
}

/// `t=bv` is a decision, not a question. Calling it a challenge would spend a
/// four-second solve on something that has no answer.
#[test]
fn a_hard_block_is_not_a_challenge() {
    let h = dd_headers();
    let page = captcha_page("bv");
    assert_eq!(DataDome::detect_only().inspect(&parts(403, &h, &page)), Outcome::Blocked);
}

/// So is a slider. It is drawn for a person, and reporting it as a challenge
/// would set `saw_challenge`, which tells the caller a solver is what would
/// help.
#[test]
fn a_captcha_is_a_refusal_not_a_question() {
    let h = dd_headers();
    let page = captcha_page("fe");
    let outcome = DataDome::detect_only().inspect(&parts(403, &h, &page));
    assert_eq!(outcome, Outcome::Blocked);
    assert_ne!(veri_core::Verdict::from_outcome(outcome), Some(veri_core::Verdict::Challenged));
}

/// An unrecognised `t` is refused rather than guessed at.
#[test]
fn an_unknown_demand_is_treated_as_a_captcha() {
    assert_eq!(DataDome::config(&captcha_page("cp")).unwrap().demand(), Demand::Captcha);
}

#[test]
fn the_cookie_alone_is_never_treated_as_clearance() {
    let dd = DataDome::detect_only();
    assert!(
        !dd.holds_clearance(Jar::holding(&[CLEARANCE_COOKIE]).as_ref()),
        "presence is not proof"
    );
    assert!(!dd.holds_clearance(Jar::empty().as_ref()));
}

/// A solve that leaves the block-time cookie untouched has not been accepted.
#[test]
fn an_unchanged_cookie_is_not_a_solve() {
    let h = dd_headers();
    let page = interstitial_page();
    let jar = Jar::holding(&[CLEARANCE_COOKIE]);
    let err = DataDome::with_solver(StubSolver::quiet())
        .clear(&parts(401, &h, &page), "ua", fixed_bridge(200, "<html></html>"), jar.as_ref())
        .unwrap_err();
    assert!(matches!(err, ClearError::Rejected(_)), "got {err:?}");
}

#[test]
fn another_provider_is_not_claimed() {
    let cf = Headers::new(vec![("cf-ray".into(), "abc".into())]);
    let dd = DataDome::detect_only();
    assert_eq!(dd.inspect(&parts(403, &cf, "cf_chl_opt")), Outcome::NotMine);

    let none = Headers::new(vec![]);
    assert_eq!(dd.inspect(&parts(200, &none, "<html>a normal page</html>")), Outcome::NotMine);
}

#[test]
fn a_datadome_cookie_identifies_the_provider() {
    let h = Headers::new(vec![("set-cookie".into(), "datadome=abc123; Path=/".into())]);
    assert_eq!(
        DataDome::detect_only().inspect(&parts(200, &h, "<html>ok</html>")),
        Outcome::Passed
    );
}

/// Only the *first* set-cookie used to be visible, so a `datadome` cookie sent
/// after any other one was invisible to detection.
#[test]
fn a_datadome_cookie_after_another_is_still_seen() {
    let h = Headers::new(vec![
        ("set-cookie".into(), "sessionid=1; Path=/".into()),
        ("set-cookie".into(), "datadome=abc123; Path=/".into()),
    ]);
    assert!(DataDome::is_present(&parts(200, &h, "<html>ok</html>")));
}

#[test]
fn clearing_a_non_challenge_is_refused() {
    let h = Headers::new(vec![]);
    let err = DataDome::detect_only()
        .clear(&parts(200, &h, "<html>fine</html>"), "ua", dead_bridge(), Jar::empty().as_ref())
        .unwrap_err();
    assert!(matches!(err, ClearError::NotAChallenge));
}

/// A hard block must fail immediately rather than spending a solve.
#[test]
fn a_hard_block_is_refused_without_solving() {
    let h = dd_headers();
    let page = captcha_page("bv");
    // The bridge would panic if it were reached; a hard block must not get that far.
    let err = DataDome::with_solver(StubSolver::quiet())
        .clear(&parts(403, &h, &page), "ua", dead_bridge(), Jar::empty().as_ref())
        .unwrap_err();
    match err {
        ClearError::Rejected(m) => assert!(m.contains("hard block"), "{m}"),
        other => panic!("expected Rejected, got {other:?}"),
    }
}

#[test]
fn the_interstitial_url_is_exact_with_and_without_e() {
    let mut cfg = DataDome::config(&interstitial_page()).unwrap();
    assert_eq!(
        cfg.interstitial_url("https://www.example.com/"),
        "https://geo.captcha-delivery.com/interstitial/?initialCid=AAAAtest%3D%3D\
         &hash=D428D5&cid=mNHKCcey2kYK&referer=https%3A%2F%2Fwww.example.com%2F\
         &s=47891&e=95b77c&b=1559358&dm=cd"
    );

    cfg.e = String::new();
    assert_eq!(
        cfg.interstitial_url("https://www.example.com/"),
        "https://geo.captcha-delivery.com/interstitial/?initialCid=AAAAtest%3D%3D\
         &hash=D428D5&cid=mNHKCcey2kYK&referer=https%3A%2F%2Fwww.example.com%2F\
         &s=47891&b=1559358&dm=cd"
    );
}
