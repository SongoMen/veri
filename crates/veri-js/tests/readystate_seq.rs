mod common;

use std::sync::Arc;
use veri_core::HttpBridge;
use veri_js::vm::{self, SolveOptions};

#[test]
fn readystate_progresses_to_complete() {
    let probe = r#"
        var log = [];
        function rec(s){ log.push(s); globalThis.__VALUE = JSON.stringify(log); }
        document.addEventListener('readystatechange', function(){ rec('rsc:' + document.readyState); });
        document.addEventListener('DOMContentLoaded', function(){ rec('dcl:' + document.readyState); });
        window.addEventListener('load', function(){
          rec('load:' + document.readyState);
          // The sensor may read readyState via a captured prototype getter rather
          // than the own property. Check whether that path agrees.
          try {
            var D = globalThis.Document;
            var d = D && Object.getOwnPropertyDescriptor(D.prototype, 'readyState');
            var viaProto = d ? (d.get ? d.get.call(document) : ('value=' + d.value)) : 'no-desc';
            var od = Object.getOwnPropertyDescriptor(document, 'readyState');
            var own = od ? (od.get ? 'getter' : ('value=' + od.value)) : 'none';
            rec('proto:' + viaProto + ' own:' + own);
          } catch (e) { rec('protoERR:' + e.message); }
        });
        window.addEventListener('pageshow', function(){ rec('pageshow:' + document.readyState); });
        rec('start:' + document.readyState);
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
    println!("RSSEQ: {v}");
    assert!(v.contains("rsc:complete"), "readystatechange never reached complete: {v}");
    assert!(v.contains("load:complete"), "load observed the wrong readyState: {v}");
    assert!(v.contains("proto:complete"), "Document.prototype readyState getter was stale: {v}");
    assert!(v.contains("own:none"), "readyState forged an own property on document: {v}");
}
