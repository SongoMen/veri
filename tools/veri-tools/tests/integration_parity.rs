//! The daemon and the dev tools each assemble the full integration list
//! themselves.
//!
//! They are both composition roots, so the repetition is deliberate, but
//! nothing makes them agree, and an integration registered in one and forgotten
//! in the other is invisible until a host that needs it behaves differently
//! under `veri-tools` than under the client people actually ship.

use std::collections::BTreeSet;
use std::path::Path;

fn registered(src: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for ctor in ["::with_solver", "::detect_only"] {
        for (at, _) in src.match_indices(ctor) {
            let name: String = src[..at]
                .chars()
                .rev()
                .take_while(|c| c.is_alphanumeric())
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            if name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
                out.insert(name);
            }
        }
    }
    out
}

#[test]
fn the_daemon_and_the_tools_register_the_same_integrations() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let daemon = std::fs::read_to_string(root.join("crates/veri-daemon/src/main.rs"))
        .expect("the daemon source must be readable from the workspace");
    let tools = std::fs::read_to_string(root.join("tools/veri-tools/src/lib.rs"))
        .expect("the tools source");

    let in_daemon = registered(&daemon);
    let in_tools = registered(&tools);

    assert!(in_daemon.len() >= 5, "parsed too few from the daemon: {in_daemon:?}");
    assert_eq!(
        in_daemon, in_tools,
        "the daemon registers {in_daemon:?} and the tools register {in_tools:?}; \
         an integration added to one has to be added to the other"
    );
}
