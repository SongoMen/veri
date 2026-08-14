use veri_js::vm::extract::{
    config_field, extract_config_object, extract_inline_script_at, first_inline_script_at,
    instrument_catches, scripts, Script,
};

const PAGE: &str = r#"<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><script>
window._page_opt = { cvId: '3', cType: 'managed', cRay: '8f2a1b3c4d5e', md: 'a{b}c' };
var x = 1;
</script></body></html>"#;

#[test]
fn finds_the_config_object() {
    let opt = extract_config_object(PAGE, "_page_opt").expect("config");
    assert!(opt.starts_with("window._page_opt = {"));
    assert!(opt.ends_with("};"));
    assert!(opt.contains("8f2a1b3c4d5e"));
}

#[test]
fn a_brace_inside_a_string_does_not_end_the_object() {
    // `md: 'a{b}c'` would close the object one field early on naive matching.
    let opt = extract_config_object(PAGE, "_page_opt").unwrap();
    assert!(opt.contains("cRay"), "stopped early: {opt}");
    assert_eq!(opt.matches('{').count(), opt.matches('}').count());
}

#[test]
fn an_escaped_quote_does_not_end_the_string() {
    let html = r#"<script>window._page_opt = { a: 'it\'s }', b: 2 };</script>"#;
    let opt = extract_config_object(html, "_page_opt").expect("config");
    assert!(opt.contains("b: 2"), "stopped at the escaped quote: {opt}");
}

#[test]
fn absent_config_is_none_not_a_panic() {
    assert!(extract_config_object("<html>nothing here</html>", "_page_opt").is_none());
    assert!(extract_config_object("window._page_opt = { unterminated", "_page_opt").is_none());
    assert!(extract_config_object("", "_page_opt").is_none());
}

#[test]
fn finds_the_bootstrap_script() {
    let (src, line, col) = extract_inline_script_at(PAGE, "_page_opt").expect("bootstrap");
    assert!(src.contains("window._page_opt"));
    assert!(src.contains("var x = 1;"));
    assert!(!src.contains("<script"));
    // Numbered as the document numbers it, so stack frames match a browser's.
    assert_eq!((line, col), (1, 14));
}

#[test]
fn reads_a_single_field() {
    assert_eq!(config_field(PAGE, "_page_opt", "cRay").as_deref(), Some("8f2a1b3c4d5e"));
    assert_eq!(config_field(PAGE, "_page_opt", "cType").as_deref(), Some("managed"));
    assert_eq!(config_field(PAGE, "_page_opt", "nope"), None);
}

#[test]
fn catch_blocks_are_instrumented_in_place() {
    let (out, sites) = instrument_catches("try { a() } catch (e) { b() }");
    assert_eq!(sites.len(), 1);
    assert!(out.contains("catch (e) {try{__CAUGHT(e,0);}catch(_){}"));
    assert!(out.contains("b()"));
}

#[test]
fn a_destructured_catch_is_left_alone() {
    // `catch ({message})` has no identifier to hand to __CAUGHT.
    let (out, sites) = instrument_catches("try { a() } catch ({message}) { b() }");
    assert!(sites.is_empty());
    assert_eq!(out, "try { a() } catch ({message}) { b() }");
}

#[test]
fn instrumentation_survives_multibyte_source() {
    // Indexing by byte through a `char` boundary would panic here.
    let src = "const s = '日本語ダミー'; try { a() } catch (e) { b() }";
    let (out, sites) = instrument_catches(src);
    assert_eq!(sites.len(), 1);
    assert!(out.contains("日本語ダミー"));
}

#[test]
fn a_bare_catch_keyword_is_not_a_catch_block() {
    let (out, sites) = instrument_catches("const catcher = 1; promise.catch(fn);");
    assert!(sites.is_empty());
    assert_eq!(out, "const catcher = 1; promise.catch(fn);");
}

/// Externals matter: a page can put *all* its work in one, and
/// dropping it means executing a variable assignment and calling it a solve.
#[test]
fn scripts_are_returned_in_document_order() {
    let html = r#"<html><head>
        <script>var a=1;</script>
        <script data-cfasync="false" src="https://ct.example.com/c.js"></script>
        <script src='https://x.example.com/d.js'></script>
        <script></script>
      </head></html>"#;
    let got: Vec<Script> = scripts(html).into_iter().map(|(_, s)| s).collect();
    assert_eq!(
        got,
        vec![
            Script::Inline("var a=1;".into()),
            Script::External("https://ct.example.com/c.js".into()),
            Script::External("https://x.example.com/d.js".into()),
        ],
        "empty scripts are dropped and order is preserved"
    );
}

#[test]
fn each_script_keeps_its_own_id() {
    let html = r#"<html><head><script></script>
        <script id="challenge">var a=1;</script></head></html>"#;
    assert_eq!(scripts(html), vec![("challenge".into(), Script::Inline("var a=1;".into()))]);
}

#[test]
fn a_prefixed_attribute_does_not_answer_for_the_real_one() {
    let html = r#"<html><head><script data-src="https://lazy.example.com/x.js">var a=1;</script>
        </head></html>"#;
    assert_eq!(scripts(html), vec![(String::new(), Script::Inline("var a=1;".into()))]);
}

#[test]
fn the_first_inline_script_is_located_past_the_external_ones() {
    let html = "<html><head>\n<script src=\"https://x.example.com/a.js\"></script>\n  <script>var a=1;</script>\n</head></html>";
    assert_eq!(first_inline_script_at(html), Some((2, 10)));
}

#[test]
fn an_identifier_ending_in_catch_is_not_instrumented() {
    let src = "function mycatch(e){ return e; }";
    let (out, sites) = instrument_catches(src);
    assert_eq!(out, src, "the page's own function must not be rewritten");
    assert!(sites.is_empty());
}

#[test]
fn a_real_catch_block_is_still_instrumented() {
    let (out, sites) = instrument_catches("try{f()}catch(e){g()}");
    assert!(out.contains("__CAUGHT(e,0)"), "got {out}");
    assert_eq!(sites.len(), 1);
}

#[test]
fn a_key_that_is_a_suffix_of_another_key_reads_its_own_value() {
    let html = r#"<script>window._page_opt={cvId:'3',Id:'real'};</script>"#;
    assert_eq!(config_field(html, "_page_opt", "Id").as_deref(), Some("real"));
    assert_eq!(config_field(html, "_page_opt", "cvId").as_deref(), Some("3"));
}
