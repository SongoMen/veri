//!
//! # Status
//!
//! This crate **detects, classifies and clears**.
//!
//! Vercel is a trademark of Vercel, Inc. This crate is not affiliated with,
//! endorsed by, or sponsored by Vercel; the name identifies the system it
//! interoperates with.
//!
//! # What it is detected by
//!
//! `x-vercel-mitigated: challenge`, which the provider sets itself. That makes
//! this the least ambiguous detection in the workspace. Clearance arrives as a
//! `_vcrcs` cookie, so nothing here needs to know what the page did to earn it.

use std::sync::Arc;
use veri_core::{
    ClearError, CookieJarView, Demand, HttpBridge, Outcome, Protection, ResponseParts, Solver,
};

pub const CLEARANCE_COOKIE: &str = "_vcrcs";

const MITIGATED: &str = "x-vercel-mitigated";
const CHALLENGE_TOKEN: &str = "x-vercel-challenge-token";
const REQUEST_ID: &str = "x-vercel-id";

/// What the response says about its own mitigation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub mitigated: String,
    pub token: String,
}

impl Config {
    pub fn demand(&self) -> Demand {
        match self.mitigated.as_str() {
            "challenge" => Demand::Script,
            _ => Demand::Block,
        }
    }
}

pub struct Vercel {
    solver: Option<Arc<dyn Solver>>,
}

impl Vercel {
    pub fn detect_only() -> Self {
        Self { solver: None }
    }

    pub fn with_solver(solver: Arc<dyn Solver>) -> Self {
        Self { solver: Some(solver) }
    }

    pub fn is_present(parts: &ResponseParts<'_>) -> bool {
        parts.headers.contains(REQUEST_ID)
            || parts.headers.contains(MITIGATED)
            || parts.headers.get("server").is_some_and(|s| s.eq_ignore_ascii_case("vercel"))
    }

    pub fn demand(parts: &ResponseParts<'_>) -> Option<Demand> {
        Self::config(parts).map(|c| c.demand())
    }

    pub fn config(parts: &ResponseParts<'_>) -> Option<Config> {
        let mitigated = parts.headers.get(MITIGATED)?;
        Some(Config {
            mitigated: mitigated.trim().to_ascii_lowercase(),
            token: parts.headers.get(CHALLENGE_TOKEN).unwrap_or_default().to_string(),
        })
    }
}

impl Protection for Vercel {
    fn name(&self) -> &'static str {
        "vercel"
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
        let Some(cfg) = Self::config(parts) else {
            return Err(ClearError::NotAChallenge);
        };
        if cfg.demand() == Demand::Block {
            return Err(ClearError::Rejected(format!(
                "vercel answered with mitigation \"{}\", which is a refusal rather than \
                 a challenge: a different egress is the only thing that helps",
                cfg.mitigated,
            )));
        }
        let Some(solver) = self.solver.as_ref() else {
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
                "checkpoint script errored: {}",
                report.errors.join("; ")
            )));
        }
        Err(ClearError::Rejected("the checkpoint ran but issued no clearance".into()))
    }
}
