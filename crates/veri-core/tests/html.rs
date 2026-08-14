use veri_core::html::{attr, script_srcs};

#[test]
fn quoting_is_optional_and_either_quote_works() {
    assert_eq!(attr("<script src=\"/a.js\">", "src").as_deref(), Some("/a.js"));
    assert_eq!(attr("<script src='/a.js'>", "src").as_deref(), Some("/a.js"));
    assert_eq!(attr("<script src=/a.js>", "src").as_deref(), Some("/a.js"));
    assert_eq!(attr("<script src=/a.js defer>", "src").as_deref(), Some("/a.js"));
}

#[test]
fn the_name_is_matched_whatever_its_casing() {
    assert_eq!(attr("<SCRIPT SRC=\"/a.js\">", "src").as_deref(), Some("/a.js"));
}

#[test]
fn a_prefixed_attribute_does_not_answer_for_the_real_one() {
    assert_eq!(attr("<script data-src=\"/lazy.js\">", "src"), None);
    assert_eq!(
        attr("<script data-src=\"/lazy.js\" src=\"/real.js\">", "src").as_deref(),
        Some("/real.js")
    );
}

#[test]
fn a_value_that_looks_like_the_name_is_not_the_name() {
    assert_eq!(attr("<script data-x=\"src=/no.js\">", "src"), None);
}

#[test]
fn a_missing_attribute_is_none() {
    assert_eq!(attr("<script defer>", "src"), None);
    assert_eq!(attr("", "src"), None);
}

#[test]
fn every_script_src_is_listed_in_order() {
    let html = "<html><head><script>inline</script>\
                <script src=\"/a.js\" defer></script>\
                <script src='https://cdn.example.com/b.js'></script></head></html>";
    assert_eq!(script_srcs(html), ["/a.js", "https://cdn.example.com/b.js"]);
}

#[test]
fn a_truncated_tag_is_read_and_ends_the_scan() {
    assert_eq!(script_srcs("<script src=\"/a.js\""), ["/a.js"]);
    assert!(script_srcs("<script").is_empty());
    assert!(script_srcs("no scripts here").is_empty());
}

#[test]
fn spaces_around_the_equals_are_allowed() {
    assert_eq!(attr("<script src = \"/a.js\">", "src").as_deref(), Some("/a.js"));
    assert_eq!(attr("<script src= '/a.js'>", "src").as_deref(), Some("/a.js"));
    assert_eq!(attr("<script src =/a.js>", "src").as_deref(), Some("/a.js"));
}
