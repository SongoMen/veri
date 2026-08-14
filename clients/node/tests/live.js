'use strict';

const { Veri, VeriError } = require('../index.js');

const url = process.argv[2];
const challengedIdentity = process.argv[3] || 'OkHttp5';
const proxy = process.env.VERI_PROXY || undefined;

if (!url) {
  console.error(
    'usage: node test-live.js <url> [challengedIdentity]\n\n' +
      'No default target on purpose, name a host you are authorised to test.\n' +
      'Set VERI_PROXY to exercise the challenge path.',
  );
  process.exit(2);
}

let pass = 0;
let fail = 0;
let skip = 0;
const ok = (n, extra = '') => (pass++, console.log(`  PASS  ${n}${extra ? `  ${extra}` : ''}`));
const bad = (n, why) => (fail++, console.log(`  FAIL  ${n}  ${why}`));
const skipped = (n, why) => (skip++, console.log(`  SKIP  ${n}  ${why}`));

(async () => {
  console.log(`veri-http live check`);
  console.log(`  target : ${url}`);
  console.log(`  proxy  : ${proxy ? proxy.split('@').pop() : 'none (direct)'}\n`);

  const veri = new Veri({ proxy });
  let reached = false;

  try {
    const res = await veri.get(url);
    if (res.ok && res.body.length > 0) {
      reached = true;
      ok('fetched', `${res.status} ${res.body.length}b via ${res.identity} rung ${res.attempts}`);
    } else {
      bad('fetched', `${res.status} ${res.verdict}`);
    }
  } catch (e) {
    bad('fetched', e.message);
  }

  if (reached) {
    try {
      const t = Date.now();
      const again = await veri.get(url);
      ok('session reuse', `${Date.now() - t}ms${again.usedClearance ? ' (clearance)' : ''}`);
    } catch (e) {
      bad('session reuse', e.message);
    }

    try {
      const rows = await veri.probe(url);
      const good = rows.filter((r) => r.verdict === 'ok').length;
      ok('probe', `${good}/${rows.length} identities pass`);
    } catch (e) {
      bad('probe', e.message);
    }

    await veri.configure({ identity: challengedIdentity, solver: true });
    try {
      const solved = await veri.get(url);
      if (solved.cleared) ok('challenge cleared', `${solved.cleared} via ${solved.identity}`);
      else skipped('challenge cleared', `${challengedIdentity} is not challenged here`);
    } catch (e) {
      if (e instanceof VeriError && e.sawChallenge) {
        skipped('challenge cleared', 'path re-challenges even with valid clearance');
      } else {
        bad('challenge cleared', e.message);
      }
    }
  } else {
    skipped('session reuse', 'target not reached');
    skipped('probe', 'target not reached');
    skipped('challenge cleared', 'target not reached');
  }

  await veri.close();

  console.log(`\n────────────────\n  passed ${pass}   failed ${fail}   skipped ${skip}`);
  if (!reached) console.log(`\n  TARGET NOT REACHED, nothing above says anything about this host.`);
  process.exit(fail === 0 && reached ? 0 : 1);
})();
