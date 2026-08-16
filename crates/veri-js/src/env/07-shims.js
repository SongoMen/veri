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
      ['Document', globalThis.__DOCUMENT],
      ['Performance', globalThis.__RAW_PERFORMANCE || globalThis.performance],
    ];
    const PK = (globalThis.__PROFILE && globalThis.__PROFILE.prototypeKinds) || {};
    const writableFor = (ctorName) => {
      const out = new Set();
      for (const n of [ctorName, 'Document', 'Node', 'EventTarget']) {
        for (const k of (PK[n] && PK[n].w) || []) out.add(k);
      }
      return out;
    };
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
      const canWrite = writableFor(ctorName);
      for (const k of keys) {
        // An own accessor already has real behaviour behind it - document.cookie
        // writes into the jar - so move the descriptor rather than snapshotting
        // what it currently reads.
        let d0;
        try {
          d0 = Object.getOwnPropertyDescriptor(raw, k);
        } catch (e) {}
        if (d0 && (d0.get || d0.set)) {
          try {
            // Keep the behaviour behind it, but a browser throws for any
            // receiver that is not the object itself.
            const wrapped = { enumerable: d0.enumerable, configurable: true };
            if (d0.get) {
              const g = d0.get;
              wrapped.get = function () {
                if (this !== raw) {
                  throw new TypeError('Illegal invocation');
                }
                return g.call(raw);
              };
              Object.defineProperty(wrapped.get, 'name', {
                value: 'get ' + k,
                configurable: true,
              });
              NATIVE.add(wrapped.get);
            }
            if (d0.set) {
              const st = d0.set;
              wrapped.set = function (v) {
                if (this !== raw) throw new TypeError('Illegal invocation');
                return st.call(raw, v);
              };
              Object.defineProperty(wrapped.set, 'name', {
                value: 'set ' + k,
                configurable: true,
              });
              NATIVE.add(wrapped.set);
            }
            Object.defineProperty(ctor.prototype, k, wrapped);
            delete raw[k];
          } catch (e) {}
          continue;
        }
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
            const proto = ctor.prototype;
            // Only the object these were lifted from may read them; any other
            // receiver gets what a browser gives, which is a throw.
            const getter = function () {
              if (this !== raw) {
                throw new TypeError('Illegal invocation');
              }
              return store[k];
            };
            Object.defineProperty(getter, 'name', { value: 'get ' + k, configurable: true });
            NATIVE.add(getter);
            const desc = { get: getter, enumerable: true, configurable: true };
            if (canWrite.has(k)) {
              const setter = function (v) {
                if (this === proto) throw new TypeError('Illegal invocation');
                store[k] = v;
              };
              Object.defineProperty(setter, 'name', { value: 'set ' + k, configurable: true });
              NATIVE.add(setter);
              desc.set = setter;
            }
            Object.defineProperty(ctor.prototype, k, desc);
          }
          delete raw[k];
        } catch (e) {}
      }
      try {
        Object.setPrototypeOf(raw, ctor.prototype);
      } catch (e) {}
    }
  })();

  (function linkSingletons() {
    const pairs = [
      [globalThis.__DOCUMENT, 'HTMLDocument'],
      [globalThis.location, 'Location'],
      [globalThis.history, 'History'],
      [globalThis.performance, 'Performance'],
      [globalThis.navigator && globalThis.navigator.permissions, 'Permissions'],
      [globalThis.navigator && globalThis.navigator.connection, 'NetworkInformation'],
      [globalThis.navigator && globalThis.navigator.mediaDevices, 'MediaDevices'],
      [globalThis.navigator && globalThis.navigator.storage, 'StorageManager'],
      [globalThis.navigator && globalThis.navigator.clipboard, 'Clipboard'],
      [globalThis.navigator && globalThis.navigator.serviceWorker, 'ServiceWorkerContainer'],
      [globalThis.navigator && globalThis.navigator.mediaCapabilities, 'MediaCapabilities'],
      [globalThis.screen && globalThis.screen.orientation, 'ScreenOrientation'],
      [globalThis.visualViewport, 'VisualViewport'],
      [globalThis.crypto, 'Crypto'],
      [globalThis.crypto && globalThis.crypto.subtle, 'SubtleCrypto'],
      [globalThis.navigator && globalThis.navigator.locks, 'LockManager'],
      [globalThis.navigator && globalThis.navigator.userActivation, 'UserActivation'],
      [globalThis.navigator && globalThis.navigator.wakeLock, 'WakeLock'],
      [globalThis.document && globalThis.document.timeline, 'DocumentTimeline'],
      [globalThis.performance && globalThis.performance.eventCounts, 'EventCounts'],
      [globalThis.performance && globalThis.performance.timing, 'PerformanceTiming'],
      [globalThis.performance && globalThis.performance.navigation, 'PerformanceNavigation'],
    ];
    for (const [obj, ctorName] of pairs) {
      try {
        const ctor = globalThis[ctorName];
        if (!obj || typeof ctor !== 'function' || !ctor.prototype) continue;
        if (Object.getPrototypeOf(obj) === ctor.prototype) continue;
        Object.setPrototypeOf(obj, ctor.prototype);
      } catch (e) {}
    }
    try {
      const tags = globalThis.__TAG_CTOR || {};
      const seen = new Set();
      const walk = (n) => {
        if (!n || typeof n !== 'object' || seen.has(n)) return;
        seen.add(n);
        const tag = n.tagName;
        if (tag && Object.getPrototypeOf(n) === Object.prototype) {
          const ctor = globalThis[tags[tag] || 'HTMLElement'];
          if (typeof ctor === 'function' && ctor.prototype)
            Object.setPrototypeOf(n, ctor.prototype);
        }
        const kids = n.childNodes;
        if (kids && kids.length) for (let i = 0; i < kids.length; i++) walk(kids[i]);
      };
      walk(globalThis.__DOCUMENT && globalThis.__DOCUMENT.documentElement);
    } catch (e) {}
  })();

  (function realEventConstructors() {
    const EV = new WeakMap();
    globalThis.__evPatch = (ev, patch) => {
      const d = EV.get(ev);
      if (d) Object.assign(d, patch);
      return d;
    };
    globalThis.__evRead = (ev) => EV.get(ev);
    // prettier-ignore
    const COMMON = {
      bubbles: false, cancelable: false, composed: false, defaultPrevented: false,
      eventPhase: 0, cancelBubble: false, returnValue: true,
      target: null, currentTarget: null, srcElement: null,
    };
    // prettier-ignore
    const FIELDS = {
      UIEvent: { detail: 0, view: null, which: 0 },
      MouseEvent: {
        screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0,
        offsetX: 0, offsetY: 0, movementX: 0, movementY: 0, x: 0, y: 0,
        ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
        button: 0, buttons: 0, relatedTarget: null,
      },
      PointerEvent: {
        pointerId: 0, width: 1, height: 1, pressure: 0, tangentialPressure: 0,
        tiltX: 0, tiltY: 0, twist: 0, pointerType: '', isPrimary: false,
      },
      KeyboardEvent: {
        key: '', code: '', location: 0, repeat: false, isComposing: false,
        ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, charCode: 0, keyCode: 0,
      },
      WheelEvent: { deltaX: 0, deltaY: 0, deltaZ: 0, deltaMode: 0 },
      CustomEvent: { detail: null },
      MessageEvent: { data: null, origin: '', lastEventId: '', source: null, ports: [] },
      ProgressEvent: { lengthComputable: false, loaded: 0, total: 0 },
      ErrorEvent: { message: '', filename: '', lineno: 0, colno: 0, error: null },
      CloseEvent: { wasClean: false, code: 0, reason: '' },
      FocusEvent: { relatedTarget: null },
      InputEvent: { data: null, isComposing: false, inputType: '' },
      TransitionEvent: { propertyName: '', elapsedTime: 0, pseudoElement: '' },
      AnimationEvent: { animationName: '', elapsedTime: 0, pseudoElement: '' },
      MediaQueryListEvent: { media: '', matches: false },
      PromiseRejectionEvent: { promise: null, reason: undefined },
    };
    // Each class inherits its parent's members, so build the full set per class.
    const PARENT = {
      UIEvent: 'Event',
      MouseEvent: 'UIEvent',
      PointerEvent: 'MouseEvent',
      DragEvent: 'MouseEvent',
      WheelEvent: 'MouseEvent',
      KeyboardEvent: 'UIEvent',
      FocusEvent: 'UIEvent',
      InputEvent: 'UIEvent',
      TouchEvent: 'UIEvent',
      CompositionEvent: 'UIEvent',
      ClipboardEvent: 'Event',
      CustomEvent: 'Event',
    };
    const allFields = (name) => {
      const out = {};
      let n = name;
      const chain = [];
      while (n) {
        chain.unshift(n);
        n = PARENT[n];
      }
      for (const c of chain) Object.assign(out, FIELDS[c] || {});
      return out;
    };

    const NAMES = Object.keys(FIELDS).concat([
      'Event',
      'DragEvent',
      'TouchEvent',
      'ClipboardEvent',
      'CompositionEvent',
    ]);
    for (const name of NAMES) {
      const Old = globalThis[name];
      if (typeof Old !== 'function' || !Old.prototype) continue;
      const proto = Old.prototype;
      const own = allFields(name);
      const spec = Object.assign({}, COMMON, own);

      const Ctor = function (type, init) {
        if (!(this instanceof Ctor)) {
          throw new TypeError("Failed to construct '" + name + "': Please use the 'new' operator.");
        }
        const d = init && typeof init === 'object' ? init : {};
        const data = { type: String(type), timeStamp: 0 };
        try {
          data.timeStamp = globalThis.performance ? performance.now() : 0;
        } catch (e) {}
        for (const k of Object.keys(spec)) data[k] = k in d ? d[k] : spec[k];
        if ('detail' in d) data.detail = d.detail;
        EV.set(this, data);
        // A constructed event is not trusted, and it is the one own property.
        Object.defineProperty(this, 'isTrusted', {
          value: false,
          writable: false,
          enumerable: true,
          configurable: false,
        });
      };
      Ctor.prototype = proto;
      try {
        Object.defineProperty(proto, 'constructor', {
          value: Ctor,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(Ctor, 'name', { value: name, configurable: true });
        Object.defineProperty(globalThis, name, {
          value: Ctor,
          writable: true,
          enumerable: false,
          configurable: true,
        });
        NATIVE.add(Ctor);
      } catch (e) {}

      try {
        const methods = {
          preventDefault() {
            const d = EV.get(this);
            if (d && d.cancelable) d.defaultPrevented = true;
          },
          stopPropagation() {
            const d = EV.get(this);
            if (d) d.__stop = true;
          },
          stopImmediatePropagation() {
            const d = EV.get(this);
            if (d) {
              d.__stop = true;
              d.__stopNow = true;
            }
          },
          composedPath() {
            const d = EV.get(this);
            return (d && d.__path) || [];
          },
          initEvent(type, bubbles, cancelable) {
            const d = EV.get(this);
            if (d) {
              d.type = String(type);
              d.bubbles = !!bubbles;
              d.cancelable = !!cancelable;
            }
          },
        };
        for (const k of Object.keys(methods)) {
          NATIVE.add(methods[k]);
          Object.defineProperty(proto, k, {
            value: methods[k],
            writable: true,
            enumerable: false,
            configurable: true,
          });
        }
      } catch (e) {}

      for (const k of Object.keys(spec).concat(['type', 'timeStamp'])) {
        try {
          const getter = function () {
            const d = EV.get(this);
            if (!d) {
              if (this === proto) throw new TypeError('Illegal invocation');
              return undefined;
            }
            return d[k];
          };
          Object.defineProperty(getter, 'name', { value: 'get ' + k, configurable: true });
          NATIVE.add(getter);
          Object.defineProperty(proto, k, {
            get: getter,
            enumerable: true,
            configurable: true,
          });
        } catch (e) {}
      }
    }
  })();

  (function realValueTypes() {
    const S = new WeakMap();
    const iface = (name, ctor, fields, extra) => {
      const Old = globalThis[name];
      const proto = Old && Old.prototype ? Old.prototype : {};
      ctor.prototype = proto;
      try {
        Object.defineProperty(proto, 'constructor', {
          value: ctor,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(ctor, 'name', { value: name, configurable: true });
        for (const k of fields) {
          const get = function () {
            const d = S.get(this);
            return d ? d[k] : undefined;
          };
          Object.defineProperty(get, 'name', { value: 'get ' + k, configurable: true });
          NATIVE.add(get);
          const set = function (v) {
            const d = S.get(this);
            if (d) d[k] = v;
          };
          Object.defineProperty(set, 'name', { value: 'set ' + k, configurable: true });
          NATIVE.add(set);
          Object.defineProperty(proto, k, { get, set, enumerable: true, configurable: true });
        }
        for (const k of Object.keys(extra || {})) {
          Object.defineProperty(proto, k, {
            value: extra[k],
            writable: true,
            enumerable: false,
            configurable: true,
          });
        }
        Object.defineProperty(globalThis, name, {
          value: ctor,
          writable: true,
          enumerable: false,
          configurable: true,
        });
        NATIVE.add(ctor);
      } catch (e) {}
      return ctor;
    };

    const RectC = function DOMRect(x, y, w, h) {
      S.set(this, { x: +x || 0, y: +y || 0, width: +w || 0, height: +h || 0 });
    };
    iface('DOMRect', RectC, ['x', 'y', 'width', 'height'], {
      get top() {
        return Math.min(this.y, this.y + this.height);
      },
      toJSON() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      },
    });
    for (const k of ['top', 'right', 'bottom', 'left']) {
      try {
        const get = function () {
          const d = S.get(this) || { x: 0, y: 0, width: 0, height: 0 };
          if (k === 'top') return Math.min(d.y, d.y + d.height);
          if (k === 'bottom') return Math.max(d.y, d.y + d.height);
          if (k === 'left') return Math.min(d.x, d.x + d.width);
          return Math.max(d.x, d.x + d.width);
        };
        Object.defineProperty(get, 'name', { value: 'get ' + k, configurable: true });
        NATIVE.add(get);
        Object.defineProperty(RectC.prototype, k, {
          get,
          enumerable: true,
          configurable: true,
        });
      } catch (e) {}
    }

    const PointC = function DOMPoint(x, y, z, w) {
      S.set(this, { x: +x || 0, y: +y || 0, z: +z || 0, w: w === undefined ? 1 : +w });
    };
    iface('DOMPoint', PointC, ['x', 'y', 'z', 'w'], {
      toJSON() {
        return { x: this.x, y: this.y, z: this.z, w: this.w };
      },
    });

    const MatrixC = function DOMMatrix(init) {
      const v = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
      S.set(this, { a: v[0], b: v[1], c: v[2], d: v[3], e: v[4], f: v[5] });
    };
    iface('DOMMatrix', MatrixC, ['a', 'b', 'c', 'd', 'e', 'f'], {
      get is2D() {
        return true;
      },
      get isIdentity() {
        const d = S.get(this);
        return d.a === 1 && d.b === 0 && d.c === 0 && d.d === 1 && d.e === 0 && d.f === 0;
      },
      toString() {
        const d = S.get(this);
        return 'matrix(' + [d.a, d.b, d.c, d.d, d.e, d.f].join(', ') + ')';
      },
      toJSON() {
        const d = S.get(this);
        return { a: d.a, b: d.b, c: d.c, d: d.d, e: d.e, f: d.f, is2D: true };
      },
    });

    const ImageDataC = function ImageData(a, b, c) {
      let data, w, h;
      if (a && typeof a === 'object' && a.length !== undefined) {
        data = a;
        w = +b || 0;
        h = c === undefined ? (w ? a.length / 4 / w : 0) : +c;
      } else {
        w = +a || 0;
        h = +b || 0;
        data = new Uint8ClampedArray(Math.max(0, w * h * 4));
      }
      S.set(this, { data, width: w, height: h, colorSpace: 'srgb' });
    };
    iface('ImageData', ImageDataC, ['data', 'width', 'height', 'colorSpace'], {});

    // DOMMatrix exposes the 4x4 names as aliases of the six 2D ones.
    try {
      const M = globalThis.DOMMatrix;
      const ALIAS = { m11: 'a', m12: 'b', m21: 'c', m22: 'd', m41: 'e', m42: 'f' };
      const IDENT = {
        m13: 0,
        m14: 0,
        m23: 0,
        m24: 0,
        m31: 0,
        m32: 0,
        m33: 1,
        m34: 0,
        m43: 0,
        m44: 1,
      };
      for (const k of Object.keys(ALIAS)) {
        const get = function () {
          return this[ALIAS[k]];
        };
        Object.defineProperty(get, 'name', { value: 'get ' + k, configurable: true });
        NATIVE.add(get);
        Object.defineProperty(M.prototype, k, { get, enumerable: true, configurable: true });
      }
      for (const k of Object.keys(IDENT)) {
        const v = IDENT[k];
        const get = function () {
          return v;
        };
        Object.defineProperty(get, 'name', { value: 'get ' + k, configurable: true });
        NATIVE.add(get);
        Object.defineProperty(M.prototype, k, { get, enumerable: true, configurable: true });
      }
    } catch (e) {}

    // Values a browser reports that the stubs answered with a function.
    const constant = (ctorName, values) => {
      try {
        const C = globalThis[ctorName];
        if (typeof C !== 'function' || !C.prototype) return;
        for (const k of Object.keys(values)) {
          const v = values[k];
          const get =
            typeof v === 'function'
              ? v
              : function () {
                  return v;
                };
          Object.defineProperty(get, 'name', { value: 'get ' + k, configurable: true });
          NATIVE.add(get);
          Object.defineProperty(C.prototype, k, {
            get,
            set(x) {
              Object.defineProperty(this, k, {
                value: x,
                writable: true,
                enumerable: true,
                configurable: true,
              });
            },
            enumerable: true,
            configurable: true,
          });
        }
      } catch (e) {}
    };
    constant('XMLHttpRequest', {
      statusText: function () {
        const s = this.status;
        return s === 200 ? 'OK' : s === 404 ? 'Not Found' : s === 0 ? '' : '';
      },
      responseURL: function () {
        return this.__url || '';
      },
      responseXML: null,
      upload: function () {
        return { addEventListener() {}, removeEventListener() {}, onprogress: null };
      },
    });
    constant('Range', {
      commonAncestorContainer: function () {
        return globalThis.document ? globalThis.document.body : null;
      },
    });
    constant('WebSocket', {
      binaryType: 'blob',
      bufferedAmount: 0,
      extensions: '',
      protocol: '',
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
    });
    constant('MediaStream', {
      active: true,
      id: '',
      onactive: null,
      onaddtrack: null,
      oninactive: null,
      onremovetrack: null,
    });
    constant('BroadcastChannel', { name: '', onmessage: null, onmessageerror: null });
    constant('SharedWorker', { onerror: null });
    constant('OffscreenCanvas', { oncontextlost: null, oncontextrestored: null });
    constant('IntersectionObserver', {
      root: null,
      rootMargin: '0px 0px 0px 0px',
      thresholds: [0],
      delay: 0,
      trackVisibility: false,
      scrollMargin: '0px 0px 0px 0px',
    });
    constant('Notification', {
      actions: [],
      badge: '',
      body: '',
      data: null,
      dir: 'auto',
      icon: '',
      lang: '',
      tag: '',
      silent: null,
      requireInteraction: false,
      renotify: false,
    });
    constant('File', { lastModified: 0, name: '', webkitRelativePath: '' });
    constant('ImageData', { pixelFormat: 'rgba-unorm8' });
    constant('URL', { username: '', password: '' });
    try {
      if (!globalThis.__IS_FRAME) {
        Object.defineProperty(globalThis, 'frameElement', {
          get() {
            return null;
          },
          enumerable: true,
          configurable: true,
        });
      }
    } catch (e) {}

    try {
      const X = globalThis.XMLHttpRequest;
      const READY = { UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 };
      for (const k of Object.keys(READY)) {
        for (const holder of [X, X && X.prototype]) {
          if (!holder) continue;
          Object.defineProperty(holder, k, {
            value: READY[k],
            writable: false,
            enumerable: true,
            configurable: false,
          });
        }
      }
    } catch (e) {}

    constant('WebSocket', { readyState: 0, url: '' });
    constant('SharedWorker', {
      port: function () {
        return { postMessage() {}, start() {}, close() {}, onmessage: null };
      },
    });
    constant('File', { lastModifiedDate: null });
    constant('Notification', {
      onclick: null,
      onclose: null,
      onerror: null,
      onshow: null,
      timestamp: function () {
        return Date.now();
      },
      title: '',
    });
    constant('Request', {
      body: null,
      destination: '',
      duplex: undefined,
      integrity: '',
      isHistoryNavigation: false,
      isReloadNavigation: false,
      keepalive: false,
      referrerPolicy: '',
      priority: 'auto',
    });
    constant('RTCPeerConnection', {
      canTrickleIceCandidates: null,
      connectionState: 'new',
      currentLocalDescription: null,
      currentRemoteDescription: null,
      iceConnectionState: 'new',
      iceGatheringState: 'new',
      localDescription: null,
      remoteDescription: null,
      pendingLocalDescription: null,
      pendingRemoteDescription: null,
      signalingState: 'stable',
      sctp: null,
    });
    for (const n of ['Image', 'HTMLImageElement']) {
      constant(n, {
        complete: true,
        naturalWidth: 0,
        naturalHeight: 0,
        alt: '',
        align: '',
        border: '',
        attributionSrc: '',
        browsingTopics: false,
        crossOrigin: null,
        decoding: 'auto',
        fetchPriority: 'auto',
        hspace: 0,
        vspace: 0,
        isMap: false,
        useMap: '',
        longDesc: '',
        lowsrc: '',
        loading: 'eager',
        referrerPolicy: '',
        sizes: '',
        srcset: '',
        currentSrc: '',
        x: 0,
        y: 0,
      });
    }

    // A stream reports whether it is locked; the stub answered with a function.
    for (const [n, fields] of [
      ['ReadableStream', ['locked']],
      ['WritableStream', ['locked']],
    ]) {
      try {
        const Old = globalThis[n];
        if (typeof Old !== 'function' || !Old.prototype) continue;
        for (const k of fields) {
          const get = function () {
            return false;
          };
          Object.defineProperty(get, 'name', { value: 'get ' + k, configurable: true });
          NATIVE.add(get);
          Object.defineProperty(Old.prototype, k, {
            get,
            enumerable: true,
            configurable: true,
          });
        }
      } catch (e) {}
    }
    for (const n of ['TransformStream', 'CompressionStream', 'DecompressionStream']) {
      try {
        const Old = globalThis[n];
        if (typeof Old !== 'function' || !Old.prototype) continue;
        for (const k of ['readable', 'writable']) {
          const get = function () {
            const C = k === 'readable' ? globalThis.ReadableStream : globalThis.WritableStream;
            try {
              return new C();
            } catch (e) {
              return undefined;
            }
          };
          Object.defineProperty(get, 'name', { value: 'get ' + k, configurable: true });
          NATIVE.add(get);
          Object.defineProperty(Old.prototype, k, {
            get,
            enumerable: true,
            configurable: true,
          });
        }
      } catch (e) {}
    }
  })();

  (function realDOMException() {
    const Old = globalThis.DOMException;
    if (typeof Old !== 'function' || !Old.prototype) return;
    const D = new WeakMap();
    // prettier-ignore
    const CODES = {
      IndexSizeError: 1, HierarchyRequestError: 3, WrongDocumentError: 4,
      InvalidCharacterError: 5, NoModificationAllowedError: 7, NotFoundError: 8,
      NotSupportedError: 9, InUseAttributeError: 10, InvalidStateError: 11,
      SyntaxError: 12, InvalidModificationError: 13, NamespaceError: 14,
      InvalidAccessError: 15, TypeMismatchError: 17, SecurityError: 18,
      NetworkError: 19, AbortError: 20, URLMismatchError: 21,
      QuotaExceededError: 22, TimeoutError: 23, InvalidNodeTypeError: 24,
      DataCloneError: 25,
    };
    const Ctor = function DOMException(message, name) {
      const n = name === undefined ? 'Error' : String(name);
      D.set(this, {
        message: message === undefined ? '' : String(message),
        name: n,
        code: CODES[n] || 0,
      });
    };
    Ctor.prototype = Old.prototype;
    try {
      Object.defineProperty(Ctor.prototype, 'constructor', {
        value: Ctor,
        writable: true,
        configurable: true,
      });
      for (const k of ['message', 'name', 'code']) {
        const get = function () {
          const d = D.get(this);
          if (!d) {
            if (this === Ctor.prototype) return k === 'code' ? 0 : '';
            return k === 'code' ? 0 : '';
          }
          return d[k];
        };
        Object.defineProperty(get, 'name', { value: 'get ' + k, configurable: true });
        NATIVE.add(get);
        Object.defineProperty(Ctor.prototype, k, {
          get,
          enumerable: true,
          configurable: true,
        });
      }
      // `String(e)` is "Name: message", which is Error.prototype.toString.
      for (const [name, value] of Object.entries(CODES)) {
        Object.defineProperty(Ctor, name.replace(/Error$/, '_ERR').toUpperCase(), {
          value,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      Object.defineProperty(globalThis, 'DOMException', {
        value: Ctor,
        writable: true,
        enumerable: false,
        configurable: true,
      });
      NATIVE.add(Ctor);
    } catch (e) {}
  })();

  (function realStructuredClone() {
    const clone = (v, seen) => {
      if (v === null || typeof v !== 'object') {
        if (typeof v === 'function' || typeof v === 'symbol') {
          throw new (globalThis.DOMException || Error)(
            String(v) + ' could not be cloned.',
            'DataCloneError',
          );
        }
        return v;
      }
      if (seen.has(v)) return seen.get(v);
      const tag = Object.prototype.toString.call(v);
      let out;
      if (tag === '[object Date]') return new Date(v.getTime());
      if (tag === '[object RegExp]') return new RegExp(v.source, v.flags);
      if (tag === '[object ArrayBuffer]') return v.slice(0);
      if (ArrayBuffer.isView(v)) {
        return new v.constructor(clone(v.buffer, seen), v.byteOffset, v.length);
      }
      if (tag === '[object Map]') {
        out = new Map();
        seen.set(v, out);
        v.forEach((val, k) => out.set(clone(k, seen), clone(val, seen)));
        return out;
      }
      if (tag === '[object Set]') {
        out = new Set();
        seen.set(v, out);
        v.forEach((val) => out.add(clone(val, seen)));
        return out;
      }
      if (Array.isArray(v)) {
        out = new Array(v.length);
        seen.set(v, out);
        for (let i = 0; i < v.length; i++) out[i] = clone(v[i], seen);
        return out;
      }
      out = {};
      seen.set(v, out);
      for (const k of Object.keys(v)) out[k] = clone(v[k], seen);
      return out;
    };
    const fn = function structuredClone(value) {
      return clone(value, new Map());
    };
    try {
      NATIVE.add(fn);
      Object.defineProperty(globalThis, 'structuredClone', {
        value: fn,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch (e) {}

    try {
      const N = globalThis.Notification;
      if (typeof N === 'function') {
        Object.defineProperty(N, 'permission', {
          get: () => 'default',
          enumerable: false,
          configurable: true,
        });
        Object.defineProperty(N, 'maxActions', { value: 2, configurable: true });
        Object.defineProperty(N, 'requestPermission', {
          value: function requestPermission(cb) {
            const p = Promise.resolve('default');
            if (typeof cb === 'function') p.then(cb);
            return p;
          },
          writable: true,
          enumerable: false,
          configurable: true,
        });
        NATIVE.add(N.requestPermission);
      }
    } catch (e) {}
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

(function blinkOnlyMembers() {
  if (/Chrome\//.test((globalThis.__IDENTITY && globalThis.__IDENTITY.ua) || '')) return;
  try {
    const raw = globalThis.__RAW_PERFORMANCE || globalThis.performance;
    delete raw.memory;
    const P = globalThis.Performance;
    if (P && P.prototype) delete P.prototype.memory;
  } catch (e) {}
})();
