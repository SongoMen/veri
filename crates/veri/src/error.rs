//! `wreq` is deliberately absent from every signature here. It is pinned to a
//! release candidate, so exposing its error type would weld every caller's
//! error handling to a pre-release and make the next `wreq` bump a breaking
//! change for them rather than for us.

use crate::{Identity, Response};
use std::fmt;
use veri_core::Verdict;

/// Opaque on purpose, ask it questions rather than matching on it.
pub struct TransportError(wreq::Error);

impl TransportError {
    pub(crate) fn new(e: wreq::Error) -> Self {
        Self(e)
    }

    pub fn is_timeout(&self) -> bool {
        self.0.is_timeout()
    }

    pub fn is_connect(&self) -> bool {
        self.0.is_connect()
    }

    pub fn is_proxy(&self) -> bool {
        self.0.is_proxy_connect()
    }

    pub fn is_tls(&self) -> bool {
        self.0.is_tls()
    }

    pub fn is_connection_reset(&self) -> bool {
        self.0.is_connection_reset()
    }

    pub fn is_redirect(&self) -> bool {
        self.0.is_redirect()
    }

    pub fn is_egress_fault(&self) -> bool {
        self.0.is_proxy_connect() || self.0.is_builder()
    }
}

impl fmt::Debug for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.0, f)
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

impl std::error::Error for TransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
    }
}

#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    Transport(TransportError),
    Exhausted {
        host: String,
        tried: Vec<(Identity, Verdict)>,
        cleared: bool,
        last_transport: Option<TransportError>,
        last_response: Option<Box<Response>>,
    },
    TooLarge {
        limit: usize,
    },
    InvalidUrl(String),
    InvalidRequest(String),
    Json(serde_json::Error),
    Status {
        status: u16,
        url: String,
    },
}

impl Error {
    pub(crate) fn transport(e: wreq::Error) -> Self {
        Error::Transport(TransportError::new(e))
    }

    pub fn saw_challenge(&self) -> bool {
        matches!(self, Error::Exhausted { tried, .. }
            if tried.iter().any(|(_, v)| *v == Verdict::Challenged))
    }

    pub fn cleared_but_rechallenged(&self) -> bool {
        matches!(self, Error::Exhausted { cleared: true, .. }) && self.saw_challenge()
    }

    pub fn all_blocked(&self) -> bool {
        matches!(self, Error::Exhausted { tried, .. }
            if !tried.is_empty() && tried.iter().all(|(_, v)| *v == Verdict::Blocked))
    }

    pub fn all_unreachable(&self) -> bool {
        matches!(self, Error::Exhausted { tried, .. }
            if !tried.is_empty() && tried.iter().all(|(_, v)| *v == Verdict::Unreachable))
    }

    pub fn response(&self) -> Option<&Response> {
        match self {
            Error::Exhausted { last_response, .. } => last_response.as_deref(),
            _ => None,
        }
    }

    pub fn transport_error(&self) -> Option<&TransportError> {
        match self {
            Error::Transport(e) => Some(e),
            Error::Exhausted { last_transport, .. } => last_transport.as_ref(),
            _ => None,
        }
    }

    pub fn is_timeout(&self) -> bool {
        self.transport_error().is_some_and(|e| e.is_timeout())
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Status { status, .. } => Some(*status),
            _ => None,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Transport(e) => write!(f, "transport error: {e}"),
            Error::Exhausted { host, tried, .. } => {
                let detail: Vec<String> =
                    tried.iter().map(|(i, v)| format!("{}={}", i.name, v)).collect();
                write!(f, "no identity worked for {host}; tried: {}", detail.join(", "))?;
                if self.cleared_but_rechallenged() {
                    write!(f, " (a clearance cookie was issued but the page still challenged)")?;
                }
                if let Some(r) = self.response() {
                    write!(f, " (last status {})", r.status)?;
                }
                if let Some(t) = self.transport_error() {
                    write!(f, " (last transport failure: {t})")?;
                }
                Ok(())
            }
            Error::TooLarge { limit } => {
                write!(f, "response body exceeded the {limit} byte limit")
            }
            Error::InvalidUrl(u) => write!(f, "invalid url: {u}"),
            Error::InvalidRequest(m) => write!(f, "invalid request: {m}"),
            Error::Json(e) => write!(f, "json error: {e}"),
            Error::Status { status, url } => write!(f, "http status {status} for {url}"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Transport(e) => Some(e),
            Error::Json(e) => Some(e),
            Error::Exhausted { last_transport, .. } => {
                last_transport.as_ref().map(|e| e as &(dyn std::error::Error + 'static))
            }
            _ => None,
        }
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e)
    }
}
