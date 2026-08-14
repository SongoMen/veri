//! Fakes for the three things a protection touches: a response, a cookie jar and
//! a solver. Every protection crate was declaring its own copies.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use veri_core::{
    CookieJarView, Headers, HttpBridge, ResponseParts, SolveError, SolveReport, Solver,
};

fn owned(strs: &[&str]) -> Vec<String> {
    strs.iter().map(|s| s.to_string()).collect()
}

/// `headers([("cf-ray", "abc")])`.
pub fn headers<const N: usize>(pairs: [(&str, &str); N]) -> Headers {
    Headers::new(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect())
}

pub fn parts<'a>(status: u16, headers: &'a Headers, body: &'a str) -> ResponseParts<'a> {
    ResponseParts { status, headers, body, url: "https://example.test/" }
}

#[derive(Default)]
pub struct Jar(Mutex<Vec<String>>);

impl Jar {
    pub fn holding(names: &[&str]) -> Arc<Self> {
        Arc::new(Self(Mutex::new(names.iter().map(|n| format!("{n}=value")).collect())))
    }

    pub fn empty() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn installed(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }

    fn value_of(&self, name: &str) -> Option<String> {
        let prefix = format!("{name}=");
        self.0.lock().unwrap().iter().find_map(|c| c.strip_prefix(&prefix).map(str::to_string))
    }
}

impl CookieJarView for Jar {
    fn has_cookie(&self, name: &str) -> bool {
        self.value_of(name).is_some()
    }

    fn set_cookie(&self, cookie: &str) {
        self.0.lock().unwrap().push(cookie.to_string());
    }

    fn cookie(&self, name: &str) -> Option<String> {
        self.value_of(name)
    }
}

struct Bridge {
    status: u16,
    body: String,
}

impl HttpBridge for Bridge {
    fn request(&self, _method: &str, _url: &str, _body: &str) -> (u16, String) {
        (self.status, self.body.clone())
    }
}

pub fn dead_bridge() -> Arc<dyn HttpBridge> {
    Arc::new(Bridge { status: 0, body: String::new() })
}

pub fn fixed_bridge(status: u16, body: &str) -> Arc<dyn HttpBridge> {
    Arc::new(Bridge { status, body: body.to_string() })
}

#[derive(Default)]
pub struct StubSolver {
    cookies_set: Vec<String>,
    errors: Vec<String>,
    calls: AtomicUsize,
}

impl StubSolver {
    pub fn quiet() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn setting(cookies: &[&str]) -> Arc<Self> {
        Arc::new(Self { cookies_set: owned(cookies), ..Self::default() })
    }

    pub fn erroring(errors: &[&str]) -> Arc<Self> {
        Arc::new(Self { errors: owned(errors), ..Self::default() })
    }

    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::Relaxed)
    }
}

impl Solver for StubSolver {
    fn solve(
        &self,
        _html: &str,
        _url: &str,
        _ua: &str,
        _http: Arc<dyn HttpBridge>,
    ) -> Result<SolveReport, SolveError> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        Ok(SolveReport {
            cookies_set: self.cookies_set.clone(),
            errors: self.errors.clone(),
            ..SolveReport::default()
        })
    }
}
