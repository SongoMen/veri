//! The ladder must not replay a request the origin already answered.

mod common;

use veri::Client;

#[tokio::test]
async fn an_origin_error_is_answered_once_and_returned() {
    let server = common::start(|_| common::response(404, r#"{"error":"nope"}"#)).await;
    let client = Client::new().expect("build");

    let res = client.get(&server.url).send().await.expect("a 404 is a response, not an error");

    assert_eq!(res.status, 404);
    assert_eq!(res.text(), r#"{"error":"nope"}"#, "the body must be reachable");
    assert!(!res.is_success());
    assert!(!res.is_ok(), "404 is not a veri-ok verdict");
    assert_eq!(server.hits(), 1, "the ladder replayed an answered request");
}

#[tokio::test]
async fn a_rejected_post_body_is_not_replayed() {
    let server = common::start(|_| common::response(401, r#"{"error":"bad key"}"#)).await;
    let client = Client::new().expect("build");

    let res = client
        .post(&server.url)
        .header("x-api-key", "wrong")
        .json(&serde_json::json!({ "symbol": "AAPL" }))
        .send()
        .await
        .expect("a 401 is a response, not an error");

    assert_eq!(res.status, 401);
    assert_eq!(res.text(), r#"{"error":"bad key"}"#);
    assert_eq!(server.hits(), 1, "a rejected POST must be sent once, not once per identity");
}

/// A clearance you already hold must survive being seeded before any traffic.
#[tokio::test]
async fn a_cookie_seeded_before_the_first_request_is_kept() {
    let client = Client::new().expect("build");

    assert!(client.cookie("example.com", "cf_clearance").is_none());
    client.set_cookie("example.com", "cf_clearance=abc123; Path=/");

    assert_eq!(
        client.cookie("example.com", "cf_clearance").as_deref(),
        Some("abc123"),
        "a cookie seeded before the first request was dropped"
    );
}

/// ...and is actually sent, not merely remembered.
#[tokio::test]
async fn a_seeded_cookie_reaches_the_wire() {
    // Echoing the Cookie header back is the only way to see what was sent.
    let server = common::start_reading(|_, req| common::response(200, req.header("cookie"))).await;

    let client = Client::new().expect("build");
    let host = server.url.trim_start_matches("http://").trim_end_matches('/');
    client.set_cookie(host, "cf_clearance=seeded; Path=/");

    let res = client.get(&server.url).send().await.expect("request");
    assert!(
        res.text().contains("cf_clearance=seeded"),
        "the seeded cookie never reached the server; saw {:?}",
        res.text()
    );
}
