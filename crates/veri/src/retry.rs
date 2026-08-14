use std::time::Duration;
use veri_core::{Headers, Verdict};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Retries per request, shared across every rung of the ladder.
    pub max_retries: u32,
    /// Wait before the first retry. Doubles each time, up to `max_backoff`.
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    pub respect_retry_after: bool,
    /// A longer `Retry-After` than this is declined, not slept through.
    pub max_retry_after: Duration,
    /// Off by default: a 502 usually means the origin applied the request and
    /// the gateway failed on the way back, so a retry is a second write.
    pub retry_non_idempotent: bool,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 2,
            initial_backoff: Duration::from_millis(250),
            max_backoff: Duration::from_secs(8),
            respect_retry_after: true,
            max_retry_after: Duration::from_secs(30),
            retry_non_idempotent: false,
        }
    }
}

impl RetryPolicy {
    pub fn none() -> Self {
        Self { max_retries: 0, ..Self::default() }
    }

    pub fn times(n: u32) -> Self {
        Self { max_retries: n, ..Self::default() }
    }

    /// The RFC 7231 safe/idempotent set.
    pub fn idempotent(method: &str) -> bool {
        matches!(
            method.to_ascii_uppercase().as_str(),
            "GET" | "HEAD" | "PUT" | "DELETE" | "OPTIONS" | "TRACE"
        )
    }

    pub fn may_repeat(&self, method: &str) -> bool {
        self.retry_non_idempotent || Self::idempotent(method)
    }

    /// Challenges and blocks are excluded - those are the ladder's business.
    pub fn retryable(verdict: Verdict) -> bool {
        match verdict {
            Verdict::Unreachable | Verdict::RateLimited => true,
            Verdict::Other(s) => matches!(s, 408 | 425 | 500 | 502 | 503 | 504),
            _ => false,
        }
    }

    /// `None` when the server asked for longer than `max_retry_after`.
    pub fn backoff(&self, retry: u32, headers: Option<&Headers>) -> Option<Duration> {
        if self.respect_retry_after {
            if let Some(after) = headers.and_then(retry_after) {
                return (after <= self.max_retry_after).then_some(after);
            }
        }
        let exp = self.initial_backoff.saturating_mul(1u32 << retry.min(16));
        let capped = exp.min(self.max_backoff);
        Some(capped + jitter(capped))
    }
}

/// Only delay-seconds; the HTTP-date form is ignored.
fn retry_after(headers: &Headers) -> Option<Duration> {
    let raw = headers.get("retry-after")?.trim();
    raw.parse::<u64>().ok().map(Duration::from_secs)
}

/// Up to 25% extra, so a fleet that failed together does not retry together.
fn jitter(base: Duration) -> Duration {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let quarter = base / 4;
    quarter.mul_f64(f64::from(nanos % 1_000) / 1_000.0)
}
