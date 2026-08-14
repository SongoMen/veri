use std::sync::Arc;
use veri::{Client, Protection, RetryPolicy};
use veri_integrations::{AwsWaf, Cloudflare, DataDome, PerimeterX, Vercel};

#[derive(Debug, Default)]
pub struct Flags {
    values: Vec<(String, String)>,
    switches: Vec<String>,
    pub positional: Vec<String>,
}

impl Flags {
    pub fn parse(taking: &[&str]) -> Self {
        let argv: Vec<String> = std::env::args().skip(1).collect();
        let mut out = Flags::default();
        let mut i = 0;
        while i < argv.len() {
            let arg = &argv[i];
            if let Some(name) = arg.strip_prefix("--") {
                if taking.contains(&name) {
                    i += 1;
                    if let Some(v) = argv.get(i) {
                        out.values.push((name.to_string(), v.clone()));
                    }
                } else {
                    out.switches.push(name.to_string());
                }
            } else {
                out.positional.push(arg.clone());
            }
            i += 1;
        }
        out
    }

    pub fn all(&self, name: &str) -> Vec<String> {
        self.values.iter().filter(|(k, _)| k == name).map(|(_, v)| v.clone()).collect()
    }

    pub fn get(&self, name: &str) -> Option<String> {
        self.values.iter().rev().find(|(k, _)| k == name).map(|(_, v)| v.clone())
    }

    pub fn has(&self, name: &str) -> bool {
        self.switches.iter().any(|s| s == name)
    }

    pub fn positional_at(&self, i: usize) -> Option<String> {
        self.positional.get(i).cloned()
    }

    pub fn proxy(&self) -> Option<String> {
        self.get("proxy").or_else(|| std::env::var("VERI_PROXY").ok().filter(|s| !s.is_empty()))
    }
}

#[derive(Debug, Default, Clone)]
pub struct ClientSpec {
    pub identity: Option<String>,
    pub ladder: Vec<String>,
    pub proxy: Option<String>,
    pub solve: bool,
}

impl ClientSpec {
    fn protections(&self) -> Vec<Arc<dyn Protection>> {
        if !self.solve {
            return vec![
                Arc::new(Cloudflare::detect_only()),
                Arc::new(DataDome::detect_only()),
                Arc::new(AwsWaf::detect_only()),
                Arc::new(PerimeterX::detect_only()),
                Arc::new(Vercel::detect_only()),
            ];
        }
        let page = || Arc::new(veri_js::V8Solver::new().shadow_dom(true));
        vec![
            Arc::new(Cloudflare::with_solver(Arc::new(
                veri_js::V8Solver::new()
                    .seed(veri_integrations::cloudflare::CONFIG_OBJECT)
                    .shadow_dom(true)
                    .frames(true)
                    .stopping_at(veri_integrations::cloudflare::CLEARANCE_COOKIE),
            ))),
            Arc::new(DataDome::detect_only()),
            Arc::new(AwsWaf::with_solver(page())),
            Arc::new(PerimeterX::detect_only()),
            Arc::new(Vercel::with_solver(Arc::new(
                veri_js::V8Solver::new()
                    .shadow_dom(true)
                    .stopping_at(veri_integrations::vercel::CLEARANCE_COOKIE),
            ))),
        ]
    }

    pub fn build(&self) -> Result<Client, veri::Error> {
        let mut b = Client::builder();
        for p in self.protections() {
            b = b.protection(p);
        }
        if let Some(id) = &self.identity {
            b = b.identity(id);
        } else if !self.ladder.is_empty() {
            b = b.ladder(&self.ladder.iter().map(String::as_str).collect::<Vec<_>>());
        }
        if let Some(p) = &self.proxy {
            b = b.proxy(p.clone());
        }
        b.retry(RetryPolicy::none()).build()
    }
}

pub async fn main_with<F, Fut>(f: F) -> std::process::ExitCode
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(), Box<dyn std::error::Error>>>,
{
    match f().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}

pub fn chrome_ua() -> &'static str {
    veri::identity::by_name("Chrome149").map_or("", |i| i.user_agent)
}

pub fn profile_line() -> String {
    let m = veri_js::vm::profile_meta();
    let day = &m.harvested_at[..m.harvested_at.len().min(10)];
    format!("Chrome {} harvested {day}", m.chrome)
}
