import { createRequire } from 'node:module';
import { flag, num } from './args.mjs';

const require = createRequire(import.meta.url);

const contender = flag('contender');
const site = JSON.parse(flag('site'));
const proxies = JSON.parse(flag('proxies'));
const perProxy = num('per-proxy');
const concurrency = num('concurrency', '4');
const timeoutMs = num('timeout', '45000');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const BLOCKED_STATUS = [202, 401, 403, 405, 429, 503];

function classify(status, body) {
  if (status === 0) return 'error';
  if (BLOCKED_STATUS.includes(status)) return 'blocked';
  if (site.markers.some((m) => body.includes(m))) return 'blocked';
  const served = (status >= 200 && status < 300) || status === 304;
  return served && body.length >= site.floor ? 'ok' : 'blocked';
}

let axios = null;
let agent = null;
let browser = null;
let veri = null;

async function axiosGet(url) {
  try {
    const r = await axios.get(url, {
      httpsAgent: agent,
      timeout: timeoutMs,
      maxRedirects: 10,
      validateStatus: () => true,
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      responseType: 'text',
      transformResponse: (x) => x,
    });
    return { status: r.status, body: String(r.data ?? '') };
  } catch {
    return { status: 0, body: '' };
  }
}

async function browserGet(url) {
  let page;
  try {
    page = await browser.newPage();
  } catch {
    return { status: 0, body: '' };
  }
  try {
    await page.authenticate(browser.__auth);
    await page.setCacheEnabled(false);
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    return { status: res ? res.status() : 0, body: await page.content() };
  } catch {
    return { status: 0, body: '' };
  } finally {
    await page.close().catch(() => {});
  }
}

async function veriGet(url) {
  try {
    const r = await veri.get(url);
    return { status: r.status, body: r.text() };
  } catch (e) {
    if (e.unreachable || e.timedOut) return { status: 0, body: '' };
    return { status: e.status || 403, body: '' };
  }
}

async function open(proxy) {
  const u = new URL(proxy);

  if (contender === 'axios') {
    axios = (await import('axios')).default;
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    agent = new HttpsProxyAgent(proxy, { keepAlive: true });
    return;
  }

  if (contender === 'veri') {
    const { Veri } = require('../../clients/node/index.js');
    veri = new Veri({ proxy, solver: true, timeoutMs });
    return;
  }

  const vanilla = (await import('puppeteer')).default;
  let pptr = vanilla;
  if (contender === 'stealth') {
    // puppeteer-extra still `require`s puppeteer, which is ESM now, so it gets
    // handed the already-imported instance rather than finding its own.
    const { addExtra } = await import('puppeteer-extra');
    const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
    pptr = addExtra(vanilla);
    pptr.use(StealthPlugin());
  }
  browser = await pptr.launch({
    headless: 'new',
    protocolTimeout: 180000,
    args: [`--proxy-server=${u.protocol}//${u.host}`, '--no-sandbox'],
  });
  browser.__auth = {
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

async function close() {
  if (browser) await browser.close().catch(() => {});
  if (veri) await veri.close().catch(() => {});
  browser = null;
  veri = null;
  agent = null;
}

const get = { axios: axiosGet, chromium: browserGet, stealth: browserGet, veri: veriGet }[
  contender
];

const rows = [];

function finish() {
  process.stdout.write(JSON.stringify(rows), () => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);

async function drive() {
  let issued = 0;
  const worker = async () => {
    while (issued < perProxy) {
      issued++;
      const startedAt = process.hrtime.bigint();
      let status = 0;
      let body = '';
      try {
        ({ status, body } = await get(site.url));
      } catch {
        // One request failing must not cost the other 999.
      }
      rows.push({
        ms: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
        status,
        outcome: classify(status, body),
      });
      if (rows.length % 25 === 0) process.stderr.write('.');
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

for (const proxy of proxies) {
  try {
    await open(proxy);
  } catch {
    for (let i = 0; i < perProxy; i++) rows.push({ ms: 0, status: 0, outcome: 'error' });
    await close();
    continue;
  }
  await drive();
  await close();
}

finish();
