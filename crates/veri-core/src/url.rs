//! Clearance is keyed by host and a challenge resolves its own relative URLs
//! against the origin, so both have to agree with what the transport sent.

pub fn host_of(url: &str) -> Option<String> {
    let after = url.split("://").nth(1)?;
    let authority = after.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

/// Keeps the URL's own scheme rather than assuming TLS.
pub fn origin_of(url: &str) -> Option<String> {
    let (scheme, _) = url.split_once("://")?;
    if scheme.is_empty() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let host = host_of(url)?;
    Some(format!("{}://{host}", scheme.to_ascii_lowercase()))
}

pub fn join(base: &str, url: &str) -> String {
    if url.contains("://") {
        return url.to_string();
    }
    let Some(origin) = origin_of(base) else { return url.to_string() };

    if let Some(rest) = url.strip_prefix("//") {
        let scheme = base.split_once("://").map_or("https", |(s, _)| s);
        return format!("{scheme}://{rest}");
    }
    if url.starts_with('/') {
        return format!("{origin}{url}");
    }

    let after_origin = match base.split_once("://") {
        Some((_, rest)) => rest.find(['/', '?', '#']).map_or("", |i| &rest[i..]),
        None => "",
    };
    let path = after_origin.split(['?', '#']).next().unwrap_or("/");
    if url.starts_with('#') {
        return format!("{origin}{}{url}", after_origin.split('#').next().unwrap_or(path));
    }
    if url.starts_with('?') {
        return format!("{origin}{path}{url}");
    }
    let dir = path.rfind('/').map_or("/", |i| &path[..=i]);
    format!("{origin}{dir}{url}")
}
