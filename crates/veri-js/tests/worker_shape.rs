//! A worker must look like a worker.

mod common;

fn in_worker(expr: &str) -> String {
    const PAGE: &str = r#"<html><body><script>
      var src = "self.onmessage = function () {"
        + " try { self.postMessage(String(__EXPR__)); }"
        + " catch (e) { self.postMessage('THREW ' + e.message); } };";
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      var w = new Worker(url);
      w.onmessage = function (e) {
        var x = new XMLHttpRequest();
        x.open('GET', 'https://echo.test/' + encodeURIComponent(e.data));
        x.send();
      };
      w.postMessage('go');
    </script></body></html>"#;

    common::echoed(&PAGE.replace("__EXPR__", expr), "ua")
}

#[test]
fn a_worker_cannot_see_the_page() {
    assert_eq!(in_worker("typeof document"), "undefined", "a worker has no document");
    assert_eq!(in_worker("typeof window"), "undefined", "a worker has no window");
    assert_eq!(in_worker("typeof localStorage"), "undefined");
    assert_eq!(in_worker("typeof screen"), "undefined");
}

#[test]
fn a_worker_navigator_is_reduced() {
    assert_eq!(in_worker("typeof navigator.plugins"), "undefined");
    assert_eq!(in_worker("typeof navigator.mimeTypes"), "undefined");
    assert_eq!(in_worker("typeof navigator.webdriver"), "undefined");
    // ...but the things a worker does expose are still there.
    assert_eq!(in_worker("navigator.platform"), "MacIntel");
    assert_eq!(in_worker("navigator.hardwareConcurrency"), "10");
}

#[test]
fn a_worker_can_still_reach_offscreen_webgl() {
    assert_eq!(
        in_worker("typeof new OffscreenCanvas(1,1).getContext('webgl').getExtension"),
        "function"
    );
}
