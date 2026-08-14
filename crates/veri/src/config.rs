use crate::retry::RetryPolicy;
use std::time::Duration;

pub(crate) const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
pub(crate) const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) const DEFAULT_MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct Config {
    pub proxy: Option<String>,
    pub timeout: Option<Duration>,
    pub connect_timeout: Option<Duration>,
    pub read_timeout: Option<Duration>,
    pub redirect_limit: usize,
    /// Not `wreq`'s own `default_headers`: the emulation owns the header set
    /// that makes up the fingerprint, and merging into it risks changing the
    /// order or casing it exists to get right. Applied per request instead.
    pub default_headers: Vec<(String, String)>,
    pub max_response_bytes: Option<usize>,
    pub retry: RetryPolicy,
    pub https_only: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            proxy: None,
            timeout: Some(DEFAULT_TIMEOUT),
            connect_timeout: Some(DEFAULT_CONNECT_TIMEOUT),
            read_timeout: None,
            redirect_limit: 10,
            default_headers: Vec::new(),
            max_response_bytes: Some(DEFAULT_MAX_RESPONSE_BYTES),
            retry: RetryPolicy::default(),
            https_only: false,
        }
    }
}
