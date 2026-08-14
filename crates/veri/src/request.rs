use crate::Error;
use std::borrow::Cow;
use std::time::Duration;
use veri_core::{Headers, Identity, Verdict};

/// A request, held in a replayable form.
#[derive(Debug, Clone)]
pub struct RequestSpec {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout: Option<Duration>,
}

impl RequestSpec {
    pub fn new(method: &str, url: &str) -> Self {
        Self {
            method: method.to_string(),
            url: url.to_string(),
            headers: Vec::new(),
            body: None,
            timeout: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub headers: Headers,
    /// Where the response came from, after any redirects.
    pub url: String,
    pub body: Vec<u8>,

    pub identity: Identity,
    pub verdict: Verdict,
    /// Ladder rungs tried (1 = first choice worked).
    pub attempts: usize,
    pub cleared: Option<&'static str>,
    pub used_clearance: bool,
}

impl Response {
    /// Body as text, replacing invalid UTF-8 rather than failing.
    pub fn text(&self) -> Cow<'_, str> {
        String::from_utf8_lossy(&self.body)
    }

    pub fn bytes(&self) -> &[u8] {
        &self.body
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.body
    }

    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_slice(&self.body)
    }

    /// Whether the HTTP status is 2xx.
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// Whether this is a real response rather than a challenge or a block.
    pub fn is_ok(&self) -> bool {
        self.verdict.is_ok()
    }

    /// The HTTP status alone: a challenge page arrives with a 200 and survives
    /// this, so use [`Response::is_ok`] for that question.
    pub fn error_for_status(self) -> Result<Self, Error> {
        if self.is_success() {
            Ok(self)
        } else {
            Err(Error::Status { status: self.status, url: self.url })
        }
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name)
    }

    /// Every value for a repeated header, in order. Use this for `set-cookie`.
    pub fn header_all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.headers.get_all(name)
    }

    pub fn content_type(&self) -> Option<&str> {
        self.headers.get("content-type")
    }

    /// Length of the body actually received.
    pub fn content_length(&self) -> usize {
        self.body.len()
    }
}
