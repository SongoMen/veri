//! Reports the browser-environment surface a real challenge demands. Runs the
//! same `vm::solve` the library does and only formats the result, a recorder
//! that drifts from the thing it records is worse than no recorder.

use std::path::PathBuf;
use veri_js::vm::{self, SolveOptions};

struct Opts {
    page: String,
    payload: Option<String>,
    capture: Option<PathBuf>,
    config: Option<String>,
}

fn parse() -> Opts {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut positional = Vec::new();
    let mut capture = None;
    let mut config = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--capture" => capture = it.next().map(PathBuf::from),
            "--config" => config = it.next().cloned(),
            "-h" | "--help" => {
                eprintln!(
                    "usage: veri-recorder <page.html> [orchestrate.js] [--capture <dir>] \
                     [--config <global>]\n\n\
                     Runs a captured page and reports the environment surface it touched.\n\
                     --capture writes the scripts it loaded and the layers it decoded into\n\
                     <dir>/loaded and <dir>/decoded. --config names a global the page\n\
                     declares its configuration on, seeded before its bootstrap runs."
                );
                std::process::exit(0);
            }
            _ => positional.push(a.clone()),
        }
    }
    let Some(page) = positional.first().cloned() else {
        eprintln!("usage: veri-recorder <page.html> [orchestrate.js] [--capture <dir>]");
        std::process::exit(2);
    };
    Opts { page, payload: positional.get(1).cloned(), capture, config }
}

fn main() -> std::process::ExitCode {
    let opts = parse();

    let html = match std::fs::read_to_string(&opts.page) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("could not read {}: {e}", opts.page);
            return std::process::ExitCode::FAILURE;
        }
    };
    let payload = match &opts.payload {
        None => String::new(),
        Some(path) => match std::fs::read_to_string(path) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("could not read {path}: {e}");
                return std::process::ExitCode::FAILURE;
            }
        },
    };
    println!("== veri-js recorder ==");
    println!("challenge page : {} ({} bytes)", opts.page, html.len());
    match &opts.payload {
        Some(path) => println!("orchestrate VM : {path} ({} bytes)", payload.len()),
        None => println!("orchestrate VM : none, the page's own scripts only"),
    }
    match &opts.config {
        Some(name) => println!("seeded config  : window.{name}"),
        None => println!("seeded config  : none, the page's scripts as they are"),
    }
    let meta = vm::profile_meta();
    println!("profile        : Chrome {} harvested {}\n", meta.chrome, meta.harvested_at);

    let options = SolveOptions {
        diagnostics: true,
        capture_dir: opts.capture.clone(),
        trace_catch: true,
        timeout: None,
        ..SolveOptions::default()
    };

    let seed = opts.config.as_ref().and_then(|n| vm::extract_config_object(&html, n));
    let found = opts.config.as_ref().and_then(|n| vm::extract_inline_script_at(&html, n));
    let watch: Vec<&str> = opts.config.iter().map(String::as_str).collect();
    let out = match vm::execute(
        vm::Program {
            seed: seed.as_deref(),
            bootstrap: found.as_ref().map(|(src, _, _)| src.as_str()),
            bootstrap_at: found.as_ref().map_or((0, 0), |(_, l, c)| (*l, *c)),
            payload: &payload,
            watch: &watch,
            ..Default::default()
        },
        "https://example.com/",
        &meta.user_agent,
        None,
        &options,
    ) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("FATAL {e}");
            return std::process::ExitCode::FAILURE;
        }
    };

    println!("ran in {:?}, {} recorded accesses\n", out.elapsed, out.records);

    let Some(d) = out.diagnostics else {
        eprintln!("no diagnostics were collected");
        return std::process::ExitCode::FAILURE;
    };

    section("operations", &d.operations_by_kind, 32);
    section("MISSING surface (the worklist)", &d.missing_surface, 60);
    section("unresolved globals", &d.global_misses, 40);
    section("satisfied by env.js", &d.satisfied_surface, 25);
    section("invocations", &d.invocations, 25);

    if !d.caught.is_empty() {
        println!("\n-- exceptions the challenge swallowed ({}) --", d.caught.len());
        for e in d.caught.iter().take(20) {
            println!("  {e}");
        }
    }
    if !out.errors.is_empty() {
        println!("\n-- errors that escaped ({}) --", out.errors.len());
        for e in &out.errors {
            println!("  {e}");
        }
    }
    if !d.rendered.is_empty() {
        println!("\n-- rendered into the DOM --");
        for r in d.rendered.iter().take(20) {
            println!("  {r}");
        }
    }

    println!("\n-- decoded layers --");
    println!("  {} fragments", d.decoded_fragments);
    if let Some(dir) = &opts.capture {
        println!("  written to {}/decoded", dir.display());
    } else {
        println!("  (pass --capture <dir> to write them out)");
    }

    println!("\n-- intercepted network intent --");
    if out.net.is_empty() {
        println!("  none");
    }
    for n in &out.net {
        println!("  {:<8} {} {}", n.kind, n.method.as_deref().unwrap_or("GET"), n.url);
    }
    std::process::ExitCode::SUCCESS
}

fn section(title: &str, rows: &[(String, usize)], limit: usize) {
    println!("\n-- {title} ({} distinct) --", rows.len());
    for (path, n) in rows.iter().take(limit) {
        println!("  {n:>6}  {path}");
    }
    if rows.len() > limit {
        println!("  ... {} more", rows.len() - limit);
    }
}
