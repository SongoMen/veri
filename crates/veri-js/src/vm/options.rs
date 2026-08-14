//! What a solve was configured with.

use std::path::PathBuf;
use std::time::Duration;

pub const DEFAULT_HEAP_MB: usize = 128;
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone)]
pub struct SolveOptions {
    /// Record every property access and capture decoded sources. Roughly 6x
    /// the memory of a plain solve, so not for serving traffic.
    pub diagnostics: bool,
    /// `None` removes the watchdog, which means trusting the challenge to
    /// terminate.
    pub timeout: Option<Duration>,
    pub heap_mb: usize,
    pub timezone: Option<String>,
    pub trace_undef: bool,
    pub shadow_dom: bool,
    /// Load and run the documents of `<iframe>` elements. Off by default: a
    /// framed document is a second page's worth of work, and only a challenge
    /// that puts its answer in a frame needs it.
    pub frames: bool,
    pub capture_dir: Option<PathBuf>,
    pub trace_catch: bool,
    pub stop_when_cookie: Option<String>,
}

impl Default for SolveOptions {
    fn default() -> Self {
        Self {
            diagnostics: false,
            timeout: Some(DEFAULT_TIMEOUT),
            heap_mb: DEFAULT_HEAP_MB,
            timezone: None,
            trace_undef: false,
            shadow_dom: false,
            frames: false,
            capture_dir: None,
            trace_catch: false,
            stop_when_cookie: None,
        }
    }
}

impl SolveOptions {
    pub fn from_env() -> Self {
        let mut o = Self::default();
        if let Some(mb) = env_parse("VERI_HEAP_MB") {
            o.heap_mb = mb;
        }
        if let Some(secs) = env_parse::<u64>("VERI_SOLVE_TIMEOUT_SECS") {
            o.timeout = (secs > 0).then(|| Duration::from_secs(secs));
        }
        o.timezone = std::env::var("VERI_TIMEZONE").ok().filter(|s| !s.is_empty());
        o.trace_undef = std::env::var("VERI_TRACE_UNDEF").is_ok();
        o.capture_dir =
            std::env::var("VERI_CAPTURE").ok().filter(|s| !s.is_empty()).map(Into::into);
        o.trace_catch = std::env::var("VERI_TRACE_CATCH").is_ok();
        o
    }
}

fn env_parse<T: std::str::FromStr>(key: &str) -> Option<T> {
    std::env::var(key).ok()?.parse().ok()
}
