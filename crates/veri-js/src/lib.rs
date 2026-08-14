//! Runs a page's own JavaScript in a browser-accurate environment, in an
//! embedded V8 isolate, with no browser.
//!
//! The environment is materialised from a profile harvested from a real Chrome
//! by `tools/harvest.html`: its globals, its prototype chains, its canvas and
//! WebGL and audio, its fonts.
//!
//! The scripts are executed rather than reimplemented, and when they fetch they
//! fetch through the [`HttpBridge`] the caller hands in, which in practice is
//! the session that fetched the page. Same fingerprint, same jar, same address.
//! [`V8Solver`] is the entry point, and every choice is an option on it.
//!
//! ```no_run
//! use veri_js::V8Solver;
//! use veri_core::Solver;
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! # let (html, url, ua): (&str, &str, &str) = todo!();
//! # let http: std::sync::Arc<dyn veri_core::HttpBridge> = todo!();
//! let solver = V8Solver::new().seed("_x_opt");
//! let report = solver.solve(html, url, ua, http)?;
//! // Success means the challenge ran, NOT that clearance was granted -
//! // only the cookie jar can tell you that.
//! # Ok(()) }
//! ```
//!
//! ```
//! use std::time::Duration;
//!
//! let solver = veri_js::V8Solver::new()
//!     .seed("_x_opt")                 // else every script in the page runs
//!     .timezone("America/New_York")   // match your egress, not the profile's
//!     .timeout(Duration::from_secs(120))
//!     .heap_mb(96);
//! ```

pub mod vm;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use veri_core::{HttpBridge, SolveError, SolveReport, Solver};
use vm::SolveOptions;

#[derive(Debug, Clone, Default)]
pub struct V8Solver {
    seed: Option<String>,
    options: SolveOptions,
}

impl V8Solver {
    pub fn new() -> Self {
        Self { seed: None, options: SolveOptions::from_env() }
    }

    /// Seed this global with the value the page declares it with, then run only
    /// the inline script that declares it, rather than the whole document.
    pub fn seed(mut self, config_object: impl Into<String>) -> Self {
        self.seed = Some(config_object.into());
        self
    }

    pub fn shadow_dom(mut self, on: bool) -> Self {
        self.options.shadow_dom = on;
        self
    }

    /// For a challenge that puts its answer in a framed document.
    pub fn frames(mut self, on: bool) -> Self {
        self.options.frames = on;
        self
    }

    pub fn stopping_at(mut self, cookie: impl Into<String>) -> Self {
        self.options.stop_when_cookie = Some(cookie.into());
        self
    }

    pub fn diagnostics(mut self, on: bool) -> Self {
        self.options.diagnostics = on;
        self
    }

    pub fn timeout(mut self, d: Duration) -> Self {
        self.options.timeout = Some(d);
        self
    }

    pub fn no_timeout(mut self) -> Self {
        self.options.timeout = None;
        self
    }

    pub fn heap_mb(mut self, mb: usize) -> Self {
        self.options.heap_mb = mb;
        self
    }

    pub fn timezone(mut self, tz: impl Into<String>) -> Self {
        self.options.timezone = Some(tz.into());
        self
    }

    pub fn capture_scripts_to(mut self, dir: impl Into<PathBuf>) -> Self {
        self.options.capture_dir = Some(dir.into());
        self
    }

    pub fn trace_caught_exceptions(mut self, on: bool) -> Self {
        self.options.trace_catch = on;
        self
    }

    pub fn trace_undefined_calls(mut self, on: bool) -> Self {
        self.options.trace_undef = on;
        self
    }

    pub fn with_options(mut self, options: SolveOptions) -> Self {
        self.options = options;
        self
    }

    pub fn options(&self) -> &SolveOptions {
        &self.options
    }

    fn solve_seeded(
        &self,
        name: &str,
        page_html: &str,
        page_url: &str,
        user_agent: &str,
        http: Arc<dyn HttpBridge>,
    ) -> Result<SolveReport, SolveError> {
        let Some(seed) = vm::extract_config_object(page_html, name) else {
            return Err(SolveError::NotAChallenge);
        };
        let found = vm::extract_inline_script_at(page_html, name);
        let prelude = rebuild_document(page_html, &vm::scripts(page_html));
        let out = vm::execute(
            vm::Program {
                prelude: Some(&prelude),
                seed: Some(&seed),
                bootstrap: found.as_ref().map(|(src, _, _)| src.as_str()),
                bootstrap_at: found.as_ref().map_or((0, 0), |(_, l, c)| (*l, *c)),
                watch: &[name],
                ..Default::default()
            },
            page_url,
            user_agent,
            Some(http),
            &self.options,
        )?;
        Ok(out.into())
    }

    fn solve_page(
        &self,
        page_html: &str,
        page_url: &str,
        user_agent: &str,
        http: Arc<dyn HttpBridge>,
    ) -> Result<SolveReport, SolveError> {
        let scripts = vm::scripts(page_html);
        if scripts.is_empty() {
            return Err(SolveError::NotAChallenge);
        }
        let prelude = rebuild_document(page_html, &scripts);
        let bootstrap = run_in_order(scripts);
        let out = vm::execute(
            vm::Program {
                prelude: Some(&prelude),
                bootstrap: Some(&bootstrap),
                bootstrap_at: vm::first_inline_script_at(page_html).map_or((0, 0), |(l, _)| (l, 0)),
                ..Default::default()
            },
            page_url,
            user_agent,
            Some(http),
            &self.options,
        )?;
        Ok(out.into())
    }
}

impl Solver for V8Solver {
    fn solve(
        &self,
        page_html: &str,
        page_url: &str,
        user_agent: &str,
        http: Arc<dyn HttpBridge>,
    ) -> Result<SolveReport, SolveError> {
        match self.seed.as_deref() {
            Some(name) => self.solve_seeded(name, page_html, page_url, user_agent, http),
            None => self.solve_page(page_html, page_url, user_agent, http),
        }
    }
}

fn rebuild_document(html: &str, scripts: &[(String, vm::Script)]) -> String {
    const HEAD_TAGS: [&str; 6] = ["meta", "title", "link", "style", "base", "head"];
    let mut out = String::new();
    for (tag, attrs) in vm::all_elements(html) {
        if matches!(tag.as_str(), "html" | "body" | "head") {
            continue;
        }
        let parent = if HEAD_TAGS.contains(&tag.as_str()) { "head" } else { "body" };
        let sets: String = attrs
            .iter()
            .map(|(k, v)| format!("e.setAttribute({},{});", vm::js(k), vm::js(v)))
            .collect();
        out.push_str(&format!(
            "(function(){{var e=document.createElement({});{sets}\
             document.{parent}.appendChild(e);}})();\n",
            vm::js(tag)
        ));
    }
    for (id, script) in scripts {
        if let vm::Script::Inline(code) = script {
            out.push_str(&format!(
                "(function(){{var e=document.createElement('script');\
                 e.textContent={};e.id={};e.__loaded=true;\
                 document.head.appendChild(e);}})();\n",
                vm::js(code),
                vm::js(id),
            ));
        }
    }
    out
}

fn run_in_order(scripts: Vec<(String, vm::Script)>) -> String {
    scripts
        .into_iter()
        .map(|(_, script)| match script {
            vm::Script::Inline(code) => code,
            vm::Script::External(src) => format!(
                "(function(){{var s=document.createElement('script');\
                 s.src={};s.__loaded=true;document.head.appendChild(s);\
                 __loadScriptNow(s);}})();",
                vm::js(src)
            ),
        })
        .collect::<Vec<_>>()
        .join("\n;\n")
}
