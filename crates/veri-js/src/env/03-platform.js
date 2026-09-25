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

  const __own = (globalThis.__own = (o, k, v) =>
    Object.defineProperty(o, k, {
      value: v,
      writable: true,
      enumerable: true,
      configurable: true,
    }));

  globalThis.Blob = function Blob(parts, opts) {
    this.__bytes = __blobBytes(parts);
    __own(this, 'type', opts && opts.type ? String(opts.type) : '');
    __own(this, 'size', this.__bytes.length);
    this.text = () => Promise.resolve(globalThis.__bytesToText(this.__bytes));
    this.arrayBuffer = () => Promise.resolve(this.__bytes.slice().buffer);
    this.slice = (a, b, t) => {
      const cut = this.__bytes.slice(a || 0, b === undefined ? this.__bytes.length : b);
      return new globalThis.Blob([cut], { type: t === undefined ? this.type : t });
    };
  };

  globalThis.FileReader = function FileReader() {
    this.readyState = 0;
    __own(this, 'result', null);
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
      __own(this, 'result', result);
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

  const __defineIface = (name, ctor, proto) => {
    try {
      Object.defineProperty(proto, 'constructor', {
        value: ctor,
        writable: true,
        configurable: true,
      });
      ctor.prototype = proto;
      Object.defineProperty(ctor, 'name', { value: name, configurable: true });
      Object.defineProperty(globalThis, name, {
        value: ctor,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch (e) {}
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
    // A browser iterates headers sorted by name, not in insertion order.
    __sorted() {
      return this.__pairs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    },
    forEach(fn, self) {
      for (const [k, v] of this.__sorted()) fn.call(self, v, k, this);
    },
    keys() {
      return this.__sorted()
        .map((p) => p[0])
        [Symbol.iterator]();
    },
    values() {
      return this.__sorted()
        .map((p) => p[1])
        [Symbol.iterator]();
    },
    entries() {
      return this.__sorted()
        .map((p) => [p[0], p[1]])
        [Symbol.iterator]();
    },
    [Symbol.iterator]() {
      return this.entries();
    },
  };

  (function () {
    const SIG = function AbortSignal() {
      throw new TypeError('Illegal constructor');
    };
    const sigProto = {
      get aborted() {
        return this.__aborted === true;
      },
      get reason() {
        return this.__reason;
      },
      throwIfAborted() {
        if (this.__aborted) throw this.__reason;
      },
      addEventListener(type, fn) {
        (this.__ls || (this.__ls = [])).push([type, fn]);
      },
      removeEventListener(type, fn) {
        this.__ls = (this.__ls || []).filter((e) => !(e[0] === type && e[1] === fn));
      },
      dispatchEvent() {
        return true;
      },
      onabort: null,
    };
    __defineIface('AbortSignal', SIG, sigProto);
    const makeSignal = () => {
      const s = Object.create(sigProto);
      s.__aborted = false;
      s.__reason = undefined;
      return s;
    };
    SIG.abort = (reason) => {
      const s = makeSignal();
      s.__aborted = true;
      s.__reason =
        reason === undefined
          ? new (globalThis.DOMException || Error)('signal is aborted without reason', 'AbortError')
          : reason;
      return s;
    };
    SIG.timeout = () => makeSignal();

    const AC = function AbortController() {
      this.__signal = makeSignal();
    };
    __defineIface('AbortController', AC, {
      get signal() {
        return this.__signal;
      },
      abort(reason) {
        const s = this.__signal;
        if (s.__aborted) return;
        s.__aborted = true;
        s.__reason =
          reason === undefined
            ? new (globalThis.DOMException || Error)(
                'signal is aborted without reason',
                'AbortError',
              )
            : reason;
        const ev = { type: 'abort', target: s, currentTarget: s };
        try {
          if (typeof s.onabort === 'function') s.onabort.call(s, ev);
        } catch (e) {}
        for (const [t, fn] of s.__ls || []) {
          if (t === 'abort') {
            try {
              typeof fn === 'function' ? fn.call(s, ev) : fn.handleEvent(ev);
            } catch (e) {}
          }
        }
      },
    });

    const absolute = (u) => {
      try {
        return globalThis.__absolute ? globalThis.__absolute(String(u)) : String(u);
      } catch (e) {
        return String(u);
      }
    };
    const REQ = function Request(input, init) {
      const o = init || {};
      const from = input && input.__isRequest ? input : null;
      this.__isRequest = true;
      this.__url = absolute(from ? from.url : input);
      this.__method = String(o.method || (from && from.method) || 'GET').toUpperCase();
      this.__headers = new globalThis.Headers(o.headers || (from && from.headers) || undefined);
      this.__body = o.body !== undefined ? o.body : from ? from.__body : null;
      this.__mode = o.mode || 'cors';
      this.__credentials = o.credentials || 'same-origin';
      this.__cache = o.cache || 'default';
      this.__redirect = o.redirect || 'follow';
      this.__referrer = o.referrer === undefined ? 'about:client' : String(o.referrer);
      this.__signal = o.signal || makeSignal();
    };
    __defineIface('Request', REQ, {
      get url() {
        return this.__url;
      },
      get method() {
        return this.__method;
      },
      get headers() {
        return this.__headers;
      },
      get mode() {
        return this.__mode;
      },
      get credentials() {
        return this.__credentials;
      },
      get cache() {
        return this.__cache;
      },
      get redirect() {
        return this.__redirect;
      },
      get referrer() {
        return this.__referrer;
      },
      get signal() {
        return this.__signal;
      },
      get bodyUsed() {
        return false;
      },
      clone() {
        return new REQ(this);
      },
      text() {
        return Promise.resolve(this.__body == null ? '' : String(this.__body));
      },
      json() {
        return this.text().then((t) => JSON.parse(t));
      },
      arrayBuffer() {
        return Promise.resolve(new ArrayBuffer(0));
      },
    });

    const RESP = function Response(body, init) {
      const o = init || {};
      this.__body = body === undefined ? null : body;
      this.__status = o.status === undefined ? 200 : Number(o.status);
      this.__statusText = o.statusText === undefined ? '' : String(o.statusText);
      this.__headers = new globalThis.Headers(o.headers || undefined);
      this.__url = o.url ? String(o.url) : '';
      this.__type = 'default';
    };
    __defineIface('Response', RESP, {
      get status() {
        return this.__status;
      },
      get statusText() {
        return this.__statusText;
      },
      get ok() {
        return this.__status >= 200 && this.__status < 300;
      },
      get headers() {
        return this.__headers;
      },
      get url() {
        return this.__url;
      },
      get type() {
        return this.__type;
      },
      get redirected() {
        return false;
      },
      get bodyUsed() {
        return false;
      },
      get body() {
        return null;
      },
      clone() {
        return new RESP(this.__body, {
          status: this.__status,
          statusText: this.__statusText,
          headers: this.__headers,
        });
      },
      text() {
        return Promise.resolve(this.__body == null ? '' : String(this.__body));
      },
      json() {
        return this.text().then((t) => JSON.parse(t));
      },
      arrayBuffer() {
        return Promise.resolve(new ArrayBuffer(0));
      },
      blob() {
        return Promise.resolve(new globalThis.Blob([this.__body == null ? '' : this.__body]));
      },
      formData() {
        return Promise.resolve(new globalThis.FormData());
      },
    });
    RESP.json = (data, init) => {
      const r = new RESP(JSON.stringify(data), init);
      r.__headers.set('content-type', 'application/json');
      return r;
    };
    RESP.error = () => {
      const r = new RESP(null, { status: 0 });
      r.__type = 'error';
      return r;
    };
    RESP.redirect = (url, status) => new RESP(null, { status: status || 302 });
  })();

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

  globalThis.__toAbsolute = function __toAbsolute(url) {
    const s = String(url == null ? '' : url);
    if (s === '' || /^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
    try {
      const loc = globalThis.location;
      const origin = (loc && loc.origin) || '';
      if (origin && s.charAt(0) === '/') return origin + s;
      if (loc && loc.href) return new URL(s, loc.href).href;
    } catch (e) {}
    return s;
  };

  const __URL_DEFAULT_PORT = {
    'http:': '80',
    'https:': '443',
    'ws:': '80',
    'wss:': '443',
    'ftp:': '21',
  };
  const __URL_SPECIAL = {
    'http:': 1,
    'https:': 1,
    'ws:': 1,
    'wss:': 1,
    'ftp:': 1,
    'file:': 1,
  };
  function __urlNormPath(path) {
    const abs = path.charAt(0) === '/';
    const stack = [];
    for (const seg of path.split('/')) {
      if (seg === '.' || seg === '%2e' || seg === '%2E') continue;
      if (seg === '..') {
        if (stack.length && stack[stack.length - 1] !== '') stack.pop();
        continue;
      }
      stack.push(seg);
    }
    let res = stack.join('/');
    if (abs && res.charAt(0) !== '/') res = '/' + res;
    return res;
  }
  function __urlParse(input, base) {
    input = String(input).replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
    const sm = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(input);
    if (!sm) {
      if (base == null) throw new TypeError("Failed to construct 'URL': Invalid URL");
      const b = base.__parts ? base.__parts : __urlParse(String(base));
      return __urlResolveRelative(input, b);
    }
    const scheme = sm[1].toLowerCase() + ':';
    let rest = input.slice(sm[0].length);
    const special = !!__URL_SPECIAL[scheme];
    const p = {
      scheme,
      username: '',
      password: '',
      hostname: '',
      port: '',
      path: '',
      query: '',
      fragment: '',
      opaque: false,
    };
    if (special && scheme !== 'file:' && !/^\/\//.test(rest)) {
      // http:example.com is treated as http://example.com
      rest = rest.replace(/^\/*/, '//');
    }
    if (/^\/\//.test(rest) || (special && scheme === 'file:')) {
      rest = rest.replace(/^\/*/, '');
      if (scheme === 'file:') rest = '/' + rest;
      let end = rest.length;
      for (let i = 0; i < rest.length; i++) {
        const c = rest[i];
        if (c === '/' || c === '?' || c === '#' || (special && c === '\\')) {
          end = i;
          break;
        }
      }
      let authority = rest.slice(0, end);
      const remainder = rest.slice(end);
      const at = authority.lastIndexOf('@');
      if (at >= 0) {
        const info = authority.slice(0, at);
        authority = authority.slice(at + 1);
        const colon = info.indexOf(':');
        p.username = colon < 0 ? info : info.slice(0, colon);
        p.password = colon < 0 ? '' : info.slice(colon + 1);
      }
      const hm = /^([^:]*)(?::(\d*))?$/.exec(authority) || ['', '', ''];
      p.hostname = (hm[1] || '').toLowerCase();
      let port = hm[2] || '';
      if (port && port === __URL_DEFAULT_PORT[scheme]) port = '';
      p.port = port;
      __urlSplitPQF(p, remainder);
      if (special && p.path === '') p.path = '/';
      p.path = __urlNormPath(p.path);
    } else {
      p.opaque = true;
      __urlSplitPQF(p, rest);
    }
    return p;
  }
  function __urlSplitPQF(p, s) {
    const hashAt = s.indexOf('#');
    if (hashAt >= 0) {
      p.fragment = s.slice(hashAt);
      s = s.slice(0, hashAt);
    }
    const qAt = s.indexOf('?');
    if (qAt >= 0) {
      p.query = s.slice(qAt);
      s = s.slice(0, qAt);
    }
    p.path = s;
  }
  function __urlResolveRelative(input, b) {
    const p = {
      scheme: b.scheme,
      username: b.username,
      password: b.password,
      hostname: b.hostname,
      port: b.port,
      path: b.path,
      query: b.query,
      fragment: '',
      opaque: b.opaque,
    };
    if (input === '') {
      p.query = b.query;
      return p;
    }
    if (input.charAt(0) === '#') {
      p.fragment = input;
      return p;
    }
    if (input.charAt(0) === '?') {
      __urlSplitPQF(p, input);
      p.path = b.path;
      return p;
    }
    if (/^\/\//.test(input)) {
      return __urlParse(b.scheme + input);
    }
    // path-relative
    p.query = '';
    if (input.charAt(0) === '/') {
      __urlSplitPQF(p, input);
    } else {
      const base = b.path.slice(0, b.path.lastIndexOf('/') + 1);
      __urlSplitPQF(p, base + input);
    }
    p.path = __urlNormPath(p.path);
    return p;
  }
  function __urlSerialize(p) {
    let out = p.scheme;
    if (!p.opaque) {
      out += '//';
      if (p.username || p.password) {
        out += p.username;
        if (p.password) out += ':' + p.password;
        out += '@';
      }
      out += p.hostname;
      if (p.port) out += ':' + p.port;
    }
    out += p.path + p.query + p.fragment;
    return out;
  }
  function __urlOrigin(p) {
    if (p.opaque || !p.hostname) return 'null';
    return p.scheme + '//' + p.hostname + (p.port ? ':' + p.port : '');
  }
  const URLImpl = function URL(url, base) {
    const parts = __urlParse(url, base === undefined ? null : base);
    Object.defineProperty(this, '__parts', { value: parts, writable: true });
    this.searchParams = new globalThis.URLSearchParams(parts.query);
  };
  const accessor = (name, get, set) =>
    Object.defineProperty(URLImpl.prototype, name, {
      get,
      set,
      enumerable: true,
      configurable: true,
    });
  accessor(
    'href',
    function () {
      return __urlSerialize(this.__parts);
    },
    function (v) {
      this.__parts = __urlParse(v);
      this.searchParams = new globalThis.URLSearchParams(this.__parts.query);
    },
  );
  accessor(
    'protocol',
    function () {
      return this.__parts.scheme;
    },
    function (v) {
      const s = String(v).replace(/:?$/, ':').toLowerCase();
      if (/^[a-z][a-z0-9+.\-]*:$/.test(s)) this.__parts.scheme = s;
    },
  );
  accessor(
    'username',
    function () {
      return this.__parts.username;
    },
    function (v) {
      this.__parts.username = String(v);
    },
  );
  accessor(
    'password',
    function () {
      return this.__parts.password;
    },
    function (v) {
      this.__parts.password = String(v);
    },
  );
  accessor(
    'hostname',
    function () {
      return this.__parts.hostname;
    },
    function (v) {
      this.__parts.hostname = String(v)
        .toLowerCase()
        .replace(/[/\\?#].*$/, '');
    },
  );
  accessor(
    'port',
    function () {
      return this.__parts.port;
    },
    function (v) {
      const s = String(v).replace(/\D.*$/, '');
      this.__parts.port = s && s === __URL_DEFAULT_PORT[this.__parts.scheme] ? '' : s;
    },
  );
  accessor(
    'host',
    function () {
      const p = this.__parts;
      return p.hostname + (p.port ? ':' + p.port : '');
    },
    function (v) {
      const hm = /^([^:]*)(?::(\d*))?/.exec(String(v)) || [];
      this.__parts.hostname = (hm[1] || '').toLowerCase();
      this.__parts.port = hm[2] || '';
    },
  );
  accessor(
    'pathname',
    function () {
      return this.__parts.path;
    },
    function (v) {
      let s = String(v);
      if (!this.__parts.opaque && s.charAt(0) !== '/') s = '/' + s;
      this.__parts.path = this.__parts.opaque ? s : __urlNormPath(s);
    },
  );
  accessor(
    'search',
    function () {
      return this.__parts.query;
    },
    function (v) {
      let s = String(v);
      if (s && s.charAt(0) !== '?') s = '?' + s;
      this.__parts.query = s;
      this.searchParams = new globalThis.URLSearchParams(s);
    },
  );
  accessor(
    'hash',
    function () {
      return this.__parts.fragment;
    },
    function (v) {
      let s = String(v);
      if (s && s.charAt(0) !== '#') s = '#' + s;
      this.__parts.fragment = s;
    },
  );
  accessor('origin', function () {
    return __urlOrigin(this.__parts);
  });
  URLImpl.prototype.toString = function () {
    return this.href;
  };
  URLImpl.prototype.toJSON = function () {
    return this.href;
  };
  try {
    Object.defineProperty(URLImpl.prototype, Symbol.toStringTag, {
      value: 'URL',
      configurable: true,
    });
  } catch (e) {}
  URLImpl.canParse = function (url, base) {
    try {
      __urlParse(url, base === undefined ? null : base);
      return true;
    } catch (e) {
      return false;
    }
  };
  URLImpl.parse = function (url, base) {
    try {
      return new URLImpl(url, base);
    } catch (e) {
      return null;
    }
  };
  globalThis.URL = URLImpl;

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
    // A stable sort by code unit, which is what the spec's `sort()` does (JS
    // Array.sort is stable); it was a no-op before.
    this.sort = () => {
      pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    };
    this.keys = () => pairs.map((p) => p[0])[Symbol.iterator]();
    this.values = () => pairs.map((p) => p[1])[Symbol.iterator]();
    this.entries = () => pairs.map((p) => [p[0], p[1]])[Symbol.iterator]();
    this[Symbol.iterator] = () => this.entries();
    const formEnc = (s) =>
      encodeURIComponent(String(s))
        .replace(/%20/g, '+')
        .replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    this.toString = () => pairs.map((p) => formEnc(p[0]) + '=' + formEnc(p[1])).join('&');
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
    const n = globalThis.__RAW_NAVIGATOR || globalThis.navigator;
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
      importScripts() {
        throw new (globalThis.DOMException || Error)(
          'importScripts is only available inside a worker',
          'InvalidAccessError',
        );
      },
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
      if (this.__remoteSend) {
        try {
          this.__remoteSend(this.__remoteId, data);
        } catch (e) {}
        return;
      }
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
  globalThis.SharedWorker = function SharedWorker(url, opts) {
    this.onerror = null;
    const port1 = new globalThis.MessagePort();
    const port2 = new globalThis.MessagePort();
    port1.__peer = port2;
    port2.__peer = port1;
    Object.defineProperty(this, 'port', { value: port1, enumerable: true, configurable: true });
    let src = __BLOBS.get(String(url)) || '';
    if (!src && String(url) && typeof __HOST_FETCH === 'function') {
      try {
        const r = JSON.parse(__HOST_FETCH('GET', __absolute(url), ''));
        src = String(r.body || '');
      } catch (e) {}
    }
    if (!src) return;
    const scope = {
      onconnect: null,
      __connectListeners: [],
      name: (opts && typeof opts.name === 'string' && opts.name) || (opts && typeof opts === 'string' ? opts : ''),
      close() {},
      importScripts() {},
      addEventListener(t, f) {
        if (t === 'connect' && typeof f === 'function') scope.__connectListeners.push(f);
      },
      removeEventListener() {},
      navigator: __workerNavigator(),
      location: globalThis.location,
      performance: globalThis.performance,
      crypto: globalThis.crypto,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      queueMicrotask: globalThis.queueMicrotask,
      Math, JSON, Date, Array, Object, String, Number, Boolean, Error, Promise, RegExp,
      Function, Intl, Symbol, Reflect, Proxy, Map, Set, WeakMap, WeakSet,
      Uint8Array, Uint32Array, Int32Array, Float64Array, ArrayBuffer, DataView,
      TextEncoder, TextDecoder,
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      OffscreenCanvas: globalThis.OffscreenCanvas,
      createImageBitmap: globalThis.createImageBitmap,
      fetch: globalThis.fetch,
      XMLHttpRequest: globalThis.XMLHttpRequest,
      MessagePort: globalThis.MessagePort,
      MessageChannel: globalThis.MessageChannel,
      WorkerNavigator: globalThis.__WorkerNavigator,
      window: undefined,
      document: undefined,
    };
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
    this.__scope = scope;
    try {
      globalThis.__IN_WORKER = true;
      const f = new globalThis.Function('__veriWorkerScope', 'with (__veriWorkerScope) {\n' + src + '\n}');
      f.call(sandbox, sandbox);
      globalThis.__IN_WORKER = false;
    } catch (e) {
      try { __rec('call', 'SharedWorker:threw:' + String(e).slice(0, 80), 0); } catch (x) {}
    }
    __schedule(function () {
      const ev = { type: 'connect', data: '', ports: [port2], source: null, target: scope };
      for (const fn of scope.__connectListeners.slice()) {
        try {
          fn.call(scope, ev);
        } catch (e) {}
      }
      if (typeof scope.onconnect === 'function') {
        try {
          scope.onconnect.call(scope, ev);
        } catch (e) {}
      }
    }, 0);
  };
  try {
    Object.defineProperty(globalThis.SharedWorker, 'name', { value: 'SharedWorker', configurable: true });
  } catch (e) {}

  globalThis.__PORTS = new Map();
  globalThis.__PORT_SEQ = 0;

  globalThis.__portsOut = function __portsOut(transfer, send) {
    const ids = [];
    if (!transfer || typeof transfer.length !== 'number') return ids;
    for (let i = 0; i < transfer.length; i++) {
      const port = transfer[i];
      if (!port || !(port instanceof globalThis.MessagePort)) continue;
      const id = (globalThis.__PORT_PREFIX || 'p') + ++globalThis.__PORT_SEQ;
      const stays = port.__peer;
      if (stays) {
        stays.__peer = null;
        stays.__remoteId = id;
        stays.__remoteSend = send;
        globalThis.__PORTS.set(id, stays);
      }
      port.__peer = null;
      port.__closed = true;
      ids.push(id);
    }
    return ids;
  };

  globalThis.__portsIn = function __portsIn(ids, send) {
    const out = [];
    if (!ids || typeof ids.length !== 'number') return out;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const port = new globalThis.MessagePort();
      port.__remoteId = id;
      port.__remoteSend = send;
      globalThis.__PORTS.set(id, port);
      out.push(port);
    }
    return out;
  };

  globalThis.__portDeliver = function __portDeliver(id, data) {
    const port = globalThis.__PORTS.get(id);
    if (!port) return;
    port.__accept({ data, type: 'message', isTrusted: true, target: port, ports: [] });
  };

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
    'Europe/Warsaw': [60, 'eu', 'Central European Standard Time', 'Central European Summer Time'],
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

    function inDst(ms, z) {
      z = z || zone;
      const rule = z[1];
      if (!rule) return false;
      const y = new RealDate(ms).getUTCFullYear();
      if (rule === 'eu') {
        // Last Sunday of March to last Sunday of October, 01:00 UTC both ends.
        return ms >= nthDow(y, 2, 0, -1, 1) && ms < nthDow(y, 9, 0, -1, 1);
      }
      if (rule === 'us') {
        // Second Sunday of March to first Sunday of November, 02:00 local.
        const std = z[0];
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

    const eastOf = (ms, z) => (z || zone)[0] + (inDst(ms, z) ? 60 : 0);
    const offsetAt = (ms) => -eastOf(ms);
    const zoneName = (ms, z) => {
      z = z || zone;
      return inDst(ms, z) && z[3] ? z[3] : z[2] || 'GMT';
    };
    const zoneFor = (name) =>
      (name && ZONES[name]) || (name === tz ? zone : ZONES.UTC || [0, null, 'GMT', null]);

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
    // `GMT-4` / `GMT-04:00` for the offset-shaped timeZoneName options.
    const gmtOffset = (ms, padded) => {
      const off = eastOf(ms);
      const abs = Math.abs(off);
      const h = (abs / 60) | 0;
      const m = abs % 60;
      const sign = off >= 0 ? '+' : '-';
      if (padded) return 'GMT' + sign + pad(h) + ':' + pad(m);
      return 'GMT' + sign + h + (m ? ':' + pad(m) : '');
    };
    const shortZoneName = (ms, z) => {
      const long = zoneName(ms, z);
      if (long && long !== 'GMT' && /\s/.test(long)) {
        const abbr = long
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .toUpperCase();
        if (abbr.length >= 2) return abbr;
      }
      return gmtOffset(ms, false);
    };
    // The value Chrome puts in a `timeZoneName` part for each option form.
    const tzNameValue = (mode, ms, z) => {
      switch (mode) {
        case 'long':
          return zoneName(ms, z);
        case 'short':
          return shortZoneName(ms, z);
        case 'shortOffset':
          return gmtOffset(ms, false);
        case 'longOffset':
          return gmtOffset(ms, true);
        case 'longGeneric':
          return zoneName(ms, z);
        case 'shortGeneric':
          return shortZoneName(ms, z);
        default:
          return shortZoneName(ms, z);
      }
    };

    const MON_LONG = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    function __dtfParts(opts, date) {
      const z = zoneFor(opts.timeZone);
      const ms = date.getTime();
      const u = new RealDate(ms + eastOf(ms, z) * 60000);
      const Y = u.getUTCFullYear();
      const Mo = u.getUTCMonth();
      const Dd = u.getUTCDate();
      const H = u.getUTCHours();
      const Mi = u.getUTCMinutes();
      const Sec = u.getUTCSeconds();
      const dow = u.getUTCDay();

      const f = {};
      if (opts.dateStyle) {
        f.weekday = opts.dateStyle === 'full' ? 'long' : undefined;
        f.year = 'numeric';
        f.month =
          opts.dateStyle === 'full' || opts.dateStyle === 'long'
            ? 'long'
            : opts.dateStyle === 'medium'
              ? 'short'
              : 'numeric';
        f.day = 'numeric';
      }
      if (opts.timeStyle) {
        f.hour = 'numeric';
        f.minute = '2-digit';
        if (opts.timeStyle !== 'short') f.second = '2-digit';
      }
      if (!opts.dateStyle && !opts.timeStyle) {
        f.weekday = opts.weekday;
        f.year = opts.year;
        f.month = opts.month;
        f.day = opts.day;
        f.hour = opts.hour;
        f.minute = opts.minute;
        f.second = opts.second;
      }
      const hour12 =
        opts.hour12 !== undefined
          ? opts.hour12
          : opts.hourCycle
            ? opts.hourCycle === 'h11' || opts.hourCycle === 'h12'
            : true;

      const num = (n, style) => (style === '2-digit' ? pad(n) : String(n));
      const parts = [];
      const push = (type, value) => parts.push({ type, value });

      if (f.weekday) {
        push('weekday', f.weekday === 'long' ? DAY_LONG[dow] : DAY[dow]);
        push('literal', ', ');
      }
      const hasDate = f.year || f.month || f.day;
      const monthWord = f.month === 'long' || f.month === 'short';
      if (hasDate) {
        if (monthWord) {
          if (f.month) push('month', f.month === 'long' ? MON_LONG[Mo] : MON[Mo]);
          if (f.day) {
            push('literal', ' ');
            push('day', num(Dd, f.day));
          }
          if (f.year) {
            push('literal', ', ');
            push('year', f.year === '2-digit' ? pad(Y % 100) : String(Y));
          }
        } else {
          const seq = [];
          if (f.month) seq.push(['month', num(Mo + 1, f.month)]);
          if (f.day) seq.push(['day', num(Dd, f.day)]);
          if (f.year) seq.push(['year', f.year === '2-digit' ? pad(Y % 100) : String(Y)]);
          seq.forEach((s, i) => {
            if (i) push('literal', '/');
            push(s[0], s[1]);
          });
        }
      }
      const hasTime = f.hour || f.minute || f.second;
      if (hasTime) {
        if (hasDate) push('literal', opts.dateStyle && opts.timeStyle ? ' at ' : ', ');
        const hh = hour12 ? (H % 12 === 0 ? 12 : H % 12) : H;
        push('hour', num(hh, f.hour === '2-digit' ? '2-digit' : 'numeric'));
        if (f.minute) {
          push('literal', ':');
          push('minute', num(Mi, f.minute));
        }
        if (f.second) {
          push('literal', ':');
          push('second', num(Sec, f.second));
        }
        if (hour12) {
          push('literal', ' ');
          push('dayPeriod', H < 12 ? 'AM' : 'PM');
        }
      }
      let tzMode = opts.timeZoneName;
      if (!tzMode && opts.timeStyle === 'long') tzMode = 'short';
      else if (!tzMode && opts.timeStyle === 'full') tzMode = 'long';
      const wantsTz = !!tzMode;
      if (!hasDate && !hasTime && !wantsTz) {
        push('month', String(Mo + 1));
        push('literal', '/');
        push('day', String(Dd));
        push('literal', '/');
        push('year', String(Y));
      }
      if (wantsTz) {
        if (parts.length) push('literal', hasTime ? ' ' : ', ');
        push('timeZoneName', tzNameValue(tzMode, ms, z));
      }
      return parts;
    }
    const __dtfFormat = (opts, date) =>
      __dtfParts(opts, date)
        .map((p) => p.value)
        .join('');
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
        const asked =
          o.year ||
          o.month ||
          o.day ||
          o.hour ||
          o.minute ||
          o.second ||
          o.weekday ||
          o.dateStyle ||
          o.timeStyle;
        this.__opts = {
          locale: (Array.isArray(locales) ? locales[0] : locales) || 'en-US',
          calendar: 'gregory',
          numberingSystem: 'latn',
          timeZone: o.timeZone || tz,
          // Chrome's default is numeric month/day/year (\"1/1/1970\"), not
          // 2-digit.
          ...(asked ? {} : { year: 'numeric', month: 'numeric', day: 'numeric' }),
          ...o,
        };
        return this;
      };
      DTF.prototype.resolvedOptions = function () {
        return { ...this.__opts };
      };
      DTF.prototype.format = function (d) {
        const date = d instanceof RealDate ? d : new RealDate(d === undefined ? RealDate.now() : d);
        return __dtfFormat(this.__opts, date);
      };
      DTF.prototype.formatToParts = function (d) {
        const date = d instanceof RealDate ? d : new RealDate(d === undefined ? RealDate.now() : d);
        return __dtfParts(this.__opts, date);
      };
      DTF.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      // A constructor with all-optional params reports length 0, like Chrome;
      // the function object defaulted to its written arity of 2.
      try {
        Object.defineProperty(DTF, 'length', { value: 0, configurable: true });
      } catch (e) {}
      // Range formatting: a minimal version that joins the two endpoints the way
      // en-US does (an en-dash), enough that the method exists and returns a
      // string rather than being undefined.
      DTF.prototype.formatRange = function (a, b) {
        const s = this.format(a);
        const e = this.format(b);
        return s === e ? s : s + ' – ' + e;
      };
      DTF.prototype.formatRangeToParts = function (a, b) {
        return __dtfParts(this.__opts, a instanceof RealDate ? a : new RealDate(a)).concat(
          [{ type: 'literal', value: ' – ' }],
          __dtfParts(this.__opts, b instanceof RealDate ? b : new RealDate(b)),
        );
      };
      Intl.DateTimeFormat = DTF;
    } catch (e) {}

    try {
      const SUPPORTED = {
        calendar: [
          'buddhist',
          'chinese',
          'coptic',
          'dangi',
          'ethioaa',
          'ethiopic',
          'gregory',
          'hebrew',
          'indian',
          'islamic',
          'islamic-umalqura',
          'islamic-tbla',
          'islamic-civil',
          'islamic-rgsa',
          'iso8601',
          'japanese',
          'persian',
          'roc',
        ],
        collation: [
          'compat',
          'dict',
          'emoji',
          'eor',
          'phonebk',
          'pinyin',
          'searchjl',
          'stroke',
          'trad',
          'unihan',
          'zhuyin',
        ],
        numberingSystem: [
          'adlm',
          'ahom',
          'arab',
          'arabext',
          'bali',
          'beng',
          'deva',
          'fullwide',
          'gujr',
          'guru',
          'hanidec',
          'khmr',
          'knda',
          'laoo',
          'latn',
          'mlym',
          'mymr',
          'orya',
          'tamldec',
          'telu',
          'thai',
          'tibt',
        ],
        unit: [
          'acre',
          'bit',
          'byte',
          'celsius',
          'centimeter',
          'day',
          'degree',
          'fahrenheit',
          'fluid-ounce',
          'foot',
          'gallon',
          'gigabit',
          'gigabyte',
          'gram',
          'hectare',
          'hour',
          'inch',
          'kilobit',
          'kilobyte',
          'kilogram',
          'kilometer',
          'liter',
          'megabit',
          'megabyte',
          'meter',
          'mile',
          'mile-scandinavian',
          'milliliter',
          'millimeter',
          'millisecond',
          'minute',
          'month',
          'ounce',
          'percent',
          'petabyte',
          'pound',
          'second',
          'stone',
          'terabit',
          'terabyte',
          'week',
          'yard',
          'year',
        ],
        currency: [
          'USD',
          'EUR',
          'JPY',
          'GBP',
          'AUD',
          'CAD',
          'CHF',
          'CNY',
          'HKD',
          'NZD',
          'SEK',
          'KRW',
          'SGD',
          'NOK',
          'MXN',
          'INR',
          'RUB',
          'ZAR',
          'TRY',
          'BRL',
          'TWD',
          'DKK',
          'PLN',
          'THB',
          'IDR',
          'HUF',
          'CZK',
          'ILS',
          'CLP',
          'PHP',
          'AED',
          'COP',
          'SAR',
          'MYR',
          'RON',
        ],
        timeZone: [
          'UTC',
          'America/New_York',
          'America/Chicago',
          'America/Denver',
          'America/Los_Angeles',
          'Europe/London',
          'Europe/Paris',
          'Europe/Berlin',
          'Europe/Moscow',
          'Asia/Tokyo',
          'Asia/Shanghai',
          'Asia/Kolkata',
          'Asia/Dubai',
          'Australia/Sydney',
        ],
      };
      Intl.supportedValuesOf = function supportedValuesOf(key) {
        const k = String(key);
        if (!Object.prototype.hasOwnProperty.call(SUPPORTED, k)) {
          throw new RangeError(`Invalid key : ${k}`);
        }
        return SUPPORTED[k].slice();
      };
    } catch (e) {}

    // Without ICU these do not abort, they throw `Internal error. Icu error.`
    try {
      // Locale separators and currency symbols - the ICU data the engine lacks.
      // Keyed by language subtag, which is what the common cases turn on.
      const NF_SEP = {
        de: { g: '.', d: ',' },
        es: { g: '.', d: ',' },
        it: { g: '.', d: ',' },
        nl: { g: '.', d: ',' },
        pt: { g: '.', d: ',' },
        tr: { g: '.', d: ',' },
        fr: { g: ' ', d: ',' },
        ru: { g: ' ', d: ',' },
        pl: { g: ' ', d: ',' },
        sv: { g: ' ', d: ',' },
        cs: { g: ' ', d: ',' },
      };
      const NF_CUR = {
        USD: '$',
        CAD: 'CA$',
        AUD: 'A$',
        NZD: 'NZ$',
        HKD: 'HK$',
        MXN: 'MX$',
        EUR: '€',
        GBP: '£',
        JPY: '¥',
        CNY: 'CN¥',
        INR: '₹',
        BRL: 'R$',
        KRW: '₩',
        RUB: 'RUB',
        CHF: 'CHF',
      };
      const NF_ZERO_DIGIT = { JPY: 1, KRW: 1, CLP: 1, VND: 1, HUF: 1, ISK: 1, TWD: 1 };
      const NF = function NumberFormat(locales, options) {
        if (!(this instanceof NF)) return new NF(locales, options);
        const o = options || {};
        const style = o.style || 'decimal';
        // Fraction defaults differ by style: currency two (or zero for the
        // no-minor-unit currencies), percent zero, decimal up to three.
        let defMin = 0;
        let defMax = 3;
        if (style === 'currency') {
          defMin = defMax = NF_ZERO_DIGIT[o.currency] ? 0 : 2;
        } else if (style === 'percent') {
          defMin = defMax = 0;
        }
        this.__opts = {
          locale: (Array.isArray(locales) ? locales[0] : locales) || 'en-US',
          numberingSystem: 'latn',
          style,
          minimumIntegerDigits: 1,
          minimumFractionDigits: defMin,
          maximumFractionDigits: defMax,
          useGrouping: o.useGrouping === undefined ? 'auto' : o.useGrouping,
          notation: 'standard',
          signDisplay: 'auto',
          roundingIncrement: 1,
          roundingMode: 'halfExpand',
          roundingPriority: 'auto',
          trailingZeroDisplay: 'auto',
          ...o,
        };
        return this;
      };
      NF.prototype.resolvedOptions = function () {
        return { ...this.__opts };
      };
      NF.prototype.format = function (n) {
        const opts = this.__opts;
        let num = Number(n);
        if (isNaN(num)) return 'NaN';
        if (!isFinite(num)) return num < 0 ? '-∞' : '∞';
        const neg = num < 0;
        let abs = Math.abs(num);
        if (opts.style === 'percent') abs *= 100;
        const min = Math.min(20, Math.max(0, opts.minimumFractionDigits));
        const max = Math.min(20, Math.max(min, opts.maximumFractionDigits));
        // Round to max, then trim trailing zeros back to min.
        let s = abs.toFixed(max);
        if (max > min) {
          s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
          const dot = s.indexOf('.');
          const have = dot < 0 ? 0 : s.length - dot - 1;
          if (have < min) s = abs.toFixed(min);
        }
        const lang = String(opts.locale).toLowerCase().split('-')[0];
        const sep = NF_SEP[lang] || { g: ',', d: '.' };
        const bits = s.split('.');
        if (opts.useGrouping !== false && opts.useGrouping !== 'false') {
          bits[0] = bits[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep.g);
        }
        let body = bits.join(sep.d);
        if (opts.style === 'percent') body += '%';
        if (opts.style === 'currency') {
          const sym = NF_CUR[opts.currency] || (opts.currency ? opts.currency + ' ' : '');
          body = sym + body;
        }
        return (neg ? '-' : '') + body;
      };
      NF.prototype.formatToParts = function (n) {
        return [{ type: 'literal', value: this.format(n) }];
      };
      NF.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      try {
        Object.defineProperty(NF, 'length', { value: 0, configurable: true });
      } catch (e) {}
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
        const x = String(a);
        const y = String(b);
        const base = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const bx = base(x);
        const by = base(y);
        if (bx < by) return -1;
        if (bx > by) return 1;
        const ax = x.normalize('NFD').toLowerCase();
        const ay = y.normalize('NFD').toLowerCase();
        if (ax < ay) return -1;
        if (ax > ay) return 1;
        const caseKey = (s) =>
          s.replace(/[A-Za-z]/g, (c) => (c >= 'a' ? '0' + c : '1' + c.toLowerCase()));
        const cx = caseKey(x);
        const cy = caseKey(y);
        return cx < cy ? -1 : cx > cy ? 1 : 0;
      };
      CO.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      Intl.Collator = CO;
    } catch (e) {}

    try {
      const PR = function PluralRules(locales, options) {
        if (!(this instanceof PR))
          throw new TypeError("Constructor Intl.PluralRules requires 'new'");
        this.__type = (options && options.type) || 'cardinal';
        this.__locale = (Array.isArray(locales) ? locales[0] : locales) || 'en-US';
      };
      PR.prototype.select = function (n) {
        const v = Number(n);
        if (this.__type === 'ordinal') {
          const t = Math.abs(v) % 100,
            u = Math.abs(v) % 10;
          if (u === 1 && t !== 11) return 'one';
          if (u === 2 && t !== 12) return 'two';
          if (u === 3 && t !== 13) return 'few';
          return 'other';
        }
        return v === 1 ? 'one' : 'other';
      };
      PR.prototype.selectRange = function (a, b) {
        return this.select(b);
      };
      PR.prototype.resolvedOptions = function () {
        return {
          locale: this.__locale,
          type: this.__type,
          minimumIntegerDigits: 1,
          minimumFractionDigits: 0,
          maximumFractionDigits: 3,
          pluralCategories:
            this.__type === 'ordinal' ? ['few', 'one', 'other', 'two'] : ['one', 'other'],
          roundingIncrement: 1,
          roundingMode: 'halfExpand',
          roundingPriority: 'auto',
          trailingZeroDisplay: 'auto',
        };
      };
      PR.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      Intl.PluralRules = PR;

      const LF = function ListFormat(locales, options) {
        if (!(this instanceof LF))
          throw new TypeError("Constructor Intl.ListFormat requires 'new'");
        this.__locale = (Array.isArray(locales) ? locales[0] : locales) || 'en-US';
        this.__type = (options && options.type) || 'conjunction';
        this.__style = (options && options.style) || 'long';
      };
      LF.prototype.format = function (list) {
        const a = Array.from(list || []).map(String);
        if (!a.length) return '';
        if (a.length === 1) return a[0];
        const word = this.__type === 'disjunction' ? 'or' : this.__style === 'narrow' ? '' : 'and';
        if (a.length === 2) return word ? a[0] + ' ' + word + ' ' + a[1] : a[0] + ', ' + a[1];
        const head = a.slice(0, -1).join(', ');
        return word ? head + ', ' + word + ' ' + a[a.length - 1] : head + ', ' + a[a.length - 1];
      };
      LF.prototype.formatToParts = function (list) {
        const out = [];
        const a = Array.from(list || []).map(String);
        a.forEach((v, i) => {
          if (i) out.push({ type: 'literal', value: i === a.length - 1 ? ' and ' : ', ' });
          out.push({ type: 'element', value: v });
        });
        return out;
      };
      LF.prototype.resolvedOptions = function () {
        return { locale: this.__locale, type: this.__type, style: this.__style };
      };
      LF.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      Intl.ListFormat = LF;

      (function () {
        const SG = function Segmenter(locales, options) {
          if (!(this instanceof SG)) {
            throw new TypeError("Constructor Intl.Segmenter requires 'new'");
          }
          const g = (options && options.granularity) || 'grapheme';
          if (g !== 'grapheme' && g !== 'word' && g !== 'sentence') {
            throw new RangeError(
              `Value ${g} out of range for Intl.Segmenter options property granularity`,
            );
          }
          this.__locale = (Array.isArray(locales) ? locales[0] : locales) || 'en-US';
          this.__granularity = g;
        };
        const pieces = (input, granularity) => {
          const out = [];
          if (granularity === 'grapheme') {
            for (const ch of input) out.push({ segment: ch });
            return out;
          }
          if (granularity === 'word') {
            const re =
              /[A-Za-z0-9_\u00c0-\u024f\u0400-\u04ff]+|\s+|[^A-Za-z0-9_\s\u00c0-\u024f\u0400-\u04ff]/g;
            let m;
            while ((m = re.exec(input))) {
              out.push({
                segment: m[0],
                isWordLike: /^[A-Za-z0-9_\u00c0-\u024f\u0400-\u04ff]/.test(m[0]),
              });
            }
            return out;
          }
          const re = /[^.!?]*[.!?]+[\s]*|[^.!?]+$/g;
          let m;
          while ((m = re.exec(input))) {
            if (m[0]) out.push({ segment: m[0] });
          }
          return out;
        };
        SG.prototype.segment = function (input) {
          const text = String(input);
          const parts = pieces(text, this.__granularity);
          let at = 0;
          const data = parts.map((p) => {
            const row = { segment: p.segment, index: at, input: text };
            if (p.isWordLike !== undefined) row.isWordLike = p.isWordLike;
            at += p.segment.length;
            return row;
          });
          const segments = {
            containing(i) {
              const n = Number(i) || 0;
              return data.find((d) => n >= d.index && n < d.index + d.segment.length);
            },
          };
          segments[Symbol.iterator] = function* () {
            for (const d of data) yield d;
          };
          return segments;
        };
        SG.prototype.resolvedOptions = function () {
          return { locale: this.__locale, granularity: this.__granularity };
        };
        SG.supportedLocalesOf = function (l) {
          return Array.isArray(l) ? l.slice() : l ? [l] : [];
        };
        Intl.Segmenter = SG;
      })();

      (function () {
        const native = String.prototype.normalize;
        if (typeof native !== 'function') return;
        Object.defineProperty(String.prototype, 'normalize', {
          writable: true,
          enumerable: false,
          configurable: true,
          value: function normalize(form) {
            const f = form === undefined ? 'NFC' : String(form);
            if (f !== 'NFC' && f !== 'NFD' && f !== 'NFKC' && f !== 'NFKD') {
              throw new RangeError(`The normalization form should be one of NFC, NFD, NFKC, NFKD.`);
            }
            const self = String(this);
            if (f === 'NFKC' || f === 'NFKD') {
              // eslint-disable-next-line no-control-regex
              if (!/[^\u0000-\u007f]/.test(self)) return self;
              return native.call(self, f === 'NFKC' ? 'NFC' : 'NFD');
            }
            return native.call(self, f);
          },
        });
      })();

      const RTF = function RelativeTimeFormat(locales, options) {
        if (!(this instanceof RTF)) {
          throw new TypeError("Constructor Intl.RelativeTimeFormat requires 'new'");
        }
        this.__locale = (Array.isArray(locales) ? locales[0] : locales) || 'en-US';
        this.__numeric = (options && options.numeric) || 'always';
        this.__style = (options && options.style) || 'long';
      };
      // `numeric: 'auto'` is what turns -1 day into "yesterday" rather than
      // "1 day ago", and a check that asks for both compares the two.
      const NAMED = {
        day: { '-1': 'yesterday', 0: 'today', 1: 'tomorrow' },
        year: { '-1': 'last year', 0: 'this year', 1: 'next year' },
        month: { '-1': 'last month', 0: 'this month', 1: 'next month' },
        week: { '-1': 'last week', 0: 'this week', 1: 'next week' },
        quarter: { '-1': 'last quarter', 0: 'this quarter', 1: 'next quarter' },
        hour: { 0: 'this hour' },
        minute: { 0: 'this minute' },
        second: { 0: 'now' },
      };
      RTF.prototype.format = function (value, unit) {
        const v = Number(value);
        const u = String(unit).replace(/s$/, '');
        if (this.__numeric === 'auto') {
          const named = NAMED[u];
          if (named && Object.prototype.hasOwnProperty.call(named, String(v)))
            return named[String(v)];
        }
        const n = Math.abs(v);
        const plural = n === 1 ? u : u + 's';
        return v < 0 ? n + ' ' + plural + ' ago' : 'in ' + n + ' ' + plural;
      };
      RTF.prototype.formatToParts = function (value, unit) {
        return [{ type: 'literal', value: this.format(value, unit) }];
      };
      RTF.prototype.resolvedOptions = function () {
        return {
          locale: this.__locale,
          style: this.__style,
          numeric: this.__numeric,
          numberingSystem: 'latn',
        };
      };
      RTF.supportedLocalesOf = function (l) {
        return Array.isArray(l) ? l.slice() : l ? [l] : [];
      };
      Intl.RelativeTimeFormat = RTF;
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
