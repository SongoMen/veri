//! Per-host memory of which identity works.

use std::collections::HashMap;
use std::sync::Mutex;
use veri_core::{Identity, Verdict};

/// How many consecutive failures before a remembered winner is abandoned.
pub const DEMOTE_AFTER: u32 = 2;

#[derive(Debug, Default)]
struct HostState {
    preferred: Option<&'static str>,
    strikes: u32,
    blocked: Vec<&'static str>,
}

#[derive(Debug, Default)]
pub struct Policy {
    hosts: Mutex<HashMap<String, HostState>>,
}

impl Policy {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn order(&self, host: &str, ladder: &[Identity]) -> Vec<Identity> {
        let hosts = self.hosts.lock().unwrap();
        let state = hosts.get(host);

        let mut ordered: Vec<Identity> = Vec::with_capacity(ladder.len());
        if let Some(pref) = state.and_then(|s| s.preferred) {
            if let Some(id) = ladder.iter().find(|i| i.name == pref) {
                ordered.push(*id);
            }
        }
        let blocked = state.map(|s| s.blocked.as_slice()).unwrap_or(&[]);
        for id in ladder {
            if ordered.iter().any(|o| o.name == id.name) || blocked.contains(&id.name) {
                continue;
            }
            ordered.push(*id);
        }
        for id in ladder {
            if !ordered.iter().any(|o| o.name == id.name) {
                ordered.push(*id);
            }
        }
        ordered
    }

    pub fn record(&self, host: &str, identity: &Identity, verdict: Verdict) {
        let mut hosts = self.hosts.lock().unwrap();
        let state = hosts.entry(host.to_string()).or_default();

        if verdict.is_ok() {
            state.preferred = Some(identity.name);
            state.strikes = 0;
            state.blocked.retain(|b| *b != identity.name);
            return;
        }

        if verdict == Verdict::Blocked && !state.blocked.contains(&identity.name) {
            state.blocked.push(identity.name);
        }
        if state.preferred == Some(identity.name) {
            state.strikes += 1;
            if state.strikes >= DEMOTE_AFTER {
                state.preferred = None;
                state.strikes = 0;
            }
        }
    }

    pub fn record_probe(&self, host: &str, identity: &Identity, verdict: Verdict) {
        if verdict != Verdict::Blocked {
            return;
        }
        let mut hosts = self.hosts.lock().unwrap();
        let state = hosts.entry(host.to_string()).or_default();
        if !state.blocked.contains(&identity.name) {
            state.blocked.push(identity.name);
        }
    }

    pub fn preferred(&self, host: &str) -> Option<&'static str> {
        self.hosts.lock().unwrap().get(host).and_then(|s| s.preferred)
    }
}
