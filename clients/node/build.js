'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '..', '..');

if (!fs.existsSync(path.join(workspace, 'Cargo.toml'))) {
  console.error(
    `no Cargo workspace at ${workspace}.\n` +
      'This builds veri-daemon from the repository sources, which an installed\n' +
      'copy of the package does not carry. Clone the repository and run this\n' +
      'there, then point VERI_DAEMON_PATH at the binary it stages.',
  );
  process.exit(1);
}
const binDir = path.join(__dirname, 'bin');
const target = path.join(binDir, 'veri-daemon' + (process.platform === 'win32' ? '.exe' : ''));

try {
  console.log('building veri-daemon (release)…');
  execFileSync('cargo', ['build', '--release', '-p', 'veri-daemon'], {
    cwd: workspace,
    stdio: 'inherit',
  });
} catch {
  console.error('\ncargo build failed. Is Rust installed?  https://rustup.rs');
  process.exit(1);
}

const built = path.join(
  workspace,
  'target',
  'release',
  'veri-daemon' + (process.platform === 'win32' ? '.exe' : ''),
);
if (!fs.existsSync(built)) {
  console.error(`built binary not found at ${built}`);
  process.exit(1);
}

fs.mkdirSync(binDir, { recursive: true });
fs.copyFileSync(built, target);
fs.chmodSync(target, 0o755);

const mb = (fs.statSync(target).size / 1048576).toFixed(1);
console.log(`staged ${path.relative(process.cwd(), target)} (${mb} MB)`);
