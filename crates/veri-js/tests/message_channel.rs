//! A challenge that pings itself through a `MessageChannel` to sample the event

mod common;
use common::{echoed, CHROME_UA};

fn round_trip(body: &str) -> String {
    echoed(
        &format!(
            "<html><body><script>\
             function done(v) {{ \
               var x = new XMLHttpRequest(); \
               x.open('GET', 'https://echo.test/' + encodeURIComponent(String(v))); \
               x.send(); \
             }}\
             {body}\
             </script></body></html>"
        ),
        CHROME_UA,
    )
}

#[test]
fn a_port_delivers_to_its_peer() {
    assert_eq!(
        round_trip(
            "var c = new MessageChannel();\
             c.port1.onmessage = function (e) { done(e.data); };\
             c.port2.postMessage('through-the-channel');"
        ),
        "through-the-channel"
    );
}

#[test]
fn delivery_goes_to_the_peer_and_not_the_sender() {
    assert_eq!(
        round_trip(
            "var c = new MessageChannel();\
             var seen = [];\
             c.port1.onmessage = function (e) { seen.push('p1:' + e.data); };\
             c.port2.onmessage = function (e) { seen.push('p2:' + e.data); };\
             c.port1.postMessage('a');\
             c.port2.postMessage('b');\
             setTimeout(function () { done(seen.join(',')); }, 0);"
        ),
        "p2:a,p1:b"
    );
}

#[test]
fn delivery_is_scheduled_not_synchronous() {
    assert_eq!(
        round_trip(
            "var c = new MessageChannel();\
             var order = [];\
             c.port1.onmessage = function (e) { order.push('message'); };\
             c.port2.postMessage('x');\
             order.push('after-post');\
             setTimeout(function () { done(order.join(',')); }, 0);"
        ),
        "after-post,message"
    );
}

#[test]
fn messages_posted_before_start_are_queued() {
    assert_eq!(
        round_trip(
            "var c = new MessageChannel();\
             var seen = [];\
             c.port1.addEventListener('message', function (e) { seen.push(e.data); });\
             c.port2.postMessage('early');\
             setTimeout(function () { \
               done('before=' + seen.length + ' after=' + (c.port1.start(), 0)); \
             }, 0);"
        ),
        "before=0 after=0"
    );
}

#[test]
fn a_queued_message_arrives_once_the_port_starts() {
    assert_eq!(
        round_trip(
            "var c = new MessageChannel();\
             var seen = [];\
             c.port1.addEventListener('message', function (e) { seen.push(e.data); });\
             c.port2.postMessage('early');\
             c.port1.start();\
             setTimeout(function () { done(seen.join(',')); }, 0);"
        ),
        "early"
    );
}

#[test]
fn a_closed_port_receives_nothing() {
    assert_eq!(
        round_trip(
            "var c = new MessageChannel();\
             var seen = 0;\
             c.port1.onmessage = function () { seen++; };\
             c.port1.close();\
             c.port2.postMessage('x');\
             setTimeout(function () { done('received=' + seen); }, 0);"
        ),
        "received=0"
    );
}

/// The profile still has to supply the constructors, so `instanceof` and the
/// prototype chain keep answering the way a capability gate expects.
#[test]
fn the_constructors_still_look_like_the_real_ones() {
    assert_eq!(round_trip("done(typeof MessageChannel);"), "function");
    assert_eq!(round_trip("done(new MessageChannel().port1 instanceof MessagePort);"), "true");
    assert_eq!(round_trip("done(typeof MessagePort.prototype.postMessage);"), "function");
}
