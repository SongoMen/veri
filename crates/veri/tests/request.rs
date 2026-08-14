use veri::request::RequestSpec;
use veri::Response;
use veri_core::{Headers, Identity, Verdict};

fn bytes(status: u16, body: Vec<u8>, verdict: Verdict) -> Response {
    Response {
        status,
        headers: Headers::default(),
        url: "https://example.com".into(),
        body,
        identity: Identity::new("Test", "ua"),
        verdict,
        attempts: 1,
        cleared: None,
        used_clearance: false,
    }
}

fn resp(status: u16, body: &str, verdict: Verdict) -> Response {
    bytes(status, body.as_bytes().to_vec(), verdict)
}

#[test]
fn json_deserialises() {
    let r = resp(200, r#"{"a":1,"b":"x"}"#, Verdict::Ok);
    let v: serde_json::Value = r.json().unwrap();
    assert_eq!(v["a"], 1);
    assert_eq!(v["b"], "x");
}

#[test]
fn text_survives_invalid_utf8() {
    let r = bytes(200, vec![0xff, 0xfe, b'h', b'i'], Verdict::Ok);
    assert!(r.text().contains("hi"));
}

#[test]
fn success_and_ok_are_different_questions() {
    let challenge = resp(200, "Just a moment", Verdict::Challenged);
    assert!(challenge.is_success());
    assert!(!challenge.is_ok());

    let missing = resp(404, "nope", Verdict::Other(404));
    assert!(!missing.is_success());
    assert!(!missing.is_ok());
}

#[test]
fn body_is_replayable() {
    let mut spec = RequestSpec::new("POST", "https://x");
    spec.body = Some(b"payload".to_vec());
    let again = spec.clone();
    assert_eq!(spec.body, again.body);
}

#[test]
fn error_for_status_is_about_the_status_alone() {
    assert!(resp(200, "{}", Verdict::Ok).error_for_status().is_ok());
    assert!(resp(204, "", Verdict::Ok).error_for_status().is_ok());

    let e = resp(404, "nope", Verdict::Other(404)).error_for_status().unwrap_err();
    assert_eq!(e.status(), Some(404));
    assert!(e.to_string().contains("404"));

    // A challenge arrives with a 200 and must survive error_for_status - the
    // two questions are deliberately different.
    let challenge = resp(200, "Just a moment", Verdict::Challenged).error_for_status();
    assert!(challenge.is_ok(), "error_for_status must not judge the verdict");
    assert!(!challenge.unwrap().is_ok());
}

#[test]
fn repeated_headers_are_all_readable() {
    let mut r = resp(200, "", Verdict::Ok);
    r.headers = Headers::new(vec![
        ("set-cookie".into(), "a=1".into()),
        ("content-type".into(), "text/html".into()),
        ("Set-Cookie".into(), "b=2".into()),
    ]);
    // `header` keeps only the first, which loses every Set-Cookie but one.
    assert_eq!(r.header("set-cookie"), Some("a=1"));
    assert_eq!(r.header_all("set-cookie").collect::<Vec<_>>(), vec!["a=1", "b=2"]);
    assert_eq!(r.content_type(), Some("text/html"));
}
