use std::time::Instant;
use veri::{Client, Verdict};
use veri_tools::{main_with, ClientSpec, Flags};

const FALLBACK_IDENTITY: &str = "OkHttp5";

struct Results {
    passed: usize,
    failed: usize,
    skipped: usize,
    reached: bool,
    seen: Vec<String>,
}

impl Results {
    fn pass(&mut self, msg: &str) {
        self.passed += 1;
        println!("   PASS  {msg}");
    }
    fn fail(&mut self, msg: &str) {
        self.failed += 1;
        println!("   FAIL  {msg}");
    }
    fn skip(&mut self, msg: &str) {
        self.skipped += 1;
        println!("   SKIP  {msg}");
    }
}

struct Opts {
    target: Option<String>,
    identity: Option<String>,
    proxy: Option<String>,
}

fn parse_opts() -> Opts {
    let flags = Flags::parse(&["proxy"]);
    Opts { target: flags.positional_at(0), identity: flags.positional_at(1), proxy: flags.proxy() }
}

fn fronted_by(r: &veri::ProbeReport) -> String {
    match (r.protection, &r.error) {
        (Some(p), _) => format!("  [{p}]"),
        // "unreachable" alone reads as a dead host when it is usually the proxy.
        (None, Some(e)) => format!("  {e}"),
        (None, None) if !r.hints.is_empty() => format!("  ({})", r.hints.join(", ")),
        (None, None) => String::new(),
    }
}

fn client_for(
    identity: Option<&str>,
    solver: bool,
    proxy: Option<&str>,
) -> Result<Client, veri::Error> {
    ClientSpec {
        identity: identity.map(str::to_string),
        proxy: proxy.map(str::to_string),
        solve: solver,
        ..Default::default()
    }
    .build()
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    main_with(run).await
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let opts = parse_opts();
    let Some(target) = opts.target.clone() else {
        eprintln!(
            "usage: walkthrough <url> [identity] [--proxy <url>]\n\n\
             Name a host you are authorised to test against."
        );
        return Err("no url given".into());
    };
    let Opts { identity: pinned, proxy, .. } = opts;
    let mut challenged_identity = pinned.clone();
    let host = veri::host_of(&target).unwrap_or_default();

    println!("veri walkthrough");
    println!("  target   : {target}");
    match &proxy {
        Some(p) => println!("  proxy    : {}", p.split('@').next_back().unwrap_or("set")),
        None => {
            println!("  proxy    : none (direct)");
        }
    }

    let mut r = Results { passed: 0, failed: 0, skipped: 0, reached: false, seen: Vec::new() };
    let client = client_for(None, true, proxy.as_deref())?;

    println!("1. Fetch: the client picks an identity for you");
    let t = Instant::now();
    match client.get(&target).send().await {
        Ok(res) => {
            println!(
                "      {} · {} bytes · via {} · rung {} · {:?}",
                res.verdict,
                res.content_length(),
                res.identity,
                res.attempts,
                t.elapsed()
            );
            if res.is_ok() && res.content_length() > 200 {
                r.reached = true;
                r.pass("got a real response");
            } else {
                r.fail("response was not usable");
            }
        }
        Err(e) => {
            if let veri::Error::Exhausted { tried, .. } = &e {
                for (_, v) in tried {
                    let v = v.to_string();
                    if !r.seen.contains(&v) {
                        r.seen.push(v);
                    }
                }
            }
            r.fail(&format!("{e}"));
            // The egress never reached the host, so nothing below is about it.
            if e.transport_error().is_some_and(|t| t.is_proxy()) {
                println!(
                    "   note     : the proxy refused the connection, so the host was never reached"
                );
            }
        }
    }

    println!("\n2. Probe: what does each identity actually get?");
    match client.probe(&target).await {
        Ok(rows) => {
            for r in &rows {
                println!(
                    "      {:<12} {:<11} http={:<4} {:>6}ms{}",
                    r.identity.name,
                    r.verdict.to_string(),
                    r.status,
                    r.elapsed.as_millis(),
                    fronted_by(r)
                );
            }
            if challenged_identity.is_none() {
                challenged_identity = rows
                    .iter()
                    .find(|r| r.verdict == Verdict::Challenged)
                    .map(|r| r.identity.name.to_string());
            }
            let ok = rows.iter().filter(|r| r.verdict.is_ok()).count();
            println!("      {ok}/{} pass", rows.len());
            if ok > 0 {
                r.pass("at least one identity passes");
            } else {
                r.fail("no identity passes");
            }
        }
        Err(e) => r.fail(&format!("{e}")),
    }

    println!("\n3. Memory: the client remembers what worked for this host");
    match client.preferred_identity(&host) {
        Some(name) => {
            println!("      {host} → {name}");
            r.pass("preference recorded");
        }
        None => r.fail("no preference was learned"),
    }

    println!("\n4. Session reuse: repeat fetches should be fast");
    let mut times = Vec::new();
    for i in 1..=4 {
        let t = Instant::now();
        match client.get(&target).send().await {
            Ok(res) => {
                let ms = t.elapsed().as_millis();
                times.push(ms);
                println!(
                    "      {i}. {} · {ms}ms{}",
                    res.verdict,
                    if res.used_clearance { " · reused clearance" } else { "" }
                );
            }
            Err(e) => println!("      {i}. error: {e}"),
        }
    }
    if times.len() == 4 {
        r.pass("repeat fetches all succeeded");
    } else {
        r.fail("a repeat fetch failed");
    }

    println!("\n5. Errors: bad input is rejected, not silently accepted");
    match client.get("not-a-url").send().await {
        Err(e) => {
            println!("      {e}");
            r.pass("bad url rejected");
        }
        Ok(_) => r.fail("bad url was accepted"),
    }

    println!("\n6. Challenge WITHOUT a solver");
    if !r.reached {
        r.skip("target is not reachable");
        println!("\n7. Same request WITH a solver: should now succeed");
        r.skip("target is not reachable");
        return finish(&r, &target);
    }
    let challenged_identity = challenged_identity.unwrap_or_else(|| FALLBACK_IDENTITY.to_string());
    println!("   using {challenged_identity}, which this host challenges");
    let no_solver = client_for(Some(&challenged_identity), false, proxy.as_deref())?;
    let challenged = match no_solver.get(&target).send().await {
        Err(e) => {
            println!("      {e}");
            if e.saw_challenge() {
                r.pass("challenge surfaced as an error");
                true
            } else {
                r.pass("blocked, and reported honestly (not solvable)");
                false
            }
        }
        Ok(res) if res.is_ok() => {
            println!("      {}, this identity is not being challenged here", res.verdict);
            r.skip("no challenge to solve (try a different identity or proxy)");
            false
        }
        Ok(res) => {
            println!("      {}", res.verdict);
            r.pass("non-ok verdict reported");
            true
        }
    };

    println!("\n7. Same request WITH a solver: should now succeed");
    if !challenged {
        r.skip("no challenge was served, so there is nothing for the solver to do");
    } else {
        let with_solver = client_for(Some(&challenged_identity), true, proxy.as_deref())?;
        let t = Instant::now();
        match with_solver.get(&target).send().await {
            Ok(res) => {
                println!(
                    "      {} · {} bytes · cleared={:?} · {:?}",
                    res.verdict,
                    res.content_length(),
                    res.cleared,
                    t.elapsed()
                );
                if res.verdict == Verdict::Ok && res.cleared.is_some() {
                    r.pass("challenge solved");
                } else if res.verdict == Verdict::Ok {
                    r.pass("succeeded (no solve was needed on retry)");
                } else {
                    r.fail("solver did not clear the challenge");
                }
            }
            Err(e) if e.saw_challenge() => {
                println!("      {e}");
                let host = veri::host_of(&target).unwrap_or_default();
                if with_solver.has_clearance(&host) {
                    println!("      a clearance cookie was issued for {host}");
                    r.fail(
                        "clearance was issued but the page still challenged, so the\n         \
                         challenge was not accepted. Holding the cookie is not the same as\n         \
                         passing: check whether real Chrome opens this url from this address\n         \
                         before concluding anything about the host.",
                    );
                } else {
                    r.fail("solver did not obtain clearance");
                }
            }
            Err(e) => r.fail(&format!("{e}")),
        }
    }

    finish(&r, &target)
}

fn finish(r: &Results, target: &str) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n────────────────────────────────");
    println!("  passed {}   failed {}   skipped {}", r.passed, r.failed, r.skipped);

    if !r.reached {
        println!("\n  TARGET NOT REACHED, {target}");
        println!("  Any passes above are offline checks and say nothing about this host.");
        if !r.seen.is_empty() {
            println!("  Verdicts seen: {}", r.seen.join(", "));
        }
        return Err("target not reached".into());
    }

    if r.failed == 0 {
        println!("  all checks OK");
        Ok(())
    } else {
        Err(format!("{} check(s) failed", r.failed).into())
    }
}
