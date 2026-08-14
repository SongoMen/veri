use std::time::Duration;
use veri::RetryPolicy;
use veri_core::{Headers, Verdict};

fn headers(pairs: &[(&str, &str)]) -> Headers {
    Headers::new(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect())
}

#[test]
fn transient_failures_are_retryable() {
    assert!(RetryPolicy::retryable(Verdict::Unreachable));
    assert!(RetryPolicy::retryable(Verdict::RateLimited));
    assert!(RetryPolicy::retryable(Verdict::Other(503)));
    assert!(RetryPolicy::retryable(Verdict::Other(504)));
    assert!(RetryPolicy::retryable(Verdict::Other(408)));
}

#[test]
fn the_ladders_business_is_not_retried() {
    assert!(!RetryPolicy::retryable(Verdict::Challenged));
    assert!(!RetryPolicy::retryable(Verdict::Blocked));
    assert!(!RetryPolicy::retryable(Verdict::Ok));
    assert!(!RetryPolicy::retryable(Verdict::Other(404)));
    assert!(!RetryPolicy::retryable(Verdict::Other(401)));
}

#[test]
fn backoff_grows_and_then_stops_growing() {
    let p = RetryPolicy {
        initial_backoff: Duration::from_millis(100),
        max_backoff: Duration::from_millis(400),
        ..RetryPolicy::default()
    };
    // Jitter adds up to 25%, so assert on bands rather than exact values.
    let at = |n| p.backoff(n, None).unwrap();
    assert!(at(0) >= Duration::from_millis(100) && at(0) < Duration::from_millis(126));
    assert!(at(1) >= Duration::from_millis(200) && at(1) < Duration::from_millis(251));
    assert!(at(2) >= Duration::from_millis(400) && at(2) < Duration::from_millis(501));
    // Capped from here on.
    assert!(at(9) < Duration::from_millis(501));
}

#[test]
fn backoff_does_not_overflow_at_absurd_attempt_counts() {
    let p = RetryPolicy::default();
    assert!(p.backoff(u32::MAX, None).unwrap() <= p.max_backoff.mul_f64(1.25));
}

#[test]
fn retry_after_wins_over_the_computed_backoff() {
    let p = RetryPolicy::default();
    let h = headers(&[("retry-after", "3")]);
    assert_eq!(p.backoff(0, Some(&h)), Some(Duration::from_secs(3)));
}

#[test]
fn an_unreasonable_retry_after_is_declined_rather_than_slept_through() {
    let p = RetryPolicy { max_retry_after: Duration::from_secs(30), ..RetryPolicy::default() };
    let h = headers(&[("retry-after", "600")]);
    assert_eq!(p.backoff(0, Some(&h)), None);
}

#[test]
fn an_http_date_retry_after_falls_back_to_backoff() {
    // Only the numeric form is parsed; a date must not be read as 0 seconds.
    let p = RetryPolicy::default();
    let h = headers(&[("retry-after", "Wed, 21 Oct 2015 07:28:00 GMT")]);
    assert!(p.backoff(0, Some(&h)).unwrap() >= p.initial_backoff);
}

#[test]
fn retry_after_can_be_ignored() {
    let p = RetryPolicy { respect_retry_after: false, ..RetryPolicy::default() };
    let h = headers(&[("retry-after", "600")]);
    assert!(p.backoff(0, Some(&h)).unwrap() < Duration::from_secs(1));
}

#[test]
fn none_disables_retrying() {
    assert_eq!(RetryPolicy::none().max_retries, 0);
    assert_eq!(RetryPolicy::times(5).max_retries, 5);
}
