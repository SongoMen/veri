'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workspace = path.resolve(root, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const platform = process.platform;
const arch = process.arch;
const name = `veri-http-${platform}-${arch}`;
const exe = platform === 'win32' ? 'veri-daemon.exe' : 'veri-daemon';

if (!process.argv.includes('--no-build')) {
  console.log(`building veri-daemon for ${platform}-${arch}…`);
  execFileSync('cargo', ['build', '--release', '-p', 'veri-daemon'], {
    cwd: workspace,
    stdio: 'inherit',
  });
}

const built = path.join(workspace, 'target', 'release', exe);
if (!fs.existsSync(built)) {
  console.error(`no binary at ${built}, run without --no-build`);
  process.exit(1);
}

const outDir = path.join(root, 'npm', name);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'bin'), { recursive: true });

fs.copyFileSync(built, path.join(outDir, 'bin', exe));
fs.chmodSync(path.join(outDir, 'bin', exe), 0o755);

fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify(
    {
      name,
      version: pkg.version,
      description: `veri-daemon binary for ${platform}-${arch}.`,
      license: pkg.license,
      repository: pkg.repository,
      os: [platform],
      cpu: [arch],
      files: ['bin/', 'THIRD-PARTY-LICENSES.md'],
    },
    null,
    2,
  ) + '\n',
);

fs.copyFileSync(path.join(workspace, 'LICENSE'), path.join(outDir, 'LICENSE'));
fs.writeFileSync(
  path.join(outDir, 'THIRD-PARTY-LICENSES.md'),
  require('./third-party-licenses.js').main(),
);

fs.writeFileSync(
  path.join(outDir, 'README.md'),
  `# ${name}\n\nPlatform binary for [veri-http](https://www.npmjs.com/package/veri-http).\n` +
    `Installed automatically; not meant to be depended on directly.\n\n` +
    `MIT, see LICENSE. The binary links third-party crates; their licences are\n` +
    `in THIRD-PARTY-LICENSES.md.\n`,
);

const mb = (fs.statSync(path.join(outDir, 'bin', exe)).size / 1048576).toFixed(1);
console.log(`wrote npm/${name}  (${mb} MB)`);
