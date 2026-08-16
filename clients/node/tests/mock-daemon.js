'use strict';

const readline = require('node:readline');

const JAR = {};
const PROTOCOL = Number(process.env.MOCK_PROTOCOL || 2);

if (process.env.MOCK_DIE) {
  process.stderr.write('libfoo.so.6: cannot open shared object file\n');
  process.exit(Number(process.env.MOCK_DIE));
}

if (!process.env.MOCK_SILENT) {
  process.stdout.write(
    `${JSON.stringify({ ready: true, version: '0.0.0-mock', protocol: PROTOCOL })}\n`,
  );
}

let first = null;
const reply = (o) => {
  if (first === null && o.__m !== 'firstMethod') first = o.__m ?? first;
  delete o.__m;
  process.stdout.write(`${JSON.stringify(o)}\n`);
};

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return reply({ id: 0, ok: false, error: 'malformed request' });
  }

  const { id, method, url } = req;

  if (method === 'info') {
    return reply({
      id,
      __m: method,
      ok: true,
      info: {
        version: '0.0.0-mock',
        protocol: PROTOCOL,
        identities: ['Firefox143', 'OkHttp5'],
        ladder: ['Firefox143'],
        profile: { chrome: '151.0.0.0', harvestedAt: '2026-01-01T00:00:00Z' },
      },
    });
  }

  if (method === 'firstMethod') {
    return reply({ id, __m: method, ok: true, info: { first } });
  }

  if (method === 'configure') {
    const send = (o) => setTimeout(() => reply(o), 50);
    return send({
      id,
      __m: method,
      ok: true,
      info: {
        rebuilt: true,
        solver: req.solver ?? true,
        received: Object.keys(req)
          .filter((k) => k !== 'id' && k !== 'method')
          .sort(),
        timeoutMs: req.timeoutMs ?? null,
        retries: req.retries ?? null,
        maxResponseBytes: req.maxResponseBytes ?? null,
      },
    });
  }

  if (method === 'set_cookie') {
    const host = req.host || req.url;
    const [pair] = String(req.cookie || '').split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) {
      JAR[`${host}|${pair.slice(0, eq).trim()}`] = pair.slice(eq + 1).trim();
    }
    return reply({ id, __m: method, ok: true });
  }

  if (method === 'cookie') {
    const host = req.host || req.url;
    return reply({
      id,
      __m: method,
      ok: true,
      info: { cookie: JAR[`${host}|${req.name}`] ?? null },
    });
  }

  if (method === 'forget') {
    return reply({ id, __m: method, ok: true, info: { forgot: req.host ? 2 : 0 } });
  }

  if (method === 'probe') {
    return reply({
      id,
      __m: method,
      ok: true,
      probe: [
        {
          identity: 'Firefox143',
          verdict: 'ok',
          status: 200,
          ms: 10,
          bytes: 5,
          protection: 'cloudflare',
          hints: [],
          cleared: false,
        },
        {
          identity: 'OkHttp5',
          verdict: 'challenged',
          status: 403,
          ms: 12,
          bytes: 9,
          protection: 'cloudflare',
          hints: [],
          cleared: false,
        },
      ],
    });
  }

  if (String(url).includes('/silence')) return;

  if (String(url).includes('/orphan-error')) {
    return reply({ id: 0, ok: false, error: 'malformed request: missing field `method`' });
  }

  if (String(url).includes('/exhausted')) {
    return reply({
      id,
      __m: method,
      ok: false,
      error: 'no identity worked for mock; tried: Firefox143=blocked',
      status: 403,
      verdict: 'blocked',
      headers: [
        ['content-type', 'application/json'],
        ['cf-ray', 'abc'],
      ],
      body: '{"error":"invalid api key"}',
      identity: 'Firefox143',
      attempts: 7,
    });
  }

  if (String(url).includes('/challenged')) {
    return reply({
      id,
      __m: method,
      ok: false,
      error: 'no identity worked for mock; tried: OkHttp5=challenged',
      sawChallenge: true,
    });
  }
  if (String(url).includes('/rechallenged')) {
    return reply({
      id,
      __m: method,
      ok: false,
      error:
        'no identity worked for mock; tried: OkHttp5=challenged (a clearance cookie was issued but the page still challenged)',
      sawChallenge: true,
      clearedButRechallenged: true,
    });
  }
  if (String(url).includes('/blocked')) {
    return reply({
      id,
      __m: method,
      ok: false,
      error: 'no identity worked for mock; tried: OkHttp5=blocked',
      sawChallenge: false,
    });
  }
  if (String(url).includes('/timeout')) {
    return reply({
      id,
      __m: method,
      ok: false,
      error: 'transport error: operation timed out',
      sawChallenge: false,
      timedOut: true,
      unreachable: true,
    });
  }
  if (String(url).includes('/unreachable')) {
    return reply({
      id,
      __m: method,
      ok: false,
      error: 'no identity worked for mock; tried: Firefox143=unreachable',
      sawChallenge: false,
      timedOut: false,
      unreachable: true,
    });
  }
  if (String(url).includes('/echo-timeout')) {
    return reply({
      id,
      __m: method,
      ok: true,
      status: 200,
      verdict: 'ok',
      headers: [],
      body: String(req.requestTimeoutMs ?? 'unset'),
      identity: 'Firefox143',
      attempts: 1,
      usedClearance: false,
    });
  }
  if (String(url).includes('/dupheaders')) {
    return reply({
      id,
      __m: method,
      ok: true,
      status: 200,
      verdict: 'ok',
      headers: [
        ['set-cookie', 'a=1'],
        ['set-cookie', 'cf_clearance=xyz'],
        ['set-cookie', 'b=2'],
      ],
      body: 'ok',
      identity: 'Firefox143',
      attempts: 1,
      usedClearance: false,
    });
  }
  if (String(url).includes('/binary')) {
    return reply({
      id,
      __m: method,
      ok: true,
      status: 200,
      verdict: 'ok',
      headers: [],
      bodyBase64: '/9j/4AA=',
      identity: 'Firefox143',
      attempts: 1,
      usedClearance: false,
    });
  }
  if (String(url).includes('/solved')) {
    return reply({
      id,
      __m: method,
      ok: true,
      status: 200,
      verdict: 'ok',
      headers: [['content-type', 'application/json']],
      body: '{"solved":true}',
      identity: 'OkHttp5',
      attempts: 1,
      cleared: 'cloudflare',
      usedClearance: false,
    });
  }
  if (String(url).includes('/notjson')) {
    return reply({
      id,
      __m: method,
      ok: true,
      status: 200,
      verdict: 'ok',
      headers: [],
      body: '<html>not json</html>',
      identity: 'Firefox143',
      attempts: 1,
      usedClearance: false,
    });
  }
  if (String(url).includes('/teapot')) {
    return reply({
      id,
      __m: method,
      ok: true,
      status: 418,
      verdict: 'http-418',
      headers: [],
      body: 'teapot',
      identity: 'Firefox143',
      attempts: 1,
      usedClearance: false,
    });
  }

  return reply({
    id,
    __m: method,
    ok: true,
    status: 200,
    verdict: 'ok',
    headers: [['content-type', 'application/json']],
    body: JSON.stringify({
      method: req.method,
      url: req.url,
      headers: req.headers || [],
      query: req.query || [],
      json: req.json ?? null,
      body: req.body ?? null,
      bodyBase64: req.bodyBase64 ?? null,
    }),
    identity: 'Firefox143',
    attempts: 1,
    usedClearance: true,
  });
});
