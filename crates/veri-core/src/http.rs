//! Wire details more than one crate needs to agree on.

/// Standard base64, padded. Hand-written rather than a dependency, since this
/// is all of it that anything here needs.
pub fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = u32::from_be_bytes([0, b[0], b[1], b[2]]);
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Percent-encode everything outside the unreserved set.
pub fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The content type a request body describes about itself.
///
/// A multipart body carries its own boundary on the first line, so the header
/// can be derived rather than guessed. Sent as `text/plain` instead, AWS WAF
/// answers "Invalid `boundary` for `multipart/form-data` request".
pub fn content_type_for(body: &str) -> String {
    body.strip_prefix("--")
        .and_then(|rest| rest.split("\r\n").next())
        .filter(|b| b.starts_with("----WebKitFormBoundary"))
        .map(|b| format!("multipart/form-data; boundary={b}"))
        .unwrap_or_else(|| "text/plain;charset=UTF-8".to_string())
}
