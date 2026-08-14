//! Scaffolding shared by the environment tests: a bridge that records what the
//! page asked for, and a probe that reports one expression's value back through
//! it. The page has no other way to talk to the test.

// Each integration test binary compiles this module separately and uses part of it.
#![allow(dead_code)]

use std::sync::{Arc, Mutex};
use veri_core::{HttpBridge, Solver};
use veri_js::V8Solver;

/// Records every request the page made and answers each with a fixed body.
pub struct Spy {
    calls: Mutex<Vec<(String, String, String)>>,
    reply: String,
}

impl Spy {
    pub fn new(reply: &str) -> Arc<Self> {
        Arc::new(Self { calls: Mutex::new(Vec::new()), reply: reply.to_string() })
    }

    /// URLs requested, in order.
    pub fn urls(&self) -> Vec<String> {
        self.calls.lock().unwrap().iter().map(|(_, u, _)| u.clone()).collect()
    }

    /// `"{method} {url} {body}"` per request, in order.
    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().iter().map(|(m, u, b)| format!("{m} {u} {b}")).collect()
    }
}

impl HttpBridge for Spy {
    fn request(&self, method: &str, url: &str, body: &str) -> (u16, String) {
        self.calls.lock().unwrap().push((method.into(), url.into(), body.into()));
        (200, self.reply.clone())
    }
}

/// The Chrome-only branches are gated on the User-Agent, so a test about what a
/// Chrome exposes has to claim to be one.
pub const CHROME_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                             (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

/// Only the escapes these values actually produce.
pub fn unescape(s: &str) -> String {
    s.replace("%20", " ")
        .replace("%2C", ",")
        .replace("%2F", "/")
        .replace("%3B", ";")
        .replace("%5B", "[")
        .replace("%5D", "]")
        .replace("%7C", "|")
        .replace("%3A", ":")
        .replace("%3D", "=")
        .replace("%2B", "+")
}

pub fn echoed(page: &str, ua: &str) -> String {
    let bridge = Spy::new("");
    let report = V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://x.test/", ua, bridge.clone())
        .unwrap();
    if !report.errors.is_empty() {
        println!("page errors: {:?}", report.errors);
    }
    bridge
        .urls()
        .iter()
        .find_map(|u| u.strip_prefix("https://echo.test/"))
        .map(unescape)
        .unwrap_or_default()
}

pub fn probe_as(ua: &str, expr: &str) -> String {
    let page = format!(
        "<html><body><script>var v;\
         try {{ v = String({expr}); }} catch (e) {{ v = 'THREW ' + e.message; }}\
         var x=new XMLHttpRequest();x.open('GET','https://echo.test/'+encodeURIComponent(v));x.send();\
         </script></body></html>"
    );
    echoed(&page, ua)
}

/// [`probe_as`] under the solver's placeholder User-Agent.
pub fn probe(expr: &str) -> String {
    probe_as("ua", expr)
}
