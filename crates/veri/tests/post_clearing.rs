//! A POST that gets challenged is cleared and sent again, body and all.

mod common;

use std::sync::Arc;
use veri::{
    ClearError, Client, CookieJarView, HttpBridge, Outcome, Protection, ResponseParts, RetryPolicy,
};

const BODY: &str = r#"{"transfer":100}"#;

/// Challenges anything without the cookie, and clearing installs it.
struct Gate;

impl Protection for Gate {
    fn name(&self) -> &'static str {
        "gate"
    }

    fn inspect(&self, parts: &ResponseParts<'_>) -> Outcome {
        if parts.body.contains("please solve") {
            Outcome::Challenge
        } else {
            Outcome::from_unmarked(parts)
        }
    }

    fn holds_clearance(&self, cookies: &dyn CookieJarView) -> bool {
        cookies.has_cookie("gate_clearance")
    }

    fn clear(
        &self,
        _parts: &ResponseParts<'_>,
        _user_agent: &str,
        _http: Arc<dyn HttpBridge>,
        cookies: &dyn CookieJarView,
    ) -> Result<(), ClearError> {
        cookies.set_cookie("gate_clearance=ok; Path=/");
        Ok(())
    }
}

fn gated() -> Client {
    Client::builder().protection(Arc::new(Gate)).retry(RetryPolicy::none()).build().expect("build")
}

#[tokio::test(flavor = "multi_thread")]
async fn a_challenged_post_is_replayed_after_clearing() {
    let server = common::start_reading(|_, req| {
        if req.header("cookie").contains("gate_clearance") {
            common::response(200, req.body())
        } else {
            common::response(403, "please solve")
        }
    })
    .await;

    let res = gated().post(&server.url).body(BODY).send().await.expect("cleared");

    assert_eq!(res.status, 200);
    assert_eq!(res.cleared, Some("gate"), "the response must say what cleared it");
    assert_eq!(res.text(), BODY, "the body has to survive the replay intact");
    assert_eq!(server.hits(), 2, "one challenged attempt, then one cleared one");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refused_post_is_tried_under_every_identity() {
    let server = common::start(|_| common::page_response(403, "<html>denied</html>")).await;
    let client = gated();

    let err = client.post(&server.url).body(BODY).send().await.expect_err("blocked");

    assert!(!err.saw_challenge(), "a plain refusal is not a challenge");
    assert!(err.all_blocked());
    assert_eq!(server.hits(), client.ladder().len(), "one attempt per rung, no more");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_origins_own_refusal_reaches_the_caller_intact() {
    let denial = r#"{"error":"invalid api key"}"#;
    let server =
        common::start(move |_| common::typed_response(403, "application/json", denial)).await;
    let client = gated();

    let res = client.post(&server.url).body(BODY).send().await.expect("the origin answered");

    assert_eq!(res.status, 403);
    assert_eq!(res.text(), denial);
    assert_eq!(server.hits(), 1, "a registered protection must not ladder over the origin");
}

#[tokio::test(flavor = "multi_thread")]
async fn exhausting_the_ladder_still_hands_back_what_the_last_rung_saw() {
    let server = common::start(|_| common::page_response(403, "<html>denied</html>")).await;
    let client = gated();

    let err = client.post(&server.url).body(BODY).send().await.expect_err("blocked");
    let last = err.response().expect("the ladder must not discard the response");

    assert_eq!(last.status, 403);
    assert_eq!(last.text(), "<html>denied</html>");
    assert_eq!(last.attempts, client.ladder().len(), "the last rung, not the first");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unclaimed_refusal_is_the_origins_answer_and_is_not_repeated() {
    let server = common::start(|_| common::response(403, "denied")).await;
    let client = Client::builder().retry(RetryPolicy::none()).build().expect("build");

    let res = client.post(&server.url).body(BODY).send().await.expect("a 403 is a response");

    assert_eq!(res.status, 403);
    assert_eq!(server.hits(), 1, "an unclaimed 403 must not ladder");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_transport_failure_after_clearing_keeps_laddering() {
    let server = common::start(|n| match n {
        0 => common::response(403, "please solve"),
        1 => common::Act::Reset,
        _ => common::response(200, "served"),
    })
    .await;

    let res = gated().get(&server.url).send().await.expect("the ladder must carry on");

    assert_eq!(res.status, 200);
    assert_eq!(res.text(), "served");
    assert!(res.attempts > 1, "the second rung is what served it");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unauthorised_api_answer_comes_back_with_its_body() {
    let server = common::start(|_| common::response(401, r#"{"error":"bad key"}"#)).await;

    let res = gated().post(&server.url).body(BODY).send().await.expect("401 is an answer");

    assert_eq!(res.status, 401);
    assert_eq!(res.text(), r#"{"error":"bad key"}"#);
    assert_eq!(server.hits(), 1, "a 401 was replayed {} times", server.hits());
}
