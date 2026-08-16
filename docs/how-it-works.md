# How it works

The browser environment, and the parts of it that turned out to be
load-bearing.

## The browser environment is harvested

Anything that measures a JavaScript environment asks it hundreds of questions
and checks the answers are mutually consistent and match a real machine. A
hand-written surface does not survive that, and it has to avoid identifying
_itself_ as well.

So `tools/harvest.html` runs once in a real Chrome and writes down what it sees:
every global name, every constructor prototype and every member on it, the
inheritance chain linking them, the installed fonts with their metrics, and the
machine's own canvas render, WebGL parameters and audio fingerprint. It runs to
several thousand entries; the profile itself is the only accurate count.

It ships **inside `veri-js`** (`profiles/chrome.json`), so nothing is required
of you at install time, and it says which Chrome it came from:

```rust
let m = veri_js::vm::profile_meta();
println!("Chrome {} harvested {}", m.chrome, m.harvested_at);
```

A JSON snapshot cannot carry behaviour, so `env/` fill that in: a
DOM with layout and events, canvas 2D that encodes real PNG bytes, WebGL 1 and 2
with the machine's own parameters and shader precisions, `AudioContext`,
WebCrypto with real AES-GCM and SHA-256, Workers with `MessageChannel` and
`MessagePort`, WebAssembly including the streaming entry points, `Intl`,
storage, timers, and the document lifecycle in the order a browser fires it.

Hand-written stubs fail two ways this avoids: an empty `X.prototype` fails a
capability gate, and prototypes without their inheritance chain fail every
`instanceof` check.

## The profile is one machine

`profiles/chrome.json` is a single real machine: its canvas render, its ANGLE
renderer string, its audio fingerprint, its screen. Every install therefore
presents the _same_ device, and one canvas hash clusters all of them together.

Timezone is the one that matters most in practice, because a fixed
`America/New_York` behind an egress on another continent contradicts itself:

```rust
veri_js::V8Solver::new().seed(name).timezone("Europe/Berlin")
```

```
VERI_TIMEZONE=Europe/Berlin              # read by V8Solver::new
```

Re-harvesting per deployment is the real answer; a shared profile is a
reasonable default, not a good disguise. It also goes stale, since Chrome ships
new APIs every few weeks. Open `tools/harvest.html`, press **Save profile**, and
replace `crates/veri-js/profiles/chrome.json` with what it writes.

Harvest from a **headed** browser. A headless run captures the same globals and
prototypes, but its window-shaped values are not a real machine's: 800x600 at
`colorDepth` 24 with `devicePixelRatio` 1, versus 1512x982 at 30 and 2 for the
same Chrome with a window.

## The scripts fetch through the client that fetched the page

A DOM alone is not much use to a page: its scripts have to fetch, and that is
where the fidelity is usually lost, because the JavaScript's requests leave
through something other than the connection the page arrived on. Different
fingerprint, different jar, often a different address.

`fetch`, `XMLHttpRequest` and `<script src>` are implemented in `env/` against
`__HOST_FETCH`, which is not JavaScript. It is a Rust function bound into
the isolate at startup (`vm/bridge.rs`), and it calls whichever
`veri_core::HttpBridge` the caller installed. `veri` installs `SessionBridge`,
which holds the session that fetched the page:

```
client.get(url) ──► page ──► its scripts run in the environment
                                    │  fetch / XHR / <script src>
                                    ▼
                              __HOST_FETCH  (Rust)
                                    ▼
                     the same wreq client, jar, proxy and IP
```

So a script's request carries the identity's TLS and HTTP/2 fingerprint, arrives
from the same address as the page, and any cookie it is handed lands in the jar
the next request reads from.

The bridge is synchronous. It uses `block_in_place`, so
solving needs a multi-threaded tokio runtime and says so rather than hanging:

```
veri: solving requires a multi-thread tokio runtime;
#[tokio::main(flavor = "current_thread")] cannot drive a challenge
```

Three methods cross it: `request`, `request_bytes` for a binary body such as a
WebAssembly module, and `request_with_headers` where the page sets its own.

## How a page's demands are handled

`veri` classifies a response, hands the page to
whichever integration claimed it, and that integration runs the page's own
scripts and reads the jar afterwards. Nothing about a provider's protocol is
encoded: the page sets cookies, and the cookies it set are the answer.

## Shadow DOM

Every page uses shadow DOM the ordinary way, so
`shadow_dom(true)` is what a solver normally wants and what every protection
registered by the daemon and `veri-tools` sets.

`V8Solver::shadow_dom` carries it and `crates/veri-js/tests/page_solver.rs`
pins both directions.

## No ICU data

The `v8` crate ships without ICU, and the failure modes are not graceful:
`Intl.DateTimeFormat` **aborts the process** (`Fatal process out of memory:
DateTimePatternGeneratorCache::CreateGenerator`), while `Intl.NumberFormat` and
`Intl.Collator` throw `Internal error. Icu error.`, which no real browser does.

Reading the timezone is close to universal in fingerprinting, so all three are
replaced in `env/03-platform.js` rather than left to fail. The replacement also
controls what is reported: without it the VM tells the truth about the _host
machine_, which disagrees with the proxy exit IP. DST is modelled for the EU and
US rules; zones outside the table get a fixed offset.

`crates/veri-js/tests/intl.rs` guards this. A regression there is a hard abort
rather than a failing assertion, which is precisely why it is pinned.

## When a zone requires a newer Chrome than we can present

Some zones require a **current** Chrome and reject an older one even when it is
a genuine browser.

`veri` can only present the newest fingerprint `wreq-util` ships, today
`Chrome149`. Against a zone like that the check is still completed and clearance
is still issued, but the document request is challenged again and the client
reports it as cleared-but-rechallenged (`Error::cleared_but_rechallenged()` in
Rust, `e.clearedButRechallenged` in Node). The fix is to bump `wreq-util` when
it ships a newer Chrome. Pairing a newer User-Agent with an older emulation is
itself detectable, and `crates/veri/tests/identity_ua.rs` fails if an identity
and its emulation disagree about who they are.
