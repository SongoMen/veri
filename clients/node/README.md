# veri-http

An HTTP client for Node that sees what a browser sees: a ladder of browser
identities, per-host memory of which one a site accepts, and the page's own
JavaScript run in-process when a page will not answer without it.

For reaching services you are entitled to reach — your own sites and APIs,
endpoints you have an agreement with, and public data you are permitted to
collect. It does not solve CAPTCHAs and cannot be made to.

```js
const { Veri } = require('veri-http');

const veri = new Veri({ proxy: 'http://user:pass@host:port' });

const res = await veri.get('https://example.com/api/data');
console.log(res.status, res.identity, res.body.length);
console.log(res.json());

await veri.close();
```

```
200  ok  11016b via Firefox143  rung 1
200  ok  11016b via Firefox143  rung 1  cleared cloudflare
```

## Install

```
npm install veri-http
```

You do not need to build Rust. The binary arrives via a platform package
(`veri-http-darwin-arm64`, `veri-http-linux-x64`, …) declared as an
`optionalDependency` with `os`/`cpu` constraints, so npm downloads exactly the
one that matches your machine and skips the rest.

Published for macOS (arm64, x64), Linux (x64, arm64) and Windows (x64). On
anything else, build from source, see below.

## API

### `new Veri(options)`

Every option is optional. The client starts the daemon lazily, on the first
request.

| option             | default    | meaning                                                                                                                  |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `proxy`            | none       | Proxy URL. Use a **sticky** one if you rely on clearing, clearance is bound to the IP that earned it.                    |
| `solver`           | `true`     | Clear challenges rather than only reporting them.                                                                        |
| `identity`         | none       | Pin one identity, disabling laddering.                                                                                   |
| `ladder`           | built-in   | Identity order to try. See `info()` for the names.                                                                       |
| `timeoutMs`        | `60000`    | One attempt, redirects and body read included. Each retry gets a fresh one.                                              |
| `connectTimeoutMs` | `10000`    | Time allowed to establish a connection.                                                                                  |
| `retries`          | `2`        | Retries per request, shared across the whole ladder rather than per rung.                                                |
| `maxResponseBytes` | `67108864` | Largest body to buffer. Bodies are held in memory, so this is what stops one oversized response taking down the process. |
| `daemonDeadlineMs` | `300000`   | Backstop for a daemon that accepts a request and never answers. Not the request timeout, it only fires on a bug.         |
| `daemonPath`       | resolved   | Explicit path to the `veri-daemon` binary.                                                                               |
| `daemonArgs`       | none       | Extra argv for it.                                                                                                       |

One client keeps one daemon, one cookie jar and one set of sessions. Build one
per egress, not one per request, and `close()` it when you are done.

### Requests

```js
await veri.get(url, options);
await veri.post(url, options);
await veri.put(url, options);
await veri.patch(url, options);
await veri.delete(url, options);
await veri.head(url, options);
await veri.request({ method, url, ...options });
```

`options` takes `headers`, `query`, `json`, `body`, and `timeoutMs` to override
the client's timeout for this request alone. `json` sets the content type and
serialises for you; `body` is sent as-is.

```js
await veri.post('https://example.com/api/quote', {
  headers: { 'x-api-key': '…' },
  json: { symbol: 'AAPL' },
});
```

### Response

```js
res.status; // 200
res.verdict; // 'ok' | 'challenged' | 'blocked' | 'rate-limited' | 'unreachable'
res.headers; // last value wins for repeats
res.headersList; // every [name, value] pair, in order
res.getAll('set-cookie'); // every value for one repeated header
res.text();
res.json();
res.bytes(); // Buffer, for a body that is not text
res.isBinary;
```

Plus how the result was obtained:

```js
res.identity; // which identity answered
res.attempts; // ladder rungs tried; 1 means the first choice worked
res.cleared; // the protection whose challenge was cleared, or null
res.usedClearance; // clearance the session already held was reused
```

**`isSuccess` and `ok` answer different questions.** `isSuccess` is HTTP 2xx.
`ok` means a real response rather than a challenge or a block, and a challenge
page routinely arrives with a `200`, so `isSuccess` alone will fool you.

### Errors

A failure rejects with a `VeriError` carrying flags that say what to do next:

| flag                     | meaning                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `sawChallenge`           | A protection served a challenge. A solver is the thing that would help.           |
| `clearedButRechallenged` | The challenge _was_ solved and clearance issued, and this path challenged anyway. |
| `timedOut`               | A timeout was involved. Back off rather than treating it as a refusal.            |
| `unreachable`            | No identity reached the host at all.                                              |
| `response`               | The last response the ladder saw, as a `VeriResponse`. `status` and `body` are shorthands for its own. |

`clearedButRechallenged`: the solve worked and the clearance is real, so a different **identity** is the thing most likely to help.

```js
try {
  const res = await veri.get(url);
} catch (e) {
  if (e.clearedButRechallenged) return; // try another identity before giving up on the route
  if (e.timedOut || e.unreachable) return retryLater();
  if (e.status) return JSON.parse(e.body); // the origin's own answer, kept intact
  throw e;
}
```

### Cookies

Three ways to supply your own:

```js
// One request only.
await veri.get(url, { headers: { cookie: 'session=abc; other=1' } });

// Into the jar for a host, so every later request carries it, including every
// rung of the identity ladder.
await veri.setCookie('example.com', 'session=abc; Path=/');
const held = await veri.cookie('example.com', 'session');
```

Your cookies are **merged** with the jar, not swapped for it: yours win on a
name collision and the rest of the jar still goes out, in a single header. That
matters because a clearance the ladder just earned lives in the jar, and
replacing the header would throw it away.

There is no client-wide header option; set it per request or seed the jar.

### Sessions

```js
await veri.forget('example.com'); // → how many sessions were dropped
```

Drops every session for a host, cookies and clearance included. Worth doing when
the egress IP behind a proxy rotates, since clearance is bound to the IP that
earned it.

### Diagnostics

```js
await veri.probe(url); // one row per identity: verdict, status, ms, bytes,
// protection, hints, cleared, without clearing anything
await veri.info(); // identities, engine version, browser profile provenance
```

`probe` is the fastest way to answer "which identity does this host accept, and
who is in front of it" before configuring anything.

### Lifecycle

```js
await veri.configure({ proxy: '…' }); // change settings mid-run
await veri.close(); // stop the child process
```

## Why a child process, not a native addon

The solver embeds V8 13. Node embeds its own V8 (10.2 on Node 18). Two different
V8 runtimes in one process conflict over platform initialisation and symbols, so
a napi-rs addon is not a viable route.

One process is
shared by all requests from a `Veri` instance, and it holds the session cache,
so **reuse one instance** rather than constructing per request.
If you later want it in its own repository, the coupling is small, move the
folder and:

1. Point `findDaemon()` at wherever the binary is installed (the
   `../../target/...` candidates only make sense inside the workspace).
2. Ship prebuilt daemons in `bin/`, since there is no local `cargo build` to
   fall back on.
3. Keep `PROTOCOL_VERSION` in sync with the daemon's. The client already
   refuses to talk to a mismatched daemon and says so, rather than failing
   somewhere deep in a request.

## Developing locally

**Tests.** `npm test` is offline: it runs the client against
`tests/mock-daemon.js`, which speaks the same wire protocol. Fast, deterministic,
and it sends no traffic to anyone.

```
npm test          # the offline suite, no network
```

It covers the things that are actually ours, request encoding, response
shaping, error mapping, id matching under pipelining, the version handshake,
and `close()` semantics.

For a real end-to-end check, name a target explicitly:

```
node tests/live.js <url> [challengedIdentity]
VERI_PROXY=http://user:pass@host:port node tests/live.js <url> OkHttp5
```

There is deliberately no default target, a test suite should not hit somebody's
site because you typed `npm test`. Use a host you own or are authorised to test.
To exercise the solver you need one that actually challenges, which usually
means a datacenter proxy: residential IPs are rarely challenged at all.

**Building the daemon:** from a checkout of the repository, which is where the
Rust sources are. An installed copy of the package does not carry them.

```
npm run build     # builds veri-daemon, stages it in bin/
```

## Things worth knowing

**`configure` throws away every session.** It rebuilds the client, which means a
fresh cookie jar, so calling it after a ~4 s solve discards the clearance. The reply says `rebuilt: true` when that happened. Configure
once, at startup, if you can.

**Repeated headers.** `res.headers` keeps the last value for a repeated name;
`res.getAll('set-cookie')` returns all of them, and `res.headersList` is the raw
ordered list.

**Binary responses.** `res.isBinary` is true when the body was not valid UTF-8.
Use `res.bytes()`, `res.body` is a lossy UTF-8 decode in that case.

## License

MIT
