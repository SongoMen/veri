mod common;

use std::sync::Arc;
use veri_core::HttpBridge;
use veri_js::vm::{self, SolveOptions};

#[test]
fn addeventlistener_is_shared_and_inherited() {
    let probe = r#"
        var ET = globalThis.EventTarget && globalThis.EventTarget.prototype;
        var nameOf = function(p){
          if (p === document) return 'document';
          if (p === ET) return 'EventTarget.prototype';
          try { var t = Object.prototype.toString.call(p); } catch(e){ t='?'; }
          try { var c = p && p.constructor && p.constructor.name; } catch(e){ c='?'; }
          return (c||'?') + ' ' + t;
        };
        var owner = null, ownerEqWin = null, chain = [];
        var p = document, g = 0;
        while (p && g++ < 40) {
          var own = Object.prototype.hasOwnProperty.call(p, 'addEventListener');
          chain.push(nameOf(p) + (own ? '[OWNS ael]' : ''));
          if (own && owner === null) {
            owner = nameOf(p);
            try { ownerEqWin = (p.addEventListener === window.addEventListener); } catch(e){ ownerEqWin='ERR'; }
          }
          p = Object.getPrototypeOf(p);
        }
        globalThis.__VALUE = JSON.stringify({
          eq: window.addEventListener === document.addEventListener,
          docOwn: Object.prototype.hasOwnProperty.call(document, 'addEventListener'),
          winOwn: Object.prototype.hasOwnProperty.call(globalThis, 'addEventListener'),
          etEq: window.addEventListener === (ET && ET.addEventListener),
          aelOwner: owner,
          ownerAEL_eq_win: ownerEqWin,
          chain: chain,
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
    println!("AEL PROBE: {v}");
    assert!(v.contains("\"eq\":true"), "window.addEventListener !== document.addEventListener: {v}");
    assert!(v.contains("\"docOwn\":false"), "document still OWNS addEventListener: {v}");
    assert!(v.contains("\"winOwn\":false"), "window still OWNS addEventListener: {v}");
}
