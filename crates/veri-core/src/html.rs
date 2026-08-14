//! Just enough HTML scanning for a protection to read a challenge page.

pub fn script_srcs(html: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(open) = lower[at..].find("<script").map(|i| i + at) {
        let end = lower[open..].find('>').map(|e| e + open).unwrap_or(lower.len());
        if let Some(src) = attr(&html[open..end.min(html.len())], "src") {
            out.push(src);
        }
        at = end.max(open + 1);
    }
    out
}

pub fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let at = lower
        .match_indices(name)
        .find(|(i, _)| {
            lower[..*i].ends_with(char::is_whitespace)
                && lower[i + name.len()..].trim_start().starts_with('=')
        })
        .map(|(i, _)| i + name.len())?;
    let rest = tag[at..].trim_start().strip_prefix('=')?.trim_start();
    match rest.chars().next()? {
        quote @ ('"' | '\'') => rest[1..].find(quote).map(|e| rest[1..1 + e].to_string()),
        _ => {
            let end = rest.find([' ', '\t', '\n', '\r', '>']).unwrap_or(rest.len());
            Some(rest[..end].to_string())
        }
    }
}
