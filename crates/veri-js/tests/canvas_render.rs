//! The canvas must answer for what was drawn on it.

mod common;
use common::probe;

const DRAW: &str = "function(t){var c=document.createElement('canvas');var x=c.getContext('2d');\
     x.textBaseline='top';x.font='14px Arial';x.fillText(t,2,2);return c.toDataURL();}";

#[test]
fn different_drawings_produce_different_images() {
    let out = probe(&format!("(function(){{var d={DRAW};return d('veri')===d('other');}})()"));
    assert_eq!(out, "false", "two different drawings produced the same image");
}

#[test]
fn the_same_drawing_is_stable() {
    let out = probe(&format!("(function(){{var d={DRAW};return d('veri')===d('veri');}})()"));
    assert_eq!(out, "true", "a fingerprint must be reproducible within a run");
}

#[test]
fn an_untouched_canvas_keeps_the_harvested_render() {
    let out = probe(
        "(function(){var c=document.createElement('canvas');\
         return c.toDataURL().indexOf('data:image/png;base64,')===0;})()",
    );
    assert_eq!(out, "true");
}
