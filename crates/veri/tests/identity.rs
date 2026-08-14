use veri::identity::{by_name, DEFAULT_LADDER, KNOWN};

#[test]
fn every_ladder_entry_resolves() {
    for name in DEFAULT_LADDER {
        assert!(by_name(name).is_some(), "ladder names an unknown identity: {name}");
    }
}

#[test]
fn user_agent_matches_family() {
    for id in KNOWN {
        if id.name.starts_with("Firefox") {
            assert!(id.user_agent.contains("Firefox/"), "{}", id.name);
        } else if id.name.starts_with("Chrome") {
            assert!(id.user_agent.contains("Chrome/"), "{}", id.name);
        } else if id.name.starts_with("Safari") {
            assert!(
                id.user_agent.contains("Safari/") && !id.user_agent.contains("Chrome/"),
                "{}",
                id.name
            );
        }
    }
}

#[test]
fn versions_agree_between_name_and_ua() {
    for id in KNOWN {
        let digits: String = id.name.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            continue;
        }
        assert!(
            id.user_agent.contains(&digits),
            "{} claims version {digits} but its UA does not",
            id.name
        );
    }
}
