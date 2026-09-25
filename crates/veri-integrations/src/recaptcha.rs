//! reCAPTCHA v3, as used for an automatic rate limited page.
//!
//! # Status
//!
//! Detects, classifies and clears.
//!
//! reCAPTCHA is a trademark of Google LLC. This crate is not affiliated with,
//! endorsed by, or sponsored by Google; the name identifies the system it
//! interoperates with.
//!
//! # What it is detected by
//!
//! A page that loads `recaptcha/api.js?render=<key>` *and* calls
//! `grecaptcha.execute` on its own, on a response that is not a success.

use std::sync::Arc;
use veri_core::{
    ClearError, CookieJarView, Demand, HttpBridge, Outcome, Protection, ResponseParts, Solver,
};

/// The v3 loader carries the site key in its query string.
const RENDER_MARKER: &str = "recaptcha/api.js?render=";
const EXECUTE_MARKER: &str = "grecaptcha.execute";

pub struct Recaptcha {
    solver: Option<Arc<dyn Solver>>,
}

impl Recaptcha {
    pub fn detect_only() -> Self {
        Self { solver: None }
    }

    pub fn with_solver(solver: Arc<dyn Solver>) -> Self {
        Self { solver: Some(solver) }
    }

    pub fn is_present(parts: &ResponseParts<'_>) -> bool {
        parts.body.contains(RENDER_MARKER) && parts.body.contains(EXECUTE_MARKER)
    }

    pub fn demand(parts: &ResponseParts<'_>) -> Option<Demand> {
        if (200..300).contains(&parts.status) {
            return None;
        }
        Self::is_present(parts).then_some(Demand::Script)
    }

    /// The site key the page asks for, for diagnosis.
    pub fn site_key(body: &str) -> Option<&str> {
        let at = body.find(RENDER_MARKER)? + RENDER_MARKER.len();
        let rest = &body[at..];
        let end = rest.find(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')?;
        (end > 0).then(|| &rest[..end])
    }
}

impl Protection for Recaptcha {
    fn name(&self) -> &'static str {
        "recaptcha"
    }

    fn inspect(&self, parts: &ResponseParts<'_>) -> Outcome {
        Outcome::of(Self::demand(parts), Self::is_present(parts), parts)
    }

    fn holds_clearance(&self, _cookies: &dyn CookieJarView) -> bool {
        false
    }

    fn clear(
        &self,
        parts: &ResponseParts<'_>,
        user_agent: &str,
        http: Arc<dyn HttpBridge>,
        cookies: &dyn CookieJarView,
    ) -> Result<(), ClearError> {
        if Self::demand(parts) != Some(Demand::Script) {
            return Err(ClearError::NotAChallenge);
        }
        let Some(solver) = &self.solver else {
            return Err(ClearError::Failed("no solver registered; this crate detects only".into()));
        };

        let report = solver.solve(parts.body, parts.url, user_agent, http)?;
        for cookie in &report.cookies_set {
            cookies.set_cookie(cookie);
        }
        if !report.errors.is_empty() {
            return Err(ClearError::Failed(format!(
                "challenge script errored: {}",
                report.errors.join("; ")
            )));
        }

        let host = veri_core::url::host_of(parts.url).unwrap_or_default();
        let reported = !host.is_empty()
            && report.requests.iter().any(|c| {
                veri_core::url::host_of(&c.url).is_some_and(|h| h == host) && c.status > 0
            });
        if reported {
            return Ok(());
        }
        Err(ClearError::Rejected(
            "the check ran but the page submitted nothing back to its own origin".into(),
        ))
    }
}
