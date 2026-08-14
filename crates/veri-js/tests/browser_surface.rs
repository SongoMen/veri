//! APIs a real fingerprint reads.

mod common;
use common::{probe_as, CHROME_UA};

fn probe(expr: &str) -> String {
    probe_as(CHROME_UA, expr)
}

#[test]
fn plugins_have_entries_not_just_a_length() {
    assert_eq!(probe("navigator.plugins.length"), "5");
    assert_eq!(probe("navigator.plugins[0].name"), "PDF Viewer");
    assert_eq!(probe("navigator.plugins[0].filename"), "internal-pdf-viewer");
    assert_eq!(probe("navigator.plugins[4].name"), "WebKit built-in PDF");
    assert_eq!(probe("navigator.plugins.item(1).name"), "Chrome PDF Viewer");
    assert_eq!(probe("navigator.plugins.namedItem('PDF Viewer').name"), "PDF Viewer");
}

#[test]
fn mime_types_have_entries_and_link_back() {
    assert_eq!(probe("navigator.mimeTypes.length"), "2");
    assert_eq!(probe("navigator.mimeTypes[0].type"), "application/pdf");
    assert_eq!(probe("navigator.mimeTypes[0].suffixes"), "pdf");
    assert_eq!(probe("navigator.mimeTypes[1].type"), "text/pdf");
    assert_eq!(probe("navigator.mimeTypes[0].enabledPlugin.name"), "PDF Viewer");
}

#[test]
fn webgpu_answers_rather_than_throwing() {
    assert_eq!(probe("navigator.gpu.getPreferredCanvasFormat()"), "bgra8unorm");
    assert!(probe("navigator.gpu.wgslLanguageFeatures.size").parse::<u32>().unwrap_or(0) > 0);
    assert_eq!(probe("typeof navigator.gpu.requestAdapter"), "function");
}

#[test]
fn speech_synthesis_and_codec_support_answer() {
    assert_eq!(probe("navigator.gpu ? typeof speechSynthesis.getVoices : 'x'"), "function");
    assert!(probe("speechSynthesis.getVoices().length").parse::<u32>().unwrap_or(0) > 100);
    assert!(
        probe("speechSynthesis.getVoices().filter(v => v.localService).length")
            .parse::<u32>()
            .unwrap_or(0)
            > 100
    );
    assert!(
        probe("new Set(speechSynthesis.getVoices().map(v => v.lang)).size")
            .parse::<u32>()
            .unwrap_or(0)
            > 10
    );
    assert_eq!(probe("MediaRecorder.isTypeSupported('video/webm')"), "true");
    assert_eq!(probe("MediaRecorder.isTypeSupported('video/nonsense')"), "false");
    assert_eq!(probe("document.createElement('video').canPlayType('video/mp4')"), "maybe");
    assert_eq!(
        probe("document.createElement('video').canPlayType('video/mp4; codecs=\"avc1.42E01E\"')"),
        "probably"
    );
    assert_eq!(probe("document.createElement('video').canPlayType('video/nonsense')"), "");
}

#[test]
fn chrome_object_shape_matches_a_page() {
    assert_eq!(probe("typeof window.chrome"), "object");
    assert_eq!(probe("typeof window.chrome.runtime"), "undefined");
}

#[test]
fn platform_objects_name_their_interface() {
    assert_eq!(probe("Object.prototype.toString.call(navigator)"), "[object Navigator]");
    assert_eq!(probe("Object.prototype.toString.call(screen)"), "[object Screen]");
}

#[test]
fn harvested_values_match_a_real_chrome() {
    // getComputedStyle(el).length is 475 in Chrome; it was 19 here.
    assert_eq!(probe("getComputedStyle(document.body).length"), "475");
    assert_eq!(probe("getComputedStyle(document.body)[0]"), "accent-color");
    assert_eq!(probe("Array.from(getComputedStyle(document.body)).length"), "475");

    assert_eq!(probe("navigator.gpu.wgslLanguageFeatures.size"), "10");
    assert_eq!(probe("document.hasFocus()"), "true");
    assert_eq!(probe("document.visibilityState"), "visible");
}

#[test]
fn a_webgl2_context_reports_webgl2_versions() {
    let ver = probe(
        "(function(){var c=document.createElement('canvas');\
         return c.getContext('webgl2').getParameter(0x1F02);})()",
    );
    assert!(ver.starts_with("WebGL 2.0"), "webgl2 VERSION was {ver:?}");

    let glsl = probe(
        "(function(){var c=document.createElement('canvas');\
         return c.getContext('webgl2').getParameter(0x8B8C);})()",
    );
    assert!(glsl.starts_with("WebGL GLSL ES 3.0"), "webgl2 SHADING_LANGUAGE_VERSION was {glsl:?}");

    let one = probe(
        "(function(){var c=document.createElement('canvas');\
         return c.getContext('webgl').getParameter(0x1F02);})()",
    );
    assert!(one.starts_with("WebGL 1.0"), "webgl VERSION was {one:?}");
}

#[test]
fn computed_width_belongs_to_the_element_not_the_harvest() {
    let out = probe(
        "(function(){\
         function w(t){var d=document.createElement('div');d.style.font='16px Arial';\
         d.textContent=t;document.body.appendChild(d);\
         return [getComputedStyle(d).width, d.offsetWidth+'px'];}\
         var a=w('a'), b=w('a much longer run of text');\
         return a[0]+'|'+a[1]+'|'+b[0]+'|'+b[1];})()",
    );
    let f: Vec<&str> = out.split('|').collect();
    assert_eq!(f.len(), 4, "probe returned {out:?}");
    assert_ne!(f[0], f[2], "two differently sized elements computed the same width");
    assert_eq!(f[0], f[1], "computed width disagreed with offsetWidth");
    assert_eq!(f[2], f[3], "computed width disagreed with offsetWidth");
}

#[test]
fn a_blob_holds_bytes_rather_than_a_stringified_object() {
    assert_eq!(probe("new Blob([new ArrayBuffer(1024)]).size"), "1024");
    assert_eq!(probe("new Blob([new Uint8Array([1,2,3])]).size"), "3");
    assert_eq!(probe("new Blob(['abc']).size"), "3");
    // UTF-8, not UTF-16 code units.
    assert_eq!(probe("new Blob(['\\u00e9']).size"), "2");
}

#[test]
fn a_file_reader_reports_a_base64_data_url() {
    let out = probe(
        "(function(){var r=new FileReader();var got='pending';\
         r.onload=function(){got=r.result;};\
         r.readAsDataURL(new Blob([new Uint8Array([0,1,2])],{type:'application/octet-stream'}));\
         return got;})()",
    );
    assert_eq!(out, "pending", "the read is asynchronous, as a browser's is");

    // 1024 zero bytes base64-encode to a known length and prefix.
    let done = probe(
        "(function(){var r=new FileReader();\
         r.readAsDataURL(new Blob([new ArrayBuffer(3)],{type:'text/plain'}));\
         __drainOnce();\
         return String(r.result)==='data:text/plain;base64,AAAA';})()",
    );
    assert_eq!(done, "true", "three zero bytes base64-encode to AAAA");
}

#[test]
fn form_data_encodes_as_multipart_with_a_boundary() {
    // Checked inside the VM: the body is full of characters the probe channel
    // percent-encodes, so only the verdicts come back.
    let out = probe(
        "(function(){var f=new FormData();f.append('solution_metadata','V');\
         var b=__encodeBody(f);var first=b.split('\\r\\n')[0];\
         return [first.slice(0,24),\
                 b.indexOf('Content-Disposition: form-data; name=')>=0,\
                 b.slice(-(first.length+4))===first+'--\\r\\n',\
                 b.indexOf('\\r\\n\\r\\nV\\r\\n')>=0].join('~');})()",
    );
    let f: Vec<&str> = out.split('~').collect();
    assert_eq!(f.len(), 4, "probe returned {out:?}");
    assert_eq!(f[0], "------WebKitFormBoundary", "opens with the boundary");
    assert_eq!(f[1], "true", "names the field");
    assert_eq!(f[2], "true", "closes with the boundary");
    assert_eq!(f[3], "true", "carries the value after a blank line");
}

/// Two form bodies must not share a boundary, or a proxy that reuses one
/// truncates the second.
#[test]
fn each_form_body_gets_its_own_boundary() {
    let out = probe(
        "(function(){var a=new FormData();a.append('x','1');var b=new FormData();b.append('x','1');\
         return String(__encodeBody(a).split('\\r\\n')[0]!==__encodeBody(b).split('\\r\\n')[0]);})()",
    );
    assert_eq!(out, "true");
}

#[test]
fn performance_now_measures_synchronous_work() {
    let out = probe(
        "(function(){var t0=performance.now();\
         for(var s=Date.now(),e=s+5;Date.now()<e;);\
         return String(performance.now()-t0>=3);})()",
    );
    assert_eq!(out, "true", "5ms of real work must show up as elapsed time");
}

#[test]
fn request_idle_callback_actually_calls_back() {
    let out = probe(
        "(function(){var fired='no',arg='none';\
         requestIdleCallback(function(d){fired='yes';arg=typeof (d&&d.timeRemaining);});\
         __drainOnce();\
         return fired+'|'+arg;})()",
    );
    assert_eq!(out, "yes|function", "the deadline argument carries timeRemaining()");
}

#[test]
fn storage_enumerates_its_keys_and_nothing_else() {
    assert_eq!(probe("(localStorage.setItem('a', 1), Object.keys(localStorage).join())"), "a");
    assert_eq!(probe("(localStorage.setItem('a', 1), localStorage.length)"), "1");
    assert_eq!(probe("Object.prototype.toString.call(localStorage)"), "[object Storage]");
    assert_eq!(probe("(localStorage.setItem('a', 1), 'a' in localStorage)"), "true");
    assert_eq!(probe("(localStorage.setItem('a', 1), localStorage.key(0))"), "a");
    assert_eq!(probe("typeof localStorage.setItem"), "function");
    // Separate stores, as in a browser.
    assert_eq!(probe("(localStorage.setItem('a', 1), sessionStorage.length)"), "0");
}
