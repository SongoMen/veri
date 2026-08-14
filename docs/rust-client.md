# The Rust client

Everything the `veri` crate exposes. The Node client is documented separately in
[`clients/node/README.md`](../clients/node/README.md).

## Install

```toml
[dependencies]
veri = "0.1"
veri-js = "0.1"           # runs challenge scripts; needed by any protection that clears
veri-integrations = "0.1" # the five providers, one module each
```

`veri` alone knows about no provider. It will fetch, ladder identities, reuse
sessions and tell you a response was `Verdict::Challenged`, but nothing acts on
that until a protection is registered:

```rust
use std::sync::Arc;
use veri::Client;
use veri_integrations::{cloudflare, AwsWaf, Cloudflare};

let client = Client::builder()
    .protection(Arc::new(Cloudflare::with_solver(Arc::new(
        veri_js::V8Solver::new()
            .seed(cloudflare::CONFIG_OBJECT)
            .shadow_dom(true)
            .frames(true)
            .stopping_at(cloudflare::CLEARANCE_COOKIE),
    ))))
    .protection(Arc::new(AwsWaf::with_solver(Arc::new(
        veri_js::V8Solver::new().shadow_dom(true),
    ))))
    .build()?;
```

One solver, configured per protection. `V8Solver::new()` runs every script the
page carries; `.seed(name)` narrows that to the one inline script declaring that
global, which is what Cloudflare needs. The options above are the ones measured
to work, so start from them rather than the bare defaults. See
[Shadow DOM](how-it-works.md#shadow-dom).

`detect_only()` in place of `with_solver(..)` classifies a challenge without
attempting it, which is what you want if you only need to know what a host is
running.

`veri-js` embeds V8, so the first build downloads a ~100 MB prebuilt
`librusty_v8.a` into `target/`. No C++ toolchain, but it does need network, and
it is cached per target directory rather than in `~/.cargo`.

## Requests

`get` `post` `put` `patch` `delete` `head`, then `.header()` `.headers()`
`.query()` `.json()` `.form()` `.body()` `.timeout()`, finished with `.send()`.

Responses carry `.text()` `.bytes()` `.json::<T>()` `.error_for_status()` plus
`status`, `headers`, and how the result was obtained: `identity`, `attempts`,
`cleared`, `used_clearance`.

Note `is_success()` (HTTP 2xx) and `is_ok()` (a real response, not a challenge)
are different questions, a challenge page can arrive with a 200.
`error_for_status()` asks the first one, so a challenge survives it.

## Timeouts, retries and limits

The defaults are chosen so that nothing here has to be remembered to be safe.

|                         | Default | Set with                                                |
| ----------------------- | ------- | ------------------------------------------------------- |
| One HTTP request        | 60s     | `.timeout(d)`, `.no_timeout()`                          |
| Connect                 | 10s     | `.connect_timeout(d)`                                   |
| Buffered body           | 64 MiB  | `.max_response_bytes(n)`, `.unlimited_response_bytes()` |
| Retries per request     | 2       | `.retry(RetryPolicy::times(n))`, `RetryPolicy::none()`  |
| Redirects followed      | 10      | `.redirect_limit(n)`                                    |
| One solve, start to end | 90s     | `V8Solver::new().timeout(d)`                            |

**The first and the last do not bound each other**, which the numbers make it
easy to assume. `.timeout(d)` is handed to the HTTP client and covers a single
request, redirects and body read included. A solve happens _between_ requests,
after a challenge has been received and before the retry, so nothing about it is
inside that window: a 90s solve completes under a 60s request timeout, and the
call that contains it takes as long as it takes. Only the solver's own deadline
stops a challenge. `crates/veri/tests/timeouts.rs` pins this.

The requests a challenge makes through the bridge are ordinary requests on the
same client, so each one _is_ bounded by `.timeout(d)`.

Bodies are read into memory, so the cap is what stops one oversized response
taking down the process.

Retries cover transport failures, 429 and 5xx, and honour `Retry-After`.
Challenges and blocks are _not_ retried.

## Cookies

Three ways to supply your own, all of which reach the wire:

```rust
// One request only.
client.get(url).header("cookie", "session=abc; other=1").send().await?;

// Every request from this client.
let client = Client::builder().header("cookie", "api=key").build()?;

// Into the jar for a host, so every later request carries it, including every
// rung of the identity ladder, and anything a protection earns alongside it.
client.set_cookie("example.com", "session=abc; Path=/");
let held = client.cookie("example.com", "session");
```

The jar and your own cookies are merged, not swapped: yours win on a name
collision and the rest of the jar still goes out, in a single `cookie` header.
That matters because a clearance the ladder just earned lives in the jar, and
replacing the header would throw it away.

## Session reuse

A challenge is solved once. Every request afterwards rides the resulting
clearance at ordinary speed, so the cost is paid on the first request and not
again.

```rust
let client = veri::Client::builder()
    .protection(Arc::new(Cloudflare::with_solver(Arc::new(
        veri_js::V8Solver::new().seed(cloudflare::CONFIG_OBJECT),
    ))))
    .build()?;

for _ in 0..4 {
    let res = client.get(url).send().await?;
    println!("{} {} {}", res.status, res.used_clearance, res.attempts);
}
assert!(client.has_clearance("example.com"));
```

`has_clearance` reports whether clearance was actually earned for a host, which
is worth checking on failure: a fetch that never cleared and a path that
re-challenges every caller look identical otherwise. See
[When a zone requires a newer Chrome than we can present](how-it-works.md#when-a-zone-requires-a-newer-chrome-than-we-can-present).

`client.open_sessions()` counts the sessions being held, which is what grows
when a client is reused across many hosts.

`client.forget(host)` drops every session for a host, worth doing when a
clearance stops working, or when a proxy's egress IP rotates, since clearance
is bound to the IP that earned it.

## Logging

The client emits `tracing` spans and events, one span per request, then events
per ladder rung, retry and clear attempt. It depends on the facade only, so if
you install no subscriber it costs nothing.

```rust
tracing_subscriber::fmt().with_env_filter("veri=debug").init();
```

## Runtime requirement

Clearing a challenge needs the **multi-thread** tokio runtime. The solver is a
V8 isolate mid-execution, so its network calls are driven synchronously with
`block_in_place`, which `#[tokio::main(flavor = "current_thread")]` cannot
support. Plain requests work on either; only solving is affected, and it reports
the reason rather than panicking.
