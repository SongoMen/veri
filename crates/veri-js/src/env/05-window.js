(function () {
  const location = {
    href: __PAGE_URL,
    protocol: __URL.protocol,
    host: __URL.hostname + (__URL.port ? ':' + __URL.port : ''),
    hostname: __URL.hostname,
    port: __URL.port,
    pathname: __URL.pathname,
    search: __URL.search,
    hash: __URL.hash,
    origin: __URL.protocol + '//' + __URL.hostname + (__URL.port ? ':' + __URL.port : ''),
    reload() {},
    replace() {},
    assign() {},
    toString() {
      return this.href;
    },
  };

  const navigator = {
    userAgent: __IDENTITY.ua,
    appVersion: __IDENTITY.ua.replace('Mozilla/', ''),
    appName: 'Netscape',
    appCodeName: 'Mozilla',
    platform: __IDENTITY.platform,
    product: 'Gecko',
    productSub: '20030107',
    vendor: /Firefox\//.test(__IDENTITY.ua)
      ? ''
      : /Safari\//.test(__IDENTITY.ua) && !/Chrome\//.test(__IDENTITY.ua)
        ? 'Apple Computer, Inc.'
        : 'Google Inc.',
    vendorSub: '',
    language: __IDENTITY.language,
    languages: __IDENTITY.languages,
    onLine: true,
    cookieEnabled: true,
    doNotTrack: null,
    hardwareConcurrency: __IDENTITY.hardwareConcurrency,
    ...(/Chrome\//.test(__IDENTITY.ua) ? { deviceMemory: __IDENTITY.deviceMemory } : {}),
    maxTouchPoints: 0,
    pdfViewerEnabled: true,
    webdriver: false,
    javaEnabled: () => false,
    getGamepads: () => [null, null, null, null],
  };
  const __GREASE_BRAND = (function () {
    try {
      const b = globalThis.__PROFILE.navigator.userAgentData.brands;
      for (const x of b) if (!/Chrome|Chromium/i.test(x.brand)) return x.brand;
    } catch (e) {}
    return 'Not=A?Brand';
  })();

  (function () {
    const v = /Chrome\/(\d+)/.exec(__IDENTITY.ua);
    if (v) {
      navigator.userAgentData = {
        // GREASE brand taken from the harvested profile: Chrome varies the
        // string by version, and inventing one is a mismatch a comparison finds.
        brands: [
          { brand: __GREASE_BRAND, version: '99' },
          { brand: 'Google Chrome', version: v[1] },
          { brand: 'Chromium', version: v[1] },
        ],
        mobile: false,
        platform: 'macOS',
        // The hardware-shaped fields are harvested; the version-shaped ones track the
        // identity being claimed, so the two halves cannot contradict.
        getHighEntropyValues: () => {
          const U = globalThis.__UA_DATA || {};
          // The high-entropy version is a four-part build number; `.0.0.0` is the
          // low-entropy form. Reuses the harvested build with the claimed major.
          const harvested = U.uaFullVersion || '';
          const full = (function () {
            const parts = harvested.split('.');
            if (parts.length === 4) {
              if (parts[0] === v[1]) return harvested;
              return [v[1], parts[1], parts[2], parts[3]].join('.');
            }
            return v[1] + '.0.0.0';
          })();
          return Promise.resolve({
            architecture: U.architecture || 'arm',
            bitness: U.bitness || '64',
            model: U.model !== undefined ? U.model : '',
            platform: U.platform || 'macOS',
            platformVersion: U.platformVersion || '15.5.0',
            wow64: U.wow64 === true,
            formFactors: U.formFactors || ['Desktop'],
            uaFullVersion: full,
            brands: [
              { brand: __GREASE_BRAND, version: '99' },
              { brand: 'Google Chrome', version: v[1] },
              { brand: 'Chromium', version: v[1] },
            ],
            fullVersionList: [
              { brand: __GREASE_BRAND, version: '99.0.0.0' },
              { brand: 'Google Chrome', version: full },
              { brand: 'Chromium', version: full },
            ],
            mobile: false,
          });
        },
        toJSON() {
          return { brands: this.brands, mobile: this.mobile, platform: this.platform };
        },
      };
    }
  })();

  const screen = {
    width: __IDENTITY.screenW,
    height: __IDENTITY.screenH,
    availWidth: __IDENTITY.screenW,
    availHeight: __IDENTITY.availH,
    availLeft: 0,
    availTop: __IDENTITY.availTop,
    colorDepth: __IDENTITY.colorDepth,
    pixelDepth: __IDENTITY.colorDepth,
    orientation: { angle: 0, type: 'landscape-primary' },
  };

  const history = {
    length: 1,
    scrollRestoration: 'auto',
    state: null,
    pushState() {},
    replaceState() {},
    back() {},
    forward() {},
    go() {},
  };

  const performance = {
    timeOrigin: Date.now(),
    // Virtual time for scheduled waits, so a timer does not really sleep, plus the
    // real time spent inside the current tick. Purely virtual made every piece of
    // synchronous work measure as 0.1ms, and a challenge that divides bytes by
    // elapsed then never converges - AWS WAF's bandwidth check loops forever on it.
    now: (() => {
      let last = 0;
      let tickVirt = -1;
      let tickReal = 0;
      return () => {
        const virt = globalThis.__NOW || 0;
        if (virt !== tickVirt) {
          tickVirt = virt;
          tickReal = Date.now();
        }
        const t = virt + (Date.now() - tickReal);
        last = t > last ? t : last + 0.0001;
        return last;
      };
    })(),
    timing: {},
    navigation: { type: 0 },
    // Chrome-only, and present on every real Chrome.
    memory: (function () {
      const M =
        (globalThis.__PROFILE && globalThis.__PROFILE.misc && globalThis.__PROFILE.misc.memory) ||
        {};
      const total = M.totalJSHeapSize || 2102155;
      const used = M.usedJSHeapSize || 1303703;
      return {
        jsHeapSizeLimit: M.jsHeapSizeLimit || 4395630592,
        get totalJSHeapSize() {
          return total + (((Date.now() / 1000) | 0) % 400000);
        },
        get usedJSHeapSize() {
          return used + (((Date.now() / 1000) | 0) % 300000);
        },
      };
    })(),
    getEntriesByType: () => [],
    getEntriesByName: () => [],
    mark() {},
    measure() {},
  };

  globalThis.document = __watch('document', __DOCUMENT);
  globalThis.location = __watch('location', location);
  // The raw objects, so later stages can restructure them.
  globalThis.__RAW_NAVIGATOR = navigator;
  globalThis.__RAW_SCREEN = screen;
  globalThis.navigator = __watch('navigator', navigator);
  globalThis.screen = __watch('screen', screen);
  globalThis.history = __watch('history', history);
  globalThis.performance = __watch('performance', performance);

  globalThis.innerWidth = __IDENTITY.innerW;
  globalThis.innerHeight = __IDENTITY.innerH;

  globalThis.__setFrameViewport = function __setFrameViewport(w, h) {
    if (!(w > 0) || !(h > 0)) return;
    globalThis.innerWidth = w;
    globalThis.innerHeight = h;
    globalThis.outerWidth = w;
    globalThis.outerHeight = h;
    try {
      document.hasFocus = () => false;
      if (globalThis.__markNativeFn) globalThis.__markNativeFn(document.hasFocus);
    } catch (e) {}
    try {
      document.documentElement.clientWidth = w;
      document.documentElement.clientHeight = h;
    } catch (e) {}
  };
  globalThis.outerWidth = __IDENTITY.screenW;
  globalThis.outerHeight = __IDENTITY.screenH - 38;
  globalThis.devicePixelRatio = __IDENTITY.dpr;
  globalThis.screenX = 0;
  globalThis.screenY = 38;
  globalThis.pageXOffset = 0;
  globalThis.pageYOffset = 0;
  globalThis.origin = location.origin;
  globalThis.isSecureContext = true;
  globalThis.closed = false;
  globalThis.name = '';

  // A window can post to itself, and code that reaches for it and finds nothing
  // there takes a branch no browser takes.
  globalThis.postMessage = function (data) {
    const ev = {
      type: 'message',
      isTrusted: true,
      data,
      origin: globalThis.location ? globalThis.location.origin : '',
      source: globalThis.window,
      lastEventId: '',
      ports: [],
      bubbles: false,
      cancelable: false,
    };
    __schedule(function () {
      for (const f of ((globalThis.__LISTENERS.window || {}).message || []).slice()) {
        try {
          typeof f === 'function' ? f(ev) : f.handleEvent(ev);
        } catch (e) {}
      }
      if (typeof globalThis.onmessage === 'function') {
        try {
          globalThis.onmessage(ev);
        } catch (e) {}
      }
    }, 0);
  };

  globalThis.addEventListener = function (t, f) {
    __listenerFactory('window').add(t, f);
  };
  globalThis.removeEventListener = function (t, f) {
    __listenerFactory('window').remove(t, f);
  };
  globalThis.dispatchEvent = function () {
    return true;
  };
  globalThis.__NOW = 0;
  globalThis.__TIMER_SEQ = 0;
  globalThis.__schedule = function (fn, delay, extraArgs) {
    const id = ++__TIMER_ID;
    if (typeof fn !== 'function') return id;
    __TIMERS.push({
      id,
      fn,
      args: extraArgs || [],
      at: __NOW + (Number(delay) > 0 ? Number(delay) : 0),
      seq: ++__TIMER_SEQ,
    });
    return id;
  };
  globalThis.setTimeout = function (fn, delay, ...rest) {
    return __schedule(fn, delay, rest);
  };
  globalThis.clearTimeout = function (id) {
    __CANCELLED.add(id);
  };
  globalThis.__INTERVAL_CAP = 12;
  globalThis.__CANCELLED = new Set();
  globalThis.setInterval = function (fn, ms) {
    const id = ++__TIMER_ID;
    if (typeof fn !== 'function') return id;
    let runs = 0;
    const tick = function () {
      if (__CANCELLED.has(id) || runs++ >= __INTERVAL_CAP) return;
      try {
        fn();
      } finally {
        if (!__CANCELLED.has(id) && runs < __INTERVAL_CAP) __schedule(tick, ms);
      }
    };
    __schedule(tick, ms);
    return id;
  };
  globalThis.clearInterval = function (id) {
    __CANCELLED.add(id);
  };
  globalThis.requestAnimationFrame = function (fn) {
    return __schedule(function () {
      fn(globalThis.performance ? performance.now() : 0);
    }, 16);
  };
  globalThis.cancelAnimationFrame = function () {};
  // The profile materialises this as a bare stub that never calls back, and code
  // that hands it work then waits forever. AWS WAF's challenge queues its solve
  // here, so a stub leaves it polling and it never submits.
  globalThis.requestIdleCallback = function requestIdleCallback(fn) {
    return __schedule(function () {
      if (typeof fn === 'function') {
        fn({
          didTimeout: false,
          timeRemaining() {
            return 50;
          },
        });
      }
    }, 1);
  };
  globalThis.cancelIdleCallback = function cancelIdleCallback(id) {
    __CANCELLED.add(id);
  };
  globalThis.queueMicrotask = function (fn) {
    if (typeof fn === 'function') Promise.resolve().then(fn);
  };
  globalThis.__TIMERS = [];
  globalThis.__TIMER_ID = 0;

  // How far ahead of real time a timer may be fired. A challenge that samples
  // on an interval measures the rate it gets them back, and collapsing the wait
  // hands it a rate no machine could produce.
  const AHEAD_CAP_MS = 250;
  globalThis.__T0 = globalThis.__T0 || Date.now();

  globalThis.__drainOnce = function () {
    if (!__TIMERS.length) return 0;
    let due = Infinity;
    for (const t of __TIMERS) if (t.at < due) due = t.at;
    const elapsed = Date.now() - __T0;
    // Not yet its turn. The test is how far ahead the clock would land, not how
    // far away the timer is: firing whatever sits beyond the cap is what a long
    // wait needs least, and it drags the whole clock forward to meet it.
    if (due > elapsed + AHEAD_CAP_MS) return -1;
    __NOW = Math.max(__NOW, due, elapsed);
    const batch = [];
    for (let i = __TIMERS.length - 1; i >= 0; i--) {
      if (__TIMERS[i].at <= due) {
        batch.push(__TIMERS[i]);
        __TIMERS.splice(i, 1);
      }
    }
    batch.sort((a, b) => a.seq - b.seq);
    let n = 0;
    for (const t of batch) {
      if (__CANCELLED.has(t.id)) continue;
      try {
        t.fn.apply(null, t.args);
        n++;
      } catch (e) {
        __noteError('timer', e);
      }
    }
    return n;
  };

  globalThis.atob = function (s) {
    const bytes = globalThis.__unb64(String(s));
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  };

  globalThis.btoa = function (s) {
    s = String(s);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    return globalThis.__b64(bytes);
  };

  globalThis.__NET = [];
  (function () {
    const push = globalThis.__NET.push.bind(globalThis.__NET);
    globalThis.__NET.push = function (entry) {
      try {
        if (entry && typeof entry === 'object') {
          entry.__t = globalThis.performance ? performance.now() : 0;
        }
      } catch (e) {}
      return push(entry);
    };
  })();
  globalThis.XMLHttpRequest = function () {
    const self = this;
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.response = '';
    this.responseType = '';
    this.withCredentials = false;
    this.timeout = 0;
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
    this.ontimeout = null;
    this.__listeners = {};
    this.open = function (m, u) {
      self.__m = m;
      self.__u = u;
      self.readyState = 1;
    };
    this.setRequestHeader = function (k, v) {
      (self.__h = self.__h || {})[k] = v;
    };
    this.addEventListener = function (t, f) {
      (self.__listeners[t] || (self.__listeners[t] = [])).push(f);
    };
    this.removeEventListener = function () {};
    this.abort = function () {};
    this.getAllResponseHeaders = function () {
      return 'content-type: text/plain\r\n';
    };
    this.getResponseHeader = function () {
      return null;
    };

    this.__emit = function (type) {
      const ev = {
        type,
        target: self,
        currentTarget: self,
        loaded: self.responseText.length,
        total: self.responseText.length,
        lengthComputable: true,
      };
      const l = self.__listeners[type] || [];
      for (const fn of l) {
        try {
          (typeof fn === 'function' ? fn : fn.handleEvent).call(self, ev);
        } catch (e) {
          __noteError('xhr:' + type, e);
        }
      }
      const h = self['on' + type];
      if (typeof h === 'function') {
        try {
          h.call(self, ev);
        } catch (e) {
          __noteError('xhr:on' + type, e);
        }
      }
    };

    this.send = function (b) {
      const body = b === undefined || b === null ? null : __encodeBody(b);
      __NET.push({ kind: 'xhr', method: self.__m, url: self.__u, headers: self.__h || {}, body });
      if (typeof __HOST_FETCH === 'function') {
        __schedule(function () {
          let r;
          try {
            const hdrs = globalThis.__headerPairs(self.__h);
            r = JSON.parse(
              hdrs.length && typeof __HOST_FETCH_HEADERS === 'function'
                ? __HOST_FETCH_HEADERS(
                    self.__m || 'GET',
                    __absolute(self.__u),
                    body || '',
                    JSON.stringify(hdrs),
                  )
                : __HOST_FETCH(self.__m || 'GET', __absolute(self.__u), body || ''),
            );
          } catch (e) {
            r = { status: 0, body: '' };
          }
          self.status = r.status | 0;
          self.responseText = String(r.body || '');
          self.response = self.responseText;
          __NET.push({
            kind: 'xhr-response',
            method: self.__m,
            url: self.__u,
            body: 'status=' + self.status + ' len=' + self.responseText.length,
          });
          self.readyState = 2;
          self.__emit('readystatechange');
          self.readyState = 3;
          self.__emit('readystatechange');
          self.readyState = 4;
          self.__emit('readystatechange');
          self.__emit(self.status >= 200 && self.status < 400 ? 'load' : 'error');
          self.__emit('loadend');
        }, 1);
      }
    };
  };
  // The page's own headers, as pairs the bridge can send.
  globalThis.__headerPairs = function (h) {
    const out = [];
    if (!h) return out;
    if (typeof h.forEach === 'function' && !Array.isArray(h)) {
      try {
        h.forEach((v, k) => out.push([String(k), String(v)]));
        return out;
      } catch (e) {}
    }
    if (Array.isArray(h)) {
      for (const p of h) if (p && p.length === 2) out.push([String(p[0]), String(p[1])]);
      return out;
    }
    for (const k of Object.keys(h)) out.push([String(k), String(h[k])]);
    return out;
  };

  globalThis.fetch = function (u, opts) {
    const method = opts && opts.method ? String(opts.method).toUpperCase() : 'GET';
    const body = opts && opts.body != null ? __encodeBody(opts.body) : '';
    __NET.push({ kind: 'fetch', url: String(u), method, body: body || null });

    if (typeof __HOST_FETCH !== 'function') {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return new Promise(function (resolve, reject) {
      __schedule(function () {
        let r;
        // One request, whatever is asked of the response afterwards. Fetching
        // bytes and decoding here is what stops `.arrayBuffer()` sending the
        // whole thing a second time, which a one-shot endpoint answers once.
        let raw = null;
        try {
          const hdrs = globalThis.__headerPairs(opts && opts.headers);
          if (hdrs.length && typeof __HOST_FETCH_HEADERS === 'function') {
            r = JSON.parse(__HOST_FETCH_HEADERS(method, __absolute(u), body, JSON.stringify(hdrs)));
          } else if (typeof __HOST_FETCH_BYTES === 'function') {
            const b = JSON.parse(__HOST_FETCH_BYTES(method, __absolute(u), body));
            raw = __unb64(String(b.b64 || ''));
            r = { status: b.status, body: globalThis.__bytesToText(raw) };
          } else {
            r = JSON.parse(__HOST_FETCH(method, __absolute(u), body));
          }
        } catch (e) {
          r = { status: 0, body: '' };
        }
        const status = r.status | 0;
        const text = String(r.body || '');
        __NET.push({
          kind: 'fetch-response',
          url: String(u),
          body: 'status=' + status + ' len=' + text.length,
        });
        if (status === 0) {
          reject(new TypeError('Failed to fetch'));
          return;
        }
        // Only the custom-header route has no bytes variant to ask for, so it
        // is the one case that still has to go back.
        const bytes = () => {
          if (raw) return raw;
          if (typeof __HOST_FETCH_BYTES !== 'function') return new Uint8Array(0);
          try {
            const b = JSON.parse(__HOST_FETCH_BYTES(method, String(u), body));
            raw = __unb64(String(b.b64 || ''));
            return raw;
          } catch (e) {
            return new Uint8Array(0);
          }
        };
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: '',
          url: String(u),
          redirected: false,
          type: 'basic',
          headers: { get: () => null, has: () => false, forEach: () => {} },
          text: () => Promise.resolve(text),
          json: () => Promise.resolve(JSON.parse(text || 'null')),
          arrayBuffer: () => Promise.resolve(bytes().slice().buffer),
          blob: () => Promise.resolve(new globalThis.Blob([bytes()])),
          clone() {
            return this;
          },
        });
      }, 1);
    });
  };

  globalThis.navigator.sendBeacon = function (u, b) {
    const body = b != null ? String(b) : '';
    __NET.push({ kind: 'beacon', url: String(u), body: body || null });
    if (typeof __HOST_FETCH !== 'function') return false;
    __schedule(function () {
      try {
        __HOST_FETCH('POST', __absolute(u), body);
      } catch (e) {}
    }, 1);
    return true;
  };

  globalThis.crypto = __watch('crypto', {
    subtle: __SUBTLE,
    getRandomValues(a) {
      for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0;
      return a;
    },
    randomUUID() {
      const h = [];
      for (let i = 0; i < 256; i++) h.push((i + 0x100).toString(16).slice(1));
      const b = new Uint8Array(16);
      for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      return (
        h[b[0]] +
        h[b[1]] +
        h[b[2]] +
        h[b[3]] +
        '-' +
        h[b[4]] +
        h[b[5]] +
        '-' +
        h[b[6]] +
        h[b[7]] +
        '-' +
        h[b[8]] +
        h[b[9]] +
        '-' +
        h[b[10]] +
        h[b[11]] +
        h[b[12]] +
        h[b[13]] +
        h[b[14]] +
        h[b[15]]
      );
    },
  });

  // A real Storage enumerates its stored keys and nothing else: the methods
  // live on the prototype and `length` counts what is in it.
  const makeStorage = () => {
    const d = Object.create(null);
    const proto = {
      getItem(k) {
        return k in d ? d[k] : null;
      },
      setItem(k, v) {
        d[String(k)] = String(v);
      },
      removeItem(k) {
        delete d[String(k)];
      },
      clear() {
        for (const k of Object.keys(d)) delete d[k];
      },
      key(i) {
        const keys = Object.keys(d);
        return i >= 0 && i < keys.length ? keys[i] : null;
      },
    };
    Object.defineProperty(proto, Symbol.toStringTag, { value: 'Storage', configurable: true });
    const store = Object.create(proto);
    Object.defineProperty(store, 'length', {
      get: () => Object.keys(d).length,
      configurable: true,
    });
    return new Proxy(store, {
      get: (t, k) => (typeof k === 'string' && k in d && !(k in t) ? d[k] : Reflect.get(t, k)),
      set(t, k, v) {
        if (typeof k === 'string' && !(k in t)) {
          d[k] = String(v);
          return true;
        }
        return Reflect.set(t, k, v);
      },
      has: (t, k) => (typeof k === 'string' && k in d) || Reflect.has(t, k),
      deleteProperty(t, k) {
        if (typeof k === 'string' && k in d) {
          delete d[k];
          return true;
        }
        return Reflect.deleteProperty(t, k);
      },
      ownKeys: () => Object.keys(d),
      getOwnPropertyDescriptor: (t, k) =>
        typeof k === 'string' && k in d
          ? { value: d[k], writable: true, enumerable: true, configurable: true }
          : Reflect.getOwnPropertyDescriptor(t, k),
    });
  };

  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();

  // Navigation timing. The field set and constant fields are harvested; the
  // timings scale per run and keep the order a real load has.
  (function () {
    const T =
      (globalThis.__PROFILE &&
        globalThis.__PROFILE.misc &&
        globalThis.__PROFILE.misc.performance &&
        globalThis.__PROFILE.misc.performance.navigation) ||
      null;

    // prettier-ignore
    const ORDER = [
    'fetchStart', 'domainLookupStart', 'domainLookupEnd', 'connectStart', 'secureConnectionStart',
    'connectEnd', 'requestStart', 'responseStart', 'finalResponseHeadersStart', 'responseEnd',
    'domInteractive', 'domContentLoadedEventStart', 'domContentLoadedEventEnd', 'domComplete',
    'loadEventStart', 'loadEventEnd'
  ];

    let entry = null;
    function build() {
      if (entry || !T) return entry;
      const e = {};
      for (const k of Object.keys(T)) e[k] = T[k];
      // One scale factor per run keeps every interval in proportion.
      const scale = 0.75 + ((Date.now() / 97) % 100) / 200;
      for (const k of ORDER) {
        if (typeof e[k] === 'number' && e[k] > 0) e[k] = Math.round(e[k] * scale * 10) / 10;
      }
      e.duration = e.loadEventEnd;
      e.name = String((globalThis.location && globalThis.location.href) || '');
      e.startTime = 0;
      e.entryType = 'navigation';
      e.toJSON = function () {
        const o = {};
        for (const k in this) {
          if (typeof this[k] !== 'function') o[k] = this[k];
        }
        return o;
      };
      try {
        const C = globalThis.PerformanceNavigationTiming;
        if (C && C.prototype) Object.setPrototypeOf(e, C.prototype);
      } catch (err) {}
      entry = e;
      return entry;
    }

    const paint = () => {
      const n = build();
      const at = n ? Math.round(n.domInteractive * 0.9 * 10) / 10 : 0;
      const mk = (name) => ({
        name,
        entryType: 'paint',
        startTime: at,
        duration: 0,
        toJSON() {
          return { name, entryType: 'paint', startTime: at, duration: 0 };
        },
      });
      return [mk('first-paint'), mk('first-contentful-paint')];
    };

    const resources = () =>
      (globalThis.__NET || [])
        .filter((n) => n && n.url && n.kind !== 'xhr-response')
        .map((n, i) => {
          const start = typeof n.__t === 'number' ? n.__t : i * 7.4;
          const dur = 12.7;
          const size = n.__size || 0;
          return {
            name: String(n.url),
            entryType: 'resource',
            startTime: start,
            duration: dur,
            initiatorType:
              n.kind === 'xhr' ? 'xmlhttprequest' : n.kind === 'beacon' ? 'beacon' : 'fetch',
            nextHopProtocol: 'h2',
            renderBlockingStatus: 'non-blocking',
            workerStart: 0,
            redirectStart: 0,
            redirectEnd: 0,
            fetchStart: start,
            domainLookupStart: start,
            domainLookupEnd: start,
            connectStart: start,
            connectEnd: start,
            secureConnectionStart: start,
            requestStart: start + dur * 0.1,
            responseStart: start + dur * 0.8,
            responseEnd: start + dur,
            responseStatus: 200,
            transferSize: size ? size + 300 : 0,
            encodedBodySize: size,
            decodedBodySize: size,
            serverTiming: [],
          };
        });

    globalThis.performance.getEntriesByType = (t) => {
      if (t === 'navigation') {
        const n = build();
        return n ? [n] : [];
      }
      if (t === 'paint') return paint();
      if (t === 'resource') return resources();
      return [];
    };
    globalThis.performance.getEntries = () => {
      const n = build();
      return (n ? [n] : []).concat(paint()).concat(resources());
    };
    globalThis.performance.getEntriesByName = (name, t) =>
      globalThis.performance
        .getEntries()
        .filter((e) => e.name === name && (!t || e.entryType === t));
  })();

  globalThis.PerformanceObserver = function PerformanceObserver(cb) {
    this._cb = cb;
    this.observe = function () {
      __rec('call', 'PerformanceObserver.observe', 1);
    };
    this.disconnect = function () {};
    this.takeRecords = function () {
      return [];
    };
  };
  // prettier-ignore
  globalThis.PerformanceObserver.supportedEntryTypes = [
  'element', 'event', 'first-input', 'largest-contentful-paint', 'layout-shift', 'longtask',
  'mark', 'measure', 'navigation', 'paint', 'resource', 'visibility-state'
];

  globalThis.MutationObserver = function MutationObserver(cb) {
    this._cb = cb;
    this.observe = function () {};
    this.disconnect = function () {};
    this.takeRecords = function () {
      return [];
    };
  };
  globalThis.IntersectionObserver = function IntersectionObserver(cb) {
    this._cb = cb;
    this.observe = function () {};
    this.unobserve = function () {};
    this.disconnect = function () {};
    this.takeRecords = function () {
      return [];
    };
  };
  globalThis.ResizeObserver = function ResizeObserver(cb) {
    this._cb = cb;
    this.observe = function () {};
    this.unobserve = function () {};
    this.disconnect = function () {};
  };
})();
