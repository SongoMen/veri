//! Shared vocabulary for the `veri` crates.
//!
//! A [`Protection`] answers for one provider: whether a response is its own
//! ([`Outcome`]), what it is being asked for ([`Demand`]), and how to answer.
//! A [`Solver`] runs a challenge page and reports what it did, knowing no
//! provider at all.
//!
//! [`Outcome`] is one protection's opinion, [`Verdict`] is the client's
//! conclusion, which is why [`Outcome::NotMine`] has no verdict: it means ask
//! the next protection. Only [`Demand::Script`] is a challenge. A captcha is a
//! refusal however scripted its page looks, because a challenged verdict
//! promises the caller that a solver is the thing that would help.

pub mod html;
pub mod http;
pub mod provider;
pub mod url;

use std::fmt;
use std::sync::Arc;

#[derive(Debug, Default, Clone)]
pub struct Headers(Vec<(String, String)>);

impl Headers {
    pub fn new(pairs: Vec<(String, String)>) -> Self {
        Self(pairs)
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    pub fn get_all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.0.iter().filter(move |(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    pub fn contains(&self, name: &str) -> bool {
        self.get(name).is_some()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.0.iter().map(|(k, v)| (k.as_str(), v.as_str()))
    }
}

#[derive(Debug, Clone)]
pub struct ResponseParts<'a> {
    pub status: u16,
    pub headers: &'a Headers,
    pub body: &'a str,
    pub url: &'a str,
}

impl ResponseParts<'_> {
    pub fn is_page(&self) -> bool {
        match self.headers.get("content-type") {
            Some(ct) => ct.to_ascii_lowercase().contains("text/html"),
            None => self.body.trim_start().starts_with('<'),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// This protection is not involved, ask the next one.
    NotMine,
    /// This protection is involved and let the request through.
    Passed,
    /// A challenge this protection can attempt to clear.
    Challenge,
    /// Refused, with no path forward. A different identity or egress may help,
    /// but nothing this client can do to the payload will.
    Blocked,
    /// Throttled.
    RateLimited,
}

impl Outcome {
    pub fn of(demand: Option<Demand>, present: bool, parts: &ResponseParts<'_>) -> Outcome {
        match demand {
            Some(Demand::Script) => Outcome::Challenge,
            Some(Demand::Captcha | Demand::Block) => Outcome::Blocked,
            None if present => Outcome::from_unmarked(parts),
            None => Outcome::NotMine,
        }
    }

    pub fn from_unmarked(parts: &ResponseParts<'_>) -> Outcome {
        match parts.status {
            200..=299 => Outcome::Passed,
            429 => Outcome::RateLimited,
            403 if parts.is_page() => Outcome::Blocked,
            _ => Outcome::NotMine,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Demand {
    /// Answerable by executing the page's script.
    Script,
    /// Drawn for a human. Nothing to script.
    Captcha,
    /// Already decided. Nothing to answer.
    Block,
}

pub trait CookieJarView: Send + Sync {
    fn has_cookie(&self, name: &str) -> bool;

    fn set_cookie(&self, _cookie: &str) {}

    fn cookie(&self, name: &str) -> Option<String>;
}

pub trait Protection: Send + Sync {
    fn name(&self) -> &'static str;

    fn inspect(&self, parts: &ResponseParts<'_>) -> Outcome;

    fn holds_clearance(&self, cookies: &dyn CookieJarView) -> bool;

    fn clear(
        &self,
        parts: &ResponseParts<'_>,
        user_agent: &str,
        http: Arc<dyn HttpBridge>,
        cookies: &dyn CookieJarView,
    ) -> Result<(), ClearError>;
}

#[derive(Debug)]
pub enum ClearError {
    /// The response was not a challenge this protection handles.
    NotAChallenge,
    /// The challenge ran but the provider did not accept it.
    Rejected(String),
    /// The attempt could not be completed.
    Failed(String),
}

impl fmt::Display for ClearError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClearError::NotAChallenge => write!(f, "not a challenge"),
            ClearError::Rejected(m) => write!(f, "challenge rejected: {m}"),
            ClearError::Failed(m) => write!(f, "could not clear: {m}"),
        }
    }
}

impl std::error::Error for ClearError {}

impl From<SolveError> for ClearError {
    fn from(e: SolveError) -> Self {
        match e {
            SolveError::NotAChallenge => ClearError::NotAChallenge,
            SolveError::TimedOut(d) => {
                ClearError::Failed(format!("challenge did not finish within {d:?}"))
            }
            SolveError::Failed(m) => ClearError::Failed(m),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Ok,
    /// A protection served a challenge.
    Challenged,
    /// A protection refused outright.
    Blocked,
    RateLimited,
    /// No response at all, reset, TLS failure, timeout. A server that dislikes
    /// a TLS fingerprint closes rather than answers, so this is identity-dependent.
    Unreachable,
    /// An ordinary HTTP status nobody claimed.
    Other(u16),
}

impl Verdict {
    pub fn is_ok(self) -> bool {
        matches!(self, Verdict::Ok)
    }

    pub fn identity_might_help(self) -> bool {
        matches!(self, Verdict::Blocked | Verdict::Challenged | Verdict::Unreachable)
    }

    /// Verdict for a response no protection claimed.
    pub fn from_status(status: u16) -> Self {
        match status {
            200..=299 => Verdict::Ok,
            429 => Verdict::RateLimited,
            s => Verdict::Other(s),
        }
    }

    pub fn from_outcome(o: Outcome) -> Option<Verdict> {
        match o {
            Outcome::Passed => Some(Verdict::Ok),
            Outcome::Challenge => Some(Verdict::Challenged),
            Outcome::Blocked => Some(Verdict::Blocked),
            Outcome::RateLimited => Some(Verdict::RateLimited),
            Outcome::NotMine => None,
        }
    }
}

impl fmt::Display for Verdict {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Verdict::Ok => write!(f, "ok"),
            Verdict::Challenged => write!(f, "challenged"),
            Verdict::Blocked => write!(f, "blocked"),
            Verdict::RateLimited => write!(f, "rate-limited"),
            Verdict::Unreachable => write!(f, "unreachable"),
            Verdict::Other(s) => write!(f, "http-{s}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identity {
    pub name: &'static str,
    pub user_agent: &'static str,
}

impl Identity {
    pub const fn new(name: &'static str, user_agent: &'static str) -> Self {
        Self { name, user_agent }
    }
}

impl fmt::Display for Identity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name)
    }
}

/// Synchronous HTTP performed on a protection's behalf.
pub trait HttpBridge: Send + Sync {
    fn request(&self, method: &str, url: &str, body: &str) -> (u16, String);

    fn request_bytes(&self, method: &str, url: &str, body: &str) -> (u16, Vec<u8>) {
        let (status, text) = self.request(method, url, body);
        (status, text.into_bytes())
    }

    fn request_with_headers(
        &self,
        method: &str,
        url: &str,
        body: &str,
        _headers: &[(String, String)],
    ) -> (u16, String) {
        self.request(method, url, body)
    }

    fn holds_cookie(&self, _name: &str) -> bool {
        false
    }
}

pub trait Solver: Send + Sync {
    fn solve(
        &self,
        page_html: &str,
        page_url: &str,
        user_agent: &str,
        http: Arc<dyn HttpBridge>,
    ) -> Result<SolveReport, SolveError>;
}

#[derive(Debug, Clone)]
pub struct BridgeCall {
    pub method: String,
    pub url: String,
    /// 0 when the request never completed.
    pub status: u16,
    pub request_bytes: usize,
    pub response_bytes: usize,
}

impl fmt::Display for BridgeCall {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} {} -> {} ({}b sent, {}b recv)",
            self.method, self.url, self.status, self.request_bytes, self.response_bytes
        )
    }
}

#[derive(Debug, Default, Clone)]
pub struct SolveReport {
    /// Bridge traffic only, in order. Everything else a run can tell you is in
    /// [`SolveReport::diagnostics`].
    pub requests: Vec<BridgeCall>,
    /// Cookies the page assigned to `document.cookie`, raw and in order. A
    /// provider that hands its token to script rather than to `Set-Cookie` leaves
    /// it here, and a browser would have taken it into the jar.
    pub cookies_set: Vec<String>,
    /// JavaScript errors that escaped. Non-empty means a broken run.
    pub errors: Vec<String>,
    /// Rough measure of work done; useful for spotting a script that bailed
    /// early. Always 0 without diagnostics.
    pub operations: usize,
    /// Present only when the solver was built with diagnostics enabled.
    pub diagnostics: Option<Diagnostics>,
}

/// Roughly 6x the memory of a plain solve, so a production solve neither
/// collects nor reports it.
#[derive(Debug, Default, Clone)]
pub struct Diagnostics {
    /// Text the run rendered into the DOM.
    pub rendered: Vec<String>,
    /// DOM attribute writes, in order.
    pub attribute_log: Vec<String>,
    /// How much of the harvested profile was actually materialised.
    pub profile_stats: Option<String>,
    /// Scripts the page asked to load.
    pub scripts_loaded: Vec<String>,
    /// Exceptions the challenge caught and swallowed internally.
    pub caught: Vec<String>,
    /// Platform calls that returned undefined or null, most-called first.
    pub undef_calls: Vec<(String, usize)>,
    /// The first few compiled bodies, for comparing against a browser's.
    pub fn_bodies: Vec<String>,
    /// One stable id per executed `new Function` body, in order. The same
    /// instruction hashes the same in any engine, so this diffs against a
    /// browser's trace and the first differing index is where they parted.
    pub fn_trace: Vec<u32>,
    /// Sources of `new Function` bodies that threw, with the message.
    pub fn_threw: Vec<String>,
    /// Bare globals that failed ordinary lookup, most-read first. Unlike
    /// [`Diagnostics::missing_surface`], not paths beneath a defined object.
    pub global_misses: Vec<(String, usize)>,
    /// Property accesses by operation kind, `get`, `set`, `call`, `new`.
    pub operations_by_kind: Vec<(String, usize)>,
    /// Paths read that the environment does not define, most-read first. The
    /// worklist for widening `env/`.
    pub missing_surface: Vec<(String, usize)>,
    /// Paths the environment satisfied, most-read first.
    pub satisfied_surface: Vec<(String, usize)>,
    /// Functions and constructors the challenge invoked, most-called first.
    pub invocations: Vec<(String, usize)>,
    /// Payload layers the challenge decoded at runtime.
    pub decoded_fragments: usize,
}

#[derive(Debug)]
pub enum SolveError {
    NotAChallenge,
    /// The challenge did not finish within the solver's deadline.
    TimedOut(std::time::Duration),
    Failed(String),
}

impl fmt::Display for SolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SolveError::NotAChallenge => write!(f, "not a challenge page"),
            SolveError::TimedOut(d) => write!(f, "solve timed out after {d:?}"),
            SolveError::Failed(m) => write!(f, "solve failed: {m}"),
        }
    }
}

impl std::error::Error for SolveError {}
