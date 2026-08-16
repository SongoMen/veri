'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

const PROTOCOL_VERSION = 2;
const DAEMON_DEADLINE_MS = 300000;

const EXE = process.platform === 'win32' ? 'veri-daemon.exe' : 'veri-daemon';

const PLATFORM_PACKAGE = `veri-http-${process.platform}-${process.arch}`;

function findDaemon() {
  if (process.env.VERI_DAEMON_PATH && fs.existsSync(process.env.VERI_DAEMON_PATH)) {
    return process.env.VERI_DAEMON_PATH;
  }

  try {
    return require.resolve(`${PLATFORM_PACKAGE}/bin/${EXE}`);
  } catch {}

  const local = [
    path.join(__dirname, '..', '..', 'target', 'release', EXE),
    path.join(__dirname, '..', '..', 'target', 'debug', EXE),
    path.join(__dirname, 'npm', PLATFORM_PACKAGE, 'bin', EXE),
    path.join(__dirname, 'bin', EXE),
  ];
  for (const c of local) {
    if (fs.existsSync(c)) return c;
  }

  return EXE;
}

class VeriError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'VeriError';
    Object.assign(this, info);
  }
}

function pairs(obj) {
  if (!obj) return undefined;
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      if (one !== undefined && one !== null) out.push([key, String(one)]);
    }
  }
  return out;
}

function requestBody(opts) {
  const value = opts.body;
  if (value === undefined || value === null) return {};
  if (typeof value === 'string') return { body: value };

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return { bodyBase64: value.toString('base64') };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      bodyBase64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    };
  }
  if (value instanceof ArrayBuffer) {
    return { bodyBase64: Buffer.from(value).toString('base64') };
  }
  if (typeof value.pipe === 'function' || typeof value[Symbol.asyncIterator] === 'function') {
    throw new VeriError(
      'a streaming body cannot be sent: the daemon needs the whole request up front. ' +
        'Collect it first, e.g. await buffer(stream).',
    );
  }
  return { json: value };
}

class VeriResponse {
  constructor(raw) {
    this.status = raw.status;
    this.verdict = raw.verdict;
    this.headersList = raw.headers || [];
    this.headers = Object.fromEntries(this.headersList);
    this._bytes = raw.bodyBase64 != null ? Buffer.from(raw.bodyBase64, 'base64') : null;
    this.body = raw.body ?? (this._bytes ? this._bytes.toString('utf8') : '');
    this.identity = raw.identity;
    this.attempts = raw.attempts;
    this.cleared = raw.cleared ?? null;
    this.usedClearance = raw.usedClearance ?? false;
  }

  /** Every value for a repeated header, in order. Use for `set-cookie`. */
  getAll(name) {
    const want = String(name).toLowerCase();
    return this.headersList.filter(([k]) => String(k).toLowerCase() === want).map(([, v]) => v);
  }

  bytes() {
    return this._bytes ?? Buffer.from(this.body, 'utf8');
  }

  get isBinary() {
    return this._bytes != null;
  }

  json() {
    return JSON.parse(this.body);
  }

  text() {
    return this.body;
  }

  get isSuccess() {
    return this.status >= 200 && this.status < 300;
  }

  get ok() {
    return this.verdict === 'ok';
  }
}

function failure(msg) {
  const err = new VeriError(msg.error || 'request failed', {
    sawChallenge: msg.sawChallenge ?? false,
    clearedButRechallenged: msg.clearedButRechallenged ?? false,
    timedOut: msg.timedOut ?? false,
    unreachable: msg.unreachable ?? false,
  });
  if (msg.status != null) {
    err.response = new VeriResponse(msg);
    err.status = err.response.status;
    err.body = err.response.body;
  }
  return err;
}

const SETTING_KEYS = [
  'proxy',
  'solver',
  'identity',
  'ladder',
  'timeoutMs',
  'connectTimeoutMs',
  'retries',
  'maxResponseBytes',
];

function pickSettings(opts) {
  const out = {};
  for (const k of SETTING_KEYS) {
    if (opts[k] !== undefined) out[k] = opts[k];
  }
  return out;
}

class Veri {
  /**
   * @param {object} [opts]
   * @param {string} [opts.proxy]     Proxy URL. Use a STICKY proxy if you rely on
   *                                  challenge clearing
   * @param {boolean} [opts.solver]   Clear challenges (default true).
   * @param {string}  [opts.identity] Pin one identity, disabling laddering.
   * @param {string[]} [opts.ladder]  Custom identity order.
   * @param {number} [opts.timeoutMs] Total time for one attempt, redirects and
   *                                  body read included. Default 60000; 0 removes it.
   * @param {number} [opts.connectTimeoutMs] Time allowed to connect. Default 10000.
   * @param {number} [opts.retries]   Retries per request, shared across the
   *                                  ladder. Default 2.
   * @param {number} [opts.maxResponseBytes] Largest body to buffer. Default
   *                                  64 MiB; 0 removes the cap.
   * @param {number} [opts.daemonDeadlineMs] Backstop for a daemon that accepts
   *                                  a request and never answers. Not the
   *                                  request timeout. Default 300000.
   * @param {string} [opts.daemonPath] Explicit path to the binary.
   * @param {string[]} [opts.daemonArgs] Extra argv for it. Lets the daemon be
   *   run through an interpreter or wrapper, the test suite uses this to run
   *   a mock via `node`.
   */
  constructor(opts = {}) {
    this.opts = opts;
    this._pending = new Map();
    this._nextId = 1;
    this._proc = null;
    this._ready = null;
    this._started = null;
    this._closed = false;
  }

  async _start() {
    if (this._started) return this._started;
    this._started = this._startAndConfigure();
    return this._started;
  }

  async _startAndConfigure() {
    this._ready = new Promise((resolve, reject) => {
      const bin = this.opts.daemonPath || findDaemon();
      const args = this.opts.daemonArgs || [];
      const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this._proc = proc;

      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      proc.on('error', (e) => {
        reject(
          new VeriError(
            `could not start veri-daemon at "${bin}": ${e.message}\n` +
              `Expected the platform package "${PLATFORM_PACKAGE}" to be installed. ` +
              `If your platform is not published yet, point VERI_DAEMON_PATH at a ` +
              `veri-daemon binary, or build one from a checkout of the repository ` +
              `with "npm run build" (needs Rust).`,
          ),
        );
      });

      proc.on('exit', (code) => {
        const err = new VeriError(
          `veri-daemon exited (code ${code})${stderr ? `: ${stderr.trim()}` : ''}`,
        );
        reject(err);
        this._rejectAll(err);
        if (!this._closed) {
          this._ready = null;
          this._started = null;
        }
      });

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.ready) {
          const theirs = msg.protocol ?? 0;
          if (theirs !== PROTOCOL_VERSION) {
            reject(
              new VeriError(
                `veri-daemon speaks protocol v${theirs}, this client speaks v${PROTOCOL_VERSION}. ` +
                  `Rebuild the daemon (cargo build --release -p veri-daemon) ` +
                  `or install a matching veri-http.`,
              ),
            );
            return;
          }
          this.daemonVersion = msg.version;
          resolve();
          return;
        }
        const entry = this._claim(msg.id);
        if (!entry) {
          if (!msg.ok) {
            this._rejectAll(
              new VeriError(
                `veri-daemon reported a failure it could not attribute to a request: ` +
                  `${msg.error || 'no reason given'}`,
              ),
            );
          }
          return;
        }
        if (msg.ok) entry.resolve(msg);
        else entry.reject(failure(msg));
      });
    });

    await this._ready;

    const settings = pickSettings(this.opts);
    if (Object.keys(settings).length > 0) {
      await this._send({
        method: 'configure',
        solver: this.opts.solver === undefined ? true : this.opts.solver,
        ...settings,
      });
    }
  }

  _claim(id) {
    const entry = this._pending.get(id);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this._pending.delete(id);
    return entry;
  }

  _rejectAll(err) {
    for (const id of [...this._pending.keys()]) this._claim(id)?.reject(err);
  }

  _send(payload) {
    return new Promise((resolve, reject) => {
      if (this._closed) return reject(new VeriError('client is closed'));
      const id = this._nextId++;
      const deadline = this.opts.daemonDeadlineMs ?? DAEMON_DEADLINE_MS;
      const entry = { resolve, reject, timer: null };
      if (deadline > 0) {
        entry.timer = setTimeout(() => {
          this._pending.delete(id);
          reject(
            new VeriError(
              `veri-daemon accepted "${payload.method}" and did not answer within ${deadline}ms`,
              { timedOut: true },
            ),
          );
        }, deadline);
        entry.timer.unref?.();
      }
      this._pending.set(id, entry);
      this._proc.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (err) => {
        if (err) {
          this._claim(id);
          reject(new VeriError(`write failed: ${err.message}`));
        }
      });
    });
  }

  async request(opts) {
    await this._start();
    const raw = await this._send({
      method: (opts.method || 'GET').toLowerCase(),
      url: opts.url,
      headers: pairs(opts.headers),
      query: pairs(opts.query),
      ...requestBody(opts),
      requestTimeoutMs: opts.timeoutMs,
    });
    return new VeriResponse(raw);
  }

  get(url, opts = {}) {
    return this.request({ ...opts, method: 'GET', url });
  }
  post(url, opts = {}) {
    return this.request({ ...opts, method: 'POST', url });
  }
  put(url, opts = {}) {
    return this.request({ ...opts, method: 'PUT', url });
  }
  patch(url, opts = {}) {
    return this.request({ ...opts, method: 'PATCH', url });
  }
  delete(url, opts = {}) {
    return this.request({ ...opts, method: 'DELETE', url });
  }
  head(url, opts = {}) {
    return this.request({ ...opts, method: 'HEAD', url });
  }

  async configure(opts) {
    await this._start();
    Object.assign(this.opts, opts);
    const r = await this._send({ method: 'configure', ...pickSettings(opts) });
    return r.info;
  }

  /**
   * Drops cookies and clearance too. Worth doing when the egress IP behind a
   * proxy rotates, since clearance is bound to the IP that earned it.
   *
   * @param {string} host Hostname, or any URL on it.
   * @returns {Promise<number>} How many sessions were dropped.
   */
  async forget(host) {
    await this._start();
    const r = await this._send({ method: 'forget', host });
    return r.info.forgot;
  }

  /**
   * Seed a cookie into the jar for a host, so every later request carries it,
   * including every rung of the identity ladder. A `cookie` request header is
   * per-request; this outlives the request.
   *
   * @param {string} host Hostname, or any URL on it.
   * @param {string} cookie A `Set-Cookie`-shaped string, e.g. `name=value; Path=/`.
   * @returns {Promise<void>}
   */
  async setCookie(host, cookie) {
    await this._start();
    await this._send({ method: 'set_cookie', host, cookie });
  }

  /**
   * The value of a cookie the jar holds for a host, if any.
   *
   * @param {string} host Hostname, or any URL on it.
   * @param {string} name Cookie name.
   * @returns {Promise<string|null>}
   */
  async cookie(host, name) {
    await this._start();
    const r = await this._send({ method: 'cookie', host, name });
    return r.info.cookie ?? null;
  }

  async probe(url) {
    await this._start();
    const r = await this._send({ method: 'probe', url });
    return r.probe;
  }

  async info() {
    await this._start();
    const r = await this._send({ method: 'info' });
    return r.info;
  }

  async close() {
    this._closed = true;
    if (this._proc) {
      this._proc.stdin.end();
      this._proc.kill();
      this._proc = null;
    }
    this._ready = null;
    this._started = null;
  }
}

module.exports = { Veri, VeriResponse, VeriError };
