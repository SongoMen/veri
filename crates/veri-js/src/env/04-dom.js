(function () {
  globalThis.__matches = function __matches(el, sel) {
    sel = String(sel).trim();
    if (!sel) return false;
    if (sel === '*') return true;
    try {
      const m = /^([a-zA-Z][\w-]*)?(?:#([\w-]+))?(?:\.([\w-]+))?((?:\[[^\]]+\])*)$/.exec(sel);
      if (!m) return false;
      const tag = m[1],
        id = m[2],
        cls = m[3],
        attrs = m[4];
      if (tag && el.tagName !== tag.toUpperCase()) return false;
      if (id && el.id !== id) return false;
      if (cls && !(el.classList && el.classList.contains(cls))) return false;
      if (attrs) {
        const parts = attrs.match(/\[[^\]]+\]/g) || [];
        for (let i = 0; i < parts.length; i++) {
          const body = parts[i].slice(1, -1);
          const am = /^([\w-]+)(?:([*^$~|]?=)"?([^"\]]*)"?)?$/.exec(body);
          if (!am) return false;
          const name = am[1],
            op = am[2],
            want = am[3];
          let have = el.getAttribute ? el.getAttribute(name) : null;
          if (have === null || have === undefined) have = el[name];
          if (have === null || have === undefined) return false;
          if (!op) continue;
          have = String(have);
          if (op === '=' && have !== want) return false;
          if (op === '*=' && have.indexOf(want) < 0) return false;
          if (op === '^=' && have.slice(0, want.length) !== want) return false;
          if (op === '$=' && have.slice(-want.length) !== want) return false;
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  };
  function __inDocument(el) {
    for (let n = el, hops = 0; n && hops < 64; n = n.parentNode, hops++) {
      if (
        n === globalThis.document.documentElement ||
        n === globalThis.document.body ||
        n === globalThis.document.head
      ) {
        return true;
      }
    }
    return false;
  }

  /// Same shape as __fire, but for a frame's own buckets and targets.
  globalThis.__fireIn = function __fireIn(bucket, type, target, view) {
    const list = ((globalThis.__LISTENERS[bucket] || {})[type] || []).slice();
    const ev = {
      type,
      target,
      currentTarget: target,
      srcElement: target,
      view,
      bubbles: true,
      cancelable: false,
      isTrusted: true,
      timeStamp: performance.now(),
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    };
    for (const f of list) {
      try {
        typeof f === 'function' ? f.call(target, ev) : f.handleEvent(ev);
      } catch (e) {}
    }
    const on = target && target['on' + type];
    if (typeof on === 'function') {
      try {
        on.call(target, ev);
      } catch (e) {}
    }
  };

  /// Both the `on<type>` property and anything registered with
  /// addEventListener, which is where a page puts the handler that tells it an
  /// injected element finished loading.
  globalThis.__fireOn = function __fireOn(el, type, event) {
    const ev = event || { type, target: el, currentTarget: el, isTrusted: true };
    const on = el['on' + type];
    if (typeof on === 'function') {
      try {
        on.call(el, ev);
      } catch (e) {}
    }
    const l = (el.__handlers && el.__handlers[type]) || [];
    for (const f of l.slice()) {
      try {
        typeof f === 'function' ? f.call(el, ev) : f.handleEvent(ev);
      } catch (e) {}
    }
  };

  /// Reachable from the document, crossing out of a shadow tree through its
  /// host the way a browser does. A watchdog uses this to decide a widget is
  /// still alive.
  globalThis.__isConnected = function __isConnected(node) {
    const doc = globalThis.document;
    for (let n = node, hops = 0; n && hops < 128; hops++) {
      if (n === doc || n === doc.documentElement || n === doc.body || n === doc.head) return true;
      n = n.parentNode || n.host || null;
    }
    return false;
  };

  /// A shadow root's children never reach the document, so the registry walk
  /// cannot see them and the only place to look is the subtree itself.
  globalThis.__queryWithin = function __queryWithin(root, sel) {
    const out = [];
    const walk = (n, depth) => {
      if (!n || depth > 64) return;
      const kids = n.childNodes || n.children || [];
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        try {
          if (__matches(k, sel)) out.push(k);
        } catch (e) {}
        walk(k, depth + 1);
        if (k && k.__shadowRoot) walk(k.__shadowRoot, depth + 1);
      }
    };
    walk(root, 0);
    if (root && root.__shadowRoot) walk(root.__shadowRoot, 0);
    return out;
  };

  globalThis.__queryAll = function __queryAll(sel) {
    const all = globalThis.__ELEMENTS || [];
    const out = [];
    for (let i = 0; i < all.length; i++) {
      try {
        if (__matches(all[i], sel) && __inDocument(all[i])) out.push(all[i]);
      } catch (e) {}
    }
    return out;
  };

  globalThis.__LISTENERS = { window: {}, document: {} };
  globalThis.__listenerFactory = listenerFactory;
  function listenerFactory(bucket) {
    return {
      add(type, fn) {
        if (typeof fn !== 'function' && !(fn && typeof fn.handleEvent === 'function')) return;
        (globalThis.__LISTENERS[bucket][type] ||= []).push(fn);
      },
      remove(type, fn) {
        const l = globalThis.__LISTENERS[bucket][type];
        if (l) {
          const i = l.indexOf(fn);
          if (i >= 0) l.splice(i, 1);
        }
      },
    };
  }
  globalThis.__fire = function (bucket, type, extra) {
    const l = (globalThis.__LISTENERS[bucket][type] || []).slice();
    const ev = Object.assign(
      {
        type,
        target: bucket === 'window' ? globalThis.window : globalThis.document,
        currentTarget: bucket === 'window' ? globalThis.window : globalThis.document,
        bubbles: true,
        cancelable: false,
        isTrusted: true,
        timeStamp: performance.now(),
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {},
      },
      extra || {},
    );
    let n = 0;
    for (const fn of l) {
      try {
        (typeof fn === 'function' ? fn : fn.handleEvent).call(null, ev);
        n++;
      } catch (e) {
        globalThis.__noteError(type, e);
      }
    }
    const host = bucket === 'window' ? globalThis : globalThis.document;
    const h = host['on' + type];
    if (typeof h === 'function') {
      try {
        h.call(host, ev);
        n++;
      } catch (e) {
        globalThis.__noteError(type, e);
      }
    }
    return n;
  };
  globalThis.__EVENT_ERRORS = [];

  globalThis.__noteError = function __noteError(ev, e) {
    globalThis.__EVENT_ERRORS.push({
      ev,
      err: String(e),
      stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : null,
      at: __REC.length,
    });
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function __boxRect(b) {
    return {
      x: 0,
      y: 0,
      width: b.width,
      height: b.height,
      top: 0,
      left: 0,
      right: b.width,
      bottom: b.height,
    };
  }

  function __mulM(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }

  function __parseTransform(s) {
    let m = [1, 0, 0, 1, 0, 0];
    if (!s) return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    let g;
    while ((g = re.exec(String(s))) !== null) {
      const n = g[2]
        .split(/[\s,]+/)
        .filter((x) => x !== '')
        .map(Number);
      const rad = (deg) => ((deg || 0) * Math.PI) / 180;
      let t;
      switch (g[1]) {
        case 'matrix':
          t = [n[0] || 0, n[1] || 0, n[2] || 0, n[3] || 0, n[4] || 0, n[5] || 0];
          break;
        case 'translate':
          t = [1, 0, 0, 1, n[0] || 0, n.length > 1 ? n[1] : 0];
          break;
        case 'scale':
          t = [n[0] || 0, 0, 0, n.length > 1 ? n[1] : n[0] || 0, 0, 0];
          break;
        case 'skewX':
          t = [1, 0, Math.tan(rad(n[0])), 1, 0, 0];
          break;
        case 'skewY':
          t = [1, Math.tan(rad(n[0])), 0, 1, 0, 0];
          break;
        case 'rotate': {
          const c = Math.cos(rad(n[0])),
            s2 = Math.sin(rad(n[0]));
          t = [c, s2, -s2, c, 0, 0];
          if (n.length > 2) {
            t = __mulM(__mulM([1, 0, 0, 1, n[1], n[2]], t), [1, 0, 0, 1, -n[1], -n[2]]);
          }
          break;
        }
        default:
          t = [1, 0, 0, 1, 0, 0];
      }
      m = __mulM(m, t);
    }
    return m;
  }

  function __matrixObject(m) {
    return {
      a: m[0],
      b: m[1],
      c: m[2],
      d: m[3],
      e: m[4],
      f: m[5],
      multiply(o) {
        return __matrixObject(__mulM(m, [o.a, o.b, o.c, o.d, o.e, o.f]));
      },
      inverse() {
        const det = m[0] * m[3] - m[1] * m[2];
        if (!det) return __matrixObject([1, 0, 0, 1, 0, 0]);
        return __matrixObject([
          m[3] / det,
          -m[1] / det,
          -m[2] / det,
          m[0] / det,
          (m[2] * m[5] - m[3] * m[4]) / det,
          (m[1] * m[4] - m[0] * m[5]) / det,
        ]);
      },
      translate(x, y) {
        return __matrixObject(__mulM(m, [1, 0, 0, 1, x || 0, y || 0]));
      },
      scale(x, y) {
        return __matrixObject(__mulM(m, [x || 0, 0, 0, y === undefined ? x || 0 : y, 0, 0]));
      },
      toString() {
        return 'matrix(' + m.join(', ') + ')';
      },
    };
  }

  // The CTM runs from the nearest viewport down to and including this element.
  function __ctm(el) {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (String(n.tagName).toLowerCase() === 'svg') break;
      chain.unshift(n);
    }
    let m = [1, 0, 0, 1, 0, 0];
    for (const n of chain) {
      m = __mulM(m, __parseTransform(n.getAttribute && n.getAttribute('transform')));
    }
    return m;
  }

  function makeSvgElement(tag) {
    const el = makeElement(tag);
    el.tagName = String(tag);
    el.nodeName = String(tag);
    el.namespaceURI = SVG_NS;
    el.getCTM = function () {
      return __matrixObject(__ctm(this));
    };
    el.getScreenCTM = function () {
      return __matrixObject(__ctm(this));
    };
    el.createSVGMatrix = function () {
      return __matrixObject([1, 0, 0, 1, 0, 0]);
    };
    el.createSVGPoint = function () {
      return {
        x: 0,
        y: 0,
        matrixTransform(m) {
          return { x: m.e, y: m.f };
        },
      };
    };
    return el;
  }

  const __FRAME_WINDOWS = new WeakMap();
  const __FRAME_CTX = new WeakMap();
  const __CTX_EL = new Map();

  /// What the framed contexts sent up since the last round, delivered to the
  /// page's own listeners with the frame as the source.
  globalThis.__pumpFrameInbox = function __pumpFrameInbox() {
    if (typeof __HOST_FRAME_TAKE !== 'function') return 0;
    let rows;
    try {
      rows = JSON.parse(__HOST_FRAME_TAKE());
    } catch (e) {
      return 0;
    }
    for (const row of rows) {
      // A worker's realm reports through the same inbox as a frame's.
      const owner = globalThis.__WORKER_CTX_OWNER && globalThis.__WORKER_CTX_OWNER.get(row.i);
      if (owner) {
        try {
          owner.__deliverToMain(row.m && row.m.data);
        } catch (e) {}
        continue;
      }
      const el = __CTX_EL.get(row.i);
      if (!el) continue;
      const view = __frameWindow(el);
      const ev = __messageEvent(row.m && row.m.data, __frameOrigin(view), view);
      __deliver('window', globalThis.onmessage, ev);
    }
    return rows.length;
  };
  let __FRAME_SEQ = 0;

  function __messageEvent(data, origin, source) {
    return {
      type: 'message',
      // A browser stamps every event it dispatches itself. A challenge that
      // checks it drops an untrusted message without a word, so leaving it off
      // looks exactly like never having sent one.
      isTrusted: true,
      data,
      origin,
      source,
      lastEventId: '',
      ports: [],
      bubbles: false,
      cancelable: false,
      target: source,
    };
  }

  function __deliver(bucket, on, ev) {
    const list = (globalThis.__LISTENERS[bucket] || {}).message || [];
    for (const f of list.slice()) {
      try {
        typeof f === 'function' ? f(ev) : f.handleEvent(ev);
      } catch (e) {}
    }
    try {
      if (typeof on === 'function') on(ev);
    } catch (e) {}
  }

  /// `iframe.contentWindow.postMessage(...)` from the page.
  globalThis.__postToFrame = function __postToFrame(el, data, origin) {
    const ctx = __FRAME_CTX.get(el);
    if (ctx !== undefined && typeof __HOST_FRAME_POST === 'function') {
      try {
        __HOST_FRAME_POST(ctx, JSON.stringify({ data, origin: __PAGE_ORIGIN() }));
      } catch (e) {}
      return;
    }
    const bucket = __FRAME_BUCKETS.get(el);
    if (!bucket) return;
    const ev = __messageEvent(data, __PAGE_ORIGIN(), globalThis.window);
    __schedule(() => __deliver(bucket, null, ev), 0);
  };

  /// `parent.postMessage(...)` from inside a frame.
  function __framesParent(view) {
    const real = globalThis.window;
    let proxy;
    proxy = new Proxy(Object.create(null), {
      get(t, k) {
        if (k === 'postMessage') {
          return function (data) {
            const ev = __messageEvent(data, __frameOrigin(view), view);
            __schedule(() => __deliver('window', globalThis.onmessage, ev), 0);
          };
        }
        if (k === 'parent' || k === 'top' || k === 'window' || k === 'self') return proxy;
        return real[k];
      },
      set(t, k, v) {
        real[k] = v;
        return true;
      },
      has(t, k) {
        return k in real;
      },
    });
    return proxy;
  }

  function __frameOrigin(view) {
    try {
      return view.location.origin || __PAGE_ORIGIN();
    } catch (e) {
      return __PAGE_ORIGIN();
    }
  }

  function __PAGE_ORIGIN() {
    try {
      return globalThis.location.origin;
    } catch (e) {
      return '*';
    }
  }

  const __FRAME_BUCKETS = new WeakMap();

  function __frameWindow(el) {
    const cached = __FRAME_WINDOWS.get(el);
    if (cached) return cached;
    const own = {};
    const bucket = 'frame' + ++__FRAME_SEQ;
    globalThis.__LISTENERS[bucket] = {};
    globalThis.__LISTENERS[bucket + '-doc'] = {};
    __FRAME_BUCKETS.set(el, bucket);
    // prettier-ignore
    for (const name of ['Function', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'RegExp', 'Error', 'Date', 'Map', 'Set', 'Symbol']) {
    try {
      const real = globalThis[name];
      if (typeof real !== 'function') continue;
      // Delegates to the page's, so behaviour is identical; only identity differs.
      const copy = function (...a) {
        return new.target ? Reflect.construct(real, a, new.target) : real.apply(this, a);
      };
      copy.prototype = real.prototype;
      Object.defineProperty(copy, 'name', { value: name, configurable: true });
      for (const k of Object.getOwnPropertyNames(real)) {
        if (
          k === 'prototype' ||
          k === 'name' ||
          k === 'length' ||
          k === 'caller' ||
          k === 'arguments'
        )
          continue;
        try {
          copy[k] = real[k];
        } catch (e) {}
      }
      own[name] = copy;
    } catch (e) {}
  }
    const view = new Proxy(own, {
      get(t, k) {
        // The frame's own entries first: `parent` here is the bridge back to
        // the page, and handing out the page's window instead loses the reply.
        if (Object.prototype.hasOwnProperty.call(t, k)) return t[k];
        if (k === 'window' || k === 'self') return view;
        if (k === 'parent' || k === 'top') return globalThis.window;
        if (k === 'frameElement') return el;
        return globalThis.window[k];
      },
      set(t, k, v) {
        // A frame writing into the page's global would overwrite the very
        // config the page is being judged on.
        t[k] = v;
        return true;
      },
      // `with (view)` only routes a bare name through the proxy when this says
      // it has it, and a frame's script resolves every one of its globals here.
      has() {
        return true;
      },
      ownKeys() {
        return Reflect.ownKeys(globalThis);
      },
      getOwnPropertyDescriptor(t, k) {
        return (
          Object.getOwnPropertyDescriptor(globalThis, k) || {
            value: undefined,
            writable: true,
            enumerable: true,
            configurable: true,
          }
        );
      },
    });
    const listeners = globalThis.__listenerFactory(bucket);
    own.window = view;
    own.self = view;
    own.frameElement = el;
    own.addEventListener = (t, f) => listeners.add(t, f);
    own.removeEventListener = (t, f) => listeners.remove(t, f);
    own.dispatchEvent = () => true;
    own.postMessage = (data, origin) => __postToFrame(el, data, origin);
    own.parent = __framesParent(view);
    own.top = own.parent;
    __FRAME_WINDOWS.set(el, view);
    return view;
  }

  function makeElement(tag) {
    const T = String(tag).toUpperCase();
    const classSet = new Set();
    const el = {
      tagName: T,
      nodeName: T,
      nodeType: 1,
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      __style: (function () {
        const props = {};
        const kebab = (k) => String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
        const isCss = (k) => {
          if (!globalThis.__CSS_SET) {
            const set = new Set();
            for (const n of globalThis.__CSS_PROPS || globalThis.__CSS_LONGHAND || []) {
              set.add(String(n));
              const k = kebab(n);
              set.add(k);
              // A vendor-prefixed property is `webkitFontSmoothing` in camel case and
              // `-webkit-font-smoothing` in CSS:
              if (/^(webkit|moz|ms|o)-/.test(k)) set.add('-' + k);
            }
            globalThis.__CSS_SET = set;
          }
          if (globalThis.__CSS_SET.size === 0) return true;
          return globalThis.__CSS_SET.has(kebab(k)) || globalThis.__CSS_SET.has(String(k));
        };
        const api = {
          setProperty(k, v) {
            if (kebab(k) === 'font-family' && globalThis.__noteFont) {
              try {
                __noteFont(String(v));
              } catch (e) {}
            }
            if (isCss(k)) props[kebab(k)] = String(v);
          },
          getPropertyValue(k) {
            return props[kebab(k)] || '';
          },
          getPropertyPriority() {
            return '';
          },
          removeProperty(k) {
            const v = props[kebab(k)] || '';
            delete props[kebab(k)];
            return v;
          },
          item(i) {
            return Object.keys(props)[i] || '';
          },
          [Symbol.iterator]() {
            return Object.keys(props)[Symbol.iterator]();
          },
          get length() {
            return Object.keys(props).length;
          },
          get cssText() {
            return Object.keys(props)
              .map((k) => k + ': ' + props[k] + ';')
              .join(' ');
          },
          set cssText(v) {
            for (const decl of String(v).split(';')) {
              const at = decl.indexOf(':');
              if (at <= 0) continue;
              const k = decl.slice(0, at).trim();
              // Same rule as setProperty: a declaration a browser cannot parse
              // is dropped, not kept.
              if (isCss(k)) props[kebab(k)] = decl.slice(at + 1).trim();
            }
          },
        };
        try {
          const C = globalThis.CSSStyleDeclaration;
          if (C && C.prototype) Object.setPrototypeOf(api, C.prototype);
        } catch (e) {}
        return new Proxy(api, {
          get(t, k) {
            if (typeof k === 'symbol' || k in t) return Reflect.get(t, k);
            const v = props[kebab(k)];
            if (v !== undefined) return v;
            if (isCss(k)) return '';
            __rec('get:MISSING', 'style.' + String(k));
            return undefined;
          },
          set(t, k, v) {
            if (typeof k === 'symbol' || k in t) return Reflect.set(t, k, v);
            if (kebab(k) === 'font-family' && globalThis.__noteFont) {
              try {
                __noteFont(String(v));
              } catch (e) {}
            }
            if (isCss(k)) {
              props[kebab(k)] = String(v);
              return true;
            }
            return Reflect.set(t, k, String(v));
          },
          has(t, k) {
            return k in t || (typeof k === 'string' && kebab(k) in props);
          },
          ownKeys(t) {
            return Reflect.ownKeys(t).concat(Object.keys(props).filter((p) => !(p in t)));
          },
          getOwnPropertyDescriptor(t, k) {
            if (k in t) return Reflect.getOwnPropertyDescriptor(t, k);
            const kk = typeof k === 'string' ? kebab(k) : k;
            if (kk in props) {
              return { value: props[kk], writable: true, enumerable: true, configurable: true };
            }
            return undefined;
          },
        });
      })(),
      classList: (function () {
        const set = classSet;
        return {
          add(...c) {
            c.forEach((x) => set.add(x));
          },
          remove(...c) {
            c.forEach((x) => set.delete(x));
          },
          toggle(c) {
            set.has(c) ? set.delete(c) : set.add(c);
            return set.has(c);
          },
          contains(c) {
            return set.has(c);
          },
          item(i) {
            return [...set][i] ?? null;
          },
          replace(a, b) {
            if (set.delete(a)) {
              set.add(b);
              return true;
            }
            return false;
          },
          get length() {
            return set.size;
          },
          toString() {
            return [...set].join(' ');
          },
        };
      })(),
      get id() {
        return this.attributes.id || '';
      },
      set id(v) {
        this.attributes.id = String(v);
      },
      outerHTML: '',
      textContent: '',
      value: '',
      // Reflected both ways. Assigning the property alone used to leave the
      // content attribute empty, so getAttribute('src') answered null on an
      // element that plainly had one.
      get src() {
        return this.attributes.src || '';
      },
      set src(v) {
        this.attributes.src = String(v);
      },
      dataset: new Proxy(
        {},
        {
          get(t, k) {
            if (typeof k === 'symbol') return Reflect.get(t, k);
            const attr = 'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
            return Reflect.has(t, k) ? Reflect.get(t, k) : undefined;
          },
          set(t, k, v) {
            return Reflect.set(t, k, String(v));
          },
          has(t, k) {
            return Reflect.has(t, k);
          },
        },
      ),
      childNodes: [],
      children: [],
      attributes: __attributeMap(),
      parentNode: null,
      parentElement: null,
      width: 300,
      height: 150,

      setAttribute(k, v) {
        this.attributes[k] = String(v);
        if (k === 'id') this.id = String(v);
        if (k === 'class') this.className = String(v);
        if (k === 'src') {
          this.src = String(v);
          __maybeLoadScript(this);
          __maybeLoadFrame(this);
        }
        if (k === 'style') {
          try {
            this.style.cssText = String(v);
          } catch (e) {}
        }
        if (__diagOn() && globalThis.__ATTR_LOG && globalThis.__ATTR_LOG.length < 120) {
          globalThis.__ATTR_LOG.push(T + '[' + k + ']=' + String(v).slice(0, 80));
        }
      },
      getAttribute(k) {
        return k in this.attributes ? this.attributes[k] : null;
      },
      removeAttribute(k) {
        delete this.attributes[k];
      },
      hasAttribute(k) {
        return k in this.attributes;
      },
      getAttributeNames() {
        return Object.keys(this.attributes);
      },

      appendChild(c) {
        if (c) {
          try {
            c.parentNode = this;
            c.parentElement = this;
          } catch (e) {}
        }
        this.childNodes.push(c);
        if (c && c.nodeType === 1) this.children.push(c);
        __maybeLoadScript(c);
        return c;
      },
      insertBefore(c, ref) {
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        if (c) {
          try {
            c.parentNode = this;
            c.parentElement = this;
          } catch (e) {}
        }
        if (i >= 0) this.childNodes.splice(i, 0, c);
        else this.childNodes.push(c);
        if (c && c.nodeType === 1) this.children.push(c);
        __maybeLoadScript(c);
        return c;
      },
      removeChild(c) {
        const i = this.childNodes.indexOf(c);
        if (i >= 0) this.childNodes.splice(i, 1);
        const j = this.children.indexOf(c);
        if (j >= 0) this.children.splice(j, 1);
        if (c) {
          try {
            c.parentNode = null;
            c.parentElement = null;
          } catch (e) {}
        }
        return c;
      },
      replaceChild(n, o) {
        this.removeChild(o);
        return this.appendChild(n);
      },
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
      },
      cloneNode() {
        return makeElement(tag);
      },
      contains(n) {
        return this.childNodes.indexOf(n) >= 0;
      },
      hasChildNodes() {
        return this.childNodes.length > 0;
      },

      get firstChild() {
        return this.childNodes[0] ?? null;
      },
      get lastChild() {
        return this.childNodes[this.childNodes.length - 1] ?? null;
      },
      get firstElementChild() {
        return this.children[0] ?? null;
      },
      get lastElementChild() {
        return this.children[this.children.length - 1] ?? null;
      },
      get nextSibling() {
        const p = this.parentNode;
        if (!p) return null;
        const i = p.childNodes.indexOf(this);
        return i >= 0 ? (p.childNodes[i + 1] ?? null) : null;
      },
      get previousSibling() {
        const p = this.parentNode;
        if (!p) return null;
        const i = p.childNodes.indexOf(this);
        return i > 0 ? p.childNodes[i - 1] : null;
      },
      get nextElementSibling() {
        const p = this.parentNode;
        if (!p) return null;
        const i = p.children.indexOf(this);
        return i >= 0 ? (p.children[i + 1] ?? null) : null;
      },
      get previousElementSibling() {
        const p = this.parentNode;
        if (!p) return null;
        const i = p.children.indexOf(this);
        return i > 0 ? p.children[i - 1] : null;
      },

      // Declared arity matters: a browser's are 2, 2 and 1.
      addEventListener(_t, _f) {
        if (typeof _f !== 'function' && !(_f && typeof _f.handleEvent === 'function')) return;
        const all = this.__handlers || (this.__handlers = {});
        (all[_t] || (all[_t] = [])).push(_f);
      },
      removeEventListener(_t, _f) {
        const l = this.__handlers && this.__handlers[_t];
        if (!l) return;
        const i = l.indexOf(_f);
        if (i >= 0) l.splice(i, 1);
      },
      dispatchEvent(_e) {
        __fireOn(this, (_e && _e.type) || '', _e);
        return true;
      },
      get __box() {
        let attached = false;
        for (let n = this; n; n = n.parentNode) {
          if (n === document.body || n === document.documentElement) {
            attached = true;
            break;
          }
        }
        const text = this.textContent || '';
        if (!attached || !text) return { width: 0, height: 0 };
        const style = this.style || {};
        const shorthand = style.font || '';
        if (globalThis.__noteFont) {
          try {
            __noteFont((style.fontFamily || shorthand || '') + '');
          } catch (e) {}
        }
        const size = parseFloat(style.fontSize) || parseFloat(shorthand) || 16;
        const family =
          style.fontFamily ||
          (shorthand ? __fontFamilies(shorthand).families.join(',') : '') ||
          'serif';
        const m = __measure(text, size + 'px ' + family);
        return { width: m.width, height: m.lineHeight };
      },
      get offsetWidth() {
        return Math.round(this.__box.width);
      },
      get offsetHeight() {
        return this.__box.height;
      },
      get clientWidth() {
        return Math.round(this.__box.width);
      },
      get clientHeight() {
        return this.__box.height;
      },
      getBoundingClientRect() {
        const r = __boxRect(this.__box);
        r.toJSON = function toJSON() {
          return {};
        };
        return r;
      },
      getClientRects() {
        const b = this.__box;
        return b.width ? [__boxRect(b)] : [];
      },
      focus() {},
      blur() {},
      click() {},
      scrollIntoView() {},
      querySelector(sel) {
        const h = __queryWithin(this, sel);
        if (h.length) return h[0];
        const g = __queryAll(sel);
        return g.length ? g[0] : null;
      },
      querySelectorAll(sel) {
        const h = __queryWithin(this, sel);
        return h.length ? h : __queryAll(sel);
      },
      closest() {
        return null;
      },
      matches(sel) {
        return __matches(this, sel);
      },
      attachShadow(init) {
        if (!globalThis.__SHADOW_DOM) return undefined;
        if (this.__shadowRoot) {
          throw new Error(
            'Shadow root cannot be created on a host which already hosts a shadow tree',
          );
        }
        const root = makeElement('#shadow-root');
        root.nodeType = 11;
        root.nodeName = '#document-fragment';
        root.mode = init && init.mode === 'open' ? 'open' : 'closed';
        root.host = this;
        try {
          if (__G0.ShadowRoot && __G0.ShadowRoot.prototype) {
            Object.setPrototypeOf(root, __G0.ShadowRoot.prototype);
          }
        } catch (e) {}
        Object.defineProperty(this, '__shadowRoot', {
          value: root,
          enumerable: false,
          configurable: true,
        });
        return root;
      },
      get shadowRoot() {
        const r = this.__shadowRoot;
        return r && r.mode === 'open' ? r : null;
      },
      get elements() {
        return __queryWithin(this, 'input')
          .concat(__queryWithin(this, 'select'))
          .concat(__queryWithin(this, 'textarea'))
          .concat(__queryWithin(this, 'button'));
      },
      submit() {
        try {
          const fields = this.elements
            .filter((el) => el.name && el.type !== 'submit' && el.type !== 'button')
            .map(
              (el) =>
                encodeURIComponent(el.name) +
                '=' +
                encodeURIComponent(el.value == null ? '' : el.value),
            )
            .join('&');
          const method = String(this.method || 'GET').toUpperCase();
          const here = (globalThis.location && globalThis.location.href) || '';
          const action = this.action || this.getAttribute('action') || here;
          const url = new globalThis.URL(String(action), here).href;
          const withHeaders = globalThis.__HOST_FETCH_HEADERS;
          const plain = globalThis.__HOST_FETCH;
          const target =
            method === 'GET' && fields ? url + (url.includes('?') ? '&' : '?') + fields : url;
          if (typeof withHeaders === 'function') {
            withHeaders(
              method,
              target,
              method === 'GET' ? '' : fields,
              JSON.stringify([['content-type', 'application/x-www-form-urlencoded']]),
            );
          } else if (typeof plain === 'function') {
            plain(method, target, method === 'GET' ? '' : fields);
          }
        } catch (e) {}
      },
      requestSubmit() {
        this.submit();
      },
      insertAdjacentHTML() {},
      insertAdjacentElement(_, e) {
        return e;
      },
      get innerHTML() {
        return this.__html || '';
      },
      set innerHTML(html) {
        this.__html = String(html);
        this.childNodes = [];
        this.children = [];
        try {
          for (const child of __parseHtml(this.__html)) this.appendChild(child);
        } catch (e) {}
      },
      getContext(type) {
        return __makeContext(this, String(type));
      },
      transferControlToOffscreen() {
        return new globalThis.OffscreenCanvas(this.width || 300, this.height || 150);
      },
      get contentWindow() {
        return T === 'IFRAME' ? __frameWindow(this) : null;
      },
      get contentDocument() {
        return T === 'IFRAME' ? globalThis.document : null;
      },
      canPlayType(t) {
        return typeof globalThis.__canPlayType === 'function' ? globalThis.__canPlayType(t) : '';
      },
      toDataURL() {
        return __renderedPng(this);
      },
      toBlob(cb) {
        if (typeof cb === 'function') cb({ size: 1024, type: 'image/png' });
      },
    };
    // Elements must satisfy `instanceof HTMLScriptElement` and friends.
    try {
      const ctorName = __TAG_CTOR[T] || 'HTMLElement';
      const ctor = __G0[ctorName] || __G0.HTMLElement;
      if (ctor && ctor.prototype) Object.setPrototypeOf(el, ctor.prototype);
    } catch (e) {}

    // Assigning the property is how a frame is navigated; setAttribute is the
    // rarer spelling and hooking only that leaves the frame empty.
    if (T === 'IFRAME') {
      try {
        let href = '';
        Object.defineProperty(el, 'src', {
          configurable: true,
          enumerable: true,
          get() {
            return href;
          },
          set(v) {
            href = String(v);
            this.attributes.src = href;
            __maybeLoadFrame(this);
          },
        });
      } catch (e) {}
    }

    try {
      Object.defineProperty(el, 'isConnected', {
        configurable: true,
        enumerable: false,
        get() {
          return __isConnected(this);
        },
      });
    } catch (e) {}

    try {
      Object.defineProperty(el, 'className', {
        get() {
          return [...classSet].join(' ');
        },
        set(v) {
          classSet.clear();
          String(v)
            .split(/\s+/)
            .filter(Boolean)
            .forEach((c) => classSet.add(c));
          try {
            el.attributes.class = [...classSet].join(' ');
          } catch (e) {}
        },
        enumerable: true,
        configurable: true,
      });
    } catch (e) {}

    try {
      Object.defineProperty(el, 'style', {
        get() {
          return el.__style;
        },
        set(v) {
          try {
            el.__style.cssText = String(v);
          } catch (e) {}
        },
        enumerable: true,
        configurable: true,
      });
    } catch (e) {}

    try {
      if (globalThis.__markNative) __markNative(el);
    } catch (e) {}

    const wrapped = __watch('el<' + tag + '>', el);
    (globalThis.__ELEMENTS || (globalThis.__ELEMENTS = [])).push(wrapped);
    return wrapped;
  }
  globalThis.__parseHtml = function __parseHtml(html) {
    const roots = [];
    const stack = [];
    // prettier-ignore
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const re = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let m;
    let last = 0;
    const put = (node) => {
      if (stack.length) stack[stack.length - 1].appendChild(node);
      else roots.push(node);
    };
    while ((m = re.exec(html)) !== null) {
      const text = html.slice(last, m.index);
      if (text.trim() && stack.length) {
        try {
          stack[stack.length - 1].textContent += text;
        } catch (e) {}
        try {
          put(document.createTextNode(text));
        } catch (e) {}
      }
      last = re.lastIndex;
      const name = m[1].toLowerCase();
      if (m[0][1] === '/') {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tagName === name.toUpperCase()) {
            stack.length = i;
            break;
          }
        }
        continue;
      }
      const el = makeElement(name);
      const attrs = m[2] || '';
      const are = /([\w-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = are.exec(attrs)) !== null) {
        const v = a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : (a[5] ?? '');
        try {
          el.setAttribute(a[1], v);
        } catch (e) {}
      }
      put(el);
      if (!VOID.has(name) && !/\/\s*$/.test(attrs)) stack.push(el);
    }
    return roots;
  };

  const documentElement = makeElement('html');
  const head = makeElement('head');
  const body = makeElement('body');

  for (const root of [head, body]) {
    root.parentNode = documentElement;
    root.parentElement = documentElement;
    documentElement.childNodes.push(root);
    documentElement.children.push(root);
  }

  const document = {
    nodeType: 9,
    documentElement,
    head,
    body,
    // Present and null between scripts, never absent.
    currentScript: null,
    get styleSheets() {
      const sheets = __inDocumentOrder(this)
        .filter(
          (n) =>
            n.tagName === 'STYLE' ||
            (n.tagName === 'LINK' && String(n.rel || '').toLowerCase() === 'stylesheet'),
        )
        .map((n) => ({
          ownerNode: n,
          href: n.href || null,
          type: 'text/css',
          disabled: false,
          media: { mediaText: '' },
          title: n.title || null,
          cssRules: [],
          rules: [],
        }));
      sheets.item = (i) => sheets[i] || null;
      return sheets;
    },
    readyState: 'loading',
    visibilityState: 'visible',
    hidden: false,
    characterSet: 'UTF-8',
    charset: 'UTF-8',
    contentType: 'text/html',
    compatMode: 'CSS1Compat',
    referrer: '',
    // FontFaceSet. `check` is the direct way to ask whether a family is
    // installed, and answering true for everything claims every font ever named.
    fonts: (function () {
      const present = new Set(
        (
          (__PROFILE && __PROFILE.misc && __PROFILE.misc.fonts && __PROFILE.misc.fonts.present) ||
          []
        ).map((f) => f.toLowerCase()),
      );
      const set = {
        status: 'loaded',
        size: 0,
        ready: Promise.resolve(null),
        check(font) {
          // Chrome answers true for a family it does not have:
          return __fontFamilies(font).families.length > 0 || present.size >= 0;
        },
        load() {
          return Promise.resolve([]);
        },
        add() {
          return set;
        },
        delete() {
          return false;
        },
        clear() {},
        has() {
          return false;
        },
        forEach() {},
        values() {
          return [][Symbol.iterator]();
        },
        keys() {
          return [][Symbol.iterator]();
        },
        entries() {
          return [][Symbol.iterator]();
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return true;
        },
        onloading: null,
        onloadingdone: null,
        onloadingerror: null,
      };
      set[Symbol.iterator] = function () {
        return [][Symbol.iterator]();
      };
      return set;
    })(),
    // MM/DD/YYYY HH:MM:SS in local time, always - the one date on the document that is
    // not locale-formatted.
    get lastModified() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return (
        p(d.getMonth() + 1) +
        '/' +
        p(d.getDate()) +
        '/' +
        d.getFullYear() +
        ' ' +
        p(d.getHours()) +
        ':' +
        p(d.getMinutes()) +
        ':' +
        p(d.getSeconds())
      );
    },
    title: 'Just a moment...',
    createElement: (t) => makeElement(t),
    createElementNS: (ns, t) => (ns === SVG_NS ? makeSvgElement(t) : makeElement(t)),
    createTextNode: (t) => {
      const value = String(t);
      return {
        nodeType: 3,
        nodeName: '#text',
        data: value,
        nodeValue: value,
        textContent: value,
        wholeText: value,
        length: value.length,
        parentNode: null,
        parentElement: null,
        childNodes: [],
        nextSibling: null,
        previousSibling: null,
      };
    },
    createDocumentFragment: () => makeElement('#fragment'),
    __registry: {},
    getElementById: (id) => {
      const all = globalThis.__ELEMENTS || [];
      for (let i = 0; i < all.length; i++) {
        try {
          if (all[i].id === id) return all[i];
        } catch (e) {}
      }
      return null;
    },
    getElementsByTagName: (t) => {
      t = String(t).toLowerCase();
      if (t === 'head') return [head];
      if (t === 'body') return [body];
      if (t === '*') return (globalThis.__ELEMENTS || []).slice();
      return __queryAll(t);
    },
    // A live view of the document's script tags, which is how a collector that
    // hashes each script finds them.
    get scripts() {
      return __queryAll('script');
    },
    getElementsByClassName: (c) => {
      const want = String(c).trim().split(/\s+/).filter(Boolean);
      if (!want.length) return [];
      return (globalThis.__ELEMENTS || []).filter((el) => {
        try {
          return want.every((w) => el.classList && el.classList.contains(w));
        } catch (e) {
          return false;
        }
      });
    },
    // Resolved against the document. querySelector keeps a registry fallback so a
    // challenge looking up its own tag gets an object rather than null.
    querySelector: (sel) => {
      const found = __queryAll(sel);
      if (found.length) return found[0];
      return (document.__registry[sel] ||= makeElement(
        /^[a-z0-9]+$/i.test(String(sel)) ? String(sel) : 'div',
      ));
    },
    querySelectorAll: (sel) => __queryAll(sel),
    hasFocus: () => true,
    visibilityState: 'visible',
    hidden: false,
    addEventListener: (t, f) => listenerFactory('document').add(t, f),
    removeEventListener: (t, f) => listenerFactory('document').remove(t, f),
    dispatchEvent() {
      return true;
    },
    createEvent: () => ({ initEvent() {} }),
  };

  globalThis.__COOKIES_SET = [];
  (function () {
    const jar = new Map();
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      enumerable: true,
      get() {
        return Array.from(jar, ([k, v]) => k + '=' + v).join('; ');
      },
      set(raw) {
        const s = String(raw);
        globalThis.__COOKIES_SET.push(s);
        const eq = s.split(';')[0].indexOf('=');
        if (eq < 0) return;
        const name = s.slice(0, eq).trim();
        const value = s
          .slice(eq + 1)
          .split(';')[0]
          .trim();
        // A past expiry or a zero max-age is a deletion, not an assignment.
        if (/max-age\s*=\s*0(?!\d)/i.test(s) || /expires\s*=[^;]*19[7-9]\d/i.test(s)) {
          jar.delete(name);
        } else {
          jar.set(name, value);
        }
      },
    });
  })();

  /// Name to value, as the rest of this file expects, but walkable the way a
  /// NamedNodeMap is: page code iterates it and reads `.name` off each entry.
  function __attributeMap() {
    const map = {};
    Object.defineProperty(map, Symbol.iterator, {
      value: function () {
        return Object.keys(this)
          .map((name) => ({ name, value: this[name] }))
          [Symbol.iterator]();
      },
      enumerable: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(map, 'length', {
      get() {
        return Object.keys(this).length;
      },
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(map, 'item', {
      value: function (i) {
        const name = Object.keys(this)[i];
        return name === undefined ? null : { name, value: this[name] };
      },
      enumerable: false,
      writable: true,
      configurable: true,
    });
    return map;
  }

  globalThis.__ATTR_LOG = [];

  globalThis.__SCRIPTS_LOADED = [];
  globalThis.__maybeLoadScript = function __maybeLoadScript(el) {
    if (!el) return;
    let tag, src, inline;
    try {
      tag = el.tagName;
      src = el.src || el.getAttribute('src');
      inline = el.textContent || el.innerHTML;
    } catch (e) {
      return;
    }
    if (tag !== 'SCRIPT') return;
    if (el.__loaded) return;
    el.__loaded = true;
    __schedule(function () {
      __loadScriptNow(el);
    }, 0);
  };

  globalThis.__loadScriptNow = function __loadScriptNow(el) {
    let src, inline;
    try {
      src = el.src || el.getAttribute('src');
      inline = el.textContent || el.innerHTML;
    } catch (e) {
      return;
    }

    const fire = (ok) => {
      try {
        __fireOn(el, ok ? 'load' : 'error');
      } catch (e) {}
    };

    if (src) {
      if (typeof __HOST_FETCH !== 'function') {
        __SCRIPTS_LOADED.push({ src, status: 'no-bridge' });
        fire(false);
        return;
      }
      let r;
      try {
        r = JSON.parse(__HOST_FETCH('GET', __absolute(src), ''));
      } catch (e) {
        r = { status: 0, body: '' };
      }
      const code = String(r.body || '');
      __SCRIPTS_LOADED.push({ src: String(src), status: r.status, bytes: code.length });
      if (__diagOn()) {
        (globalThis.__SCRIPT_SOURCES || (globalThis.__SCRIPT_SOURCES = [])).push({
          src: String(src),
          code,
        });
      }
      if (r.status >= 200 && r.status < 400 && code) {
        const prev = globalThis.document.currentScript;
        globalThis.document.currentScript = el;
        try {
          __runInScope(code);
        } catch (e) {
          __SCRIPTS_LOADED.push({ src: String(src), threw: String(e).slice(0, 140) });
        } finally {
          globalThis.document.currentScript = prev;
        }
        fire(true);
      } else {
        fire(false);
      }
    } else if (inline && String(inline).trim()) {
      __SCRIPTS_LOADED.push({ inline: true, bytes: String(inline).length });
      try {
        __runInScope(String(inline));
      } catch (e) {
        __SCRIPTS_LOADED.push({ inline: true, threw: String(e).slice(0, 140) });
      }
      fire(true);
    }
  };

  globalThis.__FRAMES_LOADED = [];

  globalThis.__buildFrameDocument = function __buildFrameDocument(html) {
    const part = (tag) => {
      const m = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '\\s*>', 'i').exec(html);
      return m ? m[1] : '';
    };
    for (const [tag, parent] of [
      ['head', document.head],
      ['body', document.body],
    ]) {
      const inner = part(tag);
      if (!inner.trim() || !parent) continue;
      try {
        for (const child of __parseHtml(inner)) parent.appendChild(child);
      } catch (e) {}
    }
  };

  const FRAME_LIFECYCLE = [
    "document.readyState = 'interactive'; __fire('document','readystatechange');",
    "__fire('document','DOMContentLoaded');",
    "document.readyState = 'complete'; __fire('document','readystatechange');",
    "__fire('window','load');",
    "__fire('window','pageshow');",
  ];

  globalThis.__driveFrameLifecycle = function __driveFrameLifecycle(ctx, el) {
    let i = 0;
    const step = () => {
      if (i >= FRAME_LIFECYCLE.length) {
        __fireOn(el, 'load');
        return;
      }
      __HOST_FRAME_RUN(ctx, FRAME_LIFECYCLE[i++]);
      __schedule(step, 1);
    };
    step();
  };

  globalThis.__maybeLoadFrame = function __maybeLoadFrame(el) {
    if (!globalThis.__FRAMES) return;
    if (!el || el.tagName !== 'IFRAME' || el.__frameLoaded) return;
    // One framed document is what a challenge needs; more is a page being a page.
    if (__FRAMES_LOADED.length >= 2) return;
    let src;
    try {
      src = el.src || el.getAttribute('src');
    } catch (e) {
      return;
    }
    if (!src || !/^https?:/i.test(String(src))) return;
    el.__frameLoaded = true;
    __schedule(function () {
      __loadFrameNow(el, String(src));
    }, 0);
  };

  globalThis.__loadFrameNow = function __loadFrameNow(el, src) {
    const note = (extra) => {
      const row = Object.assign({ frame: src }, extra);
      __FRAMES_LOADED.push(row);
      __SCRIPTS_LOADED.push(row);
    };
    if (typeof __HOST_FETCH !== 'function') return note({ status: 'no-bridge' });

    let r;
    try {
      r = JSON.parse(__HOST_FETCH('GET', __absolute(src), ''));
    } catch (e) {
      return note({ status: 0, threw: String(e).slice(0, 120) });
    }
    const html = String(r.body || '');
    note({ status: r.status, bytes: html.length });
    if (!(r.status >= 200 && r.status < 400) || !html) return;

    const view = __frameWindow(el);
    try {
      view.location = __frameLocation(src);
      view.document = __frameDocument(view, __FRAME_BUCKETS.get(el) + '-doc');
    } catch (e) {}

    // Its own context, so `this` inside its scripts is its own global. A frame
    // sharing the page's context initialises itself into the page instead.
    const ctx =
      typeof __HOST_FRAME_OPEN === 'function' ? __HOST_FRAME_OPEN(String(src), __IDENTITY.ua) : -1;
    if (ctx >= 0) {
      __FRAME_CTX.set(el, ctx);
      __CTX_EL.set(ctx, el);
      const box = (() => {
        const num = (v) => parseInt(String(v || '').replace(/[^0-9]/g, ''), 10);
        const w =
          num(el.style && el.style.width) || num(el.getAttribute('width')) || el.width || 300;
        const h =
          num(el.style && el.style.height) || num(el.getAttribute('height')) || el.height || 65;
        return [w, h];
      })();
      __HOST_FRAME_RUN(ctx, '__setFrameViewport(' + box[0] + ',' + box[1] + ')');
      const markup = String(html).replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
      __HOST_FRAME_RUN(ctx, '__buildFrameDocument(' + JSON.stringify(markup) + ')');
      let inCtx = 0;
      for (const code of __inlineScripts(html)) {
        const err = __HOST_FRAME_RUN(ctx, code);
        if (err) note({ frameThrew: String(err).slice(0, 160) });
        else inCtx++;
      }
      note({ scripts: inCtx, context: ctx });
      __driveFrameLifecycle(ctx, el);
      return;
    }

    let ran = 0;
    for (const code of __inlineScripts(html)) {
      // A framed script takes its global from `this`, and a nested plain call in
      // sloppy mode binds that to the real global rather than the frame's. The
      // scope object is what `self` resolves to here, so preferring it puts the
      // frame's own window back in the frame's hands.
      code = code.replace(/\bthis\s*\|\|\s*self\b/g, 'self');
      try {
        globalThis.__runInFrame(code, view);
        ran++;
      } catch (e) {
        note({ threw: String(e).slice(0, 160) });
      }
    }
    note({ scripts: ran });

    // A framed document runs the same lifecycle a page does, and runs it after
    // the work its scripts queued. Firing it inline lands before a handler the
    // script is still on its way to installing.
    const wBucket = __FRAME_BUCKETS.get(el);
    const dBucket = wBucket + '-doc';
    const step = (delay, fn) => __schedule(fn, delay);
    step(1, () => {
      try {
        const doc = view.document;
        doc.readyState = 'interactive';
        __fireIn(dBucket, 'readystatechange', doc, view);
        __fireIn(dBucket, 'DOMContentLoaded', doc, view);
      } catch (e) {}
    });
    step(2, () => {
      try {
        const doc = view.document;
        doc.readyState = 'complete';
        __fireIn(dBucket, 'readystatechange', doc, view);
        __fireIn(wBucket, 'load', view, view);
        __fireIn(wBucket, 'pageshow', view, view);
      } catch (e) {}
    });

    try {
      __fireOn(el, 'load');
    } catch (e) {}
  };

  function __inlineScripts(html) {
    const out = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let m;
    while ((m = re.exec(html))) {
      if (/\bsrc\s*=/i.test(m[1])) continue;
      if (m[2] && m[2].trim()) out.push(m[2]);
    }
    return out;
  }

  function __frameLocation(src) {
    const u = new globalThis.URL(src);
    return {
      href: u.href,
      origin: u.origin,
      protocol: u.protocol,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      toString() {
        return u.href;
      },
      replace() {},
      assign() {},
      reload() {},
    };
  }

  /// Its own document, so the frame's nodes never appear in the page's queries.
  function __frameDocument(view, bucket) {
    const d = Object.create(globalThis.document);
    const listeners = globalThis.__listenerFactory(bucket);
    d.defaultView = view;
    d.currentScript = null;
    // Its own listeners and its own readiness: inheriting the page's means the
    // frame's scripts register against a lifecycle that already finished, and
    // wait for an event that will never come again.
    d.readyState = 'loading';
    d.addEventListener = (t, f) => listeners.add(t, f);
    d.removeEventListener = (t, f) => listeners.remove(t, f);
    return d;
  }

  const NODE_FILTER_BITS = {
    SHOW_ALL: 0xffffffff,
    SHOW_ELEMENT: 0x1,
    SHOW_ATTRIBUTE: 0x2,
    SHOW_TEXT: 0x4,
    SHOW_CDATA_SECTION: 0x8,
    SHOW_ENTITY_REFERENCE: 0x10,
    SHOW_ENTITY: 0x20,
    SHOW_PROCESSING_INSTRUCTION: 0x40,
    SHOW_COMMENT: 0x80,
    SHOW_DOCUMENT: 0x100,
    SHOW_DOCUMENT_TYPE: 0x200,
    SHOW_DOCUMENT_FRAGMENT: 0x400,
    SHOW_NOTATION: 0x800,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  };

  function __inDocumentOrder(root) {
    const out = [];
    const kidsOf = (n) => {
      if (n === document) return [document.documentElement].filter(Boolean);
      return n && n.childNodes ? Array.prototype.slice.call(n.childNodes) : [];
    };
    (function walk(n) {
      if (!n) return;
      out.push(n);
      for (const k of kidsOf(n)) walk(k);
    })(root);
    return out;
  }

  function __accepts(node, show, filter) {
    const t = node === document ? 9 : node.nodeType || 1;
    if (!(show & (1 << (t - 1)))) return false;
    if (!filter) return true;
    const verdict =
      typeof filter === 'function' ? filter(node) : filter.acceptNode ? filter.acceptNode(node) : 1;
    return verdict === 1;
  }

  document.createNodeIterator = function createNodeIterator(root, whatToShow, filter) {
    const show = whatToShow === undefined ? 0xffffffff : whatToShow >>> 0;
    const nodes = __inDocumentOrder(root).filter((n) => __accepts(n, show, filter));
    let i = 0;
    return {
      root,
      whatToShow: show,
      filter: filter || null,
      referenceNode: root,
      pointerBeforeReferenceNode: true,
      nextNode() {
        if (i >= nodes.length) return null;
        this.referenceNode = nodes[i];
        this.pointerBeforeReferenceNode = false;
        return nodes[i++];
      },
      previousNode() {
        if (i <= 0) return null;
        this.referenceNode = nodes[--i];
        return nodes[i];
      },
      detach() {},
    };
  };

  documentElement.parentNode = document;

  (function () {
    const constants = {
      ELEMENT_NODE: 1,
      ATTRIBUTE_NODE: 2,
      TEXT_NODE: 3,
      CDATA_SECTION_NODE: 4,
      ENTITY_REFERENCE_NODE: 5,
      ENTITY_NODE: 6,
      PROCESSING_INSTRUCTION_NODE: 7,
      COMMENT_NODE: 8,
      DOCUMENT_NODE: 9,
      DOCUMENT_TYPE_NODE: 10,
      DOCUMENT_FRAGMENT_NODE: 11,
      NOTATION_NODE: 12,
      DOCUMENT_POSITION_DISCONNECTED: 1,
      DOCUMENT_POSITION_PRECEDING: 2,
      DOCUMENT_POSITION_FOLLOWING: 4,
      DOCUMENT_POSITION_CONTAINS: 8,
      DOCUMENT_POSITION_CONTAINED_BY: 16,
      DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
    };
    for (const name of Object.keys(constants)) {
      if (document[name] === undefined) {
        Object.defineProperty(document, name, { value: constants[name], enumerable: true });
      }
    }

    const collection = (tag) => ({
      get length() {
        return document.getElementsByTagName(tag).length;
      },
      item(i) {
        return document.getElementsByTagName(tag)[i] || null;
      },
      namedItem() {
        return null;
      },
    });
    const live = {
      anchors: collection('a'),
      forms: collection('form'),
      images: collection('img'),
      links: collection('a'),
      scripts: collection('script'),
      embeds: collection('embed'),
      plugins: collection('embed'),
      applets: collection('applet'),
    };
    for (const name of Object.keys(live)) {
      if (document[name] === undefined) document[name] = live[name];
    }

    const extras = {
      designMode: 'off',
      dir: '',
      doctype: { name: 'html', publicId: '', systemId: '', nodeType: 10, nodeName: 'html' },
      fullscreenEnabled: true,
      fullscreenElement: null,
      pictureInPictureEnabled: true,
      pictureInPictureElement: null,
      pointerLockElement: null,
      scrollingElement: documentElement,
      onreadystatechange: null,
    };
    for (const on of [
      'click',
      'dblclick',
      'mousedown',
      'mouseup',
      'mousemove',
      'mouseover',
      'mouseout',
      'mouseenter',
      'mouseleave',
      'wheel',
      'contextmenu',
      'pointerdown',
      'pointerup',
      'pointermove',
      'pointerover',
      'pointerout',
      'pointerenter',
      'pointerleave',
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture',
      'keydown',
      'keyup',
      'keypress',
      'touchstart',
      'touchend',
      'touchmove',
      'touchcancel',
      'scroll',
      'scrollend',
      'selectionchange',
      'select',
      'input',
      'change',
      'submit',
      'reset',
      'focus',
      'blur',
      'focusin',
      'focusout',
      'copy',
      'cut',
      'paste',
      'drag',
      'dragstart',
      'dragend',
      'dragenter',
      'dragleave',
      'dragover',
      'drop',
      'visibilitychange',
      'fullscreenchange',
      'fullscreenerror',
      'animationstart',
      'animationend',
      'animationiteration',
      'transitionstart',
      'transitionend',
      'transitionrun',
      'transitioncancel',
      'load',
      'error',
      'abort',
      'securitypolicyviolation',
    ]) {
      if (document['on' + on] === undefined) document['on' + on] = null;
    }
    if (document.childElementCount === undefined) document.childElementCount = 1;
    if (document.activeElement === undefined) document.activeElement = body;
    for (const name of Object.keys(extras)) {
      if (document[name] === undefined) document[name] = extras[name];
    }
  })();

  globalThis.__DOCUMENT = document;
})();
