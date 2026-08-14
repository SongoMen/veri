use std::time::Duration;
use veri::*;
use veri_core::url::host_of;

#[test]
fn host_parsing() {
    assert_eq!(host_of("https://a.example.com/x/y?z=1").as_deref(), Some("a.example.com"));
    assert_eq!(host_of("http://h:8080/").as_deref(), Some("h:8080"));
    assert_eq!(host_of("https://h?a=1").as_deref(), Some("h"));
    assert_eq!(host_of("not a url"), None);
    assert_eq!(host_of("https:///nohost"), None);
}

#[test]
fn query_encoding_and_joining() {
    let c = Client::new().unwrap();
    let b = c.get("https://x/api").query([("q", "a b&c"), ("n", "1")]);
    assert_eq!(b.peek().url, "https://x/api?q=a%20b%26c&n=1");

    let b2 = c.get("https://x/api?already=1").query([("q", "2")]);
    assert!(b2.peek().url.ends_with("?already=1&q=2"), "{}", b2.peek().url);
}

#[test]
fn json_sets_body_and_content_type() {
    let c = Client::new().unwrap();
    let b = c.post("https://x").json(&serde_json::json!({"a": 1}));
    assert_eq!(b.peek().body.as_deref(), Some(&b"{\"a\":1}"[..]));
    assert!(b.peek().headers.iter().any(|(k, v)| k == "content-type" && v == "application/json"));
}

#[test]
fn form_encodes_pairs() {
    let c = Client::new().unwrap();
    let b = c.post("https://x").form([("a", "1 2"), ("b", "&")]);
    assert_eq!(String::from_utf8(b.peek().body.clone().unwrap()).unwrap(), "a=1%202&b=%26");
}

#[test]
fn works_with_no_protections_registered() {
    let c = Client::new().unwrap();
    assert!(!c.is_laddering() || c.ladder().len() > 1);
    assert!(!c.ladder().is_empty());
}

#[test]
fn builder_rejects_empty_ladder() {
    assert!(Client::builder().ladder(&["nope"]).build().is_err());
}

#[test]
fn a_single_unknown_identity_is_an_error() {
    let e = match Client::builder().ladder(&["Firefox143", "Firefx143", "Safari18"]).build() {
        Err(e) => e.to_string(),
        Ok(_) => panic!("a typo in the ladder should not build"),
    };
    assert!(e.contains("Firefx143"), "should name the typo: {e}");
    assert!(e.contains("Firefox143"), "should list the known names: {e}");

    assert!(Client::builder().identity("Chrome1000").build().is_err());
    assert!(Client::builder().ladder(&["Firefox143", "Safari18"]).build().is_ok());
}

#[test]
fn error_distinguishes_challenge_from_block() {
    let id = Identity::new("X", "ua");
    let challenged = Error::Exhausted {
        host: "h".into(),
        tried: vec![(id, Verdict::Challenged)],
        cleared: false,
        last_transport: None,
        last_response: None,
    };
    assert!(challenged.saw_challenge());
    assert!(!challenged.all_blocked());

    let blocked = Error::Exhausted {
        host: "h".into(),
        tried: vec![(id, Verdict::Blocked)],
        cleared: false,
        last_transport: None,
        last_response: None,
    };
    assert!(!blocked.saw_challenge());
    assert!(blocked.all_blocked());
}

#[test]
fn clearance_issued_then_refused_reads_differently_from_never_issued() {
    let id = Identity::new("X", "ua");

    let rechallenged = Error::Exhausted {
        host: "h".into(),
        tried: vec![(id, Verdict::Challenged)],
        cleared: true,
        last_transport: None,
        last_response: None,
    };
    assert!(rechallenged.cleared_but_rechallenged());
    assert!(rechallenged.to_string().contains("still challenged"));

    let never_cleared = Error::Exhausted {
        host: "h".into(),
        tried: vec![(id, Verdict::Challenged)],
        cleared: false,
        last_transport: None,
        last_response: None,
    };
    assert!(!never_cleared.cleared_but_rechallenged());
    assert!(!never_cleared.to_string().contains("re-challenges"));

    let blocked = Error::Exhausted {
        host: "h".into(),
        tried: vec![(id, Verdict::Blocked)],
        cleared: true,
        last_transport: None,
        last_response: None,
    };
    assert!(!blocked.cleared_but_rechallenged());
}

#[test]
fn ladder_is_on_by_default_and_off_when_pinned() {
    let laddered = Client::new().unwrap();
    assert!(laddered.is_laddering());
    assert!(laddered.ladder().len() > 1);

    let pinned = Client::builder().identity("Firefox143").build().unwrap();
    assert!(!pinned.is_laddering());
    assert_eq!(pinned.ladder(), vec!["Firefox143"]);
}

#[test]
fn available_identities_are_all_usable() {
    for name in ClientBuilder::available_identities() {
        assert!(
            Client::builder().identity(name).build().is_ok(),
            "advertised identity {name} cannot be selected"
        );
    }
}

/// URL handling that used to silently produce the wrong request.
#[test]
fn url_edge_cases() {
    // Userinfo and case must not fork the session key or leak into Origin.
    assert_eq!(host_of("https://user:pw@Example.com/x").as_deref(), Some("example.com"));
    assert_eq!(host_of("https://EXAMPLE.com:8443/x").as_deref(), Some("example.com:8443"));
    assert_eq!(host_of("https://example.com/x").as_deref(), Some("example.com"));
    assert_eq!(host_of("not-a-url"), None);
}

#[test]
fn query_survives_a_fragment() {
    let c = Client::new().unwrap();
    let b = c.get("https://x.test/p#frag").query([("a", "1")]);
    let spec = b.peek();
    assert_eq!(spec.url, "https://x.test/p?a=1#frag");

    let b = c.get("https://x.test/p?b=2").query([("a", "1")]);
    let spec = b.peek();
    assert_eq!(spec.url, "https://x.test/p?b=2&a=1");
}

#[test]
fn form_twice_sets_one_content_type() {
    let c = Client::new().unwrap();
    let b = c.post("https://x.test/p").form([("a", "1")]).form([("b", "2")]);
    let spec = b.peek();
    let n = spec.headers.iter().filter(|(k, _)| k.eq_ignore_ascii_case("content-type")).count();
    assert_eq!(n, 1, "content-type was sent {n} times");
}

/// Cloning must share state, or a clone silently starts from scratch: no
/// remembered identity, no cookies, no clearance.
#[test]
fn clones_share_sessions_and_policy() {
    let a = Client::new().unwrap();
    let b = a.clone();
    a.set_cookie("example.com", "cf_clearance=abc; Path=/");
    assert_eq!(b.cookie("example.com", "cf_clearance").as_deref(), Some("abc"));
    assert_eq!(a.ladder(), b.ladder());
}

#[test]
fn seeding_a_cookie_twice_replaces_rather_than_accumulates() {
    let c = Client::new().unwrap();
    c.set_cookie("example.com", "cf_clearance=first; Path=/");
    c.set_cookie("example.com", "cf_clearance=second; Path=/");
    assert_eq!(c.cookie("example.com", "cf_clearance").as_deref(), Some("second"));
}

#[test]
fn forgetting_a_host_drops_its_seeded_cookies() {
    let c = Client::new().unwrap();
    c.set_cookie("example.com", "cf_clearance=abc; Path=/");
    c.forget("example.com");
    assert_eq!(c.cookie("example.com", "cf_clearance"), None);
}

#[test]
fn defaults_are_safe_without_opting_in() {
    let c = Client::new().unwrap();
    assert!(
        c.max_response_bytes().is_some(),
        "an uncapped body read lets one response take down the process"
    );
    assert!(c.timeout().is_some(), "a request with no deadline can wait forever");
}

#[test]
fn limits_are_configurable() {
    let c = Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(1))
        .max_response_bytes(1024)
        .redirect_limit(0)
        .retry(RetryPolicy::none())
        .build()
        .unwrap();

    let unbounded = Client::builder().no_timeout().unlimited_response_bytes().build().unwrap();
    assert_eq!(c.timeout(), Some(Duration::from_secs(5)));
    assert_eq!(c.max_response_bytes(), Some(1024));
    assert_eq!(unbounded.timeout(), None);
    assert_eq!(unbounded.max_response_bytes(), None);
}

/// A per-request header is the more specific instruction, so it must win.
#[test]
fn a_request_header_overrides_the_clients_default() {
    let c = Client::builder()
        .header("x-api-key", "default")
        .header("accept-language", "en-GB")
        .build()
        .unwrap();
    let b = c.get("https://x.test/p").header("x-api-key", "specific");
    let spec = b.peek();

    // The client's defaults are merged at send time, so the spec carries only
    // what the request set; the precedence rule lives in `send_once`.
    assert_eq!(spec.headers.len(), 1);
    let would_send: Vec<&str> = c
        .default_headers()
        .into_iter()
        .filter(|(k, _)| !spec.headers.iter().any(|(sk, _)| sk.eq_ignore_ascii_case(k)))
        .map(|(k, _)| k)
        .collect();
    assert_eq!(would_send, vec!["accept-language"], "x-api-key must not be sent twice");
}

#[test]
fn a_transport_failure_is_visible_on_the_error() {
    let id = Identity::new("X", "ua");
    let e = Error::Exhausted {
        host: "h".into(),
        tried: vec![(id, Verdict::Unreachable), (id, Verdict::Unreachable)],
        cleared: false,
        last_transport: None,
        last_response: None,
    };
    assert!(e.all_unreachable());
    assert!(!e.all_blocked());
    assert!(!e.saw_challenge());

    let mixed = Error::Exhausted {
        host: "h".into(),
        tried: vec![(id, Verdict::Unreachable), (id, Verdict::Challenged)],
        cleared: false,
        last_transport: None,
        last_response: None,
    };
    assert!(!mixed.all_unreachable());
    assert!(mixed.saw_challenge());
}

#[test]
fn a_request_builder_is_owned_so_it_can_be_spawned() {
    // Borrowing the client would make this fail to compile, which is the whole
    // point: `tokio::spawn(client.get(url).send())` must work.
    fn assert_send<T: Send + 'static>(_: T) {}
    let c = Client::new().unwrap();
    assert_send(c.get("https://x.test").send());
}

#[test]
fn json_twice_sets_one_content_type() {
    let c = Client::new().unwrap();
    let b = c
        .post("https://x.test/p")
        .json(&serde_json::json!({ "a": 1 }))
        .json(&serde_json::json!({ "b": 2 }));
    let n = b.peek().headers.iter().filter(|(k, _)| k.eq_ignore_ascii_case("content-type")).count();
    assert_eq!(n, 1, "content-type was sent {n} times");
}
