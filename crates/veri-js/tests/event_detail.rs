//! A dispatched event has to reach its listener carrying its fields. A sensor
//! that hands data to itself through `dispatchEvent(new CustomEvent(type, {detail}))`
//! and reads `e.detail.data` in the handler will throw on `undefined` if the
//! dispatch delivers a stripped copy - which is what an `Object.assign` merge of
//! an event whose fields live on the prototype does.

mod common;
use common::probe;

#[test]
fn custom_event_detail_reaches_the_listener() {
    let got = probe(
        "(function(){var seen;\
         document.addEventListener('ak_t', function(e){ seen = e.detail && e.detail.data; });\
         document.dispatchEvent(new CustomEvent('ak_t', { detail: { data: 42 } }));\
         return seen;})()",
    );
    assert_eq!(got, "42", "CustomEvent detail did not reach the listener");
}

#[test]
fn custom_event_detail_defaults_to_null() {
    let got = probe(
        "(function(){var seen='unset';\
         document.addEventListener('ak_u', function(e){ seen = e.detail; });\
         document.dispatchEvent(new CustomEvent('ak_u'));\
         return seen;})()",
    );
    assert_eq!(got, "null", "a detail-less CustomEvent should deliver detail === null");
}

#[test]
fn dispatched_event_is_untrusted_and_targets_its_dispatcher() {
    // A constructed event is never trusted, and dispatchEvent sets its target.
    let trusted = probe(
        "(function(){var t;\
         document.addEventListener('ak_v', function(e){ t = e.isTrusted; });\
         document.dispatchEvent(new Event('ak_v'));\
         return t;})()",
    );
    assert_eq!(trusted, "false", "a constructed, dispatched event must be untrusted");

    let target = probe(
        "(function(){var ok;\
         document.addEventListener('ak_w', function(e){ ok = e.target === document; });\
         document.dispatchEvent(new Event('ak_w'));\
         return ok;})()",
    );
    assert_eq!(target, "true", "dispatchEvent should set the event target to the dispatcher");
}
