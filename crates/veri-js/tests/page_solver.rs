//! The browser environment must be reachable.

mod common;

use common::Spy;
use veri_core::Solver;
use veri_js::V8Solver;

#[test]
fn a_page_with_no_seeded_config_still_runs() {
    let page = r#"<html><body><script>
      globalThis.__ran = true;
      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://api-js.example.test/js/');
      xhr.send('payload=1');
    </script></body></html>"#;

    let bridge = Spy::new("{\"cookie\":\"session=abc\"}");
    let report = V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://protected.test/", "ua", bridge.clone())
        .expect("a page with nothing to seed must still run");

    assert!(report.errors.is_empty(), "unexpected errors: {:?}", report.errors);
    let seen = bridge.calls();
    assert!(
        seen.iter().any(|r| r.contains("api-js.example.test")),
        "the page's own request never reached the bridge: {seen:?}"
    );
}

/// Several inline scripts run in document order, sharing one global.
#[test]
fn every_inline_script_runs_in_order() {
    let page = r#"<html><head>
      <script>globalThis.__order = ['a'];</script>
      <script src="https://cdn.test/ignored.js"></script>
      <script>globalThis.__order.push('b');</script>
    </head><body><script>
      var x = new XMLHttpRequest();
      x.open('GET', 'https://echo.test/' + globalThis.__order.join('-'));
      x.send();
    </script></body></html>"#;

    let bridge = Spy::new("ok");
    V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://protected.test/", "ua", bridge.clone())
        .expect("run");

    let seen = bridge.calls();
    assert!(
        seen.iter().any(|r| r.contains("echo.test/a-b")),
        "scripts did not all run in order: {seen:?}"
    );
}

#[test]
fn a_page_with_no_scripts_is_not_a_challenge() {
    let bridge = Spy::new("");
    let err = V8Solver::new()
        .shadow_dom(true)
        .solve("<html><body>nothing here</body></html>", "https://x.test/", "ua", bridge)
        .expect_err("a scriptless page is not a challenge");
    assert!(matches!(err, veri_core::SolveError::NotAChallenge), "got {err:?}");
}

#[test]
fn an_external_script_is_fetched_and_executed() {
    let page = r#"<html><body>
      <script>var dd={'t':'fe'};</script>
      <script src="https://loader.test/c.js"></script>
    </body></html>"#;

    // The loader, once fetched, calls back out so we can see that it ran.
    let bridge = Spy::new(
        "var x = new XMLHttpRequest(); x.open('POST', 'https://api.test/submit'); x.send('done');",
    );
    V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://protected.test/", "ua", bridge.clone())
        .expect("run");

    let seen = bridge.calls();
    assert!(
        seen.iter().any(|r| r.contains("loader.test/c.js")),
        "the external script was never fetched: {seen:?}"
    );
    assert!(
        seen.iter().any(|r| r.contains("api.test/submit")),
        "the external script was fetched but never ran: {seen:?}"
    );
}

#[test]
fn the_pages_elements_exist_for_its_scripts() {
    let page = r#"<html><body><p id="cmsg">Please enable JS</p>
      <script>
        var el = document.getElementById('cmsg');
        var x = new XMLHttpRequest();
        x.open('GET', 'https://echo.test/' + (el ? 'found' : 'null'));
        x.send();
      </script></body></html>"#;

    let bridge = Spy::new("");
    V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://protected.test/", "ua", bridge.clone())
        .expect("run");

    let seen = bridge.calls();
    assert!(
        seen.iter().any(|r| r.contains("echo.test/found")),
        "getElementById returned null for an element the page declared: {seen:?}"
    );
}

#[test]
fn inner_html_builds_real_children() {
    let page = r#"<html><body><script>
      var w = document.createElement('div');
      w.innerHTML = '<iframe src="https://frame.test/x" title="Device Check" width="100%"></iframe>';
      var el = w.firstChild;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://echo.test/'
        + (el ? el.tagName : 'null')
        + '/' + (el ? el.getAttribute('src') : '-')
        + '/' + (el ? el.getAttribute('title').replace(' ', '_') : '-'));
      x.send();
    </script></body></html>"#;

    let bridge = Spy::new("");
    V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://protected.test/", "ua", bridge.clone())
        .expect("run");

    let seen = bridge.calls();
    assert!(
        seen.iter().any(|r| r.contains("echo.test/IFRAME/https://frame.test/x/Device_Check")),
        "innerHTML did not parse into a real element: {seen:?}"
    );
}

/// `OffscreenCanvas` needs a real context: a fingerprint reads the unmasked WebGL
/// vendor and renderer through `new OffscreenCanvas(1,1).getContext('webgl')`,
/// and a bare constructor loses the whole WebGL fingerprint.
#[test]
fn offscreen_canvas_has_a_webgl_context() {
    let page = r#"<html><body><script>
      var r = new OffscreenCanvas(1, 1).getContext('webgl');
      var i = r.getExtension('WEBGL_debug_renderer_info');
      var vendor = r.getParameter(i.UNMASKED_VENDOR_WEBGL);
      var x = new XMLHttpRequest();
      x.open('GET', 'https://echo.test/' + encodeURIComponent(vendor));
      x.send();
    </script></body></html>"#;

    let bridge = Spy::new("");
    V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://protected.test/", "ua", bridge.clone())
        .expect("run");

    let seen = bridge.calls();
    assert!(
        seen.iter().any(|r| r.contains("echo.test/Google%20Inc.")),
        "OffscreenCanvas gave no WebGL vendor: {seen:?}"
    );
}

/// A challenge that compiles its own instructions leaves no source to read.
#[test]
fn a_compiled_function_that_throws_is_recorded() {
    let page = r#"<html><body><script>
      var op = new Function('return arguments[0].missing.e;');
      var state = [];
      state[41] = 41; state[50] = state;
      try { op(state); } catch (e) {}
      var x = new XMLHttpRequest();
      x.open('GET', 'https://echo.test/done');
      x.send();
    </script></body></html>"#;

    let bridge = Spy::new("");
    let solver = V8Solver::new()
        .with_options(veri_js::vm::SolveOptions { diagnostics: true, ..Default::default() });
    let report = solver.solve(page, "https://x.test/", "ua", bridge).expect("run");

    let d = report.diagnostics.expect("diagnostics were requested");
    assert!(
        d.fn_threw.iter().any(|f| f.contains("arguments[0].missing.e")),
        "the failing function's source was not recorded: {:?}",
        d.fn_threw
    );
}

/// The recording is diagnostics-only: the hot path must not pay for it.
#[test]
fn nothing_is_recorded_without_diagnostics() {
    let page = r#"<html><body><script>
      try { new Function('return null.x;')(); } catch (e) {}
      var x = new XMLHttpRequest(); x.open('GET', 'https://echo.test/done'); x.send();
    </script></body></html>"#;
    let bridge = Spy::new("");
    let report =
        V8Solver::new().shadow_dom(true).solve(page, "https://x.test/", "ua", bridge).expect("run");
    assert!(report.diagnostics.is_none());
}

#[test]
fn shadow_dom_is_on_for_the_page_solver_and_off_for_the_seeded_one() {
    let page = r#"<html><body><script>
      var host = document.createElement('div');
      var got;
      try { got = host.attachShadow({ mode: 'closed' }); } catch (e) { got = 'threw'; }
      var x = new XMLHttpRequest();
      x.open('GET', 'https://echo.test/' + (got === undefined ? 'absent' : (got === 'threw' ? 'threw' : 'root')));
      x.send();
    </script></body></html>"#;

    let bridge = Spy::new("");
    V8Solver::new()
        .shadow_dom(true)
        .solve(page, "https://x.test/", "ua", bridge.clone())
        .expect("run");
    assert!(
        bridge.calls().iter().any(|r| r.contains("echo.test/root")),
        "the generic solver should provide a shadow root: {:?}",
        bridge.calls()
    );

    let off = Spy::new("");
    let solver = V8Solver::new().with_options(veri_js::vm::SolveOptions::default());
    solver.solve(page, "https://x.test/", "ua", off.clone()).expect("run");
    assert!(
        off.calls().iter().any(|r| r.contains("echo.test/absent")),
        "with shadow_dom off, attachShadow must stay absent: {:?}",
        off.calls()
    );
}
