//! An HTTP client that sees what a browser sees.
//!
//! A ladder of browser identities tried in the order a host has actually
//! accepted, retries underneath, a warm session and cookie jar per host, and,
//! with a protection registered, the page's own JavaScript run on the same
//! connection.
//!
//! ```no_run
//! # async fn run() -> Result<(), veri::Error> {
//! let client = veri::Client::new()?;
//!
//! let res = client.get("https://example.com/api/data").send().await?;
//! println!("{}", res.text());
//! # Ok(()) }
//! ```
//!
//! Protections are additive: with none registered this is still TLS
//! fingerprinting, an identity ladder and session reuse.
//!
//! ```no_run
//! # use std::sync::Arc;
//! # use std::time::Duration;
//! # async fn run() -> Result<(), veri::Error> {
//! # #[derive(serde::Deserialize)] struct Quote { price: f64 }
//! let client = veri::Client::builder()
//!     .proxy("http://user:pass@host:port")
//!     .timeout(Duration::from_secs(20))
//!     .retry(veri::RetryPolicy::times(3))
//!     .protection(Arc::new(veri_integrations::Cloudflare::detect_only()))
//!     .build()?;
//!
//! let quote: Quote = client
//!     .post("https://example.com/api/quote")
//!     .header("x-api-key", "…")
//!     .json(&serde_json::json!({ "symbol": "AAPL" }))
//!     .send()
//!     .await?
//!     .json()?;
//! # Ok(()) }
//! ```

mod config;
pub mod error;
pub mod identity;
pub mod request;
pub mod retry;

/// Per-host memory of which identity works. Public so its behaviour is testable
/// and inspectable; it names no `wreq` type.
pub mod policy;
// Internal: would otherwise re-export `wreq` types through the public API.
pub(crate) mod session;

pub use error::{Error, TransportError};
pub use request::{RequestSpec, Response};
pub use retry::RetryPolicy;
pub use veri_core::http;
pub use veri_core::url::{host_of, origin_of};
pub use veri_core::{
    BridgeCall, ClearError, CookieJarView, Diagnostics, Headers, HttpBridge, Identity, Outcome,
    Protection, ResponseParts, SolveError, SolveReport, Solver, Verdict,
};

use config::Config;
use policy::Policy;
use session::{Session, SessionBridge, SessionStore};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ProbeReport {
    pub identity: Identity,
    pub status: u16,
    pub verdict: Verdict,
    pub elapsed: std::time::Duration,
    pub bytes: usize,
    pub protection: Option<&'static str>,
    /// Providers named by the response headers.
    pub hints: Vec<String>,
    pub cleared: bool,
    pub error: Option<String>,
}

impl ProbeReport {
    fn unreachable(identity: Identity, elapsed: Duration, error: String) -> Self {
        Self {
            identity,
            status: 0,
            verdict: Verdict::Unreachable,
            elapsed,
            bytes: 0,
            protection: None,
            hints: Vec::new(),
            cleared: false,
            error: Some(error),
        }
    }
}

pub struct ClientBuilder {
    config: Config,
    ladder: Vec<Identity>,
    protections: Vec<Arc<dyn Protection>>,
    errors: Vec<String>,
}

impl Default for ClientBuilder {
    fn default() -> Self {
        Self {
            config: Config::default(),
            ladder: identity::DEFAULT_LADDER.iter().filter_map(|n| identity::by_name(n)).collect(),
            protections: Vec::new(),
            errors: Vec::new(),
        }
    }
}

impl ClientBuilder {
    /// Use a **sticky** proxy if you rely on clearing: clearance is bound to
    /// the IP that earned it.
    pub fn proxy(mut self, url: impl Into<String>) -> Self {
        self.config.proxy = Some(url.into());
        self
    }

    pub fn timeout(mut self, d: Duration) -> Self {
        self.config.timeout = Some(d);
        self
    }

    pub fn connect_timeout(mut self, d: Duration) -> Self {
        self.config.connect_timeout = Some(d);
        self
    }
    pub fn read_timeout(mut self, d: Duration) -> Self {
        self.config.read_timeout = Some(d);
        self
    }

    pub fn no_timeout(mut self) -> Self {
        self.config.timeout = None;
        self.config.connect_timeout = None;
        self.config.read_timeout = None;
        self
    }

    pub fn redirect_limit(mut self, n: usize) -> Self {
        self.config.redirect_limit = n;
        self
    }

    pub fn https_only(mut self, yes: bool) -> Self {
        self.config.https_only = yes;
        self
    }

    pub fn max_response_bytes(mut self, n: usize) -> Self {
        self.config.max_response_bytes = Some(n);
        self
    }

    pub fn unlimited_response_bytes(mut self) -> Self {
        self.config.max_response_bytes = None;
        self
    }

    pub fn retry(mut self, policy: RetryPolicy) -> Self {
        self.config.retry = policy;
        self
    }

    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.config.default_headers.push((name.into(), value.into()));
        self
    }

    pub fn headers<I, K, V>(mut self, pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        for (k, v) in pairs {
            self.config.default_headers.push((k.into(), v.into()));
        }
        self
    }

    pub fn ladder(mut self, names: &[&str]) -> Self {
        self.errors.extend(
            names.iter().filter(|n| identity::by_name(n).is_none()).map(|n| unknown_identity(n)),
        );
        self.ladder = names.iter().filter_map(|n| identity::by_name(n)).collect();
        self
    }

    pub fn identity(mut self, name: &str) -> Self {
        if identity::by_name(name).is_none() {
            self.errors.push(unknown_identity(name));
        }
        self.ladder = identity::by_name(name).into_iter().collect();
        self
    }

    pub fn available_identities() -> Vec<&'static str> {
        identity::KNOWN.iter().map(|i| i.name).collect()
    }

    pub fn protection(mut self, p: Arc<dyn Protection>) -> Self {
        self.protections.push(p);
        self
    }

    pub fn build(self) -> Result<Client, Error> {
        if !self.errors.is_empty() {
            return Err(Error::InvalidRequest(self.errors.join("; ")));
        }
        if self.ladder.is_empty() {
            return Err(Error::InvalidRequest("identity ladder is empty".into()));
        }
        Ok(Client {
            inner: Arc::new(Inner {
                sessions: SessionStore::new(self.config.clone()),
                policy: Policy::new(),
                ladder: self.ladder,
                protections: self.protections,
                config: self.config,
            }),
        })
    }
}

fn unknown_identity(name: &str) -> String {
    format!(
        "unknown identity {name:?}; known: {}",
        identity::KNOWN.iter().map(|i| i.name).collect::<Vec<_>>().join(", ")
    )
}

enum AfterClear {
    Passed(Response),
    Rechallenged(Fetched),
    NotCleared,
}

struct Inner {
    sessions: SessionStore,
    policy: Policy,
    ladder: Vec<Identity>,
    protections: Vec<Arc<dyn Protection>>,
    config: Config,
}

#[derive(Clone)]
pub struct Client {
    inner: Arc<Inner>,
}

impl Client {
    pub fn new() -> Result<Self, Error> {
        ClientBuilder::default().build()
    }

    pub fn builder() -> ClientBuilder {
        ClientBuilder::default()
    }

    pub fn get(&self, url: &str) -> RequestBuilder {
        self.request("GET", url)
    }
    pub fn post(&self, url: &str) -> RequestBuilder {
        self.request("POST", url)
    }
    pub fn put(&self, url: &str) -> RequestBuilder {
        self.request("PUT", url)
    }
    pub fn patch(&self, url: &str) -> RequestBuilder {
        self.request("PATCH", url)
    }
    pub fn delete(&self, url: &str) -> RequestBuilder {
        self.request("DELETE", url)
    }
    pub fn head(&self, url: &str) -> RequestBuilder {
        self.request("HEAD", url)
    }

    pub fn request(&self, method: &str, url: &str) -> RequestBuilder {
        RequestBuilder { client: self.clone(), spec: RequestSpec::new(method, url), error: None }
    }

    /// Classify a URL under every identity, without clearing anything.
    pub async fn probe(&self, url: &str) -> Result<Vec<ProbeReport>, Error> {
        self.probe_inner(url, false).await
    }

    /// Probe, then try to clear anything that was challenged.
    pub async fn probe_with_clearing(&self, url: &str) -> Result<Vec<ProbeReport>, Error> {
        self.probe_inner(url, true).await
    }

    async fn probe_inner(&self, url: &str, clear: bool) -> Result<Vec<ProbeReport>, Error> {
        let host = host_of(url).ok_or_else(|| Error::InvalidUrl(url.to_string()))?;
        let spec = RequestSpec::new("GET", url);
        let mut out = Vec::new();

        for id in &self.inner.ladder {
            let session = self.inner.sessions.get(&host, *id)?;
            let started = std::time::Instant::now();

            let fetched = match self.send_once(&session, &spec).await {
                Ok(f) => f,
                Err(Error::Transport(e)) => {
                    self.inner.policy.record_probe(&host, id, Verdict::Unreachable);
                    let egress = e.is_egress_fault();
                    out.push(ProbeReport::unreachable(*id, started.elapsed(), e.to_string()));
                    if egress {
                        break;
                    }
                    continue;
                }
                Err(other) => return Err(other),
            };
            self.inner.policy.record_probe(&host, id, fetched.verdict);

            let mut report = ProbeReport {
                identity: *id,
                status: fetched.status,
                verdict: fetched.verdict,
                elapsed: Duration::ZERO,
                bytes: fetched.body.len(),
                protection: fetched.claimed.as_ref().map(|p| p.name()),
                hints: veri_core::provider::hints(&fetched.headers),
                cleared: false,
                error: None,
            };

            if clear && fetched.verdict == Verdict::Challenged {
                if let Some(p) = &fetched.claimed {
                    if self.try_clear(&session, &fetched, p).is_ok() {
                        if let Ok(after) = self.send_once(&session, &spec).await {
                            report.status = after.status;
                            report.verdict = after.verdict;
                            report.bytes = after.body.len();
                            report.protection =
                                after.claimed.map(|c| c.name()).or_else(|| Some(p.name()));
                            report.hints = veri_core::provider::hints(&after.headers);
                            report.cleared = after.verdict.is_ok();
                        }
                    }
                }
            }
            report.elapsed = started.elapsed();
            out.push(report);
        }
        Ok(out)
    }

    pub fn preferred_identity(&self, host: &str) -> Option<&'static str> {
        self.inner.policy.preferred(host)
    }

    pub fn default_headers(&self) -> Vec<(&str, &str)> {
        self.inner.config.default_headers.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
    }

    pub fn max_response_bytes(&self) -> Option<usize> {
        self.inner.config.max_response_bytes
    }

    pub fn timeout(&self) -> Option<Duration> {
        self.inner.config.timeout
    }

    pub fn ladder(&self) -> Vec<&'static str> {
        self.inner.ladder.iter().map(|i| i.name).collect()
    }

    pub fn is_laddering(&self) -> bool {
        self.inner.ladder.len() > 1
    }

    pub fn has_clearance(&self, host: &str) -> bool {
        self.inner.sessions.any_clearance(host, |s| self.holds_clearance(s))
    }

    fn holds_clearance(&self, session: &Session) -> bool {
        self.inner.protections.iter().any(|p| p.holds_clearance(session))
    }

    pub fn set_cookie(&self, host: &str, cookie: &str) {
        self.inner.sessions.set_cookie(host, cookie);
    }

    pub fn cookie(&self, host: &str, name: &str) -> Option<String> {
        self.inner.sessions.cookie(host, name)
    }

    pub fn open_sessions(&self) -> usize {
        self.inner.sessions.len()
    }

    pub fn forget(&self, host: &str) -> usize {
        self.inner.sessions.forget(host)
    }

    #[tracing::instrument(
        level = "debug",
        skip_all,
        fields(method = %spec.method, url = %spec.url)
    )]
    async fn execute(&self, spec: RequestSpec) -> Result<Response, Error> {
        let host = host_of(&spec.url).ok_or_else(|| Error::InvalidUrl(spec.url.clone()))?;
        let order = self.inner.policy.order(&host, &self.inner.ladder);
        let mut tried = Vec::new();
        let mut last_transport = None;
        let mut last_response = None;
        let mut budget = self.inner.config.retry.max_retries;

        for (rung, id) in order.iter().enumerate() {
            let session = self.inner.sessions.get(&host, *id)?;
            let had_clearance = self.holds_clearance(&session);

            let fetched = match self.send_with_retry(&session, &spec, &mut budget).await {
                Ok(f) => f,
                Err(Error::Transport(e)) => {
                    // Fails identically for every identity.
                    if e.is_egress_fault() {
                        return Err(Error::Transport(e));
                    }
                    tracing::debug!(identity = id.name, error = %e, "rung unreachable");
                    self.inner.policy.record(&host, id, Verdict::Unreachable);
                    tried.push((*id, Verdict::Unreachable));
                    last_transport = Some(e);
                    continue;
                }
                Err(other) => return Err(other),
            };
            self.inner.policy.record(&host, id, fetched.verdict);
            tracing::debug!(
                identity = id.name,
                status = fetched.status,
                verdict = %fetched.verdict,
                "rung answered"
            );

            if fetched.verdict.is_ok() {
                return Ok(fetched.into_response(*id, rung + 1, None, had_clearance));
            }

            let mut answered = fetched;
            if answered.verdict == Verdict::Challenged {
                match self.clear_then_retry(&session, &answered, &spec, &mut budget, rung).await? {
                    AfterClear::Passed(res) => return Ok(res),
                    AfterClear::Rechallenged(after) => answered = after,
                    AfterClear::NotCleared => {}
                }
            }

            if !answered.verdict.identity_might_help() {
                return Ok(answered.into_response(*id, rung + 1, None, had_clearance));
            }

            tried.push((*id, answered.verdict));
            last_response =
                Some(Box::new(answered.into_response(*id, rung + 1, None, had_clearance)));
        }

        let cleared = self.inner.sessions.any_clearance(&host, |s| self.holds_clearance(s));
        Err(Error::Exhausted { host, tried, cleared, last_transport, last_response })
    }

    async fn clear_then_retry(
        &self,
        session: &Session,
        fetched: &Fetched,
        spec: &RequestSpec,
        budget: &mut u32,
        rung: usize,
    ) -> Result<AfterClear, Error> {
        let id = session.identity;
        let Some(p) = fetched.claimed.clone() else { return Ok(AfterClear::NotCleared) };
        if let Err(e) = self.try_clear(session, fetched, &p) {
            tracing::debug!(identity = id.name, error = %e, "clear failed");
            return Ok(AfterClear::NotCleared);
        }

        let after = match self.send_with_retry(session, spec, budget).await {
            Ok(f) => f,
            Err(Error::Transport(e)) if !e.is_egress_fault() => {
                tracing::debug!(identity = id.name, error = %e, "cleared, then the retry failed");
                return Ok(AfterClear::NotCleared);
            }
            Err(other) => return Err(other),
        };
        self.inner.policy.record(&session.host, &id, after.verdict);
        if !after.verdict.is_ok() {
            tracing::debug!(
                identity = id.name,
                verdict = %after.verdict,
                "cleared but the retry was not ok"
            );
            return Ok(AfterClear::Rechallenged(after));
        }
        tracing::info!(identity = id.name, protection = p.name(), "cleared");
        Ok(AfterClear::Passed(after.into_response(id, rung + 1, Some(p.name()), false)))
    }

    async fn send_with_retry(
        &self,
        session: &Session,
        spec: &RequestSpec,
        budget: &mut u32,
    ) -> Result<Fetched, Error> {
        let policy = &self.inner.config.retry;
        let may_repeat = policy.may_repeat(&spec.method);
        let mut attempt = 0u32;
        loop {
            let wait = match self.send_once(session, spec).await {
                Ok(f) => {
                    if *budget == 0 || !may_repeat || !RetryPolicy::retryable(f.verdict) {
                        return Ok(f);
                    }
                    match policy.backoff(attempt, Some(&f.headers)) {
                        // Asked to wait longer than we will block a caller for.
                        None => return Ok(f),
                        Some(w) => w,
                    }
                }
                Err(Error::Transport(e)) => {
                    if *budget == 0 || !may_repeat || e.is_egress_fault() {
                        return Err(Error::Transport(e));
                    }
                    match policy.backoff(attempt, None) {
                        None => return Err(Error::Transport(e)),
                        Some(w) => w,
                    }
                }
                Err(other) => return Err(other),
            };
            *budget -= 1;
            attempt += 1;
            tracing::debug!(identity = session.identity.name, ?wait, attempt, "retrying");
            tokio::time::sleep(wait).await;
        }
    }

    fn try_clear(
        &self,
        session: &Session,
        fetched: &Fetched,
        protection: &Arc<dyn Protection>,
    ) -> Result<(), ClearError> {
        let text = String::from_utf8_lossy(&fetched.body);
        let parts = ResponseParts {
            status: fetched.status,
            headers: &fetched.headers,
            body: &text,
            url: &fetched.url,
        };

        let bridge = Arc::new(SessionBridge::new(session.clone(), &fetched.url));
        let outcome = protection.clear(
            &parts,
            session.identity.user_agent,
            bridge.clone() as Arc<dyn HttpBridge>,
            session,
        );
        tracing::debug!(
            protection = protection.name(),
            bridge_calls = bridge.calls().len(),
            ok = outcome.is_ok(),
            "clear attempted"
        );
        outcome
    }

    fn caller_cookie<'a>(&'a self, spec: &'a RequestSpec) -> Option<&'a str> {
        let cookie = |headers: &'a [(String, String)]| {
            headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("cookie")).map(|(_, v)| v.as_str())
        };
        cookie(&spec.headers).or_else(|| cookie(&self.inner.config.default_headers))
    }

    async fn send_once(&self, session: &Session, spec: &RequestSpec) -> Result<Fetched, Error> {
        let mut req = match spec.method.as_str() {
            "GET" => session.client.get(&spec.url),
            "POST" => session.client.post(&spec.url),
            "PUT" => session.client.put(&spec.url),
            "PATCH" => session.client.patch(&spec.url),
            "DELETE" => session.client.delete(&spec.url),
            "HEAD" => session.client.head(&spec.url),
            m => return Err(Error::InvalidRequest(format!("unsupported method: {m}"))),
        };
        for (k, v) in &self.inner.config.default_headers {
            if k.eq_ignore_ascii_case("cookie") {
                continue;
            }
            if !spec.headers.iter().any(|(sk, _)| sk.eq_ignore_ascii_case(k)) {
                req = req.header(k.as_str(), v.as_str());
            }
        }
        for (k, v) in &spec.headers {
            if k.eq_ignore_ascii_case("cookie") {
                continue;
            }
            req = req.header(k.as_str(), v.as_str());
        }

        if let Some(caller) = self.caller_cookie(spec) {
            req = req.header("cookie", merge_cookies(&session.cookie_header(), caller));
        }
        if let Some(b) = &spec.body {
            req = req.body(b.clone());
        }
        if let Some(t) = spec.timeout {
            req = req.timeout(t);
        }

        let r = req.send().await.map_err(Error::transport)?;
        let status = r.status().as_u16();
        let url = r.uri().to_string();
        let headers = Headers::new(
            r.headers()
                .iter()
                .filter_map(|(k, v)| {
                    v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string()))
                })
                .collect(),
        );
        let body = read_capped(r, self.inner.config.max_response_bytes).await?;

        // Scoped so the lossy view of `body` is dropped before `body` moves.
        let (verdict, claimed) = {
            let text = String::from_utf8_lossy(&body);
            let parts = ResponseParts { status, headers: &headers, body: &text, url: &url };
            match self
                .inner
                .protections
                .iter()
                .find_map(|p| Verdict::from_outcome(p.inspect(&parts)).map(|v| (v, p.clone())))
            {
                Some((v, p)) => (v, Some(p)),
                None => (Verdict::from_status(status), None),
            }
        };
        Ok(Fetched { status, headers, body, verdict, claimed, url })
    }
}

async fn read_capped(r: wreq::Response, limit: Option<usize>) -> Result<Vec<u8>, Error> {
    use futures_util::StreamExt;

    let Some(limit) = limit else {
        return r.bytes().await.map(|b| b.to_vec()).map_err(Error::transport);
    };
    if r.content_length().is_some_and(|n| n > limit as u64) {
        return Err(Error::TooLarge { limit });
    }
    let mut out = Vec::new();
    let mut stream = std::pin::pin!(r.bytes_stream());
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(Error::transport)?;
        if out.len() + chunk.len() > limit {
            return Err(Error::TooLarge { limit });
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn encode_pairs<I, K, V>(pairs: I) -> String
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<str>,
    V: AsRef<str>,
{
    let mut out = String::new();
    for (k, v) in pairs {
        if !out.is_empty() {
            out.push('&');
        }
        out.push_str(&http::percent_encode(k.as_ref()));
        out.push('=');
        out.push_str(&http::percent_encode(v.as_ref()));
    }
    out
}

fn merge_cookies(jar: &str, caller: &str) -> String {
    let named: Vec<&str> =
        caller.split(';').filter_map(|c| c.split_once('=')).map(|(k, _)| k.trim()).collect();
    let kept: Vec<&str> = jar
        .split(';')
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .filter(|c| c.split_once('=').map(|(k, _)| !named.contains(&k.trim())).unwrap_or(true))
        .collect();
    if kept.is_empty() {
        return caller.trim().to_string();
    }
    format!("{}; {}", kept.join("; "), caller.trim())
}

struct Fetched {
    status: u16,
    headers: Headers,
    body: Vec<u8>,
    verdict: Verdict,
    claimed: Option<Arc<dyn Protection>>,
    url: String,
}

impl Fetched {
    fn into_response(
        self,
        identity: Identity,
        attempts: usize,
        cleared: Option<&'static str>,
        used_clearance: bool,
    ) -> Response {
        Response {
            status: self.status,
            headers: self.headers,
            url: self.url,
            body: self.body,
            identity,
            verdict: self.verdict,
            attempts,
            cleared,
            used_clearance,
        }
    }
}

pub struct RequestBuilder {
    client: Client,
    spec: RequestSpec,
    error: Option<Error>,
}

impl RequestBuilder {
    pub fn header(mut self, name: &str, value: impl Into<String>) -> Self {
        self.spec.headers.push((name.to_string(), value.into()));
        self
    }

    pub fn headers<I, K, V>(mut self, pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        for (k, v) in pairs {
            self.spec.headers.push((k.into(), v.into()));
        }
        self
    }

    pub fn timeout(mut self, d: Duration) -> Self {
        self.spec.timeout = Some(d);
        self
    }

    /// Append query parameters, percent-encoding keys and values.
    pub fn query<I, K, V>(mut self, pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        let qs = encode_pairs(pairs);
        if qs.is_empty() {
            return self;
        }
        // Appending after `#frag` makes the query part of the fragment, which
        // never reaches the server.
        let (base, frag) = match self.spec.url.split_once('#') {
            Some((b, f)) => (b.to_string(), Some(f.to_string())),
            None => (self.spec.url.clone(), None),
        };
        let sep = if base.contains('?') { '&' } else { '?' };
        self.spec.url = format!("{base}{sep}{qs}");
        if let Some(f) = frag {
            self.spec.url.push('#');
            self.spec.url.push_str(&f);
        }
        self
    }

    /// The request as built, without sending it.
    pub fn peek(&self) -> &RequestSpec {
        &self.spec
    }

    pub fn body(mut self, body: impl Into<Vec<u8>>) -> Self {
        self.spec.body = Some(body.into());
        self
    }

    /// Serialise `value` as a JSON body and set the content type.
    pub fn json<T: serde::Serialize>(mut self, value: &T) -> Self {
        match serde_json::to_vec(value) {
            Ok(b) => {
                self.spec.body = Some(b);
                self.set_content_type("application/json");
            }
            Err(e) => self.error = Some(Error::InvalidRequest(format!("json body: {e}"))),
        }
        self
    }

    pub fn form<I, K, V>(mut self, pairs: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        self.spec.body = Some(encode_pairs(pairs).into_bytes());
        self.set_content_type("application/x-www-form-urlencoded");
        self
    }

    fn set_content_type(&mut self, value: &str) {
        if self.spec.headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-type")) {
            return;
        }
        self.spec.headers.push(("content-type".into(), value.into()));
    }

    pub async fn send(self) -> Result<Response, Error> {
        if let Some(e) = self.error {
            return Err(e);
        }
        self.client.execute(self.spec).await
    }
}
