//! The names on the global object, against the ones the harvested Chrome had.

mod common;
use common::{probe_as, CHROME_UA};

fn global_names() -> Vec<String> {
    probe_as(CHROME_UA, "Object.getOwnPropertyNames(globalThis).join(' ')")
        .split_whitespace()
        .filter(|n| *n != "v" && *n != "x")
        .map(str::to_string)
        .collect()
}

fn harvested() -> serde_json::Map<String, serde_json::Value> {
    let profile: serde_json::Value =
        serde_json::from_str(veri_js::vm::PROFILE).expect("the bundled profile parses");
    profile["globals"].as_object().expect("the profile lists the globals it saw").clone()
}

#[test]
fn the_global_object_carries_nothing_the_browser_did_not() {
    let harvested = harvested();
    let extra: Vec<String> =
        global_names().into_iter().filter(|n| !harvested.contains_key(n)).collect();
    assert!(extra.is_empty(), "names no harvested Chrome had: {extra:?}");
}

#[test]
fn the_environments_own_helpers_do_not_exist() {
    let reachable = probe_as(
        CHROME_UA,
        "['makeElement', 'makeSvgElement', 'listenerFactory', 'makeContext', 'makeContextInner', \
         'makeAudioNode', 'AudioContextShim', 'tagContext', 'ghost', 'watch', 'rec', \
         'isAbsent', 'internal'].filter(n => n in globalThis).join(' ')",
    );
    assert_eq!(reachable, "", "reachable from the page");
}

#[test]
fn nothing_the_host_owns_turns_up_in_enumeration() {
    let listed = probe_as(
        CHROME_UA,
        "[...Object.getOwnPropertyNames(globalThis), ...Object.keys(globalThis)]\
         .filter(n => n.startsWith('__')).join(' ')",
    );
    assert_eq!(listed, "");
}

#[test]
fn no_env_fragment_leaves_a_bare_name_resolvable() {
    let mut declared: Vec<String> = Vec::new();
    for (_, src) in veri_js::vm::ENV_PARTS {
        for line in src.lines() {
            let Some(rest) = ["const ", "let ", "var ", "function ", "class "]
                .iter()
                .find_map(|kw| line.strip_prefix(kw))
            else {
                continue;
            };
            let name: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$')
                .collect();
            if !name.is_empty() && !name.starts_with("__") {
                declared.push(name);
            }
        }
    }
    assert!(declared.len() < 40, "unexpectedly many top-level names: {declared:?}");

    let list = declared.iter().map(|n| format!("'{n}'")).collect::<Vec<_>>().join(",");
    let reachable = probe_as(
        CHROME_UA,
        &format!("[{list}].filter((n) => eval('typeof ' + n) !== 'undefined').join(' ')"),
    );
    assert_eq!(reachable, "", "reachable by bare name from page script");
}
