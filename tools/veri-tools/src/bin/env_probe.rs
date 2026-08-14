//! Evaluates one expression in the browser environment and prints it.

use veri_js::vm::{self, Program, SolveOptions};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("usage: env_probe <probe.js>, one expression")?;
    let probe = std::fs::read_to_string(&path)?;
    let ua = std::env::var("PROBE_UA").unwrap_or_else(|_| veri_tools::chrome_ua().to_string());

    let payload = format!("globalThis.__VALUE = String(({probe}));");
    let out = vm::execute(
        Program { prelude: Some("__setGhosts(false);"), payload: &payload, ..Default::default() },
        "https://probe.local/",
        &ua,
        None,
        &SolveOptions::default(),
    )?;

    match out.value {
        Some(v) => println!("{v}"),
        None => return Err(format!("the probe threw: {}", out.errors.join("; ")).into()),
    }
    Ok(())
}
