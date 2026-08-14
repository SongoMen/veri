//!
//! # Status
//!
//! Detects, classifies and clears the interstitial challenge.
//!
//! Cloudflare is a trademark of Cloudflare, Inc. This crate is not affiliated
//! with, endorsed by, or sponsored by Cloudflare; the name identifies the
//! system it interoperates with.
//!
//! # What it is detected by
//!
//! A `cf-mitigated: challenge` header is definitive. Otherwise the page is a
//! few kilobytes declaring a `_cf_chl_opt` configuration object, which is the
//! marker.

use std::sync::Arc;
use veri_core::{
    ClearError, CookieJarView, Demand, HttpBridge, Outcome, Protection, ResponseParts, Solver,
};

pub const CONFIG_OBJECT: &str = "_cf_chl_opt";

pub const CLEARANCE_COOKIE: &str = "cf_clearance";

const INTERSTITIAL_TITLE: &str = "Just a moment";

pub struct Cloudflare {
    solver: Option<Arc<dyn Solver>>,
}

impl Cloudflare {
    pub fn detect_only() -> Self {
        Self { solver: None }
    }

    pub fn with_solver(solver: Arc<dyn Solver>) -> Self {
        Self { solver: Some(solver) }
    }

    pub fn is_present(parts: &ResponseParts<'_>) -> bool {
        parts.headers.contains("cf-ray")
            || parts.headers.get("server").is_some_and(|s| s.eq_ignore_ascii_case("cloudflare"))
            || parts.headers.contains("cf-mitigated")
    }

    pub fn demand(parts: &ResponseParts<'_>) -> Option<Demand> {
        if parts.headers.get("cf-mitigated") == Some("challenge") {
            return Some(Demand::Script);
        }
        if !Self::is_present(parts) {
            return None;
        }
        let challenged = parts.body.contains(CONFIG_OBJECT)
            || (!(200..300).contains(&parts.status) && parts.body.contains(INTERSTITIAL_TITLE));
        challenged.then_some(Demand::Script)
    }
}

impl Protection for Cloudflare {
    fn name(&self) -> &'static str {
        "cloudflare"
    }

    fn inspect(&self, parts: &ResponseParts<'_>) -> Outcome {
        Outcome::of(Self::demand(parts), Self::is_present(parts), parts)
    }

    fn holds_clearance(&self, cookies: &dyn CookieJarView) -> bool {
        cookies.has_cookie(CLEARANCE_COOKIE)
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

        if cookies.has_cookie(CLEARANCE_COOKIE) {
            return Ok(());
        }
        if !report.errors.is_empty() {
            return Err(ClearError::Failed(format!(
                "challenge script errored: {}",
                report.errors.join("; ")
            )));
        }
        Err(ClearError::Rejected("the challenge ran but no clearance was issued".into()))
    }
}
