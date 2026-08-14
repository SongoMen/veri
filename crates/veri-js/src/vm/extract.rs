//! Deliberately hand-written rather than regex or a JS parser: the target is a
//! single object literal at a known anchor, and brace-matching that correctly
//! through strings and escapes is less code than either alternative.

use veri_core::html::attr;

pub fn extract_config_object(html: &str, name: &str) -> Option<String> {
    let start = html.find(&format!("window.{name}"))?;
    let brace = start + html[start..].find('{')?;
    let bytes = html.as_bytes();
    let (mut depth, mut i) = (0i32, brace);
    let (mut quote, mut escaped) = (0u8, false);
    while i < bytes.len() {
        let c = bytes[i];
        if quote != 0 {
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == quote {
                quote = 0;
            }
        } else {
            match c {
                b'\'' | b'"' => quote = c,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(format!("window.{name} = {};", &html[brace..=i]));
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

pub fn extract_inline_script_at(html: &str, name: &str) -> Option<(String, i32, i32)> {
    let anchor = html.find(&format!("window.{name}"))?;
    let open = html[..anchor].rfind("<script")?;
    let body_start = open + html[open..].find('>')? + 1;
    let end = html[body_start..].find("</script>")? + body_start;
    let (line, col) = line_col(html, body_start);
    Some((html[body_start..end].to_string(), line, col))
}

fn line_col(text: &str, byte: usize) -> (i32, i32) {
    let head = &text[..byte.min(text.len())];
    let line = head.matches('\n').count() as i32;
    let col = head.rfind('\n').map_or(head.len(), |n| head.len() - n - 1) as i32;
    (line, col)
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

pub fn config_field(html: &str, name: &str, key: &str) -> Option<String> {
    let opt = extract_config_object(html, name)?;
    let needle = format!("{key}:");
    let mut from = 0;
    let at = loop {
        let abs = from + opt[from..].find(&needle)?;
        if abs == 0 || !is_ident_byte(opt.as_bytes()[abs - 1]) {
            break abs + needle.len();
        }
        from = abs + needle.len();
    };
    let rest = opt[at..].trim_start();
    let q = rest.chars().next()?;
    if q != '\'' && q != '"' {
        return None;
    }
    let end = rest[1..].find(q)? + 1;
    Some(rest[1..end].to_string())
}

pub fn instrument_catches(src: &str) -> (String, Vec<usize>) {
    let b = src.as_bytes();
    let mut out = String::with_capacity(src.len() + 4096);
    let mut sites: Vec<usize> = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        if b[i..].starts_with(b"catch") && (i == 0 || !is_ident_byte(b[i - 1])) {
            let mut j = i + 5;
            while j < b.len() && (b[j] as char).is_whitespace() {
                j += 1;
            }
            if j < b.len() && b[j] == b'(' {
                let id_start = j + 1;
                let mut k = id_start;
                while k < b.len() && b[k] != b')' {
                    k += 1;
                }
                let ident = &src[id_start..k.min(src.len())];
                let valid = !ident.is_empty()
                    && ident.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$');
                let mut m = k + 1;
                while m < b.len() && (b[m] as char).is_whitespace() {
                    m += 1;
                }
                if valid && m < b.len() && b[m] == b'{' {
                    let idx = sites.len();
                    sites.push(i);
                    out.push_str(&src[i..=m]);
                    out.push_str(&format!("try{{__CAUGHT({ident},{idx});}}catch(_){{}}"));
                    i = m + 1;
                    continue;
                }
            }
        }
        let ch = src[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    (out, sites)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Script {
    Inline(String),
    External(String),
}

struct ScriptTag<'a> {
    tag: &'a str,
    body: &'a str,
    body_at: usize,
}

fn script_tags(html: &str) -> Vec<ScriptTag<'_>> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while let Some(rel) = html[at..].find("<script") {
        let open = at + rel;
        let Some(gt) = html[open..].find('>') else { break };
        let body_at = open + gt + 1;
        let Some(close_rel) = html[body_at..].find("</script>") else { break };
        let close = body_at + close_rel;
        out.push(ScriptTag { tag: &html[open..body_at], body: &html[body_at..close], body_at });
        at = close + "</script>".len();
    }
    out
}

pub fn scripts(html: &str) -> Vec<(String, Script)> {
    script_tags(html)
        .into_iter()
        .filter_map(|t| {
            let id = attr(t.tag, "id").unwrap_or_default();
            match attr(t.tag, "src") {
                Some(src) => Some((id, Script::External(src))),
                None if !t.body.trim().is_empty() => Some((id, Script::Inline(t.body.to_string()))),
                None => None,
            }
        })
        .collect()
}

pub fn first_inline_script_at(html: &str) -> Option<(i32, i32)> {
    let tag = script_tags(html).into_iter().find(|t| attr(t.tag, "src").is_none())?;
    Some(line_col(html, tag.body_at))
}

pub fn all_elements(html: &str) -> Vec<(String, Vec<(String, String)>)> {
    const INTERESTING: [&str; 9] =
        ["id", "class", "name", "src", "href", "content", "type", "rel", "style"];
    let mut out = Vec::new();
    let mut at = 0usize;
    while let Some(rel) = html[at..].find('<') {
        let open = at + rel;
        let Some(gt_rel) = html[open..].find('>') else { break };
        let tag_src = &html[open..open + gt_rel];
        at = open + gt_rel + 1;

        let name: String = tag_src[1..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        if name.is_empty() {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if lower == "script" {
            if let Some(end) = html[at..].find("</script>") {
                at += end + "</script>".len();
            }
            continue;
        }
        let attrs =
            INTERESTING.iter().filter_map(|k| Some((k.to_string(), attr(tag_src, k)?))).collect();
        out.push((lower, attrs));
    }
    out
}
