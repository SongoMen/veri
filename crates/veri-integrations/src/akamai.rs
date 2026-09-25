//! Akamai: the edge in front of a great many sites, and Bot Manager on some.
//!
//! # Status
//!
//! This crate **detects and classifies**.
//!
//! Akamai is a trademark of Akamai Technologies, Inc. This crate is not
//! affiliated with, endorsed by, or sponsored by Akamai; the name identifies the
//! system it interoperates with.
//!
//! # Two different refusals, and only one of them is a challenge
//!
//! **The edge deny** is a short `Access Denied` page with `server: AkamaiGHost`
//! and a reference number. There is no script on it and no cookie to earn: the
//! decision was made from the request itself, before any page existed. Nothing
//! can be executed to change it, so it is reported as a block. A different
//! identity is the thing that helps, and often does - kohls.com refuses eight of
//! nine identities this way and serves the ninth a normal page.
//!
//! **Bot Manager** is the challenge: an `_abck` cookie in a not-yet-valid state,
//! a sensor script under `/akam/<n>/<hex>`, and a POST of collected sensor data
//! that moves the cookie to a valid state. That one is answerable by running the
//! page, which is why it is classified as a script demand even though this crate
//! ships no solver for it yet. Classifying it correctly is what lets a caller
//! see the difference between "try another identity" and "this needs a solver".

use std::sync::Arc;
use veri_core::{
    ClearError, CookieJarView, Demand, HttpBridge, Outcome, Protection, ResponseParts, Solver,
};

/// Moves from a challenge state to a valid one once sensor data is accepted.
pub const CLEARANCE_COOKIE: &str = "_abck";

const GHOST: &str = "AkamaiGHost";
/// Set alongside `_abck` by Bot Manager, and a useful second opinion.
const SESSION_COOKIES: [&str; 3] = ["bm_sz", "ak_bmsc", "bm_sv"];
/// The sensor script lives under a versioned path; the identifier is stable
/// across Akamai deployments and is the cheapest positive marker in the body.
const SENSOR_PATH: &str = "/akam/";
const SENSOR_VAR: &str = "bazadebezolkohpepadr";
/// Present in `_abck` while the session is still being challenged.
const CHALLENGED_MARKER: &str = "~-1~";

pub struct Akamai {
    solver: Option<Arc<dyn Solver>>,
}

impl Akamai {
    pub fn detect_only() -> Self {
        Self { solver: None }
    }

    pub fn with_solver(solver: Arc<dyn Solver>) -> Self {
        Self { solver: Some(solver) }
    }

    pub fn is_present(parts: &ResponseParts<'_>) -> bool {
        parts.headers.get("server").is_some_and(|s| s.eq_ignore_ascii_case(GHOST))
            || parts.headers.contains("akamai-grn")
            || parts.headers.contains("x-akamai-transformed")
            || parts.headers.get_all("set-cookie").any(|c| {
                let c = c.trim_start();
                c.starts_with("AKA_")
                    || c.starts_with(CLEARANCE_COOKIE)
                    || SESSION_COOKIES.iter().any(|n| c.starts_with(n))
            })
    }

    /// Whether the response carries the Bot Manager challenge rather than the
    /// plain edge. Needs the sensor script: the cookie alone rides along on
    /// perfectly ordinary pages once a session exists.
    /// The sensor script's path is generated per site, so there is no fixed
    /// prefix to match: on kohls it is `/bmpaYg/jys/5AD/...`, not `/akam/`. What
    /// is stable is the shape - a same-origin script with a long opaque path -
    /// so that is what this looks for, keeping the documented markers as
    /// additional positives.
    pub fn sensor_src(body: &str) -> Option<&str> {
        for piece in body.split("src=\"").skip(1) {
            let Some(src) = piece.split('"').next() else { continue };
            if !src.starts_with('/') {
                continue;
            }
            // The documented prefixes are conclusive whatever their length.
            if src.contains(SENSOR_PATH) || src.contains(SENSOR_VAR) {
                return Some(src);
            }
            if src.len() < 20 {
                continue;
            }
            let path = src.split('?').next().unwrap_or(src);
            let looks_static = path.rsplit('/').next().is_some_and(|f| f.contains('.'));
            if !looks_static && path.matches('/').count() >= 3 {
                return Some(src);
            }
        }
        None
    }

    /// Both halves are needed: the cookie rides along on ordinary pages once a
    /// session exists, and a script on its own is just a page.
    pub fn is_bot_manager(parts: &ResponseParts<'_>) -> bool {
        let cookie = parts
            .headers
            .get_all("set-cookie")
            .any(|c| c.trim_start().starts_with(CLEARANCE_COOKIE))
            || parts.body.contains(CLEARANCE_COOKIE);
        cookie && Self::sensor_src(parts.body).is_some()
    }

    pub fn demand(parts: &ResponseParts<'_>) -> Option<Demand> {
        if !Self::is_present(parts) {
            return None;
        }
        // A response that succeeded is not a challenge, whatever it carries. The
        // sensor script and `_abck` both appear on ordinary pages once Bot
        // Manager is running, and treating those as a challenge turned a working
        // 200 into a challenged verdict.
        if (200..300).contains(&parts.status) {
            return None;
        }
        if Self::is_bot_manager(parts) {
            return Some(Demand::Script);
        }
        // An edge deny: refused on the request, with nothing to run. Saying
        // "block" rather than inventing a challenge is what keeps a caller from
        // waiting on a solver that can never help.
        if parts.status == 403 && parts.is_page() {
            return Some(Demand::Block);
        }
        None
    }
}

impl Protection for Akamai {
    fn name(&self) -> &'static str {
        "akamai"
    }

    fn inspect(&self, parts: &ResponseParts<'_>) -> Outcome {
        Outcome::of(Self::demand(parts), Self::is_present(parts), parts)
    }

    /// `_abck` is set from the very first response, so its presence proves
    /// nothing: Akamai encodes the state in the value, and a session still being
    /// challenged carries `~-1~`. Reading presence alone would report clearance
    /// on every challenged session.
    fn holds_clearance(&self, cookies: &dyn CookieJarView) -> bool {
        cookies.cookie(CLEARANCE_COOKIE).is_some_and(|v| !v.contains(CHALLENGED_MARKER))
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

        let seed: String = parts
            .headers
            .get_all("set-cookie")
            .filter(|c| !c.to_ascii_lowercase().contains("httponly"))
            .filter_map(|c| c.split(';').next())
            .map(|c| {
                let js = c.replace('\\', "\\\\").replace('"', "\\\"");
                format!("document.cookie=\"{js}\";")
            })
            .collect();
        let ready = "try{Object.defineProperty(document,'readyState',{configurable:true,\
            get:function(){var v=globalThis.__DOC_DYN?globalThis.__DOC_DYN.readyState:null;\
            return v==='complete'?'complete':'interactive';}});}catch(e){}";
        let leave = "setTimeout(function(){try{\
            if(globalThis.__DOC_DYN)globalThis.__DOC_DYN.visibilityState='hidden';\
            var t=function(n){var e=new Event(n);try{Object.defineProperty(e,'isTrusted',\
            {value:true,configurable:true});}catch(x){}return e;};\
            document.dispatchEvent(t('visibilitychange'));\
            window.dispatchEvent(t('blur'));window.dispatchEvent(t('pagehide'));}catch(e){}},300);";
        let probe = format!("{ready}{seed}{leave}");
        let seeded;
        let body = if !parts.body.contains("<script") {
            parts.body
        } else {
            seeded = parts.body.replacen("<script", &format!("<script>{probe}</script><script"), 1);
            &seeded
        };
        let report = solver.solve(body, parts.url, user_agent, http)?;
        for cookie in &report.cookies_set {
            cookies.set_cookie(cookie);
        }
        if !report.errors.is_empty() {
            return Err(ClearError::Failed(format!(
                "sensor script errored: {}",
                report.errors.join("; ")
            )));
        }
        Ok(())
    }
}
