//!
//! # Status
//!
//! Detection and classification only. [`PerimeterX::detect_only`] is the only
//! constructor, because the challenge is a **press-and-hold captcha** and there
//! is nothing for a solver to run.
//!
//! PerimeterX is a trademark of HUMAN Security, Inc. This crate is not
//! affiliated with, endorsed by, or sponsored by HUMAN; the name identifies the
//! system it interoperates with.
//!
//! # What it is detected by
//!
//! Its visitor cookie, or a run of inline `window._px*` assignments the block
//! page carries. [`PerimeterX::config`] reads those to say which app refused
//! and whether the page is a captcha or an outright block.

use std::sync::Arc;
use veri_core::{
    ClearError, CookieJarView, Demand, HttpBridge, Outcome, Protection, ResponseParts,
};

pub const CLEARANCE_COOKIE: &str = "_px3";

const APP_ID: &str = "window._pxAppId";
const CAPTCHA_SRC: &str = "pxCaptchaSrc";
const VISITOR_COOKIE: &str = "_pxvid";

/// What a block page declares about itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub app_id: String,
    pub uuid: String,
    pub host_url: String,
    pub js_client_src: String,
    pub action: String,
    pub first_party: bool,
}

impl Config {
    pub fn demand(&self) -> Demand {
        match self.action.as_str() {
            "b" => Demand::Block,
            _ => Demand::Captcha,
        }
    }
}

fn assignment(body: &str, name: &str) -> Option<String> {
    let key = format!("{name}=");
    let rest = &body[body.find(&key)? + key.len()..];
    match rest.chars().next()? {
        quote @ ('\'' | '"') => {
            let end = rest[1..].find(quote)?;
            Some(rest[1..1 + end].to_string())
        }
        _ => {
            let end = rest.find([';', ',', '\n']).unwrap_or(rest.len());
            Some(rest[..end].trim().to_string())
        }
    }
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.to_string())
}

pub struct PerimeterX;

impl PerimeterX {
    pub fn detect_only() -> Self {
        Self
    }

    pub fn is_present(parts: &ResponseParts<'_>) -> bool {
        let visitor = format!("{VISITOR_COOKIE}=");
        parts.headers.get_all("set-cookie").any(|c| c.trim_start().starts_with(&visitor))
            || parts.body.contains(APP_ID)
            || parts.body.contains(CAPTCHA_SRC)
    }

    pub fn demand(parts: &ResponseParts<'_>) -> Option<Demand> {
        if !Self::is_present(parts) {
            return None;
        }
        Some(Self::config(parts.body)?.demand())
    }

    pub fn config(body: &str) -> Option<Config> {
        let captcha_src = assignment(body, &format!("var {CAPTCHA_SRC}")).unwrap_or_default();
        Some(Config {
            app_id: assignment(body, APP_ID)?,
            uuid: assignment(body, "window._pxUuid").unwrap_or_default(),
            host_url: assignment(body, "window._pxHostUrl").unwrap_or_default(),
            js_client_src: assignment(body, "window._pxJsClientSrc").unwrap_or_default(),
            action: query_param(&captcha_src, "a").unwrap_or_default(),
            first_party: assignment(body, "window._pxFirstPartyEnabled").as_deref() == Some("true"),
        })
    }
}

impl Protection for PerimeterX {
    fn name(&self) -> &'static str {
        "perimeterx"
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
        _user_agent: &str,
        _http: Arc<dyn HttpBridge>,
        _cookies: &dyn CookieJarView,
    ) -> Result<(), ClearError> {
        let Some(cfg) = Self::config(parts.body) else {
            return Err(ClearError::NotAChallenge);
        };
        let served = match cfg.demand() {
            Demand::Block => "a hard block",
            _ => "a press-and-hold captcha",
        };
        Err(ClearError::Rejected(format!(
            "perimeterx served {served} for app {}, and this crate does not clear them. \
             A real browser holding clearance is served the same page on these routes, \
             so the egress is the thing to change, not the payload",
            cfg.app_id,
        )))
    }
}
