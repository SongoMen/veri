use veri_core::{ClearError, Demand, Headers, Outcome, Protection};
use veri_integrations::perimeterx::{PerimeterX, CLEARANCE_COOKIE};
use veri_testkit::{dead_bridge, headers, parts, Jar};

fn blocked_page(action: &str) -> String {
    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"description\" content=\"px-captcha\">\
         <title>Access to this page has been denied</title></head><body>\
         <script>window._pxVid='';window._pxUuid='fb4bef76-94f9-11f1-96cc-f6a2af70d597';\
         window._pxAppId='PXtestAppI';window._pxHostUrl='/testAppI/xhr';\
         window._pxCustomLogo='';window._pxJsClientSrc='/testAppI/init.js';\
         window._pxMobile=false;window._pxFirstPartyEnabled=true;\
         var pxCaptchaSrc='/testAppI/captcha/PXtestAppI/captcha.js?a={action}\
         &u=fb4bef76-94f9-11f1-96cc-f6a2af70d597&v=&m=0';\
         var script=document.createElement('script');script.src=pxCaptchaSrc;\
         </script></body></html>"
    )
}

fn passing_page() -> String {
    "<!DOCTYPE html><html lang=\"en\"><head>\
     <title>Example | Stock Market Analysis &amp; Tools for Investors</title>\
     <style>.px-captcha-visible{display:flex}</style></head><body>\
     <div id=\"px-captcha-wrapper\"><div id=\"px-captcha\"></div></div>\
     <a href=\"/article/1234567-real-content\">Real content</a>\
     </body></html>"
        .to_string()
}

#[test]
fn the_config_is_read_off_a_real_block_page() {
    let cfg = PerimeterX::config(&blocked_page("c")).expect("px config");
    assert_eq!(cfg.app_id, "PXtestAppI");
    assert_eq!(cfg.uuid, "fb4bef76-94f9-11f1-96cc-f6a2af70d597");
    assert_eq!(cfg.host_url, "/testAppI/xhr");
    assert_eq!(cfg.js_client_src, "/testAppI/init.js");
    assert!(cfg.first_party, "a path-only host url means first-party");
}

#[test]
fn the_action_decides_captcha_from_block() {
    assert_eq!(PerimeterX::config(&blocked_page("c")).unwrap().demand(), Demand::Captcha);
    assert_eq!(PerimeterX::config(&blocked_page("b")).unwrap().demand(), Demand::Block);
}

#[test]
fn an_ordinary_page_of_a_protected_site_is_not_a_challenge() {
    let body = passing_page();
    assert!(body.contains("px-captcha"), "the fixture must carry the trap");

    let h = Headers::new(vec![]);
    let p = parts(200, &h, &body);
    assert!(!PerimeterX::is_present(&p));
    assert_eq!(PerimeterX::demand(&p), None);
    assert_eq!(PerimeterX::detect_only().inspect(&p), Outcome::NotMine);
}

#[test]
fn both_a_captcha_and_a_block_are_refusals() {
    let h = Headers::new(vec![]);
    let body = blocked_page("c");
    let p = parts(403, &h, &body);
    assert!(PerimeterX::is_present(&p));
    assert_eq!(PerimeterX::detect_only().inspect(&p), Outcome::Blocked);
    assert_ne!(
        veri_core::Verdict::from_outcome(PerimeterX::detect_only().inspect(&p)),
        Some(veri_core::Verdict::Challenged)
    );

    let hard = blocked_page("b");
    assert_eq!(PerimeterX::detect_only().inspect(&parts(403, &h, &hard)), Outcome::Blocked);
}

#[test]
fn the_visitor_cookie_marks_the_provider_without_claiming_a_challenge() {
    let h = headers([("set-cookie", "_pxvid=abc-123; Path=/")]);
    let p = parts(200, &h, "<html><body>ordinary</body></html>");
    assert!(PerimeterX::is_present(&p));
    assert_eq!(PerimeterX::demand(&p), None);
    assert_eq!(PerimeterX::detect_only().inspect(&p), Outcome::Passed);
}

#[test]
fn present_but_declaring_nothing_falls_back_to_the_page() {
    let h = headers([("set-cookie", "_pxvid=abc-123")]);
    let p = parts(403, &h, "<html><body>no config here</body></html>");
    assert_eq!(PerimeterX::detect_only().inspect(&p), Outcome::Blocked);
}

#[test]
fn clearing_is_refused_with_a_reason_that_names_the_app() {
    let h = Headers::new(vec![]);
    let body = blocked_page("c");
    let err = PerimeterX::detect_only()
        .clear(&parts(403, &h, &body), "ua", dead_bridge(), Jar::empty().as_ref())
        .expect_err("this crate does not clear");
    match err {
        ClearError::Rejected(m) => {
            assert!(m.contains("PXtestAppI"), "{m}");
            assert!(m.contains("captcha"), "{m}");
        }
        other => panic!("expected a reasoned refusal, got {other:?}"),
    }
}

#[test]
fn a_page_with_no_perimeterx_is_not_ours() {
    let h = Headers::new(vec![]);
    let p = parts(200, &h, "<html><body>nothing here</body></html>");
    assert!(!PerimeterX::is_present(&p));
    assert_eq!(PerimeterX::detect_only().inspect(&p), Outcome::NotMine);
    assert!(matches!(
        PerimeterX::detect_only().clear(&p, "ua", dead_bridge(), Jar::empty().as_ref()),
        Err(ClearError::NotAChallenge)
    ));
}

#[test]
fn clearance_is_never_claimed() {
    let px = PerimeterX::detect_only();
    assert!(
        !px.holds_clearance(Jar::holding(&[CLEARANCE_COOKIE, "_pxvid"]).as_ref()),
        "holding the cookie is not proof it was earned"
    );
    assert!(!px.holds_clearance(Jar::empty().as_ref()));
}

#[test]
fn an_unterminated_quote_yields_nothing() {
    let truncated = "<html><script>window._pxAppId='PXtestAppI";
    assert_eq!(PerimeterX::config(truncated), None);

    let h = Headers::new(vec![]);
    let p = parts(403, &h, truncated);
    assert!(PerimeterX::is_present(&p), "the marker is there");
    assert_eq!(PerimeterX::demand(&p), None, "present, but nothing readable to act on");
    assert_eq!(PerimeterX::detect_only().inspect(&p), Outcome::Blocked);
}
