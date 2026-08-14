# veri

An HTTP client that sees what a browser sees.

```js
const { Veri } = require('veri-http');
const veri = new Veri();

const res = await veri.get('https://example.com/api/data');
```

```
200  ok  11016b  via Firefox143  rung 1
200  ok  11016b  via Firefox151  rung 3  cleared cloudflare
```

Some pages only exist after their JavaScript has run: a single-page app's real
content, a redirect, a cookie handshake, the interstitial a CDN shows before it
lets a browser through. An ordinary client sees none of it, so what it measures
is not what your users get.

`veri` runs those scripts in-process, in an environment materialised from a real
Chrome, fetching back out through the client that brought the page down. Same
TLS fingerprint, same jar, same exit IP, and no browser process. Peak memory
runs 64-278 MB against 1.2-1.5 GB for a headless Chromium doing the same work.

## Start here

|                                           |                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| [The Node client](clients/node/README.md) | `npm install veri-http`, then the full API reference.                                 |
| [The Rust client](docs/rust-client.md)    | `cargo add veri veri-js`, then the same.                                              |
| [How it works](docs/how-it-works.md)      | The environment, the bridge, and which details turned out to be load-bearing.         |
| [Diagnostics](docs/diagnostics.md)        | Answering "what is this host actually doing", and what makes an answer mean anything. |
| [Benchmark](tools/bench/README.md)        | Method, results, and what would make the numbers lie.                                 |

Node needs no Rust toolchain: the daemon arrives as a platform package npm picks
by `os` and `cpu`.

## What it is for

Reaching services you are entitled to reach: **your own sites and APIs**,
endpoints you have an agreement with, and public data you are permitted to
collect.

**It does not solve CAPTCHAs, and cannot be made to.** A CAPTCHA is drawn for a
person, and the type system says so: only `Demand::Script` is a challenge, and a
CAPTCHA maps to `Blocked` however scripted its page looks.

## What makes it different

**The browser environment is harvested.** `tools/harvest.html`
runs once in a real Chrome and writes down what it sees: every global name,
every constructor prototype and the inheritance chain between them, the
machine's own canvas, WebGL and audio, its installed fonts. `env/` materialises
that at startup and adds what a snapshot cannot carry, a DOM with events, canvas
that encodes real PNG bytes, WebCrypto, Workers, WebAssembly, the document
lifecycle. A test diffs every name on the global object against the harvest and
fails on a single extra.

**The page's scripts fetch through the client that fetched the page.** This is
the part nothing else does in-process. `fetch`, `XMLHttpRequest` and
`<script src>` come out of the isolate into the session that loaded the
document.

So a script's request carries the same TLS fingerprint, arrives from the same
address, and any cookie it is handed lands in the jar the next request reads
from. It is also why the integrations are so small: they run the page and read
the jar, and none of them knows which endpoint issued what.

Everything else is what you would expect of a client: retries, redirects,
timeouts, proxies, response caps, one warm session and cookie jar per host.
[How it works](docs/how-it-works.md) has the rest of the story: the harvest in
full, what goes stale, the bridge, and the handful of environment details that
turned out to decide whether a check passes.

## Integrations

Cloudflare, DataDome, AWS WAF, PerimeterX and Vercel's Security Checkpoint
each have an adapter, and each is small. They classify a response, and
where the check is scripted they hand the page to `veri-js` and report what came
back. In Node all five are registered by default; Cloudflare, AWS WAF and Vercel
clear, while DataDome and PerimeterX classify only. `solver: false` leaves
all five classifying. In Rust you register the ones you want, one crate each.

Each adapter's own documentation carries what it has actually been measured
doing, and against what.

## Crates

| Crate               | Purpose                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `veri-js`           | The environment and the V8 isolate it runs in. Knows no provider.                          |
| `veri`              | The client: transport, identity ladder, per-host policy, sessions.                         |
| `veri-core`         | Verdicts, identities, the `Protection` / `Solver` / `HttpBridge` traits. Dependency-light. |
| `veri-integrations` | The five providers, one module each. Depends on `veri-core` alone.                         |
| `veri-testkit`      | Test scaffolding shared by the integrations. Not published.                                |
| `veri-daemon`       | The long-lived process the Node client drives over stdio. Not published.                   |

An integration owns its own verification. The client cannot check "did that
work" generically, because every system binds its result differently.

The transport underneath is [`wreq`](https://crates.io/crates/wreq), which is
what makes the socket look like the browser an identity claims to be. It is
Apache-2.0, and since the npm platform packages ship a compiled daemon they
carry `THIRD-PARTY-LICENSES.md` beside it.

## Benchmark

`tools/bench` puts the same load through `axios`, headless Chromium, Chromium
with the stealth plugin, and **veri**. The targets are **yours**:
`tools/bench/targets.json` is git-ignored and ships with nothing, so these
numbers describe whichever endpoints you point it at.

The question is what it costs to see a page the way a browser sees it. On a site
with nothing fighting back, where every contender scores 100% and only the cost
differs:

| 1000 requests, no protection | median | req/s    | peak MB |
| ---------------------------- | ------ | -------- | ------- |
| **veri**                     | 134ms  | **21.9** | **122** |
| axios (cannot run the page)  | 148ms  | 25.4     | 129     |
| headless chromium            | 802ms  | 4.4      | 1473    |
| stealth chromium             | 1188ms | 3.0      | 1463    |

`veri` runs the page for roughly what a client that cannot costs, and about a
twelfth of a browser's memory.

`axios` is in the table as a floor, not a rival — it was never going to render
anything. Where a page needs its scripts run, the contenders that can are
`veri` and a real engine, and the difference between them is cost.

Full tables, including the protected endpoints and what would make the numbers
lie, are in the [benchmark README](tools/bench/README.md).

## Trademarks

Cloudflare is a trademark of Cloudflare, Inc. DataDome is a trademark of
DataDome SAS. AWS WAF and CloudFront are trademarks of Amazon Web Services, Inc.
PerimeterX is a trademark of HUMAN Security, Inc. Vercel is a trademark of
Vercel, Inc. This project is not affiliated with, endorsed by, or sponsored by
any of them. The names identify the systems the `veri-integrations` modules
interoperate with.

## License

MIT
