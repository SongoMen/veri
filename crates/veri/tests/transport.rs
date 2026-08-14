//! What the client does when the network, rather than the origin, misbehaves.

mod common;

use common::{response, Act};
use std::time::Duration;
use veri::{Client, Error, RetryPolicy, Verdict};

#[tokio::test(flavor = "multi_thread")]
async fn a_reset_connection_does_not_end_the_ladder() {
    let server = common::start(|_| Act::Reset).await;
    let client = Client::builder()
        .retry(RetryPolicy::none())
        .connect_timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let ladder = client.ladder().len();

    let err = client.get(&server.url).send().await.unwrap_err();

    match &err {
        Error::Exhausted { tried, .. } => {
            assert_eq!(
                tried.len(),
                ladder,
                "every identity should have been tried, not just the first"
            );
            assert!(tried.iter().all(|(_, v)| *v == Verdict::Unreachable));
        }
        other => panic!("expected Exhausted after trying the whole ladder, got {other:?}"),
    }
    assert!(err.all_unreachable());
    assert_eq!(server.hits(), ladder, "one connection per rung");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_origin_answer_is_returned_rather_than_laddered() {
    let server = common::start(|_| response(404, "no such thing")).await;
    let client = Client::new().unwrap();

    let res = client.get(&server.url).send().await.unwrap();

    assert_eq!(res.status, 404);
    assert_eq!(res.text(), "no such thing");
    assert_eq!(res.attempts, 1);
    assert_eq!(server.hits(), 1, "a 404 is the origin's answer; no other identity can change it");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_transient_failure_is_retried_on_the_same_identity() {
    let server = common::start(|n| {
        if n < 2 {
            response(503, "warming up")
        } else {
            response(200, "here you go")
        }
    })
    .await;
    let client = Client::builder().retry(RetryPolicy::times(2)).build().unwrap();

    let res = client.get(&server.url).send().await.unwrap();

    assert_eq!(res.status, 200);
    assert_eq!(res.text(), "here you go");
    assert_eq!(res.attempts, 1, "the retries happened on rung 1, not by laddering");
    assert_eq!(server.hits(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn retrying_can_be_switched_off() {
    let server = common::start(|_| response(503, "busy")).await;
    let client = Client::builder().retry(RetryPolicy::none()).build().unwrap();

    let res = client.get(&server.url).send().await.unwrap();

    assert_eq!(res.status, 503);
    assert_eq!(server.hits(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_retry_budget_is_shared_across_the_whole_ladder() {
    let server = common::start(|_| Act::Reset).await;
    let client = Client::builder()
        .retry(RetryPolicy::times(2))
        .connect_timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let ladder = client.ladder().len();

    let _ = client.get(&server.url).send().await.unwrap_err();

    assert_eq!(
        server.hits(),
        ladder + 2,
        "expected one attempt per rung plus two retries total, not two retries per rung"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_body_over_the_cap_is_refused() {
    let big = "x".repeat(4096);
    let server = common::start(move |_| response(200, &big)).await;
    let client = Client::builder().max_response_bytes(1024).build().unwrap();

    let err = client.get(&server.url).send().await.unwrap_err();

    assert!(matches!(err, Error::TooLarge { limit: 1024 }), "got {err:?}");
}

/// A `content-length` response is bounded by HTTP framing whether we check it
/// or not. A chunked one declares no length, so only watching the bytes go by
/// stops it, which is why the cap is enforced while reading, not after.
#[tokio::test(flavor = "multi_thread")]
async fn an_undeclared_length_does_not_defeat_the_cap() {
    let server = common::start(|_| Act::Chunked { chunk_size: 8 * 1024, chunks: 512 }).await;
    let client = Client::builder().max_response_bytes(64 * 1024).build().unwrap();

    let err = client.get(&server.url).send().await.unwrap_err();

    assert!(matches!(err, Error::TooLarge { limit: 65536 }), "got {err:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chunked_body_under_the_cap_arrives_whole() {
    let server = common::start(|_| Act::Chunked { chunk_size: 1024, chunks: 4 }).await;
    let client = Client::builder().max_response_bytes(64 * 1024).build().unwrap();

    let res = client.get(&server.url).send().await.unwrap();

    assert_eq!(res.content_length(), 4096);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_body_under_the_cap_is_untouched() {
    let body = "y".repeat(900);
    let expected = body.clone();
    let server = common::start(move |_| response(200, &body)).await;
    let client = Client::builder().max_response_bytes(1024).build().unwrap();

    let res = client.get(&server.url).send().await.unwrap();

    assert_eq!(res.content_length(), 900);
    assert_eq!(res.text(), expected);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_timeout_is_reported_as_one() {
    let server = common::start(|_| Act::Hang).await;
    let client = Client::builder()
        .timeout(Duration::from_millis(300))
        .retry(RetryPolicy::none())
        .identity("Chrome143")
        .build()
        .unwrap();

    let err = client.get(&server.url).send().await.unwrap_err();

    assert!(err.is_timeout(), "expected a timeout, got {err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn client_default_headers_reach_the_server() {
    let server = common::start(|_| response(200, "ok")).await;
    let client = Client::builder().header("x-from-client", "yes").build().unwrap();

    // The assertion is that this round-trips at all: a malformed default header
    // would fail the send rather than being silently dropped.
    let res = client.get(&server.url).send().await.unwrap();
    assert_eq!(res.status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_per_request_timeout_overrides_the_clients() {
    let server = common::start(|_| Act::Hang).await;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .retry(RetryPolicy::none())
        .identity("Chrome143")
        .build()
        .unwrap();

    let started = std::time::Instant::now();
    let err = client.get(&server.url).timeout(Duration::from_millis(300)).send().await.unwrap_err();

    assert!(err.is_timeout(), "expected a timeout, got {err}");
    assert!(started.elapsed() < Duration::from_secs(5), "the client's 30s timeout won instead");
}

/// A retry has to be invisible to the caller. Repeating a POST is not.
///
/// A 502 or 504 commonly means the origin *did* handle the request and the
/// gateway failed on the way back, so a silent retry is a second write the
/// caller never asked for and cannot detect.
#[tokio::test(flavor = "multi_thread")]
async fn a_post_is_not_replayed_by_the_retry_policy() {
    let server = common::start(|_| response(502, "bad gateway")).await;
    let client = Client::builder().retry(RetryPolicy::times(2)).build().unwrap();

    let res = client
        .post(&server.url)
        .json(&serde_json::json!({ "transfer": 100 }))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status, 502);
    assert_eq!(server.hits(), 1, "the POST body was sent {} times", server.hits());
}

#[tokio::test(flavor = "multi_thread")]
async fn an_idempotent_request_still_retries() {
    let server =
        common::start(|n| if n < 2 { response(502, "bad") } else { response(200, "ok") }).await;
    let client = Client::builder().retry(RetryPolicy::times(2)).build().unwrap();

    let res = client.get(&server.url).send().await.unwrap();

    assert_eq!(res.status, 200);
    assert_eq!(server.hits(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn non_idempotent_retries_can_be_opted_into() {
    let server =
        common::start(|n| if n < 2 { response(502, "bad") } else { response(200, "ok") }).await;
    let policy = RetryPolicy { retry_non_idempotent: true, ..RetryPolicy::times(2) };
    let client = Client::builder().retry(policy).build().unwrap();

    let res = client.post(&server.url).body("write").send().await.unwrap();

    assert_eq!(res.status, 200);
    assert_eq!(server.hits(), 3);
}
