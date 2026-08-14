# Benchmark

What it costs to fetch a page the way a browser would, measured four ways:
`axios`, headless `chromium`, `stealth` (puppeteer-extra + stealth plugin), and
`veri`.

**One test per site**, each run on its own. A site with no bot protection at all
is the baseline, and it is the most useful row: with nothing fighting back,
every contender succeeds and only the cost separates them.

The targets are yours. `targets.json` is git-ignored and ships empty, so point
it at endpoints you are entitled to hammer 1000 times — your own, in practice,
since that is what this load pattern is fair to.

Publishing results: `node results_md.mjs <run output>` emits the markdown.

```
cd tools/bench && npm install
cp targets.example.json targets.json      # then point it at your own targets
node bench.mjs --targets targets.json --proxies /path/to/proxy_urls.txt \
               --per-site 16 --rotate 8 --offset 0
```

Proxies are one URL per line. `--offset` starts past addresses an earlier run
touched, since a challenged address stays challenged.

`targets.json` is yours to write and is git-ignored:

```json
[{ "name": "cloudflare", "url": "https://…", "floor": 50000, "markers": ["_cf_chl_opt"] }]
```

## Results

16,000 requests, 1000 per contender per site, one address each,
concurrency 4. Targets: a site with no bot protection, a
Cloudflare-protected site, an AWS WAF site with the challenge action
enabled, and a Vercel site with the Security Checkpoint on.

**none**

|          | ok   | blocked | error | ok%  | median ms | p90 ms | req/s | total s | peak MB |
| -------- | ---- | ------- | ----- | ---- | --------- | ------ | ----- | ------- | ------- |
| axios    | 1000 | 0       | 0     | 100% | 148       | 169    | 25.4  | 39      | 129     |
| chromium | 1000 | 0       | 0     | 100% | 802       | 1252   | 4.4   | 225     | 1473    |
| stealth  | 1000 | 0       | 0     | 100% | 1188      | 1799   | 3.0   | 338     | 1463    |
| **veri** | 1000 | 0       | 0     | 100% | 134       | 299    | 21.9  | 46      | 122     |

**cloudflare**

|          | ok   | blocked | error | ok%  | median ms | p90 ms | req/s | total s | peak MB |
| -------- | ---- | ------- | ----- | ---- | --------- | ------ | ----- | ------- | ------- |
| axios    | 508  | 492     | 0     | 51%  | 145       | 387    | 19.9  | 50      | 97      |
| chromium | 52   | 948     | 0     | 5%   | 3008      | 5513   | 3.3   | 303     | 1570    |
| stealth  | 437  | 563     | 0     | 44%  | 2470      | 3478   | 2.4   | 423     | 1583    |
| **veri** | 1000 | 0       | 0     | 100% | 242       | 435    | 3.7   | 274     | 278     |

**awswaf**

|          | ok   | blocked | error | ok%  | median ms | p90 ms | req/s | total s | peak MB |
| -------- | ---- | ------- | ----- | ---- | --------- | ------ | ----- | ------- | ------- |
| axios    | 24   | 976     | 0     | 2%   | 344       | 893    | 58.2  | 17      | 171     |
| chromium | 0    | 1000    | 0     | 0%   | 0         | 0      | 3.8   | 260     | 1255    |
| stealth  | 5    | 995     | 0     | 1%   | 12479     | 12625  | 2.5   | 396     | 1877    |
| **veri** | 1000 | 0       | 0     | 100% | 409       | 1765   | 5.0   | 199     | 177     |

**vercel**

|          | ok   | blocked | error | ok%  | median ms | p90 ms | req/s | total s | peak MB |
| -------- | ---- | ------- | ----- | ---- | --------- | ------ | ----- | ------- | ------- |
| axios    | 0    | 1000    | 0     | 0%   | 0         | 0      | 27.8  | 36      | 108     |
| chromium | 0    | 1000    | 0     | 0%   | 0         | 0      | 4.3   | 233     | 1214    |
| stealth  | 0    | 1000    | 0     | 0%   | 0         | 0      | 4.7   | 211     | 1318    |
| **veri** | 1000 | 0       | 0     | 100% | 152       | 205    | 13.2  | 76      | 64      |

**The unprotected table is the one to read first.** All four reach the page
every time, so nothing there is about capability: it is the price of seeing a
page the way a browser sees it. `veri` pays 134ms and 122 MB, a headless
Chromium 802ms and 1473 MB. That is the case for monitoring an estate without a
browser per worker, and it holds whether or not anything is checking.

The protected tables are the same measurement where the endpoint asks the client
to run something first. They are **your own endpoints** — `targets.json` ships
empty — so read them as "can this tool still see my page when my CDN is in
front of it", not as a score against a vendor.

**A headless browser is the wrong choice here.**
Chromium scored below plain `axios` on Cloudflare and AWS WAF: being a real
browser engine is not sufficient, and on those two rows it costs 5.6x and 7.1x
the memory to be worse. The stealth plugin closes some of that on Cloudflare, none on AWS WAF
and none on Vercel, and across earlier runs on other addresses it ranged from
56% to 0% on the same site.

**On the timings.** **veri**'s medians are 134ms unprotected against 242ms, 409ms
and 152ms on the three protected sites, the gap being the requests that include
running a challenge. Those are not comparable with the browsers' figures above
them, so read them only against each other. What the browsers cost is legible
anyway from their own rows: seconds per request where anything else is measured in hundreds of milliseconds.

**Peak RSS is the one column no address can move**, and it is where the gap is
real: 64-278 MB for veri while clearing, against 1255-1877 MB for either
browser. The 278 MB is Cloudflare, where four concurrent solves each hold a V8
isolate; a run that solves rarely sits near the bottom of that range.

**A median is not a solve cost, and the wall clock says so.** Vercel's 152ms is
what a request costs once `_vcrcs` is held. But 1000 requests at that median and
concurrency 4 is ~38s of request time, against 76s measured, the difference is
time spent solving, which the median column cannot show because it averages `ok`
rows only. Clearance is issued with `Max-Age=3600` and the run lasted 76s, so a
single solve should have covered all 1000 requests; it did not. Read the row as
sustained clearing under load, not as one solve amortised over 999 free ones.

## What the numbers mean, and what would make them lie

**One address per contender, held for the whole test.** Adjacent entries from
the pool, so they are the same kind of address, and disjoint, so no contender
can use another's IP.

Every contender then puts the same load on its own address and they degrade the
same way. On a rate-triggered protection that is the test: what happens when
you keep asking from one place, which is what a real workload does.

**Latency is confounded by which address a contender drew, and the confound is
larger than most of the gaps.** One address per contender means each gets a
different proxy, and proxies vary enormously, causing different results between runs.

`address_spread.mjs` measures it directly, one contender across every address
the benchmark handed out:

```
node address_spread.mjs --contender axios --site none \
     --proxies /path/to/proxy_urls.txt --addresses 4 --requests 150
```

If one client's spread across addresses is as wide as the spread between
clients, the table is ranking proxies. To rank clients on latency, run the whole
benchmark once per assignment and average, `--assign 0`, `1`, `2`, `3` rotates
which address each contender draws, so the address effect cancels.

Success rate carries the same caveat more weakly, address reputation is part of
what a protection reacts to. **Peak RSS is the one column no address can move.**

**The browsers run with their cache off.** Chromium revalidates and is
answered `304` from its own cache: not a real fetch, and not the work the other
two are doing.

**Each contender runs in its own process.** Peak RSS is sampled over that
process tree, so Chromium's renderers are counted and no contender's memory
leaks into another's baseline.

**Status does not classify.** Every provider here serves challenges with `200`:
DataDome at 775 bytes, Cloudflare at 5.6KB. A response counts as `ok` only if
the status is 2xx, no challenge marker is present, _and_ the body clears a
per-site floor taken from a real page.

**Duration is time-to-HTML**, `domcontentloaded` for the browsers. Browsers
still pay for subresources they fetch on the way, which is real cost but not
directly comparable to a single document fetch. Read the memory column
alongside it.

## Notes

- Browsers make many requests per navigation, so they burn an address
  several times faster than a single-document client. On a rate-triggered
  protection this shows up as the browser being challenged sooner.
- `axios` sends a current Chrome User-Agent. Without one it fails for a trivial
  reason that says nothing about the tool.
- `veri` is the only contender that attempts to clear a challenge, which is the
  point of the comparison. Its `blocked` count
  is what it could not clear.
- DataDome and PerimeterX are deliberately absent. Nothing here clears either,
  so the column would be four zeros and a coin flip. PerimeterX asks for a
  press-and-hold gesture, which a real headed Chrome cannot pass without a
  person, so no client belongs in that table.
