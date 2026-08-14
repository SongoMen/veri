use veri_core::url::{host_of, join, origin_of};

#[test]
fn host_lowercases_and_drops_userinfo() {
    assert_eq!(host_of("https://user:pw@Example.COM/a?b#c").as_deref(), Some("example.com"));
    assert_eq!(host_of("https://example.com").as_deref(), Some("example.com"));
}

#[test]
fn host_keeps_the_port() {
    assert_eq!(host_of("https://example.com:8443/x").as_deref(), Some("example.com:8443"));
}

#[test]
fn host_rejects_garbage() {
    assert_eq!(host_of("not-a-url"), None);
    assert_eq!(host_of("https://"), None);
    assert_eq!(host_of("https:///path"), None);
}

#[test]
fn origin_keeps_the_scheme() {
    assert_eq!(origin_of("http://example.com/a").as_deref(), Some("http://example.com"));
    assert_eq!(
        origin_of("https://example.com:8443/a").as_deref(),
        Some("https://example.com:8443")
    );
}

#[test]
fn origin_rejects_garbage() {
    assert_eq!(origin_of("example.com/a"), None);
    assert_eq!(origin_of("://example.com"), None);
}

#[test]
fn join_resolves_the_forms_a_page_emits() {
    let base = "https://x.test/dir/page.html?a=1";
    assert_eq!(join(base, "https://other.test/p"), "https://other.test/p");
    assert_eq!(join(base, "//other.test/p"), "https://other.test/p");
    assert_eq!(join(base, "/abs"), "https://x.test/abs");
    assert_eq!(join(base, "sub/path"), "https://x.test/dir/sub/path");
    assert_eq!(join(base, "?b=2"), "https://x.test/dir/page.html?b=2");
    assert_eq!(join(base, "#frag"), "https://x.test/dir/page.html?a=1#frag");
}

#[test]
fn join_resolves_against_a_base_carrying_credentials() {
    let base = "https://user:pass@x.test/dir/page.html";
    assert_eq!(join(base, "sub/path"), "https://x.test/dir/sub/path");
    assert_eq!(join(base, "/abs"), "https://x.test/abs");
    assert_eq!(join(base, "?b=2"), "https://x.test/dir/page.html?b=2");
    assert_eq!(join("https://user@X.TEST/a/b", "c"), "https://x.test/a/c");
}

#[test]
fn join_handles_a_bare_origin_as_the_root() {
    assert_eq!(join("https://x.test", "sub"), "https://x.test/sub");
    assert_eq!(join("https://x.test/", "sub"), "https://x.test/sub");
}

#[test]
fn join_keeps_the_scheme_and_port_of_the_page() {
    let base = "http://x.test:8080/a/b";
    assert_eq!(join(base, "/c"), "http://x.test:8080/c");
    assert_eq!(join(base, "c"), "http://x.test:8080/a/c");
    assert_eq!(join(base, "//y.test/c"), "http://y.test/c");
}
