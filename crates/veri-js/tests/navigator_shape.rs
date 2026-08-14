mod common;
use common::probe;

#[test]
fn navigator_values_survive_the_move_to_accessors() {
    assert_eq!(probe("navigator.userAgent"), "ua", "the solver's UA must come through");
    assert_eq!(probe("navigator.platform"), "MacIntel");
    assert_eq!(probe("navigator.webdriver"), "false");
    assert_eq!(probe("navigator.hardwareConcurrency"), "10");
    assert!(probe("screen.width").parse::<u32>().unwrap_or(0) > 0);
}

#[test]
fn navigator_looks_like_a_real_one() {
    let d = |o: &str, k: &str| {
        probe(&format!(
            "(function(){{var x=Object.getOwnPropertyDescriptor({o},'{k}');\
              return x?(typeof x.get==='function'?'getter':'data'):'none';}})()"
        ))
    };
    assert_eq!(d("Navigator.prototype", "userAgent"), "getter");
    assert_eq!(d("Navigator.prototype", "webdriver"), "getter");
    assert_eq!(d("Screen.prototype", "width"), "getter");

    assert_eq!(probe("Object.getOwnPropertyNames(navigator).length"), "0");

    assert!(
        probe("Object.getOwnPropertyDescriptor(Navigator.prototype,'userAgent').get.toString()")
            .contains("native code"),
        "the getter must not expose its source"
    );
}
