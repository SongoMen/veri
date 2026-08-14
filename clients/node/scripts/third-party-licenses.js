'use strict';

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OURS = new Set([
  'veri',
  'veri-core',
  'veri-js',
  'veri-integrations',
  'veri-daemon',
  'veri-testkit',
  'veri-tools',
]);

function hostTriple() {
  return execFileSync('rustc', ['-vV'])
    .toString()
    .match(/^host: (.+)$/m)[1];
}

/// Every crate that ends up inside the binary, ours excluded.
function dependencies(workspace) {
  const meta = JSON.parse(
    execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--filter-platform', hostTriple()],
      { cwd: workspace, maxBuffer: 64 * 1024 * 1024 },
    ).toString(),
  );
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const root = [...nodes.keys()].find((id) => byId.get(id).name === 'veri-daemon');

  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) stack.push(dep.pkg);
  }
  return [...seen]
    .map((id) => byId.get(id))
    .filter((p) => !OURS.has(p.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function licenceText(pkg) {
  const dir = path.dirname(pkg.manifest_path);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const files = names
    .filter((n) => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(n))
    .sort((a, b) => a.localeCompare(b));
  const parts = [];
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile())
      parts.push(`----- ${f} -----\n${fs.readFileSync(p, 'utf8').trim()}`);
  }
  return parts.length ? parts.join('\n\n') : null;
}

function main() {
  const workspace = path.resolve(__dirname, '..', '..', '..');
  const deps = dependencies(workspace);

  const groups = new Map(); // text hash -> { text, crates: [] }
  const declaredOnly = [];
  for (const pkg of deps) {
    const text = licenceText(pkg);
    const label = `${pkg.name} ${pkg.version} (${pkg.license || pkg.license_file || 'no licence declared'})`;
    if (!text) {
      declaredOnly.push(label);
      continue;
    }
    const key = crypto.createHash('sha256').update(text).digest('hex');
    if (!groups.has(key)) groups.set(key, { text, crates: [] });
    groups.get(key).crates.push(label);
  }

  const out = [
    '# Third-party licences',
    '',
    'The `veri-daemon` binary in this package statically links the Rust crates',
    `below. Their licences follow. ${deps.length} crates, ${groups.size} distinct licence texts.`,
    '',
  ];

  if (declaredOnly.length) {
    out.push('## Declared without a licence file in the published crate', '');
    for (const c of declaredOnly) out.push(`- ${c}`);
    out.push('');
  }

  const ordered = [...groups.values()].sort((a, b) => b.crates.length - a.crates.length);
  for (const { text, crates } of ordered) {
    out.push('---', '');
    for (const c of crates) out.push(`- ${c}`);
    out.push('', '```', text, '```', '');
  }

  return out.join('\n');
}

if (require.main === module) {
  const dest = process.argv[2];
  const text = main();
  if (dest) {
    fs.writeFileSync(dest, text);
    const deps = (text.match(/^- /gm) || []).length;
    console.log(`wrote ${dest} (${deps} crates, ${(text.length / 1024).toFixed(0)} KB)`);
  } else {
    process.stdout.write(text);
  }
}

module.exports = { main };
