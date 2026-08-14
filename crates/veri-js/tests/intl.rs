//! `Intl.DateTimeFormat`.

use veri_js::vm::{self, SolveOptions};

fn probe(tz: &str, expr: &str) -> String {
    let src = format!("globalThis.__NET.push({{ kind: 'probe', url: String({expr}) }});");
    let out = vm::execute(
        vm::Program { payload: &src, ..Default::default() },
        "https://example.com/",
        "ua",
        None,
        &SolveOptions { timezone: Some(tz.to_string()), ..SolveOptions::default() },
    )
    .expect("the isolate must survive");
    out.net.iter().find(|n| n.kind == "probe").map(|n| n.url.clone()).unwrap_or_default()
}

#[test]
fn constructing_a_datetimeformat_does_not_abort() {
    assert_eq!(probe("UTC", "Intl.DateTimeFormat().resolvedOptions().timeZone"), "UTC");
    assert_eq!(
        probe("Asia/Tokyo", "Intl.DateTimeFormat().resolvedOptions().timeZone"),
        "Asia/Tokyo",
        "the zone must be the configured one, not the host's"
    );
    // The prototype route is the one a detector uses to dodge a per-instance patch.
    assert_eq!(
        probe("Asia/Tokyo", "Intl.DateTimeFormat.prototype.resolvedOptions.call(new Intl.DateTimeFormat()).timeZone"),
        "Asia/Tokyo"
    );
}

#[test]
fn number_and_collator_answer_instead_of_throwing() {
    let guard = |e: &str| {
        format!("(function(){{try{{return {e};}}catch(err){{return 'threw: '+err;}}}})()")
    };
    assert_eq!(
        probe("UTC", &guard("new Intl.NumberFormat('en-US').format(1234567.5)")),
        "1,234,567.5"
    );
    assert_eq!(probe("UTC", &guard("new Intl.Collator('en-US').compare('a','b')")), "-1");
    assert_eq!(
        probe("UTC", &guard("Intl.NumberFormat().resolvedOptions().numberingSystem")),
        "latn"
    );
}

#[test]
fn dst_is_modelled_for_the_eu_and_us_rules() {
    let jul = "new Date('2026-07-15T12:00:00Z').getTimezoneOffset()";
    let jan = "new Date('2026-01-15T12:00:00Z').getTimezoneOffset()";

    assert_eq!(probe("Europe/Berlin", jul), "-120", "CEST");
    assert_eq!(probe("Europe/Berlin", jan), "-60", "CET");

    assert_eq!(probe("America/New_York", jul), "240", "EDT");
    assert_eq!(probe("America/New_York", jan), "300", "EST");

    // No DST rule: the same all year.
    assert_eq!(probe("Asia/Tokyo", jul), "-540");
    assert_eq!(probe("Asia/Tokyo", jan), "-540");
}

#[test]
fn date_renders_in_the_configured_zone() {
    let s = probe("Europe/Berlin", "new Date('2026-07-15T12:00:00Z')");
    assert!(s.contains("14:00:00"), "wall clock should be UTC+2 in July: {s}");
    assert!(s.contains("GMT+0200"), "{s}");
    assert!(s.contains("Central European Summer Time"), "{s}");
}
