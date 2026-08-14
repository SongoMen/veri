use std::collections::BTreeSet;
use veri::{ProbeReport, Verdict};
use veri_tools::{main_with, ClientSpec, Flags};

struct Egress {
    label: String,
    proxy: Option<String>,
}

impl Egress {
    fn direct() -> Self {
        Self { label: "direct".into(), proxy: None }
    }
    fn proxied(url: &str) -> Self {
        Self {
            label: url.split('@').next_back().unwrap_or(url).to_string(),
            proxy: Some(url.to_string()),
        }
    }
}

#[derive(Default)]
struct Opts {
    urls: Vec<String>,
    proxies: Vec<String>,
    identities: Vec<String>,
    direct: bool,
    solve: bool,
}

fn parse() -> Opts {
    let flags = Flags::parse(&["url", "proxy", "identity"]);
    let mut proxies: Vec<String> =
        std::env::var("VERI_PROXY").ok().filter(|s| !s.is_empty()).into_iter().collect();
    for p in flags.all("proxy") {
        if !proxies.contains(&p) {
            proxies.push(p);
        }
    }
    Opts {
        urls: flags.all("url").into_iter().chain(flags.positional.iter().cloned()).collect(),
        proxies,
        identities: flags.all("identity"),
        direct: flags.has("direct"),
        solve: flags.has("solve"),
    }
}

fn symbol(r: &ProbeReport) -> &'static str {
    match r.verdict {
        Verdict::Ok if r.cleared => "solved",
        Verdict::Ok => "ok",
        Verdict::Challenged => "chall",
        Verdict::Blocked => "block",
        Verdict::RateLimited => "rate",
        Verdict::Unreachable => "unrch",
        Verdict::Other(_) => "err",
    }
}

fn fronted_by(r: &ProbeReport) -> String {
    match (r.protection, r.verdict.is_ok()) {
        (Some(p), _) => format!("  [{p}]"),
        // "unreachable" alone reads as a dead host when it is usually the proxy.
        (None, false) if r.error.is_some() => format!("  {}", r.error.as_deref().unwrap_or("")),
        (None, false) if !r.hints.is_empty() => format!("  ({})", r.hints.join(", ")),
        _ => String::new(),
    }
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    main_with(run).await
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let opts = parse();
    if opts.urls.is_empty() {
        eprintln!(
            "usage: check [--url <url>]... [--proxy <url>]... [--identity <name>]... \
             [--direct] [--solve]"
        );
        return Err("no urls given".into());
    }

    let mut egresses: Vec<Egress> = Vec::new();
    if opts.direct || opts.proxies.is_empty() {
        egresses.push(Egress::direct());
    }
    for p in &opts.proxies {
        egresses.push(Egress::proxied(p));
    }

    let identities: Vec<String> = if opts.identities.is_empty() {
        veri::identity::KNOWN.iter().map(|i| i.name.to_string()).collect()
    } else {
        opts.identities.clone()
    };

    println!(
        "veri check: {} url(s) x {} egress x {} identities = {} requests\n",
        opts.urls.len(),
        egresses.len(),
        identities.len(),
        opts.urls.len() * egresses.len() * identities.len()
    );
    if opts.solve {
        println!("  solving enabled: challenges will be attempted (slower)");
        println!("  browser profile: {}\n", veri_tools::profile_line());
    }

    let mut recommendations: Vec<String> = Vec::new();
    let mut unreachable: Vec<String> = Vec::new();
    let mut any_usable = false;

    for eg in &egresses {
        println!("── egress: {} {}", eg.label, "─".repeat(44usize.saturating_sub(eg.label.len())));

        for url in &opts.urls {
            let host = veri::host_of(url).unwrap_or_else(|| url.clone());
            let shown = if url.chars().count() > 58 {
                format!("{}…", url.chars().take(57).collect::<String>())
            } else {
                url.clone()
            };
            println!("\n  {shown}");

            let spec = ClientSpec {
                ladder: identities.clone(),
                proxy: eg.proxy.clone(),
                solve: opts.solve,
                ..Default::default()
            };
            let client = match spec.build() {
                Ok(c) => c,
                Err(e) => {
                    println!("    client error: {e}");
                    continue;
                }
            };

            let reports: Vec<ProbeReport> = match if opts.solve {
                client.probe_with_clearing(url).await
            } else {
                client.probe(url).await
            } {
                Ok(r) => r,
                Err(e) => {
                    println!("    unreachable: {e}");
                    unreachable.push(format!("{host} via {}", eg.label));
                    continue;
                }
            };

            for r in &reports {
                println!(
                    "    {:<12} {:<6} http={:<4} {:>7}b {:>6}ms{}",
                    r.identity.name,
                    symbol(r),
                    r.status,
                    r.bytes,
                    r.elapsed.as_millis(),
                    fronted_by(r)
                );
            }

            let ok: Vec<&ProbeReport> = reports.iter().filter(|r| r.verdict.is_ok()).collect();
            if ok.is_empty() {
                let hints: Vec<String> = reports
                    .iter()
                    .flat_map(|r| r.hints.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
                println!(
                    "    → nothing worked{}",
                    if hints.is_empty() {
                        String::new()
                    } else {
                        format!("; fronted by: {}", hints.join(", "))
                    }
                );
                unreachable.push(format!("{host} via {}", eg.label));
            } else {
                any_usable = true;
                let best = ok
                    .iter()
                    .filter(|r| !r.cleared)
                    .min_by_key(|r| r.elapsed)
                    .or_else(|| ok.iter().min_by_key(|r| r.elapsed));
                if let Some(b) = best {
                    recommendations.push(format!(
                        "{:<26} via {:<22} → {}{}",
                        host,
                        eg.label,
                        b.identity.name,
                        if b.cleared { " (needs solver)" } else { "" }
                    ));
                }
            }
        }
        println!();
    }

    println!("══ summary ══");
    if recommendations.is_empty() {
        println!("  nothing reachable.");
    } else {
        println!("  recommended settings:");
        for r in &recommendations {
            println!("    {r}");
        }
    }
    if !unreachable.is_empty() {
        println!("\n  unreachable:");
        for u in &unreachable {
            println!("    {u}");
        }
        if !opts.solve {
            println!("\n  some of these may be challenges rather than blocks;");
            println!("  re-run with --solve to find out.");
        }
    }

    if any_usable {
        Ok(())
    } else {
        Err("nothing reachable".into())
    }
}
