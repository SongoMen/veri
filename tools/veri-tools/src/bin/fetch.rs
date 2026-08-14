use std::time::Instant;
use veri_tools::{main_with, ClientSpec, Flags};

#[tokio::main]
async fn main() -> std::process::ExitCode {
    main_with(run).await
}

fn how(r: &veri::Response) -> String {
    let cleared = match &r.cleared {
        Some(v) => format!("  [cleared {v}]"),
        None => String::new(),
    };
    let reused = if r.used_clearance { "  [reused clearance]" } else { "" };
    format!("{cleared}{reused}")
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let flags = Flags::parse(&["proxy", "cookie"]);

    let Some(url) = flags.positional_at(0) else {
        eprintln!(
            "usage: fetch <url> [identity] [--proxy <url>] [--cookie <n=v>] [--body] [--no-solver]"
        );
        return Err("no url given".into());
    };

    let client = ClientSpec {
        identity: flags.positional_at(1),
        proxy: flags.proxy(),
        solve: !flags.has("no-solver"),
        ..Default::default()
    }
    .build()?;
    let show_body = flags.has("body");

    if let Some(c) = flags.get("cookie") {
        let host = veri::host_of(&url).unwrap_or_default();
        client.set_cookie(&host, &c);
        println!("seeded cookie on {host}: {}", &c[..c.len().min(40)]);
    }

    let t = Instant::now();
    let r = client.get(&url).send().await?;
    println!(
        "{}  {}  {} bytes  via {}  rung {}{}  in {:?}",
        r.status,
        r.verdict,
        r.content_length(),
        r.identity,
        r.attempts,
        how(&r),
        t.elapsed(),
    );
    if show_body {
        println!("{}", r.text());
    }
    if r.is_ok() {
        Ok(())
    } else {
        Err(format!("verdict: {}", r.verdict).into())
    }
}
