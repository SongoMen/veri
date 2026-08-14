//!
//! # Status
//!
//! Detection and classification.
//!
//! DataDome is a trademark of DataDome SAS. This crate is not affiliated with,
//! endorsed by, or sponsored by DataDome; the name identifies the system it
//! interoperates with.
//!
//! # What it is detected by
//!
//! Its own headers, its clearance cookie, or the hosts it serves script from.
//! The block page *is* the challenge page, and it carries a `var dd={…}`
//! configuration object that [`DataDome::config`] reads to tell one kind of
//! block from another. Only the scripted kind is ever attempted; anything
//! aimed at a human, or already decided, is refused.

use std::sync::Arc;
use veri_core::http::percent_encode;
use veri_core::{
    ClearError, CookieJarView, Demand, HttpBridge, Outcome, Protection, ResponseParts, Solver,
};

pub const CLEARANCE_COOKIE: &str = "datadome";

const DELIVERY_HOST: &str = "captcha-delivery.com";
const TAG_HOST: &str = "js.datadome.co";
const DEFAULT_HOST: &str = "geo.captcha-delivery.com";

/// The `var dd={…}` object a block page declares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// Response type: `i` interstitial, `c` captcha.
    pub rt: String,
    /// Present on a captcha only: `fe` or `bv`.
    pub t: String,
    pub cid: String,
    pub hsh: String,
    pub cookie: String,
    pub host: String,
    pub s: String,
    pub e: String,
    /// Present on an interstitial only.
    pub b: String,
}

impl Config {
    pub fn demand(&self) -> Demand {
        match self.rt.as_str() {
            "i" => Demand::Script,
            _ if self.t == "bv" => Demand::Block,
            _ => Demand::Captcha,
        }
    }

    pub fn interstitial_url(&self, page_url: &str) -> String {
        let e = if self.e.is_empty() { String::new() } else { format!("&e={}", self.e) };
        format!(
            "https://{}/interstitial/?initialCid={}&hash={}&cid={}&referer={}&s={}{e}&b={}&dm=cd",
            self.host,
            percent_encode(&self.cid),
            percent_encode(&self.hsh),
            percent_encode(&self.cookie),
            percent_encode(page_url),
            self.s,
            self.b,
        )
    }
}

fn field(inner: &str, key: &str) -> Option<String> {
    let k = format!("'{key}':");
    let rest = inner[inner.find(&k)? + k.len()..].trim_start();
    match rest.chars().next()? {
        '\'' => {
            let end = rest[1..].find('\'')?;
            Some(rest[1..1 + end].to_string())
        }
        _ => {
            let end = rest.find([',', '}']).unwrap_or(rest.len());
            Some(rest[..end].trim().to_string())
        }
    }
}

pub struct DataDome {
    solver: Option<Arc<dyn Solver>>,
}

impl DataDome {
    pub fn detect_only() -> Self {
        Self { solver: None }
    }

    pub fn with_solver(solver: Arc<dyn Solver>) -> Self {
        Self { solver: Some(solver) }
    }

    pub fn is_present(parts: &ResponseParts<'_>) -> bool {
        let clearance = format!("{CLEARANCE_COOKIE}=");
        parts.headers.contains("x-datadome")
            || parts.headers.contains("x-dd-b")
            || parts.headers.get_all("set-cookie").any(|c| c.trim_start().starts_with(&clearance))
            || parts.body.contains(DELIVERY_HOST)
            || parts.body.contains(TAG_HOST)
    }

    pub fn demand(parts: &ResponseParts<'_>) -> Option<Demand> {
        if !Self::is_present(parts) {
            return None;
        }
        Some(Self::config(parts.body)?.demand())
    }

    pub fn config(body: &str) -> Option<Config> {
        let at = body.find("var dd=")?;
        let open = body[at..].find('{')? + at;
        let close = body[open..].find('}')? + open;
        let inner = &body[open + 1..close];

        Some(Config {
            rt: field(inner, "rt").unwrap_or_default(),
            t: field(inner, "t").unwrap_or_default(),
            cid: field(inner, "cid")?,
            hsh: field(inner, "hsh").unwrap_or_default(),
            cookie: field(inner, "cookie").unwrap_or_default(),
            host: field(inner, "host").unwrap_or_else(|| DEFAULT_HOST.to_string()),
            s: field(inner, "s").unwrap_or_default(),
            e: field(inner, "e").unwrap_or_default(),
            b: field(inner, "b").unwrap_or_default(),
        })
    }
}

impl Protection for DataDome {
    fn name(&self) -> &'static str {
        "datadome"
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
        let Some(cfg) = Self::config(parts.body) else {
            return Err(ClearError::NotAChallenge);
        };
        match cfg.demand() {
            Demand::Script => {}
            Demand::Block => {
                return Err(ClearError::Rejected(
                    "datadome hard block (t=bv): the decision is already made, so a \
                     different egress or identity is the only thing that helps"
                        .into(),
                ))
            }
            Demand::Captcha => {
                return Err(ClearError::Rejected(format!(
                    "datadome served a captcha (rt={}, t={}), which is a slider drawn \
                     for a human and cannot be answered by executing script",
                    cfg.rt, cfg.t
                )))
            }
        }

        let Some(solver) = &self.solver else {
            return Err(ClearError::Failed("no solver registered; this crate detects only".into()));
        };

        let url = cfg.interstitial_url(parts.url);
        let (status, page) = http.request("GET", &url, "");
        if !(200..300).contains(&status) {
            return Err(ClearError::Failed(format!("datadome interstitial returned {status}")));
        }

        let before = cookies.cookie(CLEARANCE_COOKIE);
        let report = solver.solve(&page, &url, user_agent, http)?;
        for cookie in &report.cookies_set {
            cookies.set_cookie(cookie);
        }
        let after = cookies.cookie(CLEARANCE_COOKIE);

        if after.is_some() && after != before {
            return Ok(());
        }
        if !report.errors.is_empty() {
            return Err(ClearError::Failed(format!(
                "device check errored: {}",
                report.errors.join("; ")
            )));
        }
        Err(ClearError::Rejected("the device check ran but no clearance was issued".into()))
    }
}
