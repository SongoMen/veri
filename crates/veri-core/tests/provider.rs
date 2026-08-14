use veri_core::{provider, Headers};

#[test]
fn a_prefixed_provider_header_is_matched_whatever_its_casing() {
    let lower = Headers::new(vec![("x-px-block".into(), "1".into())]);
    let upper = Headers::new(vec![("X-PX-Block".into(), "1".into())]);
    assert_eq!(provider::hints(&lower), ["perimeterx"]);
    assert_eq!(provider::hints(&upper), ["perimeterx"], "the prefix branch ignored casing");
}

#[test]
fn an_exact_provider_header_is_matched_whatever_its_casing() {
    let h = Headers::new(vec![("CF-Ray".into(), "abc".into())]);
    assert_eq!(provider::hints(&h), ["cloudflare"]);
}

#[test]
fn an_unknown_server_is_reported_rather_than_guessed() {
    let h = Headers::new(vec![("server".into(), "nginx".into())]);
    assert_eq!(provider::hints(&h), ["server=nginx"]);
}
