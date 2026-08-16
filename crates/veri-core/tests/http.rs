use veri_core::http::{base64, content_type_for, percent_encode};

#[test]
fn base64_pads_every_remainder() {
    assert_eq!(base64(b""), "");
    assert_eq!(base64(b"f"), "Zg==");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(base64(b"foo"), "Zm9v");
    assert_eq!(base64(b"foobar"), "Zm9vYmFy");
}

#[test]
fn base64_survives_bytes_that_are_not_text() {
    assert_eq!(base64(&[0x00, 0xff, 0x80]), "AP+A");
    assert_eq!(base64(&[0xfb, 0xff]), "+/8=");
}

#[test]
fn percent_encoding_keeps_only_the_unreserved_set() {
    assert_eq!(percent_encode("aZ0-_.~"), "aZ0-_.~");
    assert_eq!(percent_encode("a b/c?d=e&f"), "a%20b%2Fc%3Fd%3De%26f");
    assert_eq!(percent_encode("é"), "%C3%A9");
}

#[test]
fn a_multipart_body_names_its_own_content_type() {
    let body = "------WebKitFormBoundaryAbC123\r\nContent-Disposition: form-data\r\n\r\nx\r\n";
    assert_eq!(
        content_type_for(body),
        "multipart/form-data; boundary=----WebKitFormBoundaryAbC123"
    );
}

#[test]
fn anything_else_is_plain_text() {
    assert_eq!(content_type_for("a=1&b=2"), "text/plain;charset=UTF-8");
    assert_eq!(content_type_for(""), "text/plain;charset=UTF-8");
    // Leading dashes are not enough: the boundary has to be one the SDK wrote.
    assert_eq!(content_type_for("--just-a-dashed-line\r\n"), "text/plain;charset=UTF-8");
}

#[test]
fn base64_round_trips_including_the_padded_tails() {
    use veri_core::http::{base64, unbase64};
    for case in [
        &b""[..],
        &b"f"[..],
        &b"fo"[..],
        &b"foo"[..],
        &b"foob"[..],
        &b"fooba"[..],
        &b"foobar"[..],
        &[0u8, 255, 128, 1, 2, 3][..],
    ] {
        let encoded = base64(case);
        assert_eq!(unbase64(&encoded).as_deref(), Some(case), "{encoded}");
    }
    assert_eq!(unbase64("a"), None);
    assert_eq!(unbase64("aGVsbG8"), None);
    assert_eq!(unbase64("!!!!"), None);
}
