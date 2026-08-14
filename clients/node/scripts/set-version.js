#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const raw = process.argv[2];
if (!raw) {
  console.error('usage: set-version.js <version|refs/tags/vX.Y.Z>');
  process.exit(2);
}

const version = raw.replace(/^refs\/tags\//, '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`not a semver version: ${version}`);
  process.exit(2);
}

const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

pkg.version = version;
for (const name of Object.keys(pkg.optionalDependencies || {})) {
  pkg.optionalDependencies[name] = version;
}

fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(
  `veri-http ${version} (+${Object.keys(pkg.optionalDependencies || {}).length} platform deps)`,
);
