//!
//! # Status
//!
//! Detects, classifies, and clears challenge.
//!
//! AWS WAF and CloudFront are trademarks of Amazon Web Services, Inc. This
//! crate is not affiliated with, endorsed by, or sponsored by Amazon; the names
//! identify the system it interoperates with.
//!
//! # What it is detected by
//!
//! AWS WAF signals its own actions in the response headers, and those are the
//! only definitive markers:
//!
//! ```text
//! x-amzn-waf-action: challenge      # answerable by running the SDK
//! x-amzn-waf-action: captcha        # drawn for a human
//! ```
//!
//! Clearance is an `aws-waf-token` cookie. The page's own SDK assigns it to
//! `document.cookie`, so clearing is only a matter of running the page and
//! keeping the cookies it set: nothing here knows which endpoint issued the
//! token or what the reply looked like.

use std::sync::Arc;
use veri_core::html::script_srcs;
use veri_core::{
    ClearError, CookieJarView, Demand, HttpBridge, Outcome, Protection, ResponseParts, Solver,
};

pub const CLEARANCE_COOKIE: &str = "aws-waf-token";

const ACTION_HEADER: &str = "x-amzn-waf-action";
const CHALLENGE_ID_HEADER: &str = "x-amzn-waf-challenge-id";
const SDK_HOST: &str = "sdk.awswaf.com";
const CAPTCHA_SDK_HOST: &str = "captcha-sdk.awswaf.com";
const TOKEN_HOST: &str = "token.awswaf.com";
const GOKU_PROPS: &str = "gokuProps";

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GokuProps {
    pub key: String,
    pub iv: String,
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Config {
    pub sdk_url: String,
    pub captcha_sdk_url: String,
    pub key: String,
    pub goku: Option<GokuProps>,
}

pub struct AwsWaf {
    solver: Option<Arc<dyn Solver>>,
}

impl AwsWaf {
    pub fn detect_only() -> Self {
        Self { solver: None }
    }

    pub fn with_solver(solver: Arc<dyn Solver>) -> Self {
        Self { solver: Some(solver) }
    }

    pub fn demand(parts: &ResponseParts<'_>) -> Option<Demand> {
        match parts.headers.get(ACTION_HEADER)?.trim().to_ascii_lowercase().as_str() {
            "challenge" => Some(Demand::Script),
            "captcha" => Some(Demand::Captcha),
            _ => None,
        }
    }

    pub fn is_present(parts: &ResponseParts<'_>) -> bool {
        parts.headers.get(ACTION_HEADER).is_some()
            || parts.headers.get(CHALLENGE_ID_HEADER).is_some()
            || parts.body.contains(SDK_HOST)
            || parts.body.contains(TOKEN_HOST)
            || parts.body.contains(GOKU_PROPS)
    }

    pub fn config(body: &str) -> Option<Config> {
        let mut cfg = Config::default();
        for url in script_srcs(body) {
            if url.contains(CAPTCHA_SDK_HOST) && cfg.captcha_sdk_url.is_empty() {
                cfg.captcha_sdk_url = url;
            } else if (url.contains(SDK_HOST) || url.contains(TOKEN_HOST)) && cfg.sdk_url.is_empty()
            {
                cfg.key = integration_key(&url);
                cfg.sdk_url = url;
            }
        }
        cfg.goku = goku_props(body);
        (!cfg.sdk_url.is_empty() || !cfg.captcha_sdk_url.is_empty() || cfg.goku.is_some())
            .then_some(cfg)
    }
}

fn goku_props(body: &str) -> Option<GokuProps> {
    let at = body.find(GOKU_PROPS)?;
    let open = body[at..].find('{')? + at;
    let close = body[open..].find('}')? + open;
    let obj = &body[open..close];
    Some(GokuProps {
        key: field(obj, "key").filter(|k| !k.is_empty())?,
        iv: field(obj, "iv").unwrap_or_default(),
        context: field(obj, "context").unwrap_or_default(),
    })
}

fn field(obj: &str, name: &str) -> Option<String> {
    let at = obj.find(&format!("\"{name}\""))?;
    let colon = obj[at..].find(':')? + at;
    let open = obj[colon..].find('"')? + colon + 1;
    let end = obj[open..].find('"')?;
    Some(obj[open..open + end].to_string())
}

fn integration_key(url: &str) -> String {
    url.split("://").nth(1).and_then(|rest| rest.split('/').nth(1)).unwrap_or_default().to_string()
}

impl Protection for AwsWaf {
    fn name(&self) -> &'static str {
        "awswaf"
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
            Ok(())
        } else {
            Err(ClearError::Rejected("the challenge ran but issued no token".into()))
        }
    }
}
