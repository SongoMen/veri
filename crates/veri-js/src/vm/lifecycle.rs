//! Compiling, running, and driving the document to `complete`.

const IDLE_WAIT: usize = 32;
const SETTLED_ROUNDS: usize = 128;

pub fn run(scope: &mut v8::HandleScope, src: &str, name: &str) -> Result<(), String> {
    run_at(scope, src, name, Some(("", 0, 0)))
}

pub type Origin<'a> = (&'a str, i32, i32);

pub fn run_at(
    scope: &mut v8::HandleScope,
    src: &str,
    name: &str,
    origin: Option<Origin<'_>>,
) -> Result<(), String> {
    let mut tc = v8::TryCatch::new(scope);
    let code = v8::String::new(&mut tc, src).ok_or("source too large for V8 string")?;
    let built = origin.and_then(|(url, line, col)| {
        let resource = v8::String::new(&mut tc, url)?;
        Some(v8::ScriptOrigin::new(
            &mut tc,
            resource.into(),
            line,
            col,
            // Same-origin: without this V8 withholds detail from stack frames.
            true,
            -1,
            None,
            false,
            false,
            false,
            None,
        ))
    });
    let Some(script) = v8::Script::compile(&mut tc, code, built.as_ref()) else {
        let msg = tc.exception().map(|e| e.to_rust_string_lossy(&mut tc)).unwrap_or_default();
        return Err(format!("[{name}] compile: {msg}"));
    };
    if script.run(&mut tc).is_none() {
        let msg = tc.exception().map(|e| e.to_rust_string_lossy(&mut tc)).unwrap_or_default();
        return Err(format!("[{name}] threw: {msg}"));
    }
    Ok(())
}

pub fn eval(scope: &mut v8::HandleScope, src: &str) -> String {
    let mut tc = v8::TryCatch::new(scope);
    let Some(code) = v8::String::new(&mut tc, src) else { return String::new() };
    let Some(script) = v8::Script::compile(&mut tc, code, None) else { return String::new() };
    script.run(&mut tc).map(|v| v.to_rust_string_lossy(&mut tc)).unwrap_or_default()
}

pub fn eval_json<T: serde::de::DeserializeOwned + Default>(
    scope: &mut v8::HandleScope,
    src: &str,
) -> T {
    serde_json::from_str(&eval(scope, src)).unwrap_or_default()
}

fn drive_deadline() -> std::time::Instant {
    std::time::Instant::now() + std::time::Duration::from_secs(15)
}

const GRACE_ROUNDS: usize = 16;

fn pump_until(
    scope: &mut v8::HandleScope,
    max_rounds: usize,
    idle_wait: usize,
    until_cookies_settle: bool,
    deadline: std::time::Instant,
    stop: &super::options::StopWhen,
) -> usize {
    let mut total = 0;
    let mut idle = 0;
    let mut cookies = 0usize;
    let mut since_cookie = 0usize;
    let mut grace = 0usize;
    let mut satisfied = false;
    let mut rounds = 0;
    while rounds < max_rounds && std::time::Instant::now() < deadline {
        let landed = match stop {
            super::options::StopWhen::Idle => false,
            super::options::StopWhen::Cookie(name) => super::bridge::holds_cookie(name),
            super::options::StopWhen::Posted { min_body } => {
                super::bridge::posted_body_over(*min_body)
            }
        };
        if satisfied || landed {
            satisfied = true;
            grace += 1;
            if grace > GRACE_ROUNDS {
                break;
            }
        }
        // A framed document has its own queue, and it only advances when we say.
        let framed = super::frames::drain(scope)
            + eval(scope, "String(__pumpFrameInbox ? __pumpFrameInbox() : 0)")
                .parse::<usize>()
                .unwrap_or(0);
        let ran: usize = if until_cookies_settle {
            let raw = eval(scope, "__drainOnce() + ':' + ((globalThis.__COOKIES_SET||[]).length)");
            let (ran, seen) = raw.split_once(':').unwrap_or(("0", "0"));
            let waiting: i64 = ran.parse().unwrap_or(0);
            if waiting < 0 {
                std::thread::sleep(std::time::Duration::from_millis(1));
                continue;
            }
            let seen: usize = seen.parse().unwrap_or(0);
            if seen > cookies {
                cookies = seen;
                since_cookie = 0;
            } else if cookies > 0 {
                since_cookie += 1;
            }
            waiting as usize
        } else {
            let raw: i64 = eval(scope, "String(__drainOnce())").parse().unwrap_or(0);
            if raw < 0 {
                std::thread::sleep(std::time::Duration::from_millis(1));
                continue;
            }
            raw as usize
        };
        rounds += 1;
        scope.perform_microtask_checkpoint();
        let mut platform_ran = false;
        while super::env::pump_platform(scope) {
            platform_ran = true;
        }
        if platform_ran {
            scope.perform_microtask_checkpoint();
        }
        // Frame work counts as work, or the pump calls itself idle while a
        // framed document still has a queue to get through.
        let ran = ran + usize::from(platform_ran) + framed;
        total += ran;
        if since_cookie >= SETTLED_ROUNDS {
            break;
        }
        if ran == 0 {
            idle += 1;
            if idle > 3 {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            if idle >= idle_wait {
                break;
            }
        } else {
            idle = 0;
        }
    }
    total
}

const LIFECYCLE: &[&str] = &[
    "globalThis.__DOC_DYN && (globalThis.__DOC_DYN.readyState = 'interactive'); __fire('document','readystatechange');      __fire('document','DOMContentLoaded');",
    "globalThis.__DOC_DYN && (globalThis.__DOC_DYN.readyState = 'complete'); __fire('document','readystatechange');      __fire('window','load'); __fire('window','pageshow');",
];

pub fn drive_to_complete(scope: &mut v8::HandleScope, stop: &super::options::StopWhen) {
    let deadline = drive_deadline();
    scope.perform_microtask_checkpoint();
    for step in LIFECYCLE {
        eval(scope, step);
        scope.perform_microtask_checkpoint();
    }
    pump_until(scope, budget(), IDLE_WAIT, true, deadline, stop);
}

fn budget() -> usize {
    std::env::var("VERI_PUMP_ROUNDS").ok().and_then(|v| v.parse().ok()).unwrap_or(2_000)
}
