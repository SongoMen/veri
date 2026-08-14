//! Naming who is in front of a host, from the response alone.
//!
//! A `Protection` answers only for its own provider. This names the ones the
//! workspace has no crate for, so a diagnostic can still say what it is looking
//! at rather than reporting an anonymous 403.

use crate::Headers;

const PROVIDER_HEADERS: &[(&str, &str)] = &[
    ("cf-ray", "cloudflare"),
    ("cf-mitigated", "cloudflare"),
    ("x-datadome", "datadome"),
    ("x-datadome-cid", "datadome"),
    ("x-akamai-transformed", "akamai"),
    ("akamai-grn", "akamai"),
    ("x-px-", "perimeterx"),
    ("x-iinfo", "imperva"),
    ("x-sucuri-id", "sucuri"),
    ("x-amz-cf-id", "cloudfront"),
];

pub fn hints(headers: &Headers) -> Vec<String> {
    let mut out = Vec::new();
    for (name, provider) in PROVIDER_HEADERS {
        let present = headers.iter().any(|(k, _)| {
            k.eq_ignore_ascii_case(name)
                || k.len() > name.len() && k[..name.len()].eq_ignore_ascii_case(name)
        });
        if present && !out.iter().any(|seen| seen == provider) {
            out.push(provider.to_string());
        }
    }
    if let Some(server) = headers.get("server") {
        let s = server.to_lowercase();
        if !out.iter().any(|h| s.contains(h.as_str())) {
            out.push(format!("server={server}"));
        }
    }
    out
}
