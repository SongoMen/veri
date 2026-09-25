use std::sync::Arc;
use veri_core::{
    BridgeCall, ClearError, Demand, Headers, HttpBridge, Outcome, Protection, SolveError,
    SolveReport, Solver,
};
use veri_integrations::recaptcha::Recaptcha;
use veri_testkit::{dead_bridge, headers, parts, Jar};

const KEY: &str = "6Le8iM4ZAAAAADEjw_VY4eW97zvA923JmDWGvdaq";

fn interstitial() -> String {
    format!(
        "<html><head><title>Too Many Requests</title>\
         <script src=\"https://www.recaptcha.net/recaptcha/api.js?render={KEY}\"></script>\
         </head><body><div id=\"progress\"></div><script>\
         grecaptcha.ready(function () {{ \
           grecaptcha.execute('{KEY}', {{action: 'unban'}}).then(function (t) {{ \
             var i = document.createElement('img'); \
             i.setAttribute('src', '/action.php?unban=' + t); \
             document.body.appendChild(i); \
           }}); \
         }});</script></body></html>"
    )
}

/// A solver that reports whatever bridge traffic the test needs it to.
struct Reporting(Vec<BridgeCall>);

impl Reporting {
    fn calling(urls: &[&str]) -> Arc<Self> {
        Arc::new(Self(
            urls.iter()
                .map(|u| BridgeCall {
                    method: "GET".into(),
                    url: (*u).into(),
                    status: 200,
                    request_bytes: 0,
                    response_bytes: 12,
                })
                .collect(),
        ))
    }
}

impl Solver for Reporting {
    fn solve(
        &self,
        _html: &str,
        _url: &str,
        _ua: &str,
        _http: Arc<dyn HttpBridge>,
    ) -> Result<SolveReport, SolveError> {
        Ok(SolveReport { requests: self.0.clone(), ..SolveReport::default() })
    }
}

#[test]
fn the_interstitial_is_a_challenge_not_rate_limiting() {
    let h = Headers::new(vec![]);
    let body = interstitial();
    let p = parts(429, &h, &body);
    assert_eq!(Recaptcha::demand(&p), Some(Demand::Script));
    assert_eq!(Recaptcha::detect_only().inspect(&p), Outcome::Challenge);
    assert_eq!(Outcome::from_unmarked(&p), Outcome::RateLimited);
}

#[test]
fn an_ordinary_page_carrying_recaptcha_is_left_alone() {
    let h = headers([("server", "nginx")]);
    let body = interstitial();
    let p = parts(200, &h, &body);
    assert_eq!(Recaptcha::demand(&p), None);
    assert_ne!(Recaptcha::detect_only().inspect(&p), Outcome::Challenge);
}

#[test]
fn the_loader_alone_is_not_enough() {
    let h = Headers::new(vec![]);
    let only_loader =
        format!("<html><script src=\"https://www.recaptcha.net/recaptcha/api.js?render={KEY}\"></script></html>");
    assert_eq!(Recaptcha::demand(&parts(429, &h, &only_loader)), None);

    let plain = "<html><title>Too Many Requests</title></html>";
    assert_eq!(Recaptcha::demand(&parts(429, &h, plain)), None);
    assert_eq!(Recaptcha::detect_only().inspect(&parts(429, &h, plain)), Outcome::NotMine);
}

#[test]
fn the_site_key_is_read_back() {
    assert_eq!(Recaptcha::site_key(&interstitial()), Some(KEY));
    assert_eq!(Recaptcha::site_key("<html>nothing here</html>"), None);
}

#[test]
fn clearing_needs_the_page_to_report_to_its_own_origin() {
    let h = Headers::new(vec![]);
    let body = interstitial();
    let p = parts(429, &h, &body);
    let jar = Jar::default();

    let google_only = Recaptcha::with_solver(Reporting::calling(&[
        "https://www.recaptcha.net/recaptcha/api2/anchor?k=x",
        "https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js",
    ]));
    assert!(matches!(
        google_only.clear(&p, "ua", dead_bridge(), &jar),
        Err(ClearError::Rejected(_))
    ));

    let reported = Recaptcha::with_solver(Reporting::calling(&[
        "https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js",
        "https://example.test/action.php?unban=token",
    ]));
    assert!(reported.clear(&p, "ua", dead_bridge(), &jar).is_ok());
}

#[test]
fn a_page_that_is_not_the_challenge_is_refused_before_solving() {
    let h = Headers::new(vec![]);
    let body = interstitial();
    let p = parts(200, &h, &body);
    let r = Recaptcha::with_solver(Reporting::calling(&["https://example.test/x"]));
    assert!(matches!(
        r.clear(&p, "ua", dead_bridge(), &Jar::default()),
        Err(ClearError::NotAChallenge)
    ));
}

#[test]
fn detect_only_says_so_rather_than_pretending_to_clear() {
    let h = Headers::new(vec![]);
    let body = interstitial();
    let r = Recaptcha::detect_only().clear(
        &parts(429, &h, &body),
        "ua",
        dead_bridge(),
        &Jar::default(),
    );
    assert!(matches!(r, Err(ClearError::Failed(m)) if m.contains("detects only")));
}

#[test]
fn clearance_is_never_claimed_from_the_jar() {
    assert!(!Recaptcha::detect_only().holds_clearance(&*Jar::holding(&["anything", "at", "all"])));
}
