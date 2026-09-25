mod common;

use std::sync::Arc;
use veri_core::HttpBridge;
use veri_js::vm::{self, SolveOptions};

#[test]
fn addeventlistener_is_native_and_guards_its_receiver() {
    let probe = r#"
        function probe(label, fn) {
          try { fn(); return label + '=ok'; }
          catch (e) { return label + '=' + (e && e.constructor && e.constructor.name) + ':' + (e && e.message); }
        }
        var bareAEL = window.addEventListener;
        globalThis.__VALUE = JSON.stringify({
          toStr: Function.prototype.toString.call(bareAEL),
          // A plain object is not an EventTarget -> Chrome throws Illegal invocation.
          plainObj: probe('x', function () { bareAEL.call({}, 'zz-test', function () {}); }),
          // A sloppy detached call coerces `this` to the global (a valid target) -> ok.
          sloppy: probe('x', function () { bareAEL('zz-test', function () {}); }),
        });
    "#;
    let out = vm::execute(
        vm::Program { bootstrap: Some(probe), payload: "", ..Default::default() },
        "https://x.test/",
        "ua",
        Some(common::Spy::new("") as Arc<dyn HttpBridge>),
        &SolveOptions { timeout: None, ..SolveOptions::default() },
    )
    .expect("run");
    let v = out.value.unwrap_or_default();
    println!("BARECALL: {v}");
    assert!(v.contains("[native code]"), "addEventListener does not toString as native: {v}");
    assert!(v.contains("Illegal invocation"), "no Illegal invocation for a non-EventTarget receiver: {v}");
    assert!(v.contains("\"sloppy\":\"x=ok\""), "a valid (global) receiver should not throw: {v}");
}
