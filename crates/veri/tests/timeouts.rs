mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use veri::{ClearError, Client, CookieJarView, HttpBridge, Outcome, Protection, ResponseParts};

struct SlowToClear {
    solves: AtomicUsize,
}

impl Protection for SlowToClear {
    fn name(&self) -> &'static str {
        "slow"
    }
    fn inspect(&self, parts: &ResponseParts<'_>) -> Outcome {
        if parts.status == 403 {
            Outcome::Challenge
        } else {
            Outcome::from_unmarked(parts)
        }
    }
    fn holds_clearance(&self, cookies: &dyn CookieJarView) -> bool {
        cookies.has_cookie("cleared")
    }
    fn clear(
        &self,
        _parts: &ResponseParts<'_>,
        _ua: &str,
        _http: Arc<dyn HttpBridge>,
        cookies: &dyn CookieJarView,
    ) -> Result<(), ClearError> {
        // Longer than the client's per-request timeout, on purpose.
        std::thread::sleep(Duration::from_secs(3));
        self.solves.fetch_add(1, Ordering::SeqCst);
        cookies.set_cookie("cleared=1");
        Ok(())
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_request_timeout_does_not_bound_the_solve() {
    let server = common::start(|n| {
        if n == 0 {
            common::response(403, "challenge")
        } else {
            common::response(200, "real page")
        }
    })
    .await;

    let p = Arc::new(SlowToClear { solves: AtomicUsize::new(0) });
    let client = Client::builder()
        .timeout(Duration::from_millis(800))
        .identity("Chrome149")
        .protection(p.clone())
        .build()
        .expect("client");

    let t = Instant::now();
    let res = client.get(&server.url).send().await.expect("the solve must not be cut short");
    let elapsed = t.elapsed();

    assert!(res.is_ok(), "verdict was {:?}", res.verdict);
    assert_eq!(p.solves.load(Ordering::SeqCst), 1, "the solve must have run to completion");
    assert!(
        elapsed > Duration::from_secs(3),
        "whole request took {elapsed:?}, so the 800ms per-request timeout did not bound it"
    );
}
