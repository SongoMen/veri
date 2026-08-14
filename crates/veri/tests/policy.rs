use veri::identity;
use veri::policy::{Policy, DEMOTE_AFTER};
use veri_core::{Identity, Verdict};

fn ladder() -> Vec<Identity> {
    identity::DEFAULT_LADDER.iter().filter_map(|n| identity::by_name(n)).collect()
}

#[test]
fn winner_is_tried_first_next_time() {
    let p = Policy::new();
    let l = ladder();
    let chrome = identity::by_name("Chrome143").unwrap();
    p.record("example.com", &chrome, Verdict::Ok);
    assert_eq!(p.order("example.com", &l)[0].name, "Chrome143");
    assert_eq!(p.order("other.com", &l)[0].name, l[0].name);
}

#[test]
fn one_failure_does_not_demote() {
    let p = Policy::new();
    let id = identity::by_name("Firefox143").unwrap();
    p.record("h", &id, Verdict::Ok);
    p.record("h", &id, Verdict::Challenged);
    assert_eq!(p.preferred("h"), Some("Firefox143"), "a single blip should not thrash");
}

#[test]
fn repeated_failure_demotes() {
    let p = Policy::new();
    let id = identity::by_name("Firefox143").unwrap();
    p.record("h", &id, Verdict::Ok);
    for _ in 0..DEMOTE_AFTER {
        p.record("h", &id, Verdict::Challenged);
    }
    assert_eq!(p.preferred("h"), None);
}

#[test]
fn blocked_identity_sinks_but_survives() {
    let p = Policy::new();
    let l = ladder();
    let first = l[0];
    p.record("h", &first, Verdict::Blocked);
    let order = p.order("h", &l);
    assert_eq!(order.len(), l.len(), "blocked identities are demoted, never dropped");
    assert_eq!(*order.last().unwrap(), first);
}

#[test]
fn probing_does_not_hijack_the_preference() {
    let p = Policy::new();
    let l = ladder();
    let first = l[0];
    p.record("h", &first, Verdict::Ok);

    for id in &l {
        p.record_probe("h", id, Verdict::Ok);
    }

    assert_eq!(
        p.preferred("h"),
        Some(first.name),
        "a probe must not change which identity the client prefers"
    );
}

#[test]
fn probing_still_learns_blocks() {
    let p = Policy::new();
    let l = ladder();
    p.record_probe("h", &l[0], Verdict::Blocked);
    assert_eq!(*p.order("h", &l).last().unwrap(), l[0]);
}

#[test]
fn success_clears_a_block() {
    let p = Policy::new();
    let l = ladder();
    let id = l[0];
    p.record("h", &id, Verdict::Blocked);
    p.record("h", &id, Verdict::Ok);
    assert_eq!(p.order("h", &l)[0].name, id.name);
}
