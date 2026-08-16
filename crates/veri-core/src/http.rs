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

pub fn unbase64(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => u32::from(c - b'A'),
            b'a'..=b'z' => u32::from(c - b'a') + 26,
            b'0'..=b'9' => u32::from(c - b'0') + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    };
    let body = s.trim_end_matches('=');
    if !s.len().is_multiple_of(4) || s.len() - body.len() > 2 {
        return None;
    }
    let mut out = Vec::with_capacity(body.len() / 4 * 3);
    for chunk in body.as_bytes().chunks(4) {
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= val(c)? << (18 - 6 * i);
        }
        let bytes = n.to_be_bytes();
        out.push(bytes[1]);
        if chunk.len() > 2 {
            out.push(bytes[2]);
        }
        if chunk.len() > 3 {
            out.push(bytes[3]);
        }
    }
    Some(out)
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
