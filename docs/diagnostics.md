# Diagnostics

The tools for answering "what is actually happening on this host", and what
has to be true for an answer to mean anything.

## Tools

The tools live in `tools/veri-tools`, outside the published crates.

```
cargo run --release -p veri-tools --bin fetch -- <url> [identity] [--proxy <url>]
cargo run --release -p veri-tools --bin check -- --url <url> --proxy <url> --solve
cargo run --release -p veri-tools --bin walkthrough -- <url> [identity] --proxy <url>
cargo run --release -p veri-tools --bin env_probe -- <probe.js>
```

**`check`** is the one to reach for: give it your targets and your proxies and it
tells you what to configure, rather than leaving you to guess.

```
$ cargo run --release -p veri-tools --bin check -- \
    --url https://site.com/api --url https://other.com \
    --proxy http://user:pass@p1:8000 --solve

  https://site.com/api
    Firefox143   ok     http=200    11016b    524ms  [cloudflare]
    Chrome143    ok     http=200    11016b    484ms  [cloudflare]
    OkHttp5      solved http=200    11016b   3549ms  [cloudflare]

  https://other.com
    Firefox143   err    http=401      775b    435ms  (datadome, cloudfront)
    → nothing worked; fronted by: cloudfront, datadome

══ summary ══
  recommended settings:
    site.com      via p1:8000   → Chrome143
  unreachable:
    other.com via p1:8000
```

When nothing works it names the provider in front of the host, which is usually
the whole answer, an unsupported provider looks identical to a bug otherwise.
Repeat `--url` and `--proxy` to widen the matrix; add `--direct` to include the
unproxied path, `--solve` to find out whether a challenge is actually clearable,
and `--identity` to narrow the set.

**`walkthrough`** runs its checks with PASS/FAIL/SKIP and leads its summary
with whether the target was reached at all, so offline checks cannot pad the
score.

## Operational notes

**Use a sticky proxy** if you rely on clearing. Clearance is bound to the IP that
earned it, so an endpoint that rotates between the challenge and its submission
can never complete one.

**Verify with the clearance cookie, never with page-clearing.** A `__cf_bm`
cookie from the challenged request alone re-opens many endpoints, so "the retry
returned 200" proves nothing.

**Cost per solve:** ~200 MB peak. Cloudflare measured a 3.2s median over 15
consecutive solves on fresh addresses, 1.6s to 5.2s; Vercel's checkpoint 2.5s.
Requests afterwards cost ~200 ms, so solve rarely and reuse heavily, keep one
`Client` for the life of your process and clone it into tasks.

Memory is tunable via `.heap_mb()` or `VERI_HEAP_MB` (default 128). The measured
floor is 32–48 MiB; above that the cap barely changes resident memory, so the
default leaves margin for free. Exceeding it does **not** abort, a near-limit
callback grows the heap instead, because a library has no business calling
`abort()` in someone else's server.

**A challenge that never returns is terminated.** The solver executes
adversary-supplied code synchronously on the calling thread, so a watchdog
stops the isolate at the deadline rather than leaving a worker wedged. The
challenge is driven by bounding _rounds_ of timers, which does nothing about a
single callback that loops forever; this is what does.

The switches are individual, so a run can record one thing without paying
for all of them:

```rust
V8Solver::new()
    .seed("_cf_chl_opt")
    .diagnostics(true)              // every property access
    .trace_undefined_calls(true)    // calls to names the environment lacks
    .trace_caught_exceptions(true)  // exceptions the challenge swallowed
    .capture_scripts_to("/tmp/run");
```

`diagnostics(true)` records every property access and captures decoded
sources, landing on `SolveReport::diagnostics`. It costs
roughly 6x the memory, so it is not for serving traffic, a solve without it
runs none of that collection at all.

**Some paths re-challenge regardless of clearance.** Observed on one host: the
clearance is valid and domain-wide (it works on API paths), but page paths serve
a fresh challenge every time. The ladder usually handles those, browser
identities often pass them without a challenge at all.

## Environment variables

Every one of these is read once, by `V8Solver::new`, and each supplies a
default that the matching option overrides.

| Variable                  | Read by         | Effect                                                    |
| ------------------------- | --------------- | --------------------------------------------------------- |
| `VERI_TIMEZONE`           | `V8Solver::new` | IANA name reported to the challenge                       |
| `VERI_HEAP_MB`            | `V8Solver::new` | Starting V8 old-space per solve                           |
| `VERI_SOLVE_TIMEOUT_SECS` | `V8Solver::new` | Solve deadline; `0` disables it                           |
| `VERI_CAPTURE`            | `V8Solver::new` | Directory to write loaded scripts and decoded layers into |
| `VERI_TRACE_CATCH`        | `V8Solver::new` | Report exceptions the challenge swallows                  |
| `VERI_TRACE_UNDEF`        | `V8Solver::new` | Record calls to names the environment does not define     |

The rest are read elsewhere and are not solver options at all:

| Variable               | Read by            | Effect                                                                                                                                           |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VERI_PUMP_ROUNDS`     | the solve loop     | Timer rounds a challenge gets before the run gives up. Default 2000. Raise it for a challenge that keeps scheduling work rather than finishing   |
| `VERI_NOSEAL`          | the solve loop     | Leaves the environment's internals unsealed. For debugging only: a challenge can then see them                                                   |
| `VERI_FLOW`            | the solve loop     | Print every bridge call with the milliseconds it happened at, its sent and received bytes, the cookies the page set, and the errors it swallowed |
| `VERI_REALM_URL`       | the solve loop     | Resolve a relative url against the realm that asked rather than the page. Off, and measured 0/4 against 6/6; see above                           |
| `VERI_MAX_CONCURRENCY` | `veri-daemon`      | Requests solved at once. Default 16                                                                                                              |
| `VERI_DAEMON_PATH`     | the Node client    | Explicit path to the daemon binary, ahead of the platform package                                                                                |
| `VERI_PROXY`           | `tools/veri-tools` | Proxy for the developer tools, when `--proxy` is not passed                                                                                      |

## Testing

```
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
(cd clients/node && node tests/index.js)      # offline, drives a mock daemon
tools/reliability.sh <url> <identity> <iterations>
```

CI runs all of these on Linux, macOS and Windows. Nothing here needs the
network: the integration tests drive a local socket server that resets
connections, streams unbounded chunked bodies and accepts-then-hangs, and the
solver tests run challenges that never terminate.
