//! A challenge that collects in two phases - an early POST, then a fuller one a
//! couple seconds later - only clears if the second phase actually runs. This
//! reproduces that shape offline: an immediate request plus two deferred ones,
//! and asserts the event loop reaches all of them.

mod common;
use common::{Spy, CHROME_UA};
use veri_core::Solver;
use veri_js::V8Solver;

fn urls_for(page: &str) -> Vec<String> {
    let bridge = Spy::new("");
    let report =
        V8Solver::new().shadow_dom(true).solve(page, "https://x.test/", CHROME_UA, bridge.clone());
    if let Ok(r) = &report {
        if !r.errors.is_empty() {
            println!("page errors: {:?}", r.errors);
        }
    }
    bridge.urls()
}

#[test]
fn a_deferred_second_collection_still_runs() {
    let page = "<html><body><script>\
        function post(p){var x=new XMLHttpRequest();x.open('POST','https://x.test/'+p);x.send(p);}\
        post('first');\
        setTimeout(function(){ post('second'); }, 2000);\
        setTimeout(function(){ post('third'); }, 5000);\
        </script></body></html>";
    let urls = urls_for(page);
    assert!(urls.iter().any(|u| u.ends_with("/first")), "immediate POST missing: {urls:?}");
    assert!(urls.iter().any(|u| u.ends_with("/second")), "2s deferred POST missing: {urls:?}");
    assert!(urls.iter().any(|u| u.ends_with("/third")), "5s deferred POST missing: {urls:?}");
}

#[test]
fn a_timer_that_reschedules_itself_keeps_running() {
    let page = "<html><body><script>\
        var n=0;\
        (function tick(){ n++;\
          var x=new XMLHttpRequest();x.open('POST','https://x.test/tick'+n);x.send(''+n);\
          if(n<5) setTimeout(tick, 400);\
        })();\
        </script></body></html>";
    let urls = urls_for(page);
    for i in 1..=5 {
        assert!(
            urls.iter().any(|u| u.ends_with(&format!("/tick{i}"))),
            "re-armed tick {i} missing: {urls:?}"
        );
    }
}
