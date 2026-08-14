(function () {
  const PROXY = globalThis.__GLOBAL_PROXY;
  const RealFunction = globalThis.Function;
  const RealEval = globalThis.eval;
  const realToString = Function.prototype.toString;

  // What each wrapper reports from toString(). Without it the page reads back this
  // file rather than the function a browser would have produced.
  const SOURCE = new WeakMap();

  // Held in an array so the binding never lends it a name: V8 takes stack frame
  // names from the enclosing function at compile time, and a page collecting a
  // stack would otherwise read one of ours where a browser shows `<anonymous>`.
  const SCOPED = (function () {
    // Returned rather than bound: a name is inferred from whatever a function
    // expression is assigned to, including an array or object it sits in.
    return function (params, body) {
      const src =
        '(function anonymous(' + params + '\n) {\nwith (__GLOBAL_PROXY) {\n' + body + '\n}\n})';
      return RealFunction('__GLOBAL_PROXY', 'return ' + src)(PROXY);
    };
  })();

  globalThis.__CODE = [];
  globalThis.__FN_THREW = [];
  globalThis.__FN_RING = [];
  const RING = globalThis.__FN_RING;

  globalThis.__FN_TRACE = [];
  globalThis.__FN_BODIES = [];
  const TRACE = globalThis.__FN_TRACE;
  const TRACE_CAP = 400000;
  function bodyId(src) {
    let h = 0x811c9dc5;
    for (let i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function ShimFunction(...args) {
    __rec('call', 'Function(ctor)', args.length);
    if (__diagOn()) __CODE.push({ kind: 'Function', src: args.map(String).join(' , ') });
    const body = args.length ? String(args[args.length - 1]) : '';
    const params = args.slice(0, -1).map(String).join(',');
    const inner = SCOPED(params, body);
    // Records the source of a compiled function that threw; a VM that compiles one
    // function per instruction reports only the message.
    const id = __diagOn() ? bodyId(body) : 0;
    // Worker code is compiled in this isolate but runs in a browser's separate
    // context, where a page-level hook never sees it.
    const fromWorker = !!globalThis.__IN_WORKER;
    const wrapper = function (...a) {
      const recv =
        this === undefined || this === null || this === globalThis || this === globalThis.window
          ? PROXY
          : this;
      if (!__diagOn()) return inner.apply(recv, a);
      // A ring of what ran just before, so the instruction that produced a bad operand
      // is visible and not only the one that tripped over it.
      if (!fromWorker && TRACE.length < TRACE_CAP) TRACE.push(id);
      if (!fromWorker && globalThis.__FN_BODIES.length < 120)
        globalThis.__FN_BODIES.push(body.slice(0, 700));
      const ring = RING;
      if (ring) {
        ring.push(body.slice(0, 150));
        if (ring.length > 8) ring.shift();
      }
      try {
        const out = inner.apply(recv, a);
        // Which instruction left an undefined on the interpreter's stack.
        try {
          const st = a[0];
          if (st && st[50] && typeof st[41] === 'number') {
            const sp = st[50][st[41]];
            if (sp > 0 && st[50][sp - 1] === undefined) {
              globalThis.__LAST_UNDEF_PUSH = body.slice(0, 200);
            }
          }
        } catch (e2) {}
        return out;
      } catch (err) {
        if (globalThis.__FN_THREW && globalThis.__FN_THREW.length < 40) {
          // An interpreter passes its whole machine state as the first argument,
          // so the operands that produced the fault are reachable even though
          // the program that computed them is bytecode this VM never sees.
          let operands = '';
          try {
            const st = a[0];
            if (st && st[50] && typeof st[41] === 'number') {
              const sp = st[50][st[41]];
              const seen = [];
              for (let k = Math.max(0, sp - 5); k <= sp; k++) {
                const v = st[50][k];
                seen.push(
                  k +
                    '=' +
                    (v === null ? 'null' : typeof v) +
                    ':' +
                    String(v === undefined ? 'undefined' : v).slice(0, 48),
                );
              }
              operands = ' || operands ' + seen.join(' ');
            }
          } catch (e2) {}
          const before = (globalThis.__FN_RING || [])
            .slice(0, -1)
            .map((x, i) => '[-' + (globalThis.__FN_RING.length - 1 - i) + '] ' + x)
            .join('\n       ');
          globalThis.__FN_THREW.push(
            String(err).slice(0, 120) +
              ' || ' +
              body.slice(0, 200) +
              operands +
              '\n     undefined was pushed by:\n       ' +
              (globalThis.__LAST_UNDEF_PUSH || '<not seen>') +
              '\n     preceded by:\n       ' +
              before,
          );
        }
        throw err;
      }
    };
    Object.defineProperty(wrapper, 'name', { value: 'anonymous', configurable: true });
    Object.defineProperty(wrapper, 'length', {
      value: args.length ? args.length - 1 : 0,
      configurable: true,
    });
    SOURCE.set(wrapper, 'function anonymous(' + params + '\n) {\n' + body + '\n}');
    return wrapper;
  }
  ShimFunction.prototype = RealFunction.prototype;
  Object.defineProperty(ShimFunction, 'name', { value: 'Function', configurable: true });
  globalThis.Function = ShimFunction;

  globalThis.__runInScope = function (code) {
    if (typeof __HOST_RUN === 'function') {
      const err = __HOST_RUN(code);
      if (err) throw new Error(err);
      return undefined;
    }
    const f = RealFunction('__GLOBAL_PROXY', 'with (__GLOBAL_PROXY) {\n' + code + '\n}');
    return f.call(PROXY, PROXY);
  };

  /// Same as running a page script, except every bare name resolves in the
  /// frame's own scope instead of the page's.
  globalThis.__runInFrame = function (code, scope) {
    const f = RealFunction('__FRAME', 'with (__FRAME) {\n' + code + '\n}');
    return f.call(scope, scope);
  };

  const EVAL_WRAP = (function () {
    return function (__GLOBAL_PROXY, __HOST_EVAL, __src) {
      with (__GLOBAL_PROXY) {
        return __HOST_EVAL(__src);
      }
    };
  })();
  // Assigned from a call so the property name is not inferred onto it: a page
  // reading a stack would otherwise see `globalThis.eval` where a browser
  // writes `<anonymous>`.
  globalThis.eval = (function () {
    return function (src) {
      __rec('call', 'eval', 1);
      if (typeof src !== 'string') return src;
      if (__diagOn()) __CODE.push({ kind: 'eval', src: src });
      const t = src.trim();
      if (t === 'this' || t === 'this;') return globalThis;
      return RealEval(src.length - t.length > 4096 ? t : src);
    };
  })();

  // Declared arity: a profile-materialised function reports length 0 otherwise.
  (function applyArity() {
    const A = globalThis.__ARITY;
    if (!A) return;
    const setLen = (fn, n) => {
      try {
        if (typeof fn === 'function' && fn.length !== n) {
          Object.defineProperty(fn, 'length', { value: n, configurable: true });
        }
      } catch (e) {}
    };
    for (const k of Object.keys(A.globals || {})) {
      try {
        setLen(globalThis[k], A.globals[k]);
      } catch (e) {}
    }
    for (const c of Object.keys(A.protos || {})) {
      let ctor;
      try {
        ctor = globalThis[c];
      } catch (e) {
        continue;
      }
      if (typeof ctor !== 'function' || !ctor.prototype) continue;
      const m = A.protos[c];
      for (const n of Object.keys(m)) {
        try {
          const d = Object.getOwnPropertyDescriptor(ctor.prototype, n);
          if (d && typeof d.value === 'function') setLen(d.value, m[n]);
        } catch (e) {}
      }
    }
  })();

  const NATIVE = new WeakSet();
  (function tagPlatform() {
    const seen = new Set();
    let frontier = [
      globalThis,
      globalThis.navigator,
      globalThis.document,
      globalThis.crypto,
      globalThis.performance,
      globalThis.screen,
      globalThis.history,
      globalThis.location,
      globalThis.Intl,
      globalThis.console,
      globalThis.chrome,
      globalThis.localStorage,
      globalThis.sessionStorage,
      globalThis.CSS,
      globalThis.customElements,
    ].filter(Boolean);
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const next = [];
      for (const obj of frontier) {
        if (!obj || seen.has(obj)) continue;
        seen.add(obj);
        let names;
        try {
          names = Object.getOwnPropertyNames(obj);
        } catch (e) {
          continue;
        }
        for (const n of names) {
          let v;
          try {
            v = obj[n];
          } catch (e) {
            continue;
          }
          if (typeof v === 'function') {
            NATIVE.add(v);
            // `function () { [native code] }` names nothing; a browser reports
            // `function addEventListener() { [native code] }`.
            try {
              if (!v.name) Object.defineProperty(v, 'name', { value: n, configurable: true });
            } catch (e) {}
            try {
              if (v.prototype) next.push(v.prototype);
            } catch (e) {}
          } else if (v && typeof v === 'object') {
            next.push(v);
          }
        }
      }
      frontier = next;
    }
  })();
  // In a browser navigator.userAgent is a getter on Navigator.prototype and the
  // instance has no own properties at all.
  (function moveToPrototype() {
    const pairs = [
      ['Navigator', globalThis.__RAW_NAVIGATOR],
      ['Screen', globalThis.__RAW_SCREEN],
    ];
    for (const [ctorName, raw] of pairs) {
      const ctor = globalThis[ctorName];
      if (!ctor || !ctor.prototype || !raw) continue;
      let keys;
      try {
        keys = Object.getOwnPropertyNames(raw);
      } catch (e) {
        continue;
      }

      const store = {};
      for (const k of keys) {
        let v;
        try {
          v = raw[k];
        } catch (e) {
          continue;
        }
        try {
          if (typeof v === 'function') {
            Object.defineProperty(ctor.prototype, k, {
              value: v,
              writable: true,
              enumerable: false,
              configurable: true,
            });
            NATIVE.add(v);
          } else {
            store[k] = v;
            // Reaching for it on the prototype has no instance to read from,
            // and a fingerprint counts which properties answer that way.
            const proto = ctor.prototype;
            const getter = function () {
              if (this === proto) throw new TypeError('Illegal invocation');
              return store[k];
            };
            Object.defineProperty(getter, 'name', { value: 'get ' + k, configurable: true });
            NATIVE.add(getter);
            Object.defineProperty(ctor.prototype, k, {
              get: getter,
              enumerable: true,
              configurable: true,
            });
          }
          delete raw[k];
        } catch (e) {}
      }
      try {
        Object.setPrototypeOf(raw, ctor.prototype);
      } catch (e) {}
    }
  })();

  // Records which platform call returned undefined. Off unless asked for: it wraps
  // a few hundred functions.
  if (globalThis.__TRACE_UNDEF) {
    globalThis.__UNDEF_CALLS = {};
    const hosts = [
      ['navigator', globalThis.navigator],
      ['document', globalThis.document],
      ['screen', globalThis.screen],
      ['performance', globalThis.performance],
      ['crypto', globalThis.crypto],
      ['history', globalThis.history],
      ['location', globalThis.location],
      ['localStorage', globalThis.localStorage],
      ['sessionStorage', globalThis.sessionStorage],
      ['chrome', globalThis.chrome],
      ['console', globalThis.console],
      ['Intl', globalThis.Intl],
      ['Element.prototype', globalThis.Element && globalThis.Element.prototype],
      ['Document.prototype', globalThis.Document && globalThis.Document.prototype],
      ['Navigator.prototype', globalThis.Navigator && globalThis.Navigator.prototype],
      [
        'HTMLCanvasElement.prototype',
        globalThis.HTMLCanvasElement && globalThis.HTMLCanvasElement.prototype,
      ],
    ];
    for (const [hostName, host] of hosts) {
      if (!host) continue;
      let names;
      try {
        names = Object.getOwnPropertyNames(host);
      } catch (e) {
        continue;
      }
      for (const k of names) {
        if (k === 'constructor') continue;
        let d;
        try {
          d = Object.getOwnPropertyDescriptor(host, k);
        } catch (e) {
          continue;
        }
        // Only plain methods: a getter has side effects and a class breaks
        // under `new` once wrapped.
        if (!d || typeof d.value !== 'function' || !d.writable) continue;
        const orig = d.value;
        if (orig.prototype && Object.getOwnPropertyNames(orig.prototype).length > 1) continue;
        const path = hostName + '.' + k;
        try {
          host[k] = function (...a) {
            const r = orig.apply(this, a);
            if (r === undefined || r === null) {
              globalThis.__UNDEF_CALLS[path] = (globalThis.__UNDEF_CALLS[path] || 0) + 1;
            }
            return r;
          };
          NATIVE.add(host[k]);
        } catch (e) {}
      }
    }
  }

  globalThis.createImageBitmap = function createImageBitmap(source, sx, sy, sw, sh) {
    try {
      if (!source || typeof source !== 'object') {
        return Promise.reject(new TypeError('The provided value is not of type ImageBitmapSource'));
      }
      const width =
        sw !== undefined ? sw : source.width || source.naturalWidth || source.videoWidth;
      const height =
        sh !== undefined ? sh : source.height || source.naturalHeight || source.videoHeight;
      if (!width || !height) {
        return Promise.reject(
          new DOMException('The source image could not be decoded.', 'InvalidStateError'),
        );
      }
      const bitmap = { width: width | 0, height: height | 0, close() {} };
      if (globalThis.ImageBitmap && globalThis.ImageBitmap.prototype) {
        Object.setPrototypeOf(bitmap, globalThis.ImageBitmap.prototype);
      }
      return Promise.resolve(bitmap);
    } catch (e) {
      return Promise.reject(e);
    }
  };

  (function () {
    const W = globalThis.WebAssembly;
    if (!W || typeof W.Module !== 'function') return;
    const bytesOf = (source) =>
      source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : new Uint8Array(source.buffer || source);

    W.compile = function compile(source) {
      try {
        return Promise.resolve(new W.Module(bytesOf(source)));
      } catch (e) {
        return Promise.reject(e);
      }
    };

    W.instantiate = function instantiate(source, imports) {
      try {
        if (source instanceof W.Module) return Promise.resolve(new W.Instance(source, imports));
        const module = new W.Module(bytesOf(source));
        return Promise.resolve({ module, instance: new W.Instance(module, imports) });
      } catch (e) {
        return Promise.reject(e);
      }
    };

    W.compileStreaming = function compileStreaming(source) {
      return Promise.resolve(source)
        .then((r) => r.arrayBuffer())
        .then((b) => W.compile(b));
    };

    W.instantiateStreaming = function instantiateStreaming(source, imports) {
      return Promise.resolve(source)
        .then((r) => r.arrayBuffer())
        .then((b) => W.instantiate(b, imports));
    };
  })();

  for (const f of [
    ShimFunction,
    globalThis.eval,
    globalThis.setTimeout,
    globalThis.setInterval,
    globalThis.requestAnimationFrame,
    globalThis.addEventListener,
    globalThis.removeEventListener,
    globalThis.atob,
    globalThis.btoa,
    globalThis.fetch,
    globalThis.XMLHttpRequest,
    globalThis.WebAssembly && globalThis.WebAssembly.compile,
    globalThis.WebAssembly && globalThis.WebAssembly.instantiate,
    globalThis.WebAssembly && globalThis.WebAssembly.compileStreaming,
    globalThis.WebAssembly && globalThis.WebAssembly.instantiateStreaming,
    globalThis.createImageBitmap,
  ]) {
    if (typeof f === 'function') NATIVE.add(f);
  }

  globalThis.__markNativeFn = function (fn) {
    if (typeof fn === 'function') NATIVE.add(fn);
    return fn;
  };

  globalThis.__markNative = function (obj) {
    if (!obj) return obj;
    for (const k of Object.getOwnPropertyNames(obj)) {
      let v;
      try {
        v = obj[k];
      } catch (e) {
        continue;
      }
      if (typeof v !== 'function') continue;
      NATIVE.add(v);
      try {
        if (!v.name) Object.defineProperty(v, 'name', { value: k, configurable: true });
      } catch (e) {}
    }
    return obj;
  };

  for (const f of globalThis.__NATIVE_PENDING || []) {
    if (typeof f === 'function') NATIVE.add(f);
  }
  try {
    delete globalThis.__NATIVE_PENDING;
  } catch (e) {}

  const shimToString = function toString() {
    if (NATIVE.has(this)) return 'function ' + (this.name || '') + '() { [native code] }';
    const src = SOURCE.get(this);
    if (src !== undefined) return src;
    return realToString.call(this);
  };
  Object.defineProperty(shimToString, 'name', { value: 'toString', configurable: true });
  NATIVE.add(shimToString);
  Function.prototype.toString = shimToString;
})();

// The window's own-property list is a fingerprint in its own right: a challenge
// enumerates it and reports every name it did not expect. V8's global carries
// members Chrome inherits, and lacks a handful Chrome owns.
(function () {
  const proto = Object.getPrototypeOf(globalThis);

  // Chrome reaches these through the prototype chain, so they are not own.
  for (const k of [
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    'toString',
    'valueOf',
    'constructor',
    'when',
  ]) {
    try {
      delete globalThis[k];
    } catch (e) {}
  }

  // window -> Window.prototype -> WindowProperties -> EventTarget.prototype ->
  // Object.prototype. Without it `window instanceof Window` is false, which no
  // browser has ever answered.
  const ET = globalThis.EventTarget;
  if (ET && ET.prototype) {
    for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent', 'when']) {
      try {
        const own = Object.getOwnPropertyDescriptor(globalThis, k);
        // The profile already put a stand-in here. The working implementation
        // is the one on the global, so it wins.
        if (own) Object.defineProperty(ET.prototype, k, own);
        delete globalThis[k];
      } catch (e) {}
    }
    const W = globalThis.Window;
    if (W && W.prototype) {
      try {
        const props = Object.create(ET.prototype);
        Object.defineProperty(props, Symbol.toStringTag, {
          value: 'WindowProperties',
          configurable: true,
        });
        Object.setPrototypeOf(W.prototype, props);
        for (const [k, v] of [
          ['TEMPORARY', 0],
          ['PERSISTENT', 1],
        ]) {
          if (!Object.prototype.hasOwnProperty.call(W.prototype, k)) {
            Object.defineProperty(W.prototype, k, {
              value: v,
              writable: false,
              enumerable: true,
              configurable: false,
            });
          }
        }
        Object.defineProperty(W.prototype, 'constructor', {
          value: W,
          writable: true,
          enumerable: false,
          configurable: true,
        });
        Object.defineProperty(W.prototype, Symbol.toStringTag, {
          value: 'Window',
          configurable: true,
        });
        Object.setPrototypeOf(globalThis, W.prototype);
      } catch (e) {}
    }
  }

  const own = (k, v, writable) => {
    try {
      if (Object.prototype.hasOwnProperty.call(globalThis, k)) return;
      Object.defineProperty(globalThis, k, {
        value: v,
        writable: writable !== false,
        enumerable: true,
        configurable: true,
      });
    } catch (e) {}
  };
  own('credentialless', false);
  own('crossOriginIsolated', false);
  own('originAgentCluster', false);
  own('offscreenBuffering', true);
  own('event', undefined);
  own('length', 0);
  own('status', '');
  own('scrollX', 0);
  own('scrollY', 0);
  own('screenLeft', globalThis.screenX || 0);
  own('screenTop', globalThis.screenY || 0);
})();

(function () {
  const DISCONNECTED = 1;
  const PRECEDING = 2;
  const FOLLOWING = 4;
  const CONTAINS = 8;
  const CONTAINED_BY = 16;
  const IMPLEMENTATION_SPECIFIC = 32;

  const holds = (outer, inner) => {
    for (let n = inner; n; n = n.parentNode) if (n === outer) return true;
    return false;
  };

  const walk = (root) => {
    const out = [];
    (function step(n) {
      if (!n) return;
      out.push(n);
      const kids = n === document ? [document.documentElement] : n.childNodes;
      if (kids) for (const k of Array.prototype.slice.call(kids)) step(k);
    })(root);
    return out;
  };

  function compareDocumentPosition(other) {
    if (this === other) return 0;
    if (holds(this, other)) return CONTAINED_BY | FOLLOWING;
    if (holds(other, this)) return CONTAINS | PRECEDING;
    const order = walk(document);
    const a = order.indexOf(this);
    const b = order.indexOf(other);
    if (a < 0 || b < 0) return DISCONNECTED | IMPLEMENTATION_SPECIFIC | PRECEDING;
    return a < b ? FOLLOWING : PRECEDING;
  }

  const install = (target) => {
    if (!target) return;
    try {
      Object.defineProperty(target, 'compareDocumentPosition', {
        value: compareDocumentPosition,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch (e) {}
  };

  if (globalThis.Node && globalThis.Node.prototype) install(globalThis.Node.prototype);
  for (const node of [document, document.documentElement, document.head, document.body])
    install(node);
})();
