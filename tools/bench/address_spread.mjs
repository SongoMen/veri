import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { flag, num, proxyPool, hostOf } from './args.mjs';

const contender = flag('contender', 'axios');
const requests = num('requests', '150');
const concurrency = flag('concurrency', '4');
const targets = JSON.parse(readFileSync(flag('targets', 'targets.json'), 'utf8'));
const site = targets.find((t) => t.name === flag('site', 'none'));
const pool = proxyPool(flag('proxies'), num('offset', '0'));
const addresses = pool.slice(0, num('addresses', '4'));

function run(proxy) {
  const child = spawn(
    process.execPath,
    [
      'runner.mjs',
      '--contender',
      contender,
      '--site',
      JSON.stringify(site),
      '--proxies',
      JSON.stringify([proxy]),
      '--per-proxy',
      String(requests),
      '--concurrency',
      concurrency,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  return new Promise((resolve) =>
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve([]);
      }
    }),
  );
}

const median = (sorted) => (sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0);

console.log(`${contender} on ${addresses.length} addresses, ${requests} requests each\n`);
for (const proxy of addresses) {
  const rows = await run(proxy);
  const times = rows
    .filter((r) => r.outcome === 'ok')
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  const ok = `ok ${String(times.length).padStart(4)}/${rows.length}`;
  console.log(
    `  ${hostOf(proxy).padEnd(24)} ${ok}   median ${String(median(times)).padStart(5)}ms`,
  );
}
