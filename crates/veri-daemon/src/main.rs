use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock, Semaphore};
use veri::{Client, Protection, RetryPolicy};
use veri_integrations::{AwsWaf, Cloudflare, DataDome, PerimeterX, Vercel};

const PROTOCOL_VERSION: u32 = 1;
const DEFAULT_CONCURRENCY: usize = 16;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    #[serde(default)]
    id: u64,
    method: String,

    url: Option<String>,
    host: Option<String>,
    headers: Option<Vec<(String, String)>>,
    query: Option<Vec<(String, String)>>,
    body: Option<String>,
    json: Option<serde_json::Value>,
    cookie: Option<String>,
    name: Option<String>,
    request_timeout_ms: Option<u64>,

    proxy: Option<String>,
    solver: Option<bool>,
    identity: Option<String>,
    ladder: Option<Vec<String>>,
    timeout_ms: Option<u64>,
    connect_timeout_ms: Option<u64>,
    retries: Option<u32>,
    max_response_bytes: Option<usize>,
}

impl Request {
    fn target_host(&mut self) -> Option<String> {
        let given = self.host.take().or_else(|| self.url.take())?;
        Some(veri::host_of(&given).unwrap_or(given))
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Response {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    saw_challenge: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cleared_but_rechallenged: Option<bool>,
    /// True when a timeout was involved, so a caller can back off rather than
    /// treating it as a refusal.
    #[serde(skip_serializing_if = "Option::is_none")]
    timed_out: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unreachable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verdict: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    headers: Option<Vec<(String, String)>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attempts: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cleared: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    used_clearance: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    probe: Option<Vec<ProbeRow>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    info: Option<serde_json::Value>,
}

impl Response {
    fn ok(id: u64) -> Self {
        Self { id, ok: true, ..Default::default() }
    }

    fn info(id: u64, info: serde_json::Value) -> Self {
        Self { info: Some(info), ..Self::ok(id) }
    }

    fn err(id: u64, msg: impl Into<String>) -> Self {
        Self { id, ok: false, error: Some(msg.into()), ..Default::default() }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeRow {
    identity: String,
    verdict: String,
    status: u16,
    ms: u128,
    bytes: usize,
    protection: Option<String>,
    hints: Vec<String>,
    cleared: bool,
}

impl From<veri::ProbeReport> for ProbeRow {
    fn from(p: veri::ProbeReport) -> Self {
        Self {
            identity: p.identity.name.to_string(),
            verdict: p.verdict.to_string(),
            status: p.status,
            ms: p.elapsed.as_millis(),
            bytes: p.bytes,
            protection: p.protection.map(str::to_string),
            hints: p.hints,
            cleared: p.cleared,
        }
    }
}

/// Everything that, when changed, means rebuilding the client.
#[derive(Clone, PartialEq, Eq)]
struct Settings {
    solver: bool,
    proxy: Option<String>,
    identity: Option<String>,
    ladder: Option<Vec<String>>,
    timeout_ms: Option<u64>,
    connect_timeout_ms: Option<u64>,
    retries: Option<u32>,
    max_response_bytes: Option<usize>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            solver: true,
            proxy: None,
            identity: None,
            ladder: None,
            timeout_ms: None,
            connect_timeout_ms: None,
            retries: None,
            max_response_bytes: None,
        }
    }
}

impl Settings {
    fn merged_with(&self, r: &Request) -> Self {
        Self {
            solver: r.solver.unwrap_or(self.solver),
            proxy: r.proxy.clone().or_else(|| self.proxy.clone()),
            identity: r.identity.clone().or_else(|| self.identity.clone()),
            ladder: r.ladder.clone().or_else(|| self.ladder.clone()),
            timeout_ms: r.timeout_ms.or(self.timeout_ms),
            connect_timeout_ms: r.connect_timeout_ms.or(self.connect_timeout_ms),
            retries: r.retries.or(self.retries),
            max_response_bytes: r.max_response_bytes.or(self.max_response_bytes),
        }
    }

    fn build(&self) -> Result<Client, veri::Error> {
        let mut b = Client::builder();
        for p in protections(self.solver) {
            b = b.protection(p);
        }
        if let Some(p) = &self.proxy {
            b = b.proxy(p.clone());
        }
        if let Some(id) = &self.identity {
            b = b.identity(id);
        } else if let Some(l) = &self.ladder {
            b = b.ladder(&l.iter().map(String::as_str).collect::<Vec<_>>());
        }
        if let Some(ms) = self.timeout_ms {
            b = if ms == 0 { b.no_timeout() } else { b.timeout(Duration::from_millis(ms)) };
        }
        if let Some(ms) = self.connect_timeout_ms.filter(|m| *m > 0) {
            b = b.connect_timeout(Duration::from_millis(ms));
        }
        if let Some(n) = self.retries {
            b = b.retry(RetryPolicy::times(n));
        }
        if let Some(n) = self.max_response_bytes {
            b = if n == 0 { b.unlimited_response_bytes() } else { b.max_response_bytes(n) };
        }
        b.build()
    }
}

fn protections(solver: bool) -> Vec<Arc<dyn Protection>> {
    if !solver {
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

struct State {
    client: Arc<Client>,
    settings: Settings,
}

impl State {
    fn new() -> Result<Self, veri::Error> {
        let settings = Settings::default();
        Ok(Self { client: Arc::new(settings.build()?), settings })
    }

    /// Rebuilding starts a fresh session store, so cookies and any clearance
    /// earned go with it. The reply says `rebuilt` when that happened.
    fn reconfigure(&mut self, r: &Request) -> Result<bool, veri::Error> {
        let next = self.settings.merged_with(r);
        if next == self.settings {
            return Ok(false);
        }
        self.client = Arc::new(next.build()?);
        self.settings = next;
        Ok(true)
    }
}

type Shared = Arc<RwLock<State>>;

async fn handle(shared: Shared, mut r: Request) -> Response {
    let id = r.id;
    let method = std::mem::take(&mut r.method);
    if method == "configure" {
        return configure(&shared, &r).await;
    }

    let client = shared.read().await.client.clone();
    match method.as_str() {
        "forget" => {
            let Some(host) = r.target_host() else {
                return Response::err(id, "host is required");
            };
            Response::info(id, serde_json::json!({ "forgot": client.forget(&host) }))
        }

        "set_cookie" => {
            let (Some(host), Some(cookie)) = (r.target_host(), r.cookie) else {
                return Response::err(id, "host and cookie are required");
            };
            client.set_cookie(&host, &cookie);
            Response::ok(id)
        }

        "cookie" => {
            let (Some(host), Some(name)) = (r.target_host(), r.name) else {
                return Response::err(id, "host and name are required");
            };
            Response::info(id, serde_json::json!({ "cookie": client.cookie(&host, &name) }))
        }

        "probe" => {
            let Some(url) = r.url else { return Response::err(id, "url is required") };
            match client.probe(&url).await {
                Ok(rows) => Response {
                    probe: Some(rows.into_iter().map(ProbeRow::from).collect()),
                    ..Response::ok(id)
                },
                Err(e) => Response::err(id, e.to_string()),
            }
        }

        "info" => Response::info(id, describe(&client)),

        _ => send(&client, &method, r).await,
    }
}

async fn configure(shared: &Shared, r: &Request) -> Response {
    let mut state = shared.write().await;
    match state.reconfigure(r) {
        Ok(rebuilt) => Response::info(
            r.id,
            serde_json::json!({
                "rebuilt": rebuilt,
                "proxy": state.settings.proxy.as_deref()
                    .map(|p| p.split('@').next_back().unwrap_or("set")),
                "solver": state.settings.solver,
                "ladder": state.client.ladder(),
                "timeoutMs": state.settings.timeout_ms,
                "retries": state.settings.retries,
                "maxResponseBytes": state.settings.max_response_bytes,
            }),
        ),
        Err(e) => Response::err(r.id, e.to_string()),
    }
}

fn describe(client: &Client) -> serde_json::Value {
    let profile = veri_js::vm::profile_meta();
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": PROTOCOL_VERSION,
        "identities": veri::ClientBuilder::available_identities(),
        "ladder": client.ladder(),
        "profile": {
            "chrome": profile.chrome,
            "harvestedAt": profile.harvested_at,
        },
    })
}

async fn send(client: &Client, method: &str, r: Request) -> Response {
    let id = r.id;
    let Some(url) = r.url else { return Response::err(id, "url is required") };

    let mut req = client.request(&method.to_uppercase(), &url);
    if let Some(h) = r.headers {
        req = req.headers(h);
    }
    if let Some(q) = r.query {
        req = req.query(q);
    }
    if let Some(j) = r.json {
        req = req.json(&j);
    } else if let Some(b) = r.body {
        req = req.body(b.into_bytes());
    }
    if let Some(ms) = r.request_timeout_ms.filter(|m| *m > 0) {
        req = req.timeout(Duration::from_millis(ms));
    }

    match req.send().await {
        Ok(res) => payload(&res, Response::ok(id)),
        Err(e) => {
            let base = Response {
                saw_challenge: Some(e.saw_challenge()),
                cleared_but_rechallenged: Some(e.cleared_but_rechallenged()),
                timed_out: Some(e.is_timeout()),
                unreachable: Some(e.all_unreachable()),
                ..Response::err(id, e.to_string())
            };
            match e.response() {
                Some(res) => payload(res, base),
                None => base,
            }
        }
    }
}

fn payload(res: &veri::Response, into: Response) -> Response {
    let (body, body_base64) = match std::str::from_utf8(res.bytes()) {
        Ok(text) => (Some(text.to_string()), None),
        Err(_) => (None, Some(veri::http::base64(res.bytes()))),
    };
    Response {
        status: Some(res.status),
        verdict: Some(res.verdict.to_string()),
        headers: Some(res.headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
        body,
        body_base64,
        identity: Some(res.identity.name.to_string()),
        attempts: Some(res.attempts),
        cleared: res.cleared.map(str::to_string),
        used_clearance: Some(res.used_clearance),
        ..into
    }
}

fn salvage_id(line: &str) -> u64 {
    serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|v| v.get("id").and_then(serde_json::Value::as_u64))
        .unwrap_or(0)
}

async fn answer(shared: Shared, line: String) -> String {
    let response = match serde_json::from_str::<Request>(&line) {
        Ok(r) => handle(shared, r).await,
        Err(e) => Response::err(salvage_id(&line), format!("malformed request: {e}")),
    };
    let id = response.id;
    serde_json::to_string(&response)
        .unwrap_or_else(|e| format!(r#"{{"id":{id},"ok":false,"error":"encode: {e}"}}"#))
}

fn announce_ready() {
    let mut out = std::io::stdout();
    let _ = writeln!(
        out,
        r#"{{"ready":true,"version":"{}","protocol":{}}}"#,
        env!("CARGO_PKG_VERSION"),
        PROTOCOL_VERSION
    );
    let _ = out.flush();
}

fn spawn_writer() -> (mpsc::UnboundedSender<String>, tokio::task::JoinHandle<()>) {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let task = tokio::task::spawn_blocking(move || {
        let mut out = std::io::stdout();
        while let Some(line) = rx.blocking_recv() {
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
        }
    });
    (tx, task)
}

fn spawn_reader() -> mpsc::UnboundedReceiver<String> {
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    rx
}

fn max_concurrency() -> usize {
    std::env::var("VERI_MAX_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(DEFAULT_CONCURRENCY)
        .max(1)
}

#[tokio::main]
async fn main() {
    let state = match State::new() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("veri-daemon: {e}");
            std::process::exit(1);
        }
    };
    let shared: Shared = Arc::new(RwLock::new(state));

    announce_ready();
    let (out, writer) = spawn_writer();
    let mut lines = spawn_reader();
    let permits = Arc::new(Semaphore::new(max_concurrency()));

    let mut running = tokio::task::JoinSet::new();
    while let Some(line) = lines.recv().await {
        if line.trim().is_empty() {
            continue;
        }
        let shared = shared.clone();
        let out = out.clone();
        let permits = permits.clone();
        running.spawn(async move {
            let _permit = permits.acquire().await;
            let _ = out.send(answer(shared, line).await);
        });
        while running.try_join_next().is_some() {}
    }

    while running.join_next().await.is_some() {}
    drop(out);
    let _ = writer.await;
}
