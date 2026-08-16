'use strict';

const path = require('node:path');
const assert = require('node:assert');
const { Veri, VeriError } = require('../index.js');

const MOCK = path.join(__dirname, 'mock-daemon.js');

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

/** A client wired to the mock, optionally with a doctored environment. */
function mockClient(env = {}) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  const veri = new Veri({ daemonPath: process.execPath, daemonArgs: [MOCK] });
  veri._restoreEnv = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return veri;
}

(async () => {
  console.log('veri-http offline suite (mock daemon, no network)\n');

  await test('info() reaches the engine', async () => {
    const veri = mockClient();
    try {
      const info = await veri.info();
      assert.ok(Array.isArray(info.identities), 'identities missing');
      assert.equal(info.protocol, 2);
    } finally {
      await veri.close();
    }
  });

  await test('GET encodes method and url', async () => {
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/thing');
      const echo = res.json();
      assert.equal(echo.method, 'get');
      assert.equal(echo.url, 'https://mock.test/thing');
    } finally {
      await veri.close();
    }
  });

  await test('headers and query are passed through', async () => {
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/x', {
        headers: { 'x-api-key': 'secret' },
        query: { page: '2' },
      });
      const echo = res.json();
      assert.deepEqual(echo.headers, [['x-api-key', 'secret']]);
      assert.deepEqual(echo.query, [['page', '2']]);
    } finally {
      await veri.close();
    }
  });

  await test('numbers, booleans and arrays are usable as query and header values', async () => {
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/x', {
        headers: { 'x-retry': 3, 'x-debug': true, 'x-skip': undefined },
        query: { page: 2, draft: false, tag: ['a', 'b'], gone: null },
      });
      const echo = res.json();
      assert.deepEqual(echo.headers, [
        ['x-retry', '3'],
        ['x-debug', 'true'],
      ]);
      assert.deepEqual(echo.query, [
        ['page', '2'],
        ['draft', 'false'],
        ['tag', 'a'],
        ['tag', 'b'],
      ]);
    } finally {
      await veri.close();
    }
  });

  await test('an exhausted ladder still hands back the response it saw', async () => {
    const veri = mockClient();
    try {
      await veri.get('https://mock.test/exhausted');
      assert.fail('should have rejected');
    } catch (e) {
      assert.equal(e.status, 403);
      assert.equal(e.body, '{"error":"invalid api key"}');
      assert.equal(e.response.json().error, 'invalid api key');
      assert.equal(e.response.headers['cf-ray'], 'abc');
      assert.equal(e.response.attempts, 7);
    } finally {
      await veri.close();
    }
  });

  await test('POST sends a JSON body', async () => {
    const veri = mockClient();
    try {
      const res = await veri.post('https://mock.test/x', { body: { a: 1 } });
      const echo = res.json();
      assert.equal(echo.method, 'post');
      assert.deepEqual(echo.json, { a: 1 });
    } finally {
      await veri.close();
    }
  });

  await test('body takes an object and serialises it', async () => {
    const veri = mockClient();
    try {
      const res = await veri.post('https://mock.test/x', { body: { a: 1 } });
      const echo = res.json();
      assert.deepEqual(echo.json, { a: 1 });
      assert.equal(echo.body, null);
    } finally {
      await veri.close();
    }
  });

  await test('body takes a string and sends it verbatim', async () => {
    const veri = mockClient();
    try {
      const res = await veri.post('https://mock.test/x', { body: 'a=1&b=2' });
      const echo = res.json();
      assert.equal(echo.body, 'a=1&b=2');
      assert.equal(echo.json, null);
    } finally {
      await veri.close();
    }
  });

  await test('a Buffer body crosses as bytes, not as a JSON object', async () => {
    const veri = mockClient();
    try {
      const res = await veri.post('https://mock.test/x', { body: Buffer.from([0, 255, 128]) });
      const echo = res.json();
      // base64 of 00 ff 80, decoded back to the same bytes by the daemon.
      assert.equal(echo.bodyBase64, 'AP+A');
      assert.equal(echo.body, null);
      assert.equal(echo.json, null);
    } finally {
      await veri.close();
    }
  });

  await test('a TypedArray view sends only its own window', async () => {
    const veri = mockClient();
    try {
      const whole = Uint8Array.from([1, 2, 3, 4, 5]);
      const view = whole.subarray(1, 4); // 2,3,4
      const res = await veri.post('https://mock.test/x', { body: view });
      assert.equal(res.json().bodyBase64, Buffer.from([2, 3, 4]).toString('base64'));
    } finally {
      await veri.close();
    }
  });

  await test('a streaming body is refused rather than silently buffered', async () => {
    const veri = mockClient();
    try {
      const stream = require('node:stream').Readable.from([Buffer.from('hi')]);
      await assert.rejects(
        () => veri.post('https://mock.test/x', { body: stream }),
        /streaming body cannot be sent/,
      );
    } finally {
      await veri.close();
    }
  });

  await test('response exposes how it was obtained', async () => {
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/solved');
      assert.equal(res.identity, 'OkHttp5');
      assert.equal(res.cleared, 'cloudflare');
      assert.equal(res.attempts, 1);
      assert.equal(res.ok, true);
    } finally {
      await veri.close();
    }
  });

  await test('isSuccess and ok answer different questions', async () => {
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/teapot');
      assert.equal(res.status, 418);
      assert.equal(res.isSuccess, false);
      assert.equal(res.ok, false, 'http-418 is not a "veri ok" verdict');
    } finally {
      await veri.close();
    }
  });

  await test('repeated headers are all reachable', async () => {
    // Object.fromEntries keeps only the last, which silently drops every
    // Set-Cookie but one - including a cf_clearance.
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/dupheaders');
      assert.equal(res.headers['set-cookie'], 'b=2', 'last wins on the object view');
      assert.deepEqual(res.getAll('set-cookie'), ['a=1', 'cf_clearance=xyz', 'b=2']);
      assert.deepEqual(res.getAll('Set-Cookie'), ['a=1', 'cf_clearance=xyz', 'b=2']);
      assert.deepEqual(res.getAll('nope'), []);
    } finally {
      await veri.close();
    }
  });

  await test('a binary body survives as bytes', async () => {
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/binary');
      assert.equal(res.isBinary, true);
      assert.deepEqual([...res.bytes()], [0xff, 0xd8, 0xff, 0xe0, 0x00]);
    } finally {
      await veri.close();
    }
  });

  await test('json() throws on a non-JSON body', async () => {
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/notjson');
      assert.equal(res.text(), '<html>not json</html>');
      assert.throws(() => res.json());
    } finally {
      await veri.close();
    }
  });

  await test('a challenge failure carries sawChallenge', async () => {
    const veri = mockClient();
    try {
      await veri.get('https://mock.test/challenged');
      assert.fail('should have rejected');
    } catch (e) {
      assert.ok(e instanceof VeriError, `wrong type: ${e}`);
      assert.equal(e.sawChallenge, true, 'a solver could have helped here');
    } finally {
      await veri.close();
    }
  });

  await test('a re-challenged path is distinguished from a failed solve', async () => {
    const veri = mockClient();
    try {
      await veri.get('https://mock.test/rechallenged');
      assert.fail('should have rejected');
    } catch (e) {
      assert.equal(e.sawChallenge, true);
      assert.equal(e.clearedButRechallenged, true);
    } finally {
      await veri.close();
    }
  });

  await test('an ordinary challenge is not marked as re-challenged', async () => {
    const veri = mockClient();
    try {
      await veri.get('https://mock.test/challenged');
      assert.fail('should have rejected');
    } catch (e) {
      assert.equal(e.clearedButRechallenged, false);
    } finally {
      await veri.close();
    }
  });

  await test('a block does NOT claim sawChallenge', async () => {
    const veri = mockClient();
    try {
      await veri.get('https://mock.test/blocked');
      assert.fail('should have rejected');
    } catch (e) {
      assert.equal(e.sawChallenge, false);
    } finally {
      await veri.close();
    }
  });

  await test('probe returns a row per identity', async () => {
    const veri = mockClient();
    try {
      const rows = await veri.probe('https://mock.test/x');
      assert.equal(rows.length, 2);
      assert.equal(rows[1].verdict, 'challenged');
    } finally {
      await veri.close();
    }
  });

  await test('concurrent requests match their own replies', async () => {
    const veri = mockClient();
    try {
      const urls = Array.from({ length: 10 }, (_, i) => `https://mock.test/n/${i}`);
      const out = await Promise.all(urls.map((u) => veri.get(u)));
      out.forEach((res, i) => assert.equal(res.json().url, urls[i]));
    } finally {
      await veri.close();
    }
  });

  await test('protocol mismatch is refused with a clear message', async () => {
    const veri = mockClient({ MOCK_PROTOCOL: '99' });
    try {
      await veri.info();
      assert.fail('should have refused a mismatched daemon');
    } catch (e) {
      assert.match(e.message, /protocol v99/);
      // Not pinned to a number: the point is that the message names both
      // sides, and hardcoding ours means editing this on every bump.
      assert.match(e.message, /this client speaks v\d+/);
      assert.match(e.message, /Rebuild the daemon/);
    } finally {
      veri._restoreEnv();
      await veri.close();
    }
  });

  await test('a request the daemon never answers hits the deadline', async () => {
    const veri = new Veri({
      daemonPath: process.execPath,
      daemonArgs: [MOCK],
      daemonDeadlineMs: 300,
    });
    const timeout = new Promise((_, rj) =>
      setTimeout(() => rj(new Error('never settled: the deadline did not fire')), 5000),
    );
    try {
      await Promise.race([veri.get('https://mock.test/silence'), timeout]);
      assert.fail('should have given up');
    } catch (e) {
      assert.match(e.message, /did not answer within 300ms/);
      assert.equal(e.timedOut, true, 'a deadline is a timeout, not a refusal');
    } finally {
      await veri.close();
    }
  });

  await test('an unattributable failure rejects the requests in flight', async () => {
    const veri = mockClient();
    const timeout = new Promise((_, rj) =>
      setTimeout(() => rj(new Error('never settled: the caller would hang forever')), 5000),
    );
    try {
      await Promise.race([veri.get('https://mock.test/orphan-error'), timeout]);
      assert.fail('should have reported the failure');
    } catch (e) {
      assert.match(e.message, /could not attribute/);
      assert.match(e.message, /missing field `method`/, "the daemon's reason should survive");
    } finally {
      await veri.close();
    }
  });

  await test('a stray success is ignored rather than mistaken for a reply', async () => {
    const veri = mockClient();
    try {
      veri._proc ?? (await veri.info());
      veri._proc.stdout.emit('data', `${JSON.stringify({ id: 0, ok: true, status: 200 })}\n`);
      const res = await veri.get('https://mock.test/x');
      assert.equal(res.status, 200, 'the real request should still answer normally');
    } finally {
      await veri.close();
    }
  });

  await test('a daemon that dies before ready rejects instead of hanging', async () => {
    const veri = mockClient({ MOCK_DIE: '3' });
    const timeout = new Promise((_, rj) =>
      setTimeout(() => rj(new Error('never settled: the caller would hang forever')), 5000),
    );
    try {
      await Promise.race([veri.get('https://mock.test/x'), timeout]);
      assert.fail('should have reported the dead daemon');
    } catch (e) {
      assert.match(e.message, /veri-daemon exited \(code 3\)/);
      assert.match(e.message, /cannot open shared object file/, 'stderr should reach the caller');
    } finally {
      veri._restoreEnv();
      await veri.close();
    }
  });

  await test('a missing binary explains itself', async () => {
    const veri = new Veri({ daemonPath: '/nonexistent/veri-daemon' });
    try {
      await veri.info();
      assert.fail('should have failed');
    } catch (e) {
      assert.match(e.message, /could not start veri-daemon/);
    } finally {
      await veri.close();
    }
  });

  await test('close() is idempotent and blocks later use', async () => {
    const veri = mockClient();
    await veri.info();
    await veri.close();
    await veri.close();
    try {
      await veri.get('https://mock.test/x');
      assert.fail('should reject after close');
    } catch (e) {
      assert.ok(e instanceof VeriError);
    }
  });

  await test('limits reach the daemon, client-only options do not', async () => {
    const veri = new Veri({
      daemonPath: process.execPath,
      daemonArgs: [MOCK],
      timeoutMs: 5000,
      connectTimeoutMs: 1000,
      retries: 4,
      maxResponseBytes: 1024,
    });
    try {
      const info = await veri.configure({ retries: 4 });
      assert.equal(info.retries, 4);
      // daemonPath and daemonArgs are this process's business.
      assert.ok(!info.received.includes('daemonPath'), 'daemonPath leaked to the wire');
      assert.ok(!info.received.includes('daemonArgs'), 'daemonArgs leaked to the wire');
    } finally {
      await veri.close();
    }
  });

  await test('a per-request timeout is sent', async () => {
    const veri = mockClient();
    try {
      const res = await veri.get('https://mock.test/echo-timeout', { timeoutMs: 250 });
      assert.equal(res.text(), '250');
    } finally {
      await veri.close();
    }
  });

  await test('a timeout is distinguishable from a refusal', async () => {
    const veri = mockClient();
    try {
      await veri.get('https://mock.test/timeout');
      assert.fail('should have failed');
    } catch (e) {
      assert.ok(e instanceof VeriError);
      assert.equal(e.timedOut, true);
      assert.equal(e.sawChallenge, false);
    } finally {
      await veri.close();
    }
  });

  await test('an unreachable host is flagged as such', async () => {
    const veri = mockClient();
    try {
      await veri.get('https://mock.test/unreachable');
      assert.fail('should have failed');
    } catch (e) {
      assert.equal(e.unreachable, true);
      assert.equal(e.timedOut, false);
    } finally {
      await veri.close();
    }
  });

  await test('setCookie seeds the jar and cookie reads it back', async () => {
    const veri = mockClient();
    try {
      await veri.setCookie('example.com', 'session=abc; Path=/');
      assert.equal(await veri.cookie('example.com', 'session'), 'abc');
      assert.equal(await veri.cookie('example.com', 'absent'), null);
    } finally {
      await veri.close();
    }
  });

  await test('forget() drops a host', async () => {
    const veri = mockClient();
    try {
      assert.equal(await veri.forget('mock.test'), 2);
    } finally {
      await veri.close();
    }
  });

  await test('concurrent first requests still wait for configure', async () => {
    const veri = new Veri({ daemonPath: process.execPath, daemonArgs: [MOCK], proxy: 'http://p' });
    try {
      await Promise.all([veri.get('https://mock.test/a'), veri.get('https://mock.test/b')]);
      const reply = await veri._send({ method: 'firstMethod' });
      assert.equal(
        reply.info.first,
        'configure',
        `the daemon saw "${reply.info.first}" before configure`,
      );
    } finally {
      await veri.close();
    }
  });

  console.log(`\n────────────────\n  passed ${pass}   failed ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
