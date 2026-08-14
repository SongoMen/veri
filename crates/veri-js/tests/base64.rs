//! One encoder and one decoder now serve `btoa`/`atob`, the canvas fallback and
//! the bytes the bridge carries a wasm module in, so a mistake in either is a
//! mistake in all three.

mod common;
use common::{echoed, CHROME_UA};

fn probe(expr: &str) -> String {
    echoed(
        &format!(
            "<html><body><script>\
             var v;\
             try {{ v = String({expr}); }} catch (e) {{ v = 'THREW ' + e.message; }}\
             var x = new XMLHttpRequest();\
             x.open('GET', 'https://echo.test/' + encodeURIComponent(v));\
             x.send();\
             </script></body></html>"
        ),
        CHROME_UA,
    )
}

#[test]
fn btoa_matches_the_standard_padding() {
    assert_eq!(probe("btoa('hello world')"), "aGVsbG8gd29ybGQ=");
    assert_eq!(probe("btoa('abc')"), "YWJj");
    assert_eq!(probe("btoa('ab')"), "YWI=");
    assert_eq!(probe("btoa('a')"), "YQ==");
    assert_eq!(probe("btoa('')"), "");
}

#[test]
fn atob_reverses_it() {
    assert_eq!(probe("atob('aGVsbG8gd29ybGQ=')"), "hello world");
    assert_eq!(probe("atob('YWJj')"), "abc");
    assert_eq!(probe("atob('YWI=')"), "ab");
    assert_eq!(probe("atob('YQ==')"), "a");
}

#[test]
fn high_and_zero_bytes_survive() {
    assert_eq!(probe("btoa(String.fromCharCode(0, 255, 128, 1))"), "AP+AAQ==");
    assert_eq!(
        probe("atob('AP+AAQ==').split('').map(function (c) { return c.charCodeAt(0); }).join(',')"),
        "0,255,128,1"
    );
    assert_eq!(probe("__b64(new Uint8Array([0, 97, 115, 109]))"), "AGFzbQ==");
    assert_eq!(probe("Array.from(__unb64('AGFzbQ==')).join(',')"), "0,97,115,109");
}

#[test]
fn every_byte_round_trips() {
    assert_eq!(
        probe(
            "(function () { \
               var b = new Uint8Array(256); \
               for (var i = 0; i < 256; i++) b[i] = i; \
               var back = __unb64(__b64(b)); \
               if (back.length !== 256) return 'length ' + back.length; \
               for (var j = 0; j < 256; j++) if (back[j] !== j) return 'differs at ' + j; \
               return 'identical'; \
             })()"
        ),
        "identical"
    );
}

/// A multipart boundary may not contain `+` or `/`, so that alphabet is a
/// different one on purpose and must not be folded into this.
#[test]
fn the_boundary_alphabet_is_not_the_base64_one() {
    assert_eq!(probe("/[+/]/.test(__formBoundary())"), "false");
    assert_eq!(probe("__formBoundary().startsWith('----WebKitFormBoundary')"), "true");
    assert_eq!(probe("__B64_CHARS.length"), "64");
    assert_eq!(probe("__B64_CHARS.endsWith('+/')"), "true");
}
