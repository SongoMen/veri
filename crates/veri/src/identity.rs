use veri_core::Identity;
use wreq_util::{Emulation, Profile};

const CHROME_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                         (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const CHROME_149_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                             (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const CHROME_124_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                             (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FIREFOX_143_UA: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0";
const FIREFOX_151_UA: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:151.0) Gecko/20100101 Firefox/151.0";
const SAFARI_18_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
                            (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const SAFARI_26_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
                            (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const SAFARI_IOS_26_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) \
                                AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 \
                                Mobile/15E148 Safari/604.1";
const OKHTTP_5_UA: &str = "NRC Audio/2.0.6 (nl.nrc.audio; build:36; Android 14; Sdk:34; \
                           Manufacturer:OnePlus; Model: CPH2609) OkHttp/5.0.0-alpha2";

pub const KNOWN: &[Identity] = &[
    Identity::new("Firefox143", FIREFOX_143_UA),
    Identity::new("Safari18", SAFARI_18_UA),
    Identity::new("Firefox151", FIREFOX_151_UA),
    Identity::new("Safari26", SAFARI_26_UA),
    Identity::new("Chrome143", CHROME_UA),
    Identity::new("Chrome149", CHROME_149_UA),
    Identity::new("Chrome124", CHROME_124_UA),
    Identity::new("SafariIos26", SAFARI_IOS_26_UA),
    Identity::new("OkHttp5", OKHTTP_5_UA),
];

pub const DEFAULT_LADDER: &[&str] =
    &["Firefox143", "Firefox151", "Safari26", "Chrome149", "SafariIos26", "Chrome143"];

pub fn by_name(name: &str) -> Option<Identity> {
    KNOWN.iter().copied().find(|i| i.name == name)
}

/// Internal: the return type is `wreq_util`'s, and the point of [`crate::error`]
/// is that no dependency of ours appears in a caller's types.
pub(crate) fn profile_for(identity: &Identity) -> Profile {
    match identity.name {
        "Firefox143" => Emulation::Firefox143,
        "Firefox151" => Emulation::Firefox151,
        "Safari18" => Emulation::Safari18,
        "Safari26" => Emulation::Safari26,
        "Chrome149" => Emulation::Chrome149,
        "Chrome124" => Emulation::Chrome124,
        "SafariIos26" => Emulation::SafariIos26,
        "OkHttp5" => Emulation::OkHttp5,
        _ => Emulation::Chrome143,
    }
}
