//! What reaches the wire when a caller supplies their own cookies.

mod common;

use veri::Client;

fn host_of(url: &str) -> &str {
    url.trim_start_matches("http://").trim_end_matches('/')
}

/// Seeded into the jar, so every later request to that host carries it.
#[tokio::test]
async fn a_seeded_cookie_is_sent() {
    let server = common::start_reading(|_, req| common::response(200, req.header("cookie"))).await;
    let client = Client::new().expect("build");
    client.set_cookie(host_of(&server.url), "session=abc; Path=/");

    let res = client.get(&server.url).send().await.expect("request");
    assert!(res.text().contains("session=abc"), "server saw {:?}", res.text());
}

/// Set on one request only.
#[tokio::test]
async fn a_per_request_cookie_header_is_sent() {
    let server = common::start_reading(|_, req| common::response(200, req.header("cookie"))).await;
    let client = Client::new().expect("build");

    let res =
        client.get(&server.url).header("cookie", "one=1; two=2").send().await.expect("request");
    assert!(res.text().contains("one=1"), "server saw {:?}", res.text());
    assert!(res.text().contains("two=2"), "server saw {:?}", res.text());
}

/// Client-wide, for a caller who wants the same cookie on every request.
#[tokio::test]
async fn a_default_cookie_header_is_sent() {
    let server = common::start_reading(|_, req| common::response(200, req.header("cookie"))).await;
    let client = Client::builder().header("cookie", "api=key").build().expect("build");

    let res = client.get(&server.url).send().await.expect("request");
    assert!(res.text().contains("api=key"), "server saw {:?}", res.text());
}

/// Supplying a cookie on the request used to replace the jar's outright, which
/// silently threw away a clearance the ladder had just earned.
#[tokio::test]
async fn a_request_cookie_does_not_discard_the_jar() {
    let server = common::start_reading(|_, req| {
        common::response(200, &format!("{}|{}", req.header("cookie"), req.raw_count("cookie")))
    })
    .await;
    let client = Client::new().expect("build");
    client.set_cookie(host_of(&server.url), "cf_clearance=earned; Path=/");

    let res = client.get(&server.url).header("cookie", "mine=1").send().await.expect("request");
    let text = res.text().to_string();
    let (value, count) = text.split_once('|').expect("echoed value|count");
    assert!(value.contains("cf_clearance=earned"), "the jar's cookie was dropped: {value:?}");
    assert!(value.contains("mine=1"), "the caller's cookie was dropped: {value:?}");
    assert_eq!(count, "1", "cookies belong in one header, not two");
}

/// On a name collision the caller is the more specific instruction.
#[tokio::test]
async fn a_request_cookie_overrides_the_jar_by_name() {
    let server = common::start_reading(|_, req| common::response(200, req.header("cookie"))).await;
    let client = Client::new().expect("build");
    client.set_cookie(host_of(&server.url), "session=old; Path=/");

    let res =
        client.get(&server.url).header("cookie", "session=new").send().await.expect("request");
    assert!(res.text().contains("session=new"), "server saw {:?}", res.text());
    assert!(!res.text().contains("session=old"), "both values were sent: {:?}", res.text());
}
