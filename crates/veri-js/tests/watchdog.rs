//! The solver executes adversary-supplied code on the calling thread. These
//! tests are about it giving that thread back.

use std::time::{Duration, Instant};
use veri_js::vm::{self, SolveOptions};

fn opts(timeout: Option<Duration>) -> SolveOptions {
    SolveOptions { timeout, ..SolveOptions::default() }
}

fn run(payload: &str, options: &SolveOptions) -> Result<vm::SolveOutput, vm::SolveFailure> {
    vm::execute(
        vm::Program { payload, ..Default::default() },
        "https://example.com/",
        "ua",
        None,
        options,
    )
}

#[test]
fn a_non_terminating_challenge_is_terminated() {
    let started = Instant::now();
    let result = run("while (true) { }", &opts(Some(Duration::from_millis(600))));

    match result {
        Err(vm::SolveFailure::TimedOut(_)) => {}
        Err(e) => panic!("expected a timeout, got {e}"),
        Ok(_) => panic!("an infinite loop must not report success"),
    }
    assert!(
        started.elapsed() < Duration::from_secs(20),
        "the watchdog did not fire: took {:?}",
        started.elapsed()
    );
}

#[test]
fn a_wedged_timer_callback_is_terminated() {
    let result = run(
        "setTimeout(function () { while (true) {} }, 0);",
        &opts(Some(Duration::from_millis(600))),
    );
    assert!(
        matches!(result, Err(vm::SolveFailure::TimedOut(_))),
        "expected a timeout, got {result:?}"
    );
}

#[test]
fn an_ordinary_payload_runs_to_completion() {
    let out = run("globalThis.__ran = 1;", &opts(Some(Duration::from_secs(30))))
        .expect("a trivial payload should not time out");
    assert!(out.elapsed < Duration::from_secs(30));
}

/// The isolate is fresh each time, but the host state around it is
/// thread-local.
#[test]
fn the_isolate_recovers_after_a_termination() {
    let wedged = run("while (true) {}", &opts(Some(Duration::from_millis(400))));
    assert!(matches!(wedged, Err(vm::SolveFailure::TimedOut(_))));

    // Same thread, immediately afterwards.
    let after = run("globalThis.__ran = 1;", &opts(Some(Duration::from_secs(30))));
    assert!(after.is_ok(), "a terminated solve poisoned the next one: {after:?}");
}

#[test]
fn diagnostics_are_absent_unless_asked_for() {
    let plain = run("1;", &opts(None)).unwrap();
    assert!(plain.diagnostics.is_none());
    assert_eq!(plain.records, 0, "the access recorder ran without being asked");

    let verbose =
        run("1;", &SolveOptions { diagnostics: true, timeout: None, ..SolveOptions::default() })
            .unwrap();
    assert!(verbose.diagnostics.is_some());
}

#[test]
fn a_page_that_declares_nothing_is_not_a_challenge() {
    use veri_core::{HttpBridge, Solver};
    struct Dead;
    impl HttpBridge for Dead {
        fn request(&self, _: &str, _: &str, _: &str) -> (u16, String) {
            (0, String::new())
        }
    }
    let err = veri_js::V8Solver::new()
        .seed("_x_opt")
        .solve("<html>ordinary</html>", "https://example.com/", "ua", std::sync::Arc::new(Dead))
        .unwrap_err();
    assert!(matches!(err, veri_core::SolveError::NotAChallenge), "got {err:?}");
}
