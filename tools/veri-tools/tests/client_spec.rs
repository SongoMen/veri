use veri_tools::*;

#[test]
fn a_spec_with_no_identity_keeps_the_default_ladder() {
    let c = ClientSpec::default().build().unwrap();
    assert!(c.is_laddering());
}

#[test]
fn a_pinned_identity_disables_laddering() {
    let spec = ClientSpec { identity: Some("Firefox143".into()), ..Default::default() };
    assert_eq!(spec.build().unwrap().ladder(), vec!["Firefox143"]);
}

#[test]
fn a_ladder_is_used_when_no_identity_is_pinned() {
    let spec =
        ClientSpec { ladder: vec!["Safari18".into(), "Chrome143".into()], ..Default::default() };
    assert_eq!(spec.build().unwrap().ladder(), vec!["Safari18", "Chrome143"]);
}

#[test]
fn an_unknown_identity_is_an_error_rather_than_a_silent_default() {
    let spec = ClientSpec { identity: Some("Nonesuch".into()), ..Default::default() };
    assert!(spec.build().is_err());
}
