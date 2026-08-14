import { readFileSync } from 'node:fs';

const COLUMNS = [
  'ok',
  'blocked',
  'error',
  'ok%',
  'median ms',
  'p90 ms',
  'req/s',
  'total s',
  'peak MB',
];
const CONTENDER = /^(axios|chromium|stealth|veri)\s/;

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

const sections = readFileSync(process.argv[2], 'utf8').split(/^=== /m).slice(1);
if (!sections.length) die('no sections found, did the run finish?');

for (const section of sections) {
  const name = section.slice(0, section.indexOf(':'));
  const rows = section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => CONTENDER.test(l))
    .map((l) => l.split(/\s+/));

  const failed = section.match(/^(\w+)\s+FAILURE/gm);
  if (failed) die(`${name}: ${failed.length} contender(s) failed, not publishable`);
  if (rows.length !== 4) die(`${name}: ${rows.length} rows, expected 4, not publishable`);

  console.log(`\n**${name}**\n`);
  console.log(`| | ${COLUMNS.join(' | ')} |`);
  console.log(`| --- |${COLUMNS.map(() => ' --- |').join('')}`);
  for (const [label, ...cells] of rows) {
    console.log(`| ${label === 'veri' ? '**veri**' : label} | ${cells.join(' | ')} |`);
  }
}
