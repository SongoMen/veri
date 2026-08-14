use veri_core::{Headers, Outcome, ResponseParts, Verdict};

#[test]
fn headers_are_case_insensitive() {
    let h = Headers::new(vec![("Content-Type".into(), "text/html".into())]);
    assert_eq!(h.get("content-type"), Some("text/html"));
    assert_eq!(h.get("CONTENT-TYPE"), Some("text/html"));
    assert!(h.contains("Content-Type"));
    assert_eq!(h.get("missing"), None);
}

#[test]
fn unclaimed_responses_use_plain_http_semantics() {
    assert_eq!(Verdict::from_status(200), Verdict::Ok);
    assert_eq!(Verdict::from_status(204), Verdict::Ok);
    assert_eq!(Verdict::from_status(429), Verdict::RateLimited);
    assert_eq!(Verdict::from_status(403), Verdict::Other(403));
    assert_eq!(Verdict::from_status(500), Verdict::Other(500));
}

#[test]
fn outcome_maps_to_verdict() {
    assert_eq!(Verdict::from_outcome(Outcome::Passed), Some(Verdict::Ok));
    assert_eq!(Verdict::from_outcome(Outcome::Challenge), Some(Verdict::Challenged));
    assert_eq!(Verdict::from_outcome(Outcome::Blocked), Some(Verdict::Blocked));
    assert_eq!(Verdict::from_outcome(Outcome::NotMine), None);
}

#[test]
fn escalation_advice() {
    assert!(Verdict::Challenged.identity_might_help());
    assert!(Verdict::Blocked.identity_might_help());
    // A server that dislikes a TLS fingerprint closes the connection rather
    // than answering, so an unreachable host is worth one more identity.
    assert!(Verdict::Unreachable.identity_might_help());
    assert!(!Verdict::RateLimited.identity_might_help());
    assert!(!Verdict::Ok.identity_might_help());
    assert!(!Verdict::Other(404).identity_might_help());
}

fn unmarked(status: u16, content_type: &str, body: &str) -> Outcome {
    let headers = match content_type {
        "" => Headers::new(vec![]),
        ct => Headers::new(vec![("content-type".into(), ct.into())]),
    };
    Outcome::from_unmarked(&ResponseParts { status, headers: &headers, body, url: "https://h/x" })
}

#[test]
fn an_unclaimed_status_is_left_for_the_origin() {
    assert_eq!(unmarked(401, "text/html", "<html>no</html>"), Outcome::NotMine);
    assert_eq!(unmarked(429, "text/html", "<html>slow down</html>"), Outcome::RateLimited);
    assert_eq!(unmarked(200, "text/html", "<html>hi</html>"), Outcome::Passed);
    assert_eq!(unmarked(500, "text/html", "<html>oops</html>"), Outcome::NotMine);
}

#[test]
fn an_origins_own_403_is_not_claimed_as_a_refusal() {
    assert_eq!(unmarked(403, "text/html; charset=utf-8", "<html>denied</html>"), Outcome::Blocked);
    assert_eq!(
        unmarked(403, "application/json", r#"{"error":"invalid api key"}"#),
        Outcome::NotMine
    );
    assert_eq!(unmarked(403, "", r#"{"error":"invalid api key"}"#), Outcome::NotMine);
    assert_eq!(unmarked(403, "", "<html>denied</html>"), Outcome::Blocked);
}
