//! A protection must be shown the URL the response actually came from.

mod common;

use std::sync::{Arc, Mutex};
use veri::Client;
use veri_core::{ClearError, CookieJarView, HttpBridge, Outcome, Protection, ResponseParts};

/// Records the URL it was shown and otherwise stays out of the way.
struct Spy(Arc<Mutex<Vec<String>>>);

impl Protection for Spy {
    fn name(&self) -> &'static str {
        "spy"
    }

    fn inspect(&self, parts: &ResponseParts<'_>) -> Outcome {
        self.0.lock().unwrap().push(parts.url.to_string());
        Outcome::NotMine
    }

    fn holds_clearance(&self, _cookies: &dyn CookieJarView) -> bool {
        false
    }

    fn clear(
        &self,
        _parts: &ResponseParts<'_>,
        _user_agent: &str,
        _http: Arc<dyn HttpBridge>,
        _cookies: &dyn CookieJarView,
    ) -> Result<(), ClearError> {
        Err(ClearError::NotAChallenge)
    }
}

#[tokio::test]
async fn protection_sees_the_url_after_redirects() {
    // The first request is redirected to /final on this same server; the Host
    // header is where its address comes from, since the closure predates it.
    let server = common::start_reading(|_, req| {
        if req.line().contains("/final") {
            common::response(200, "hi")
        } else {
            common::Act::Send(
                format!(
                    "HTTP/1.1 301 Moved Permanently\r\nlocation: http://{}/final\r\n\
                     content-length: 0\r\n\r\n",
                    req.header("host")
                )
                .into_bytes(),
            )
        }
    })
    .await;
    let seen = Arc::new(Mutex::new(Vec::new()));

    let client = Client::builder().protection(Arc::new(Spy(seen.clone()))).build().expect("build");

    let res = client.get(&server.url).send().await.expect("request should succeed");

    assert!(res.url.ends_with("/final"), "response url was {}", res.url);

    let seen = seen.lock().unwrap();
    let url = seen.last().expect("protection was never consulted");
    assert!(
        url.ends_with("/final"),
        "protection was shown {url}, but the response came from /final"
    );
}
