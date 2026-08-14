import { readFileSync } from 'node:fs';

export function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

export const num = (name, fallback) => Number(flag(name, fallback));

export function proxyPool(path, offset = 0) {
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(offset).concat(lines.slice(0, offset));
}

export const hostOf = (proxy) => proxy.replace(/.*@/, '');
