(function () {
  const __BLOBS = new Map();
  let __blobSeq = 0;

  function __blobBytes(parts) {
    const out = [];
    for (const p of Array.isArray(parts) ? parts : []) {
      if (p instanceof ArrayBuffer) {
        out.push(...new Uint8Array(p));
      } else if (ArrayBuffer.isView(p)) {
        out.push(...new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
      } else if (p && p.__bytes) {
        out.push(...p.__bytes);
      } else {
        const s = String(p);
        for (let i = 0; i < s.length; i++) {
          const c = s.codePointAt(i);
          if (c < 0x80) out.push(c);
          else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
          else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
          else {
            out.push(
              0xf0 | (c >> 18),
              0x80 | ((c >> 12) & 63),
              0x80 | ((c >> 6) & 63),
              0x80 | (c & 63),
            );
            i++;
          }
        }
      }
    }
    return Uint8Array.from(out);
  }

  globalThis.__bytesToText = function (bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try {
      return decodeURIComponent(escape(s));
    } catch (e) {
      return s;
    }
  };

  globalThis.Blob = function Blob(parts, opts) {
    this.__bytes = __blobBytes(parts);
    this.type = opts && opts.type ? String(opts.type) : '';
    this.size = this.__bytes.length;
    this.text = () => Promise.resolve(globalThis.__bytesToText(this.__bytes));
    this.arrayBuffer = () => Promise.resolve(this.__bytes.slice().buffer);
    this.slice = (a, b, t) => {
      const cut = this.__bytes.slice(a || 0, b === undefined ? this.__bytes.length : b);
      return new globalThis.Blob([cut], { type: t === undefined ? this.type : t });
    };
  };

  globalThis.FileReader = function FileReader() {
    this.readyState = 0;
    this.result = null;
    this.error = null;
    this.onload = null;
    this.onloadend = null;
    this.onerror = null;
    this.onabort = null;
    this.onprogress = null;
    this.onloadstart = null;
    this.__listeners = {};
  };

  globalThis.FileReader.EMPTY = 0;
  globalThis.FileReader.LOADING = 1;
  globalThis.FileReader.DONE = 2;

  globalThis.FileReader.prototype = {
    constructor: globalThis.FileReader,
    EMPTY: 0,
    LOADING: 1,
    DONE: 2,
    addEventListener(type, fn) {
      (this.__listeners[type] || (this.__listeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      const l = this.__listeners[type];
      if (l) {
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      }
    },
    dispatchEvent() {
      return true;
    },
    abort() {
      this.readyState = 2;
    },
    __finish(result) {
      this.readyState = 2;
      this.result = result;
      const fire = (type) => {
        const ev = { type, target: this, loaded: this.result ? this.result.length : 0, total: 0 };
        const h = this['on' + type];
        if (typeof h === 'function') {
          try {
            h.call(this, ev);
          } catch (e) {}
        }
        for (const f of this.__listeners[type] || []) {
          try {
            f.call(this, ev);
          } catch (e) {}
        }
      };
      __schedule(() => {
        fire('load');
        fire('loadend');
      }, 0);
    },
    readAsDataURL(blob) {
      this.readyState = 1;
      const bytes = (blob && blob.__bytes) || new Uint8Array(0);
      const type = (blob && blob.type) || 'application/octet-stream';
      this.__finish('data:' + type + ';base64,' + globalThis.__b64(bytes));
    },
    readAsText(blob) {
      this.readyState = 1;
      this.__finish(globalThis.__bytesToText((blob && blob.__bytes) || new Uint8Array(0)));
    },
    readAsBinaryString(blob) {
      this.readyState = 1;
      const b = (blob && blob.__bytes) || new Uint8Array(0);
      let s = '';
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      this.__finish(s);
    },
    readAsArrayBuffer(blob) {
      this.readyState = 1;
      this.__finish(((blob && blob.__bytes) || new Uint8Array(0)).slice().buffer);
    },
  };

  globalThis.FormData = function FormData() {
    this.__entries = [];
  };

  globalThis.FormData.prototype = {
    constructor: globalThis.FormData,
    append(name, value, filename) {
      this.__entries.push([String(name), value, filename]);
    },
    set(name, value, filename) {
      this.delete(name);
      this.append(name, value, filename);
    },
    get(name) {
      const e = this.__entries.find((x) => x[0] === String(name));
      return e ? e[1] : null;
    },
    getAll(name) {
      return this.__entries.filter((x) => x[0] === String(name)).map((x) => x[1]);
    },
    has(name) {
      return this.__entries.some((x) => x[0] === String(name));
    },
    delete(name) {
      for (let i = this.__entries.length - 1; i >= 0; i--) {
        if (this.__entries[i][0] === String(name)) this.__entries.splice(i, 1);
      }
    },
    forEach(fn, self) {
      for (const [k, v] of this.__entries) fn.call(self, v, k, this);
    },
    keys() {
      return this.__entries.map((x) => x[0])[Symbol.iterator]();
    },
    values() {
      return this.__entries.map((x) => x[1])[Symbol.iterator]();
    },
    entries() {
      return this.__entries.map((x) => [x[0], x[1]])[Symbol.iterator]();
    },
    [Symbol.iterator]() {
      return this.entries();
    },
  };

  globalThis.Headers = function Headers(init) {
    this.__pairs = [];
    if (init) {
      if (Array.isArray(init)) {
        for (const p of init) if (p && p.length === 2) this.append(p[0], p[1]);
      } else if (typeof init.forEach === 'function' && init instanceof globalThis.Headers) {
        init.forEach((v, k) => this.append(k, v));
      } else {
        for (const k of Object.keys(init)) this.append(k, init[k]);
      }
    }
  };

  globalThis.Headers.prototype = {
    constructor: globalThis.Headers,
    append(name, value) {
      this.__pairs.push([String(name).toLowerCase(), String(value)]);
    },
    set(name, value) {
      this.delete(name);
      this.append(name, value);
    },
    get(name) {
      const n = String(name).toLowerCase();
      const hit = this.__pairs.filter((p) => p[0] === n);
      return hit.length ? hit.map((p) => p[1]).join(', ') : null;
    },
    has(name) {
      const n = String(name).toLowerCase();
      return this.__pairs.some((p) => p[0] === n);
    },
    delete(name) {
      const n = String(name).toLowerCase();
      for (let i = this.__pairs.length - 1; i >= 0; i--) {
        if (this.__pairs[i][0] === n) this.__pairs.splice(i, 1);
      }
    },
    forEach(fn, self) {
      for (const [k, v] of this.__pairs.slice()) fn.call(self, v, k, this);
    },
    keys() {
      return this.__pairs.map((p) => p[0])[Symbol.iterator]();
    },
    values() {
      return this.__pairs.map((p) => p[1])[Symbol.iterator]();
    },
    entries() {
      return this.__pairs.map((p) => [p[0], p[1]])[Symbol.iterator]();
    },
    [Symbol.iterator]() {
      return this.entries();
    },
  };

  globalThis.__formBoundary = function () {
    const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const r = new Uint8Array(16);
    crypto.getRandomValues(r);
    let s = '';
    for (let i = 0; i < 16; i++) s += T[r[i] % T.length];
    return '----WebKitFormBoundary' + s;
  };

  // The wire form of a request body, whatever kind of object it is.
  globalThis.__encodeBody = function (body) {
    if (body == null) return '';
    if (body instanceof globalThis.FormData) {
      const b = globalThis.__formBoundary();
      let out = '';
      for (const [name, value, filename] of body.__entries) {
        out += '--' + b + '\r\n';
        if (value && value.__bytes !== undefined) {
          out +=
            'Content-Disposition: form-data; name="' +
            name +
            '"; filename="' +
            (filename || 'blob') +
            '"\r\n' +
            'Content-Type: ' +
            (value.type || 'application/octet-stream') +
            '\r\n\r\n' +
            globalThis.__bytesToText(value.__bytes) +
            '\r\n';
        } else {
          out +=
            'Content-Disposition: form-data; name="' +
            name +
            '"\r\n\r\n' +
            (value == null ? '' : String(value)) +
            '\r\n';
        }
      }
      return out + '--' + b + '--\r\n';
    }
    if (body && body.__bytes !== undefined) return globalThis.__bytesToText(body.__bytes);
    if (body instanceof ArrayBuffer) return globalThis.__bytesToText(new Uint8Array(body));
    if (ArrayBuffer.isView(body)) {
      return globalThis.__bytesToText(
        new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      );
    }
    return String(body);
  };

  /// Merges a reference onto a base the way RFC 3986 does. Joining the two
  /// strings only ever worked for a plain sibling name: a rooted path landed
  /// under the base's directory instead of replacing it, so a challenge that
  /// posted to `/cdn-cgi/...` reached a path that does not exist.
  function __resolveUrl(url, base) {
    const ref = String(url);
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;
    const b = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(String(base));
    if (!b) return ref;
    const scheme = b[1];
    const authority = b[2];
    const basePath = b[3] || '/';
    const baseQuery = b[4] || '';
    if (ref.startsWith('//')) return scheme + ref;
    if (ref.startsWith('#')) return scheme + '//' + authority + basePath + baseQuery + ref;
    if (ref.startsWith('?')) return scheme + '//' + authority + basePath + ref;
    let path = ref.startsWith('/')
      ? ref
      : (basePath.slice(0, basePath.lastIndexOf('/') + 1) || '/') + ref;
    let tail = '';
    const cut = path.search(/[?#]/);
    if (cut >= 0) {
      tail = path.slice(cut);
      path = path.slice(0, cut);
    }
    const segments = [];
    for (const segment of path.split('/')) {
      if (segment === '.') continue;
      if (segment === '..') {
        if (segments.length > 1) segments.pop();
        continue;
      }
      segments.push(segment);
    }
    let merged = segments.join('/');
    if (!merged.startsWith('/')) merged = '/' + merged;
    return scheme + '//' + authority + merged + tail;
  }
  globalThis.__absolute = function __absolute(url) {
    if (!globalThis.__REALM_URL) return String(url);
    const here = (globalThis.location && globalThis.location.href) || '';
    return here ? __resolveUrl(String(url), here) : String(url);
  };

  globalThis.URL = function URL(url, base) {
    const abs = base ? __resolveUrl(url, base) : String(url);
    const m = /^(https?:|blob:)\/*([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(abs) || [];
    this.href = abs;
    this.protocol = m[1] || 'https:';
    this.host = m[2] || '';
    this.hostname = (m[2] || '').split(':')[0];
    this.port = (m[2] || '').split(':')[1] || '';
    this.pathname = m[3] || '/';
    this.search = m[4] || '';
    this.hash = m[5] || '';
    this.origin = (m[1] || 'https:') + '//' + (m[2] || '');
    this.searchParams = new globalThis.URLSearchParams(this.search);
    this.toString = () => this.href;
  };

  globalThis.URLSearchParams = function URLSearchParams(init) {
    const pairs = [];
    if (typeof init === 'string') {
      for (const part of init.replace(/^\?/, '').split('&')) {
        if (!part) continue;
        const i = part.indexOf('=');
        const k = i < 0 ? part : part.slice(0, i);
        const v = i < 0 ? '' : part.slice(i + 1);
        try {
          pairs.push([
            decodeURIComponent(k.replace(/\+/g, ' ')),
            decodeURIComponent(v.replace(/\+/g, ' ')),
          ]);
        } catch (e) {
          pairs.push([k, v]);
        }
      }
    } else if (init && typeof init === 'object') {
      for (const k of Object.keys(init)) pairs.push([k, String(init[k])]);
    }
    this.get = (k) => {
      for (const p of pairs) if (p[0] === k) return p[1];
      return null;
    };
    this.getAll = (k) => pairs.filter((p) => p[0] === k).map((p) => p[1]);
    this.has = (k) => pairs.some((p) => p[0] === k);
    this.set = (k, v) => {
      const i = pairs.findIndex((p) => p[0] === k);
      if (i >= 0) pairs[i][1] = String(v);
      else pairs.push([k, String(v)]);
    };
    this.append = (k, v) => pairs.push([k, String(v)]);
    this.delete = (k) => {
      for (let i = pairs.length - 1; i >= 0; i--) if (pairs[i][0] === k) pairs.splice(i, 1);
    };
    this.forEach = (fn) => pairs.forEach((p) => fn(p[1], p[0], this));
    this.keys = () => pairs.map((p) => p[0])[Symbol.iterator]();
    this.values = () => pairs.map((p) => p[1])[Symbol.iterator]();
    this.entries = () => pairs.map((p) => [p[0], p[1]])[Symbol.iterator]();
    this[Symbol.iterator] = () => this.entries();
    this.toString = () =>
      pairs.map((p) => encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1])).join('&');
    Object.defineProperty(this, 'size', { get: () => pairs.length });
  };
  globalThis.URL.createObjectURL = function (blob) {
    const id = 'blob:' + location.origin + '/' + ++__blobSeq + '-4f2a-9c1b-000000000000';
    __BLOBS.set(id, blob && blob.__bytes ? globalThis.__bytesToText(blob.__bytes) : '');
    return id;
  };
  globalThis.URL.revokeObjectURL = function (id) {
    __BLOBS.delete(id);
  };
  globalThis.webkitURL = globalThis.URL;

  // A worker's navigator is a WorkerNavigator, not the page's Navigator:
  globalThis.__workerNavigator = function __workerNavigator() {
    const n = globalThis.navigator;
    const out = {};
    // prettier-ignore
    for (const k of [
    'appCodeName', 'appName', 'appVersion', 'platform', 'product', 'productSub', 'vendor',
    'vendorSub', 'userAgent', 'language', 'languages', 'onLine', 'hardwareConcurrency',
    'deviceMemory', 'maxTouchPoints', 'userAgentData', 'storage', 'connection', 'permissions',
    'gpu', 'locks'
  ]) {
    try {
      const v = n[k];
      if (v !== undefined) out[k] = v;
    } catch (e) {}
  }
    try {
      Object.setPrototypeOf(out, __WorkerNavigator.prototype);
    } catch (e) {}
    return out;
  };

  // A worker scope is its own interface, and code that runs in one checks that
  // it is in one. These exist only inside a worker, never on a window.
  const __illegal = (name) => {
    const c = function () {
      throw new TypeError('Illegal constructor');
    };
    Object.defineProperty(c, 'name', { value: name, configurable: true });
    return c;
  };
  const __WorkerGlobalScope = __illegal('WorkerGlobalScope');
  const __DedicatedWorkerGlobalScope = __illegal('DedicatedWorkerGlobalScope');
  const __WorkerNavigator = __illegal('WorkerNavigator');
  const __WorkerLocation = __illegal('WorkerLocation');
  try {
    if (globalThis.EventTarget && globalThis.EventTarget.prototype) {
      Object.setPrototypeOf(__WorkerGlobalScope.prototype, globalThis.EventTarget.prototype);
    }
    Object.setPrototypeOf(__DedicatedWorkerGlobalScope.prototype, __WorkerGlobalScope.prototype);
  } catch (e) {}

  globalThis.Worker = function Worker(url, opts) {
    const self_ = this;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.__listeners = {};
    this.addEventListener = function (t, f) {
      (self_.__listeners[t] || (self_.__listeners[t] = [])).push(f);
    };
    this.removeEventListener = function () {};
    this.terminate = function () {};
    // Delivered on the timer queue: a worker posts while it is being constructed,
    // before the page has assigned onmessage.
    this.__deliverToMain = function (data) {
      __schedule(function () {
        const ev = { data, type: 'message', isTrusted: true, target: self_ };
        const listeners = self_.__listeners.message || [];
        for (const f of listeners) {
          try {
            f.call(self_, ev);
          } catch (e) {}
        }
        if (typeof self_.onmessage === 'function') {
          try {
            self_.onmessage(ev);
          } catch (e) {}
        }
      }, 0);
    };

    let src = __BLOBS.get(String(url)) || '';
    if (!src && String(url) && typeof __HOST_FETCH === 'function') {
      try {
        const r = JSON.parse(__HOST_FETCH('GET', __absolute(url), ''));
        src = String(r.body || '');
        __SCRIPTS_LOADED.push({ src: String(url), status: r.status, bytes: src.length });
      } catch (e) {
        __rec('call', 'Worker:fetch-failed', 0);
      }
    }
    const scope = {
      WorkerLocation: __WorkerLocation,
      __inbox: [],
      postMessage: (d) => self_.__deliverToMain(d),
      onmessage: null,
      onmessageerror: null,
      onerror: null,
      close() {},
      importScripts() {},
      addEventListener(t, f) {
        if (t === 'message') scope.__msgListeners.push(f);
      },
      removeEventListener() {},
      __msgListeners: [],
      navigator: __workerNavigator(),
      location: globalThis.location,
      performance: globalThis.performance,
      crypto: globalThis.crypto,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      Math,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Error,
      Promise,
      Uint8Array,
      Uint32Array,
      Int32Array,
      Float64Array,
      ArrayBuffer,
      DataView,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Proxy,
      Reflect,
      Symbol,
      RegExp,
      Function,
      Intl,
      TextEncoder,
      TextDecoder,
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      // Available in a worker, and read by the worker-side fingerprint.
      OffscreenCanvas: globalThis.OffscreenCanvas,
      createImageBitmap: globalThis.createImageBitmap,
      fetch: globalThis.fetch,
      XMLHttpRequest: globalThis.XMLHttpRequest,
      caches: globalThis.caches,
      indexedDB: globalThis.indexedDB,
      WorkerGlobalScope: __WorkerGlobalScope,
      DedicatedWorkerGlobalScope: __DedicatedWorkerGlobalScope,
      WorkerNavigator: __WorkerNavigator,
      // Absent in a worker, and defined here *as undefined* on purpose:
      window: undefined,
      document: undefined,
      parent: undefined,
      top: undefined,
      frames: undefined,
      localStorage: undefined,
      sessionStorage: undefined,
      alert: undefined,
      screen: undefined,
      history: undefined,
      chrome: undefined,
      requestAnimationFrame: undefined,
      getComputedStyle: undefined,
      matchMedia: undefined,
      speechSynthesis: undefined,
    };
    scope.name = opts && typeof opts.name === 'string' ? opts.name : '';

    const sandbox = new Proxy(scope, {
      has() {
        return true;
      },
      get(t, k) {
        if (k === Symbol.unscopables) return undefined;
        return k in t ? t[k] : globalThis[k];
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    });
    scope.self = sandbox;
    scope.globalThis = sandbox;
    // `self instanceof DedicatedWorkerGlobalScope` is how worker code confirms
    // where it is running.
    try {
      Object.setPrototypeOf(scope, __DedicatedWorkerGlobalScope.prototype);
    } catch (e) {}
    this.__scope = scope;
    if (src) {
      try {
        // The parameter must not be called `self`. Compiled bodies run under
        // `with (__GLOBAL_PROXY)`, which answers to `self` and would bind the page's
        // global instead of this scope.
        globalThis.__IN_WORKER = true;
        // Its own realm when the host offers one: worker code reads its global
        // from `this`, and sharing the page's context lands that on the page.
        if (typeof __HOST_WORKER_OPEN === 'function') {
          const ctx = __HOST_WORKER_OPEN(String(src), __IDENTITY.ua, String(url || ''));
          if (ctx >= 0) {
            self_.__ctx = ctx;
            globalThis.__WORKER_CTX_OWNER = globalThis.__WORKER_CTX_OWNER || new Map();
            globalThis.__WORKER_CTX_OWNER.set(ctx, self_);
            globalThis.__IN_WORKER = false;
            return;
          }
        }
        const f = new Function('__veriWorkerScope', 'with (__veriWorkerScope) { ' + src + ' }');
        f.call(sandbox, sandbox);
        globalThis.__IN_WORKER = false;
      } catch (e) {
        __rec('call', 'Worker:threw:' + String(e).slice(0, 60), 0);
      }
    }
    // The transfer list is the reply path, not a detail to drop: a challenge that
    // hands the worker a MessagePort expects its answer back through that port and
    // never through `worker.onmessage`.
    this.postMessage = function (data, transfer) {
      if (self_.__ctx !== undefined && typeof __HOST_FRAME_POST === 'function') {
        try {
          __HOST_FRAME_POST(self_.__ctx, JSON.stringify({ data }));
        } catch (e) {}
        return;
      }
      const ports = Array.isArray(transfer)
        ? transfer.filter((t) => t instanceof globalThis.MessagePort)
        : [];
      for (const p of ports) p.start();
      const ev = { data, type: 'message', isTrusted: true, target: scope, ports, source: null };
      __schedule(function () {
        for (const f of scope.__msgListeners) {
          try {
            f.call(scope, ev);
          } catch (e) {}
        }
        if (typeof scope.onmessage === 'function') {
          try {
            scope.onmessage.call(scope, ev);
          } catch (e) {}
        }
      }, 0);
    };
  };

  globalThis.MessagePort = function MessagePort() {
    this.__listeners = [];
    this.__queue = [];
    this.__peer = null;
    this.__started = false;
    this.__closed = false;
    this.onmessageerror = null;
  };

  globalThis.MessagePort.prototype = {
    constructor: globalThis.MessagePort,
    postMessage(data) {
      const peer = this.__peer;
      if (!peer || peer.__closed) return;
      __schedule(
        () => peer.__accept({ data, type: 'message', isTrusted: true, target: peer, ports: [] }),
        0,
      );
    },
    start() {
      if (this.__started) return;
      this.__started = true;
      const queued = this.__queue.splice(0);
      for (const ev of queued) __schedule(() => this.__deliver(ev), 0);
    },
    close() {
      this.__closed = true;
    },
    addEventListener(type, fn) {
      if (type === 'message' && typeof fn === 'function') this.__listeners.push(fn);
    },
    removeEventListener(type, fn) {
      const i = this.__listeners.indexOf(fn);
      if (i >= 0) this.__listeners.splice(i, 1);
    },
    dispatchEvent() {
      return true;
    },
    // Queued until started, which is what a real port does: messages posted
    // before `start()` are held rather than dropped.
    __accept(ev) {
      if (this.__closed) return;
      if (!this.__started) {
        this.__queue.push(ev);
        return;
      }
      this.__deliver(ev);
    },
    __deliver(ev) {
      if (typeof this.__onmessage === 'function') {
        try {
          this.__onmessage.call(this, ev);
        } catch (e) {
          globalThis.__noteError('message', e);
        }
      }
      for (const f of this.__listeners.slice()) {
        try {
          f.call(this, ev);
        } catch (e) {
          globalThis.__noteError('message', e);
        }
      }
    },
  };

  // Assigning `onmessage` starts the port; `addEventListener` alone does not.
  Object.defineProperty(globalThis.MessagePort.prototype, 'onmessage', {
    configurable: true,
    enumerable: true,
    get() {
      return this.__onmessage || null;
    },
    set(fn) {
      this.__onmessage = fn;
      this.start();
    },
  });

  globalThis.MessageChannel = function MessageChannel() {
    const a = new globalThis.MessagePort();
    const b = new globalThis.MessagePort();
    a.__peer = b;
    b.__peer = a;
    this.port1 = a;
    this.port2 = b;
  };

  if (typeof WebAssembly === 'object' && WebAssembly) {
    const fromResponse = (source) =>
      Promise.resolve(source).then((r) =>
        r && typeof r.arrayBuffer === 'function' ? r.arrayBuffer() : r,
      );
    if (typeof WebAssembly.instantiateStreaming !== 'function') {
      WebAssembly.instantiateStreaming = function instantiateStreaming(source, imports) {
        return fromResponse(source).then((buf) => WebAssembly.instantiate(buf, imports));
      };
    }
    if (typeof WebAssembly.compileStreaming !== 'function') {
      WebAssembly.compileStreaming = function compileStreaming(source) {
        return fromResponse(source).then((buf) => WebAssembly.compile(buf));
      };
    }
  }

  (function () {
    const tz = (globalThis.__IDENTITY && globalThis.__IDENTITY.tz) || 'UTC';
    const RealDate = Date;

    // [minutes east of UTC, dst rule, standard name, summer name]
    // prettier-ignore
    const ZONES = {
    UTC: [0, null, 'Coordinated Universal Time', null],
    'Europe/London': [0, 'eu', 'Greenwich Mean Time', 'British Summer Time'],
    'Europe/Lisbon': [0, 'eu', 'Western European Standard Time', 'Western European Summer Time'],
    'Europe/Warsaw': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Berlin': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Paris': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Madrid': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Rome': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Amsterdam': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Stockholm': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Zurich': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Prague': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
    'Europe/Helsinki': [120, 'eu', 'Eastern European Standard Time', 'Eastern European Summer Time'],
    'Europe/Athens': [120, 'eu', 'Eastern European Standard Time', 'Eastern European Summer Time'],
    'Europe/Bucharest': [120, 'eu', 'Eastern European Standard Time', 'Eastern European Summer Time'],
    'Europe/Moscow': [180, null, 'Moscow Standard Time', null],
    'America/New_York': [-300, 'us', 'Eastern Standard Time', 'Eastern Daylight Time'],
    'America/Toronto': [-300, 'us', 'Eastern Standard Time', 'Eastern Daylight Time'],
    'America/Chicago': [-360, 'us', 'Central Standard Time', 'Central Daylight Time'],
    'America/Denver': [-420, 'us', 'Mountain Standard Time', 'Mountain Daylight Time'],
    'America/Phoenix': [-420, null, 'Mountain Standard Time', null],
    'America/Los_Angeles': [-480, 'us', 'Pacific Standard Time', 'Pacific Daylight Time'],
    'America/Vancouver': [-480, 'us', 'Pacific Standard Time', 'Pacific Daylight Time'],
    'America/Sao_Paulo': [-180, null, 'Brasilia Standard Time', null],
    'Asia/Dubai': [240, null, 'Gulf Standard Time', null],
    'Asia/Kolkata': [330, null, 'India Standard Time', null],
    'Asia/Shanghai': [480, null, 'China Standard Time', null],
    'Asia/Singapore': [480, null, 'Singapore Standard Time', null],
    'Asia/Hong_Kong': [480, null, 'Hong Kong Standard Time', null],
    'Asia/Tokyo': [540, null, 'Japan Standard Time', null],
    'Asia/Seoul': [540, null, 'Korean Standard Time', null],
    'Australia/Perth': [480, null, 'Australian Western Standard Time', null],
    'Australia/Brisbane': [600, null, 'Australian Eastern Standard Time', null],
    'Australia/Sydney': [600, 'au', 'Australian Eastern Standard Time', 'Australian Eastern Daylight Time'],
  };

    const fallbackOffset =
      globalThis.__PROFILE &&
      globalThis.__PROFILE.misc &&
      typeof globalThis.__PROFILE.misc.timezoneOffset === 'number'
        ? -globalThis.__PROFILE.misc.timezoneOffset
        : 0;
    const zone = ZONES[tz] || [fallbackOffset, null, 'GMT', null];

    function nthDow(year, month, dow, nth, hourUTC) {
      if (nth > 0) {
        const first = new RealDate(RealDate.UTC(year, month, 1));
        const shift = (dow - first.getUTCDay() + 7) % 7;
        return RealDate.UTC(year, month, 1 + shift + (nth - 1) * 7, hourUTC);
      }
      const last = new RealDate(RealDate.UTC(year, month + 1, 0));
      const back = (last.getUTCDay() - dow + 7) % 7;
      return RealDate.UTC(year, month + 1, 0 - back, hourUTC);
    }

    function inDst(ms) {
      const rule = zone[1];
      if (!rule) return false;
      const y = new RealDate(ms).getUTCFullYear();
      if (rule === 'eu') {
        // Last Sunday of March to last Sunday of October, 01:00 UTC both ends.
        return ms >= nthDow(y, 2, 0, -1, 1) && ms < nthDow(y, 9, 0, -1, 1);
      }
      if (rule === 'us') {
        // Second Sunday of March to first Sunday of November, 02:00 local.
        const std = zone[0];
        return (
          ms >= nthDow(y, 2, 0, 2, 2) - std * 60000 &&
          ms < nthDow(y, 10, 0, 1, 2) - (std + 60) * 60000
        );
      }
      if (rule === 'au') {
        // Southern hemisphere: October to April, so the year wraps.
        return ms >= nthDow(y, 9, 0, 1, 2) || ms < nthDow(y, 3, 0, 1, 3);
      }
      return false;
    }

    const eastOf = (ms) => zone[0] + (inDst(ms) ? 60 : 0);
    const offsetAt = (ms) => -eastOf(ms);
    const zoneName = (ms) => (inDst(ms) && zone[3] ? zone[3] : zone[2] || 'GMT');

    try {
      Date.prototype.getTimezoneOffset = function () {
        return offsetAt(this.getTime());
      };
    } catch (e) {}

    const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MON = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const pad = (n) => String(n).padStart(2, '0');
    const shifted = (d) => new RealDate(d.getTime() + eastOf(d.getTime()) * 60000);
    function gmt(d) {
      const off = eastOf(d.getTime());
      const abs = Math.abs(off);
      return 'GMT' + (off >= 0 ? '+' : '-') + pad((abs / 60) | 0) + pad(abs % 60);
    }

    const dateStr = (u) =>
      DAY[u.getUTCDay()] +
      ' ' +
      MON[u.getUTCMonth()] +
      ' ' +
      pad(u.getUTCDate()) +
      ' ' +
      u.getUTCFullYear();
    const timeStr = (u, d) =>
      pad(u.getUTCHours()) +
      ':' +
      pad(u.getUTCMinutes()) +
      ':' +
      pad(u.getUTCSeconds()) +
      ' ' +
      gmt(d) +
      ' (' +
      zoneName(d.getTime()) +
      ')';

    try {
      Date.prototype.toString = function () {
        if (isNaN(this.getTime())) return 'Invalid Date';
        const u = shifted(this);
        return dateStr(u) + ' ' + timeStr(u, this);
      };
      Date.prototype.toTimeString = function () {
        if (isNaN(this.getTime())) return 'Invalid Date';
        return timeStr(shifted(this), this);
      };
      Date.prototype.toDateString = function () {
        if (isNaN(this.getTime())) return 'Invalid Date';
        return dateStr(shifted(this));
      };
      Date.prototype.toLocaleDateString = function () {
        const u = shifted(this);
        return u.getUTCMonth() + 1 + '/' + u.getUTCDate() + '/' + u.getUTCFullYear();
      };
      Date.prototype.toLocaleTimeString = function () {
        const u = shifted(this);
        const h = u.getUTCHours();
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return (
          h12 +
          ':' +
          pad(u.getUTCMinutes()) +
          ':' +
          pad(u.getUTCSeconds()) +
          (h < 12 ? ' AM' : ' PM')
        );
      };
      Date.prototype.toLocaleString = function () {
        return this.toLocaleDateString() + ', ' + this.toLocaleTimeString();
      };
    } catch (e) {}

    // The replacement. Never delegates to the real constructor.
    try {
      const DTF = function DateTimeFormat(locales, options) {
        if (!(this instanceof DTF)) return new DTF(locales, options);
        const o = options || {};
        this.__opts = {
          locale: (Array.isArray(locales) ? locales[0] : locales) || 'en-US',
          calendar: 'gregory',
          numberingSystem: 'latn',
          timeZone: o.timeZone || tz,
          ...o,
        };
        return this;
      };
      DTF.prototype.resolvedOptions = function () {
        return { ...this.__opts };
      };
      DTF.prototype.format = function (d) {
        const date = d instanceof RealDate ? d : new RealDate(d === undefined ? RealDate.now() : d);
        return date.toLocaleDateString();
      };
      DTF.prototype.formatToParts = function (d) {
        const date = d instanceof RealDate ? d : new RealDate(d === undefined ? RealDate.now() : d);
        const u = shifted(date);
        return [
          { type: 'month', value: pad(u.getUTCMonth() + 1) },
          { type: 'literal', value: '/' },
          { type: 'day', value: pad(u.getUTCDate()) },
          { type: 'literal', value: '/' },
          { type: 'year', value: String(u.getUTCFullYear()) },
          { type: 'literal', value: ', ' },
          { type: 'hour', value: pad(u.getUTCHours()) },
          { type: 'literal', value: ':' },
          { type: 'minute', value: pad(u.getUTCMinutes()) },
          { type: 'literal', value: ':' },
          { type: 'second', value: pad(u.getUTCSeconds()) },
          { type: 'timeZoneName', value: zoneName(date.getTime()) },
        ];
      };
      DTF.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      Intl.DateTimeFormat = DTF;
    } catch (e) {}

    // Without ICU these do not abort, they throw `Internal error. Icu error.`
    try {
      const NF = function NumberFormat(locales, options) {
        if (!(this instanceof NF)) return new NF(locales, options);
        const o = options || {};
        this.__opts = {
          locale: (Array.isArray(locales) ? locales[0] : locales) || 'en-US',
          numberingSystem: 'latn',
          style: o.style || 'decimal',
          minimumIntegerDigits: 1,
          minimumFractionDigits: 0,
          maximumFractionDigits: 3,
          useGrouping: o.useGrouping === undefined ? 'auto' : o.useGrouping,
          notation: 'standard',
          signDisplay: 'auto',
          ...o,
        };
        return this;
      };
      NF.prototype.resolvedOptions = function () {
        return { ...this.__opts };
      };
      NF.prototype.format = function (n) {
        const num = Number(n);
        if (!isFinite(num)) return String(num);
        const max = this.__opts.maximumFractionDigits;
        const min = this.__opts.minimumFractionDigits;
        let s = Math.abs(num).toFixed(Math.min(20, Math.max(min, 0)));
        if (max > min && String(Math.abs(num)).indexOf('.') >= 0) s = String(Math.abs(num));
        const parts = s.split('.');
        if (this.__opts.useGrouping !== false) {
          parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
        return (num < 0 ? '-' : '') + parts.join('.');
      };
      NF.prototype.formatToParts = function (n) {
        return [{ type: 'literal', value: this.format(n) }];
      };
      NF.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      Intl.NumberFormat = NF;

      const CO = function Collator(locales, options) {
        if (!(this instanceof CO)) return new CO(locales, options);
        this.__opts = {
          locale: (Array.isArray(locales) ? locales[0] : locales) || 'en-US',
          usage: 'sort',
          sensitivity: 'variant',
          ignorePunctuation: false,
          collation: 'default',
          numeric: false,
          caseFirst: 'false',
          ...(options || {}),
        };
        return this;
      };
      CO.prototype.resolvedOptions = function () {
        return { ...this.__opts };
      };
      CO.prototype.compare = function (a, b) {
        const x = String(a),
          y = String(b);
        return x < y ? -1 : x > y ? 1 : 0;
      };
      CO.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      Intl.Collator = CO;
    } catch (e) {}

    try {
      const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      Number.prototype.toLocaleString = function (locales, options) {
        return new Intl.NumberFormat(locales, options).format(Number(this));
      };
      if (typeof BigInt === 'function' && BigInt.prototype) {
        // Via the decimal string, since going through Number loses precision.
        BigInt.prototype.toLocaleString = function () {
          const s = this.toString();
          return s.charAt(0) === '-' ? '-' + group(s.slice(1)) : group(s);
        };
      }
      String.prototype.localeCompare = function (that) {
        return new Intl.Collator().compare(String(this), String(that));
      };
      Array.prototype.toLocaleString = function () {
        let out = '';
        for (let i = 0; i < this.length; i++) {
          if (i) out += ',';
          const v = this[i];
          if (v !== null && v !== undefined) out += v.toLocaleString();
        }
        return out;
      };
      if (globalThis.__markNative) {
        __markNative(Number.prototype);
        __markNative(String.prototype);
        __markNative(Array.prototype);
      }
    } catch (e) {}
  })();
})();
