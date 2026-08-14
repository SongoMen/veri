import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { flag, num, proxyPool, hostOf } from './args.mjs';

const requests = num('requests', '1000');
const concurrency = num('concurrency', '4');
const contenders = flag('contenders', 'axios,chromium,stealth,veri').split(',');
const targets = JSON.parse(readFileSync(flag('targets', 'targets.json'), 'utf8'));
const only = flag('site', '');
const pool = proxyPool(flag('proxies'), num('offset', '0'));

const assign = num('assign', '0');
const addressFor = (i) => pool[(i + assign) % contenders.length];

const COLUMNS = [
  ['contender', 11],
  ['ok', 7],
  ['blocked', 9],
  ['error', 7],
  ['ok%', 7],
  ['median', 9],
  ['p90', 9],
  ['req/s', 9],
  ['total s', 9],
  ['peak MB', 9],
];

function pids(root) {
  const children = (p) => {
    try {
      return execSync(`pgrep -P ${p} 2>/dev/null || true`, { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  const kids = children(root);
  return [...new Set([String(root), ...kids, ...kids.flatMap(children)])];
}

function treeRssKb(root) {
  try {
    return execSync(`ps -o rss= -p ${pids(root).join(',')} 2>/dev/null || true`, {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .reduce((total, line) => total + Number(line.trim()), 0);
  } catch {
    return 0;
  }
}

function run(contender, address, site) {
  process.stderr.write(`\n  ${contender.padEnd(9)}`);
  const startedAt = Date.now();
  const child = spawn(
    process.execPath,
    [
      'runner.mjs',
      '--contender',
      contender,
      '--site',
      JSON.stringify(site),
      '--proxies',
      JSON.stringify([address]),
      '--per-proxy',
      String(requests),
      '--concurrency',
      String(concurrency),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );

  let peakKb = 0;
  const sampler = setInterval(() => {
    peakKb = Math.max(peakKb, treeRssKb(child.pid));
  }, 250);

  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));

  return new Promise((resolve) =>
    child.on('close', () => {
      clearInterval(sampler);
      let rows = [];
      try {
        rows = JSON.parse(out);
      } catch {}
      resolve({
        contender,
        rows,
        wallMs: Date.now() - startedAt,
        peakMb: Math.round(peakKb / 1024),
      });
    }),
  );
}

const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

function summarise(result) {
  const { rows, wallMs } = result;
  const count = (outcome) => rows.filter((r) => r.outcome === outcome).length;
  const times = rows
    .filter((r) => r.outcome === 'ok')
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  return [
    result.contender,
    times.length,
    count('blocked'),
    count('error'),
    `${Math.round((times.length / rows.length) * 100)}%`,
    percentile(times, 0.5),
    percentile(times, 0.9),
    (rows.length / (wallMs / 1000)).toFixed(1),
    Math.round(wallMs / 1000),
    result.peakMb,
  ];
}

const row = (cells) => cells.map((c, i) => String(c).padEnd(COLUMNS[i][1])).join('');

for (const site of targets) {
  if (only && site.name !== only) continue;
  console.log(
    `\n\n=== ${site.name}: ${requests} requests per contender, concurrency ${concurrency} ===`,
  );

  const results = [];
  for (const [i, contender] of contenders.entries()) {
    results.push(await run(contender, addressFor(i), site));
  }

  console.log('\n');
  console.log(row(COLUMNS.map(([name]) => name)));
  for (const result of results) {
    if (!result.rows.length) {
      console.log(`${result.contender.padEnd(11)}FAILURE, no rows returned, see stderr`);
      continue;
    }
    console.log(row(summarise(result)));
  }

  const used = contenders.map((c, i) => `${c}=${hostOf(addressFor(i))}`).join('  ');
  console.log(`\n  one address per contender, ${requests} requests each: ${used}`);
}
