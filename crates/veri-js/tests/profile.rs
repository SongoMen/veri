use veri_js::{vm, V8Solver};

#[test]
fn profile_is_embedded_and_parses() {
    let m = vm::profile_meta();
    assert!(
        m.chrome.starts_with(|c: char| c.is_ascii_digit()),
        "chrome version unreadable: {}",
        m.chrome
    );
    assert!(m.harvested_at.starts_with("20"), "harvest date: {}", m.harvested_at);
    assert!(m.bytes > 100_000, "profile looks truncated: {} bytes", m.bytes);
}

#[test]
fn the_profile_is_strict_json() {
    serde_json::from_str::<serde_json::Value>(vm::PROFILE)
        .expect("the bundled profile must be strict JSON, not merely valid JavaScript");
}

#[test]
fn a_default_solver_has_a_deadline() {
    assert!(
        V8Solver::new().seed("_x_opt").options().timeout.is_some(),
        "a solver with no deadline lets one non-terminating challenge wedge a thread"
    );
    assert!(!V8Solver::new().seed("_x_opt").options().diagnostics);
}

#[test]
fn an_explicit_option_beats_the_environment() {
    std::env::set_var("VERI_TIMEZONE", "Antarctica/Troll");

    let from_env = V8Solver::new().seed("_x_opt");
    assert_eq!(
        from_env.options().timezone.as_deref(),
        Some("Antarctica/Troll"),
        "the environment supplies the default"
    );

    let explicit = V8Solver::new().seed("_x_opt").timezone("Europe/Berlin");
    assert_eq!(
        explicit.options().timezone.as_deref(),
        Some("Europe/Berlin"),
        "and the option overrides it"
    );

    std::env::remove_var("VERI_TIMEZONE");
}
