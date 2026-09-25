(function () {
  const __SELF = new WeakMap();

  if (!('__ACTIVE_SCRIPT_URL' in globalThis)) {
    globalThis.__ACTIVE_SCRIPT_URL = undefined;
  }

  function __compound(el, sel) {
    if (!el || el.nodeType !== 1) return false;
    if (sel === '*' || sel === '') return true;
    const re = /([#.]?[\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?|\*)/g;
    let m;
    while ((m = re.exec(sel))) {
      const tok = m[1];
      if (tok === '*') continue;
      const c = tok.charAt(0);
      if (c === '#') {
        if (el.id !== tok.slice(1)) return false;
      } else if (c === '.') {
        if (!(el.classList && el.classList.contains(tok.slice(1)))) return false;
      } else if (c === '[') {
        const body = tok.slice(1, -1);
        const am = /^([\w-]+)(?:([*^$~|]?=)\s*"?([^"\]]*)"?)?$/.exec(body);
        if (!am) return false;
        let have = el.getAttribute ? el.getAttribute(am[1]) : null;
        if (have === null || have === undefined) have = el[am[1]];
        if (have === null || have === undefined) return false;
        if (!am[2]) continue;
        have = String(have);
        const want = am[3];
        if (am[2] === '=' && have !== want) return false;
        if (am[2] === '*=' && have.indexOf(want) < 0) return false;
        if (am[2] === '^=' && have.slice(0, want.length) !== want) return false;
        if (am[2] === '$=' && have.slice(-want.length) !== want) return false;
        if (am[2] === '~=' && have.split(/\s+/).indexOf(want) < 0) return false;
        if (am[2] === '|=' && have !== want && have.slice(0, want.length + 1) !== want + '-') {
          return false;
        }
      } else if (c === ':') {
        const pm = /^:([\w-]+)(?:\((.*)\))?$/.exec(tok);
        if (!pm) return false;
        const name = pm[1];
        const arg = pm[2];
        const sibs = (el.parentNode && el.parentNode.children) || [];
        const idx = Array.prototype.indexOf.call(sibs, el);
        if (name === 'not') {
          if (__matchesOne(el, arg)) return false;
        } else if (name === 'first-child') {
          if (idx !== 0) return false;
        } else if (name === 'last-child') {
          if (idx !== sibs.length - 1) return false;
        } else if (name === 'only-child') {
          if (sibs.length !== 1) return false;
        } else if (name === 'nth-child') {
          const a = String(arg).trim();
          if (a === 'odd') {
            if (idx % 2 !== 0) return false;
          } else if (a === 'even') {
            if (idx % 2 !== 1) return false;
          } else if (/^\d+$/.test(a)) {
            if (idx !== parseInt(a, 10) - 1) return false;
          }
        } else if (name === 'root') {
          if (el !== globalThis.document.documentElement) return false;
        } else if (name === 'empty') {
          if (el.childNodes && el.childNodes.length) return false;
        } else if (name === 'checked' || name === 'disabled' || name === 'required') {
          if (!el[name]) return false;
        }
        // Anything else (:hover, :focus, ...) is false in a page nobody touched.
        else if (name === 'hover' || name === 'focus' || name === 'active') return false;
      } else if (el.tagName !== tok.toUpperCase()) {
        return false;
      }
    }
    return true;
  }

  // One complex selector: compounds joined by combinators, matched right to left.
  function __matchesOne(el, sel) {
    const text = String(sel).trim();
    if (!text) return false;
    const parts = [];
    let buf = '';
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
        if (buf) parts.push(buf);
        buf = '';
        if (ch !== ' ') parts.push(ch);
        else if (parts.length && parts[parts.length - 1] !== ' ') parts.push(' ');
        continue;
      }
      buf += ch;
    }
    if (buf) parts.push(buf);
    // Trim any combinator that ended up adjacent to another.
    const seq = parts.filter((p, i) => !(p === ' ' && (i === 0 || /^[>+~]$/.test(parts[i - 1]))));
    let node = el;
    let i = seq.length - 1;
    if (i < 0 || !__compound(node, seq[i])) return false;
    i--;
    while (i >= 0) {
      const comb = seq[i];
      const target = seq[i - 1];
      if (target === undefined) return false;
      if (comb === '>') {
        node = node.parentNode;
        if (!node || !__compound(node, target)) return false;
      } else if (comb === ' ') {
        let n = node.parentNode;
        let found = null;
        while (n && n.nodeType === 1) {
          if (__compound(n, target)) {
            found = n;
            break;
          }
          n = n.parentNode;
        }
        if (!found) return false;
        node = found;
      } else if (comb === '+' || comb === '~') {
        const sibs = (node.parentNode && node.parentNode.children) || [];
        const at = Array.prototype.indexOf.call(sibs, node);
        let found = null;
        if (comb === '+') {
          if (at > 0 && __compound(sibs[at - 1], target)) found = sibs[at - 1];
        } else {
          for (let k = at - 1; k >= 0; k--) {
            if (__compound(sibs[k], target)) {
              found = sibs[k];
              break;
            }
          }
        }
        if (!found) return false;
        node = found;
      } else {
        return false;
      }
      i -= 2;
    }
    return true;
  }

  globalThis.__matches = function __matches(el, sel) {
    const text = String(sel).trim();
    if (!text) return false;
    // A selector list: any one of them matching is a match.
    const list = [];
    let buf = '';
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) {
        list.push(buf);
        buf = '';
        continue;
      }
      buf += ch;
    }
    list.push(buf);
    try {
      for (const one of list) {
        if (one.trim() && __matchesOne(el, one)) return true;
      }
      return false;
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

  globalThis.__notifyMutation = function __notifyMutation(target, record) {
    const list = globalThis.__MUTATION_OBSERVERS;
    if (!list || !list.length) return;
    for (const reg of list.slice()) {
      let match = reg.target === target;
      if (!match && reg.options && reg.options.subtree) {
        for (let n = target, hops = 0; n && hops < 256; n = n.parentNode, hops++) {
          if (n === reg.target) {
            match = true;
            break;
          }
        }
      }
      if (!match) continue;
      const o = reg.options || {};
      if (record.type === 'childList' && !o.childList) continue;
      if (record.type === 'attributes' && !o.attributes) continue;
      if (record.type === 'characterData' && !o.characterData) continue;
      const full = Object.assign(
        {
          type: record.type,
          target,
          addedNodes: [],
          removedNodes: [],
          previousSibling: null,
          nextSibling: null,
          attributeName: null,
          attributeNamespace: null,
          oldValue: null,
        },
        record,
      );
      reg.observer._records.push(full);
      if (reg.observer.__queued) continue;
      reg.observer.__queued = true;
      const fire = () => {
        reg.observer.__queued = false;
        const recs = reg.observer._records;
        reg.observer._records = [];
        if (!recs.length) return;
        try {
          reg.cb.call(reg.observer, recs, reg.observer);
        } catch (e) {}
      };
      try {
        typeof queueMicrotask === 'function' ? queueMicrotask(fire) : setTimeout(fire, 0);
      } catch (e) {
        try {
          setTimeout(fire, 0);
        } catch (e2) {}
      }
    }
  };

  // Only the target used to hear an event: nothing bubbled, target and
  // currentTarget were never moved along the path, preventDefault did nothing
  // and `{once: true}` fired every time.
  globalThis.__dispatch = function __dispatch(target, ev) {
    if (!ev) return true;
    const read = globalThis.__evRead;
    const patch = globalThis.__evPatch;
    const d = read ? read(ev) : null;
    const type = (d ? d.type : ev.type) || '';
    const bubbles = d ? d.bubbles : ev.bubbles;
    const path = [];
    for (let n = target, hops = 0; n && hops < 256; n = n.parentNode, hops++) path.push(n);
    if (globalThis.document) {
      if (path.indexOf(globalThis.document) < 0) path.push(globalThis.document);
      if (path.indexOf(globalThis) < 0) path.push(globalThis);
    }
    if (patch) patch(ev, { target, __path: path.slice(), eventPhase: 2, __stop: false });
    else {
      try {
        ev.target = target;
      } catch (e) {}
    }
    const chain = bubbles ? path : [target];
    for (const node of chain) {
      if (patch) patch(ev, { currentTarget: node, eventPhase: node === target ? 2 : 3 });
      else {
        try {
          ev.currentTarget = node;
        } catch (e) {}
      }
      try {
        const on = node['on' + type];
        if (typeof on === 'function') on.call(node, ev);
      } catch (e) {}
      const list = ((node.__handlers && node.__handlers[type]) || []).slice();
      for (const f of list) {
        try {
          const fn = typeof f === 'function' ? f : f && f.handleEvent;
          if (typeof fn === 'function') fn.call(typeof f === 'function' ? node : f, ev);
        } catch (e) {}
        if (f && f.__once) {
          const cur = node.__handlers && node.__handlers[type];
          if (cur) {
            const at = cur.indexOf(f);
            if (at >= 0) cur.splice(at, 1);
          }
        }
        const st = read ? read(ev) : null;
        if (st && st.__stopNow) break;
      }
      const st = read ? read(ev) : null;
      if (st && st.__stop) break;
    }
    if (patch) patch(ev, { currentTarget: null, eventPhase: 0 });
    const fin = read ? read(ev) : null;
    return !(fin && fin.defaultPrevented);
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

  globalThis.__collection = function __collection(arr, tag) {
    const items = Array.prototype.slice.call(arr || []);
    const C = globalThis[tag];
    const list = Object.create((C && C.prototype) || Object.prototype);
    for (let i = 0; i < items.length; i++) {
      Object.defineProperty(list, i, { value: items[i], enumerable: true, configurable: true });
    }
    const own = (k, v) => Object.defineProperty(list, k, { value: v, configurable: true });
    own('length', items.length);
    own('item', (i) => items[i >>> 0] || null);
    if (tag === 'HTMLCollection') {
      own('namedItem', (n) => items.find((e) => e && (e.id === n || e.name === n)) || null);
    } else {
      own('forEach', function (cb, thisArg) {
        for (let i = 0; i < items.length; i++) cb.call(thisArg, items[i], i, list);
      });
      own('entries', function* () {
        for (let i = 0; i < items.length; i++) yield [i, items[i]];
      });
      own('keys', function* () {
        for (let i = 0; i < items.length; i++) yield i;
      });
      own('values', function* () {
        for (const v of items) yield v;
      });
    }
    own(Symbol.iterator, function* () {
      for (const v of items) yield v;
    });
    // If the interface prototype does not carry the brand, stamp it directly so
    // `Object.prototype.toString.call` still names it.
    try {
      if (Object.prototype.toString.call(list) === '[object Object]') {
        Object.defineProperty(list, Symbol.toStringTag, { value: tag, configurable: true });
      }
    } catch (e) {}
    return list;
  };

  const __CSS_NAMED_COLORS = new Set(
    (
      'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
      'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
      'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
      'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
      'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
      'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
      'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
      'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
      'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
      'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
      'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
      'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
      'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
      'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
      'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
      'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
      'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
      'yellowgreen transparent currentcolor'
    ).split(/\s+/),
  );
  const __CSS_COLOR_PROPS = new Set([
    'color',
    'background-color',
    'border-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'outline-color',
    'text-decoration-color',
    'caret-color',
    'column-rule-color',
    'text-emphasis-color',
    'fill',
    'stroke',
    'stop-color',
    'flood-color',
    'lighting-color',
    '-webkit-text-fill-color',
    '-webkit-text-stroke-color',
  ]);
  const __CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
  const __alphaStr = (a01) => {
    const byte = Math.round(a01 * 255);
    for (let d = 1; d <= 3; d++) {
      const t = a01.toFixed(d);
      if (Math.round(parseFloat(t) * 255) === byte) return String(+t);
    }
    return String(+a01.toFixed(3));
  };
  const __rgbOut = (r, g, b, a) =>
    a === undefined || a >= 1
      ? `rgb(${r}, ${g}, ${b})`
      : `rgba(${r}, ${g}, ${b}, ${__alphaStr(Math.max(0, Math.min(1, a)))})`;
  const __hslToRgb = (h, s, l) => {
    h = (((h % 360) + 360) % 360) / 360;
    s /= 100;
    l /= 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  };
  const __CSS_SYSTEM_COLORS = {
    activeborder: [255, 255, 255],
    activecaption: [204, 204, 204],
    activetext: [255, 0, 0],
    appworkspace: [255, 255, 255],
    background: [99, 99, 206],
    buttonborder: [118, 118, 118],
    buttonface: [239, 239, 239],
    buttonhighlight: [221, 221, 221],
    buttonshadow: [136, 136, 136],
    buttontext: [0, 0, 0],
    canvas: [255, 255, 255],
    canvastext: [0, 0, 0],
    captiontext: [0, 0, 0],
    field: [255, 255, 255],
    fieldtext: [0, 0, 0],
    graytext: [128, 128, 128],
    highlight: [181, 213, 255],
    highlighttext: [0, 0, 0],
    inactiveborder: [255, 255, 255],
    inactivecaption: [255, 255, 255],
    inactivecaptiontext: [0, 0, 0],
    infobackground: [251, 252, 197],
    infotext: [0, 0, 0],
    linktext: [0, 0, 238],
    mark: [255, 255, 0],
    marktext: [0, 0, 0],
    menu: [247, 247, 247],
    menutext: [0, 0, 0],
    scrollbar: [255, 255, 255],
    threeddarkshadow: [102, 102, 102],
    threedface: [239, 239, 239],
    threedhighlight: [221, 221, 221],
    threedlightshadow: [192, 192, 192],
    threedshadow: [136, 136, 136],
    visitedtext: [85, 26, 139],
    window: [255, 255, 255],
    windowframe: [204, 204, 204],
    windowtext: [0, 0, 0],
    selecteditem: [181, 213, 255],
    selecteditemtext: [0, 0, 0],
    accentcolor: [0, 103, 244],
    accentcolortext: [255, 255, 255],
  };
  globalThis.__cssColorNorm = function __cssColorNorm(v) {
    const s = String(v).trim();
    const low = s.toLowerCase();
    if (__CSS_WIDE.has(low)) return low;
    if (Object.prototype.hasOwnProperty.call(__CSS_SYSTEM_COLORS, low)) {
      const c = __CSS_SYSTEM_COLORS[low];
      return __rgbOut(c[0], c[1], c[2]);
    }
    if (__CSS_NAMED_COLORS.has(low)) return low;
    let m = /^#([0-9a-fA-F]+)$/.exec(s);
    if (m) {
      const x = m[1];
      if (x.length !== 3 && x.length !== 4 && x.length !== 6 && x.length !== 8) return null;
      const short = x.length <= 4;
      const at = (i) => parseInt(short ? x[i] + x[i] : x.substr(i * 2, 2), 16);
      const hasA = x.length === 4 || x.length === 8;
      return __rgbOut(at(0), at(1), at(2), hasA ? at(3) / 255 : undefined);
    }
    m = /^rgba?\(([^)]*)\)$/i.exec(s);
    if (m) {
      const raw = m[1]
        .trim()
        .split(/[\s,\/]+/)
        .filter((p) => p !== '');
      if (raw.length < 3) return null;
      const chan = (t) =>
        /%$/.test(t) ? Math.round((parseFloat(t) / 100) * 255) : Math.round(parseFloat(t));
      const r = chan(raw[0]);
      const g = chan(raw[1]);
      const b = chan(raw[2]);
      if ([r, g, b].some((n) => isNaN(n))) return null;
      let a;
      if (raw.length >= 4) {
        a = /%$/.test(raw[3]) ? parseFloat(raw[3]) / 100 : parseFloat(raw[3]);
        if (isNaN(a)) return null;
      }
      return __rgbOut(r, g, b, a);
    }
    // Legacy hsl/hsla serialise as rgb in a browser.
    m = /^hsla?\(([^)]*)\)$/i.exec(s);
    if (m) {
      const raw = m[1]
        .trim()
        .split(/[\s,\/]+/)
        .filter((p) => p !== '');
      if (raw.length < 3) return null;
      const h = parseFloat(raw[0]);
      const sat = parseFloat(raw[1]);
      const lit = parseFloat(raw[2]);
      if ([h, sat, lit].some((n) => isNaN(n))) return null;
      const rgb = __hslToRgb(h, sat, lit);
      let a;
      if (raw.length >= 4) {
        a = /%$/.test(raw[3]) ? parseFloat(raw[3]) / 100 : parseFloat(raw[3]);
        if (isNaN(a)) return null;
      }
      return __rgbOut(rgb[0], rgb[1], rgb[2], a);
    }
    // The modern colour functions keep their own syntax.
    if (/^(hwb|lab|lch|oklab|oklch|color)\(/i.test(low)) return s;
    return null;
  };

  globalThis.__requireNode = function __requireNode(c, method, parent) {
    if (!c || typeof c !== 'object' || typeof c.nodeType !== 'number') {
      throw new TypeError(
        `Failed to execute '${method}' on 'Node': parameter 1 is not of type 'Node'.`,
      );
    }
    for (let n = parent, hops = 0; n && hops < 512; n = n.parentNode, hops++) {
      if (n === c) {
        throw new (globalThis.DOMException || Error)(
          `Failed to execute '${method}' on 'Node': The new child element contains the parent.`,
          'HierarchyRequestError',
        );
      }
    }
  };

  globalThis.__brandNode = function __brandNode(node, iface) {
    try {
      const C = globalThis[iface];
      if (C && C.prototype) Object.setPrototypeOf(node, C.prototype);
    } catch (e) {}
    return node;
  };

  globalThis.__LISTENERS = { window: {}, document: {} };
  globalThis.__listenerFactory = listenerFactory;
  function listenerFactory(bucket) {
    return {
      add(type, fn) {
        if (typeof fn !== 'function' && !(fn && typeof fn.handleEvent === 'function')) return;
        ((globalThis.__LISTENERS[bucket] ||= {})[type] ||= []).push(fn);
      },
      remove(type, fn) {
        const bkt = globalThis.__LISTENERS[bucket];
        const l = bkt && bkt[type];
        if (l) {
          const i = l.indexOf(fn);
          if (i >= 0) l.splice(i, 1);
        }
      },
    };
  }
  globalThis.__fire = function (bucket, type, extra) {
    const l = (globalThis.__LISTENERS[bucket][type] || []).slice();
    let ev;
    if (extra && globalThis.Event && extra instanceof globalThis.Event) {
      ev = extra;
    } else {
      ev = Object.assign(
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
    }
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

  function __tag(o, ctorName) {
    try {
      const C = globalThis[ctorName];
      if (o && typeof C === 'function' && C.prototype && Object.getPrototypeOf(o) !== C.prototype) {
        Object.setPrototypeOf(o, C.prototype);
      }
    } catch (e) {}
    return o;
  }

  function __boxRect(b) {
    // Coerce to numbers: an undefined width/height (an element veri never laid
    // out) would otherwise make the sensor's arithmetic on the rect NaN, and a
    // real DOMRect field is always a number.
    const w = +(b && b.width) || 0;
    const h = +(b && b.height) || 0;
    return __tag(
      {
        x: 0,
        y: 0,
        width: w,
        height: h,
        top: 0,
        left: 0,
        right: w,
        bottom: h,
      },
      'DOMRect',
    );
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

  const __CURVE_STEPS = 256;

  function __pathPoints(d) {
    const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
    const toks = [];
    let m;
    while ((m = re.exec(String(d == null ? '' : d))))
      toks.push(m[1] === undefined ? parseFloat(m[2]) : m[1]);
    const pts = [];
    let i = 0;
    let cmd = '';
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let cx = 0;
    let cy = 0;
    const n = () => {
      const v = toks[i++];
      return typeof v === 'number' ? v : 0;
    };
    const move = (nx, ny) => {
      x = nx;
      y = ny;
      pts.push([x, y, true]);
    };
    const line = (nx, ny) => {
      x = nx;
      y = ny;
      pts.push([x, y, false]);
    };
    const cubic = (x1, y1, x2, y2, x3, y3) => {
      const ax = x;
      const ay = y;
      for (let s = 1; s <= __CURVE_STEPS; s++) {
        const t = s / __CURVE_STEPS;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const e = t * t * t;
        pts.push([a * ax + b * x1 + c * x2 + e * x3, a * ay + b * y1 + c * y2 + e * y3, false]);
      }
      cx = x2;
      cy = y2;
      x = x3;
      y = y3;
    };
    const quad = (x1, y1, x2, y2) => {
      const ax = x;
      const ay = y;
      for (let s = 1; s <= __CURVE_STEPS; s++) {
        const t = s / __CURVE_STEPS;
        const u = 1 - t;
        pts.push([
          u * u * ax + 2 * u * t * x1 + t * t * x2,
          u * u * ay + 2 * u * t * y1 + t * t * y2,
          false,
        ]);
      }
      cx = x1;
      cy = y1;
      x = x2;
      y = y2;
    };
    const arc = (rx, ry, rot, large, sweep, ex, ey) => {
      const x0 = x;
      const y0 = y;
      if (!rx || !ry || (x0 === ex && y0 === ey)) return line(ex, ey);
      rx = Math.abs(rx);
      ry = Math.abs(ry);
      const phi = (rot * Math.PI) / 180;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const dx2 = (x0 - ex) / 2;
      const dy2 = (y0 - ey) / 2;
      const x1p = cosP * dx2 + sinP * dy2;
      const y1p = -sinP * dx2 + cosP * dy2;
      let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
      if (lam > 1) {
        const s = Math.sqrt(lam);
        rx *= s;
        ry *= s;
      }
      const sign = large === sweep ? -1 : 1;
      let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
      const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
      if (num < 0) num = 0;
      const co = sign * Math.sqrt(den === 0 ? 0 : num / den);
      const cxp = (co * rx * y1p) / ry;
      const cyp = (-co * ry * x1p) / rx;
      const ccx = cosP * cxp - sinP * cyp + (x0 + ex) / 2;
      const ccy = sinP * cxp + cosP * cyp + (y0 + ey) / 2;
      const ang = (ux, uy, vx, vy) => {
        const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        let c = d === 0 ? 0 : (ux * vx + uy * vy) / d;
        c = c > 1 ? 1 : c < -1 ? -1 : c;
        return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(c);
      };
      const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
      let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
      if (!sweep && dt > 0) dt -= 2 * Math.PI;
      else if (sweep && dt < 0) dt += 2 * Math.PI;
      for (let s = 1; s <= __CURVE_STEPS; s++) {
        const t = t1 + (dt * s) / __CURVE_STEPS;
        const px2 = Math.cos(t) * rx;
        const py2 = Math.sin(t) * ry;
        pts.push([ccx + cosP * px2 - sinP * py2, ccy + sinP * px2 + cosP * py2, false]);
      }
      x = ex;
      y = ey;
    };

    while (i < toks.length) {
      if (typeof toks[i] === 'string') cmd = toks[i++];
      else if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';
      const rel = cmd >= 'a';
      const bx = rel ? x : 0;
      const by = rel ? y : 0;
      switch (cmd.toUpperCase()) {
        case 'M':
          move(bx + n(), by + n());
          sx = x;
          sy = y;
          cx = x;
          cy = y;
          break;
        case 'L':
          line(bx + n(), by + n());
          cx = x;
          cy = y;
          break;
        case 'H':
          line(bx + n(), y);
          cx = x;
          cy = y;
          break;
        case 'V':
          line(x, by + n());
          cx = x;
          cy = y;
          break;
        case 'C':
          cubic(bx + n(), by + n(), bx + n(), by + n(), bx + n(), by + n());
          break;
        case 'S':
          cubic(2 * x - cx, 2 * y - cy, bx + n(), by + n(), bx + n(), by + n());
          break;
        case 'Q':
          quad(bx + n(), by + n(), bx + n(), by + n());
          break;
        case 'T':
          quad(2 * x - cx, 2 * y - cy, bx + n(), by + n());
          break;
        case 'A':
          arc(n(), n(), n(), n(), n(), bx + n(), by + n());
          cx = x;
          cy = y;
          break;
        case 'Z':
          line(sx, sy);
          cx = x;
          cy = y;
          break;
        default:
          i++;
      }
      if (i >= toks.length) break;
    }
    return pts;
  }

  function __pathLength(d) {
    const p = __pathPoints(d);
    let total = 0;
    for (let i = 1; i < p.length; i++) {
      if (p[i][2]) continue;
      total += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    }
    return total;
  }

  function __pathPointAt(d, want) {
    const p = __pathPoints(d);
    if (!p.length) return { x: 0, y: 0 };
    let run = 0;
    const target = Number(want) || 0;
    for (let i = 1; i < p.length; i++) {
      if (p[i][2]) continue;
      const seg = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (run + seg >= target && seg > 0) {
        const f = (target - run) / seg;
        return {
          x: p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f,
          y: p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f,
        };
      }
      run += seg;
    }
    const last = p[p.length - 1];
    return { x: last[0], y: last[1] };
  }

  const __SVG_TAGS = {
    svg: 'SVGSVGElement',
    path: 'SVGPathElement',
    rect: 'SVGRectElement',
    circle: 'SVGCircleElement',
    ellipse: 'SVGEllipseElement',
    line: 'SVGLineElement',
    polyline: 'SVGPolylineElement',
    polygon: 'SVGPolygonElement',
    g: 'SVGGElement',
    text: 'SVGTextElement',
    tspan: 'SVGTSpanElement',
    defs: 'SVGDefsElement',
    use: 'SVGUseElement',
    image: 'SVGImageElement',
    filter: 'SVGFilterElement',
    lineargradient: 'SVGLinearGradientElement',
    radialgradient: 'SVGRadialGradientElement',
    stop: 'SVGStopElement',
    clippath: 'SVGClipPathElement',
    mask: 'SVGMaskElement',
    marker: 'SVGMarkerElement',
    symbol: 'SVGSymbolElement',
    pattern: 'SVGPatternElement',
    foreignobject: 'SVGForeignObjectElement',
    textpath: 'SVGTextPathElement',
    desc: 'SVGDescElement',
    title: 'SVGTitleElement',
  };

  function makeSvgElement(tag) {
    const el = makeElement(tag);
    el.tagName = String(tag);
    el.nodeName = String(tag);
    el.namespaceURI = SVG_NS;
    const lower = String(tag).toLowerCase();
    if (lower === 'path') {
      el.getTotalLength = function getTotalLength() {
        return __pathLength(this.getAttribute('d'));
      };
      el.getPointAtLength = function getPointAtLength(len) {
        const p = __pathPointAt(this.getAttribute('d'), len);
        return __tag(p, 'DOMPoint');
      };
    }

    // SVGRect carries its numbers on the prototype, so JSON.stringify of one is
    // `{}` - own enumerable properties would show the values instead.
    const rect = (x, y, w, h) => {
      const r = {};
      const put = (k, v) =>
        Object.defineProperty(r, k, {
          value: v,
          enumerable: false,
          writable: true,
          configurable: true,
        });
      put('x', x);
      put('y', y);
      put('width', w);
      put('height', h);
      return __tag(r, 'SVGRect');
    };
    el.getBBox = function getBBox() {
      const pts = lower === 'path' ? __pathPoints(this.getAttribute('d')) : [];
      if (!pts.length) return rect(0, 0, 0, 0);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
      }
      return rect(x0, y0, x1 - x0, y1 - y0);
    };
    __tag(el, __SVG_TAGS[lower] || 'SVGElement');
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
    __tag(el.classList, 'DOMTokenList');
    __tag(el.attributes, 'NamedNodeMap');

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
      const body = row.m || {};
      if (body.__portMsg) {
        if (globalThis.__portDeliver) {
          globalThis.__portDeliver(body.__portMsg.id, body.__portMsg.data);
        }
        continue;
      }
      const view = __frameWindow(el);
      const back = (id, payload) => {
        try {
          __HOST_FRAME_POST(row.i, JSON.stringify({ __portMsg: { id, data: payload } }));
        } catch (e) {}
      };
      const ev = __messageEvent(body.data, __frameOrigin(view, el), view);
      ev.ports = globalThis.__portsIn ? globalThis.__portsIn(body.__ports, back) : [];
      for (const p of ev.ports) p.start();
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
  globalThis.__postToFrame = function __postToFrame(el, data, origin, transfer) {
    const ctx = __FRAME_CTX.get(el);
    if (ctx !== undefined && typeof __HOST_FRAME_POST === 'function') {
      const toFrame = (id, payload) => {
        try {
          __HOST_FRAME_POST(ctx, JSON.stringify({ __portMsg: { id, data: payload } }));
        } catch (e) {}
      };
      const ports = globalThis.__portsOut ? globalThis.__portsOut(transfer, toFrame) : [];
      try {
        __HOST_FRAME_POST(ctx, JSON.stringify({ data, origin: __PAGE_ORIGIN(), __ports: ports }));
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

  // A message from a frame carries the *frame's* origin. Falling back to the
  // page's was wrong in a way a receiver checks: reCAPTCHA drops a setup message
  // whose origin is not its own, so the handshake never completed and the parent
  // never asked for a token. The element's src is the authority when the view
  // has not had its location assigned yet.
  function __frameOrigin(view, el) {
    try {
      const o = view && view.location && view.location.origin;
      if (o) return o;
    } catch (e) {}
    try {
      const raw = el && (el.src || el.getAttribute('src'));
      if (raw) return new globalThis.URL(String(raw), globalThis.location.href).origin;
    } catch (e) {}
    return __PAGE_ORIGIN();
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
      try {
        if (globalThis.__markNativeFn) __markNativeFn(copy);
        if (globalThis.__markNative) __markNative(copy);
      } catch (e) {}
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
    own.postMessage = (data, origin, transfer) => __postToFrame(el, data, origin, transfer);
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
      prefix: null,
      localName: T.toLowerCase(),
      ...(T === 'IFRAME' ? { srcdoc: '' } : {}),
      get ownerDocument() {
        return globalThis.document || null;
      },
      __style: (function () {
        const props = {};
        const priorities = {};
        const kebab = (k) => String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
        const norm = (k) => {
          const s = String(k);
          return s.slice(0, 2) === '--' ? s : kebab(s);
        };
        const isCss = (k) => {
          if (String(k).slice(0, 2) === '--') return true;
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
          setProperty(k, v, priority) {
            if (kebab(k) === 'font-family' && globalThis.__noteFont) {
              try {
                __noteFont(String(v));
              } catch (e) {}
            }
            if (!isCss(k)) return;
            const nk = norm(k);
            let val = String(v);
            if (__CSS_COLOR_PROPS.has(nk)) {
              const c = globalThis.__cssColorNorm(val);
              if (c === null) return; // an unparseable colour is dropped, not kept
              val = c;
            }
            props[nk] = val;
            if (/important/i.test(String(priority || ''))) priorities[nk] = 'important';
            else delete priorities[nk];
          },
          getPropertyValue(k) {
            return props[norm(k)] || '';
          },
          getPropertyPriority(k) {
            return priorities[norm(k)] || '';
          },
          removeProperty(k) {
            const nk = norm(k);
            const v = props[nk] || '';
            delete props[nk];
            delete priorities[nk];
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
              .map((k) => k + ': ' + props[k] + (priorities[k] ? ' !important' : '') + ';')
              .join(' ');
          },
          set cssText(v) {
            for (const key of Object.keys(props)) delete props[key];
            for (const key of Object.keys(priorities)) delete priorities[key];
            for (const decl of String(v).split(';')) {
              const at = decl.indexOf(':');
              if (at <= 0) continue;
              const k = decl.slice(0, at).trim();
              let value = decl.slice(at + 1).trim();
              let priority = '';
              const bang = /\s*!\s*important\s*$/i.exec(value);
              if (bang) {
                priority = 'important';
                value = value.slice(0, bang.index).trim();
              }
              // Same rule as setProperty: a declaration a browser cannot parse
              // is dropped, not kept.
              if (isCss(k)) {
                const nk = norm(k);
                let val = value;
                if (__CSS_COLOR_PROPS.has(nk)) {
                  const c = globalThis.__cssColorNorm(val);
                  if (c === null) continue; // unparseable colour is dropped, as in setProperty
                  val = c;
                }
                props[nk] = val;
                if (priority) priorities[nk] = 'important';
              }
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
              const nk = kebab(k);
              let val = String(v);
              if (__CSS_COLOR_PROPS.has(nk)) {
                const c = globalThis.__cssColorNorm(val);
                if (c === null) return true; // invalid colour: assignment is a no-op
                val = c;
              }
              props[nk] = val;
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
      // Was a static empty string, so a page reading an element's own markup got
      // nothing where a browser gives the serialised tag. The node serialiser
      // already exists; this just points it at the element itself.
      get outerHTML() {
        try {
          return __serializeNode(__SELF.get(this) || this);
        } catch (e) {
          return '';
        }
      },
      set outerHTML(html) {
        const parent = this.parentNode;
        if (!parent) return;
        try {
          const nodes = __parseHtml(String(html));
          const idx = parent.childNodes.indexOf(this);
          for (const n of nodes) {
            if (idx >= 0) parent.insertBefore(n, this);
            else parent.appendChild(n);
          }
          parent.removeChild(this);
        } catch (e) {}
      },
      textContent: '',
      value: '',
      // Reflected both ways. Assigning the property alone used to leave the
      // content attribute empty, so getAttribute('src') answered null on an
      // element that plainly had one.
      get src() {
        const raw = this.attributes.src;
        if (raw === undefined || raw === null || raw === '') return '';
        return __toAbsolute(raw);
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
        const had = this.attributes[k];
        this.attributes[k] = String(v);
        try {
          __notifyMutation(__SELF.get(this) || this, {
            type: 'attributes',
            attributeName: String(k),
            oldValue: had === undefined ? null : had,
          });
        } catch (e) {}
        if (k === 'id') this.id = String(v);
        if (k === 'class') this.className = String(v);
        if (k === 'src') {
          this.src = String(v);
          __maybeLoadScript(this);
          __maybeLoadFrame(this);
        }
        if (k === 'srcdoc' && this.tagName === 'IFRAME') {
          try {
            this.__srcdoc = String(v);
          } catch (e) {}
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
        // `style` reflects the live declaration: setting `el.style.color` must
        // show up in `getAttribute('style')`, which read the attribute map only.
        if (k === 'style') {
          const ct = this.__style ? this.__style.cssText : '';
          return ct || ('style' in this.attributes ? this.attributes.style : null);
        }
        return k in this.attributes ? this.attributes[k] : null;
      },
      removeAttribute(k) {
        delete this.attributes[k];
        if (k === 'style' && this.__style) this.__style.cssText = '';
      },
      hasAttribute(k) {
        if (k === 'style')
          return !!(this.__style && this.__style.length) || 'style' in this.attributes;
        return k in this.attributes;
      },
      getAttributeNames() {
        const names = Object.keys(this.attributes);
        if (this.__style && this.__style.length && names.indexOf('style') < 0) names.push('style');
        return names;
      },

      appendChild(c) {
        __requireNode(c, 'appendChild', this);
        {
          try {
            const owner = __SELF.get(this) || this;
            c.parentNode = owner;
            c.parentElement = owner;
          } catch (e) {}
        }
        this.childNodes.push(c);
        if (c && c.nodeType === 1) this.children.push(c);
        __maybeLoadScript(c);
        // A srcdoc iframe has no src to trigger loading, so it loads on connect,
        // the way a browser runs it once it is in the document. Without this an
        // anti-bot's in-frame collection never executes.
        try {
          if (c && c.tagName === 'IFRAME') __maybeLoadFrame(c);
        } catch (e) {}
        try {
          __notifyMutation(__SELF.get(this) || this, { type: 'childList', addedNodes: [c] });
        } catch (e) {}
        return c;
      },
      insertBefore(c, ref) {
        __requireNode(c, 'insertBefore', this);
        // A ref that is not null and not actually a child is a NotFoundError.
        if (ref != null && this.childNodes.indexOf(ref) < 0) {
          throw new (globalThis.DOMException || Error)(
            "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
            'NotFoundError',
          );
        }
        const i = ref ? this.childNodes.indexOf(ref) : -1;
        {
          try {
            const owner = __SELF.get(this) || this;
            c.parentNode = owner;
            c.parentElement = owner;
          } catch (e) {}
        }
        if (i >= 0) this.childNodes.splice(i, 0, c);
        else this.childNodes.push(c);
        if (c && c.nodeType === 1) this.children.push(c);
        __maybeLoadScript(c);
        try {
          if (c && c.tagName === 'IFRAME') __maybeLoadFrame(c);
        } catch (e) {}
        return c;
      },
      removeChild(c) {
        if (!c || typeof c !== 'object' || typeof c.nodeType !== 'number') {
          throw new TypeError(
            "Failed to execute 'removeChild' on 'Node': parameter 1 is not of type 'Node'.",
          );
        }
        const i = this.childNodes.indexOf(c);
        if (i < 0) {
          throw new (globalThis.DOMException || Error)(
            "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
            'NotFoundError',
          );
        }
        this.childNodes.splice(i, 1);
        const j = this.children.indexOf(c);
        if (j >= 0) this.children.splice(j, 1);
        try {
          __notifyMutation(__SELF.get(this) || this, { type: 'childList', removedNodes: [c] });
        } catch (e) {}
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
      cloneNode(deep) {
        const copy = makeElement(this.tagName ? this.tagName.toLowerCase() : tag);
        try {
          for (const name of this.getAttributeNames()) {
            copy.setAttribute(name, this.getAttribute(name));
          }
        } catch (e) {}
        if (deep) {
          for (const kid of (this.childNodes || []).slice()) {
            copy.appendChild(kid.cloneNode ? kid.cloneNode(true) : kid);
          }
        }
        return copy;
      },
      contains(n) {
        for (let x = n, hops = 0; x && hops < 512; x = x.parentNode, hops++) {
          if (x === this) return true;
        }
        return false;
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
      addEventListener(_t, _f, opts) {
        if (typeof _f !== 'function' && !(_f && typeof _f.handleEvent === 'function')) return;
        const all = this.__handlers || (this.__handlers = {});
        const list = all[_t] || (all[_t] = []);
        for (const e of list) if ((e.__origin || e) === _f) return;
        const once = opts === true ? false : !!(opts && opts.once);
        if (!once) {
          list.push(_f);
          return;
        }
        const entry =
          typeof _f === 'function'
            ? function (ev) {
                return _f.call(this, ev);
              }
            : { handleEvent: (ev) => _f.handleEvent(ev) };
        entry.__once = true;
        entry.__origin = _f;
        list.push(entry);
      },
      removeEventListener(_t, _f) {
        const l = this.__handlers && this.__handlers[_t];
        if (!l) return;
        for (let i = l.length - 1; i >= 0; i--) {
          if (l[i] === _f || l[i].__origin === _f) l.splice(i, 1);
        }
      },
      dispatchEvent(_e) {
        return __dispatch(__SELF.get(this) || this, _e);
      },
      get __box() {
        if (this.tagName === 'HTML') {
          return { width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 };
        }
        const isBody = this.tagName === 'BODY';
        const bodyWidth = () => Math.max(0, (globalThis.innerWidth || 0) - 16);
        let attached = false;
        for (let n = this; n; n = n.parentNode) {
          if (n === document.body || n === document.documentElement) {
            attached = true;
            break;
          }
        }
        const text = this.textContent || '';
        if (!attached || !text) return { width: isBody ? bodyWidth() : 0, height: 0 };
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
        return { width: isBody ? bodyWidth() : m.width, height: m.lineHeight };
      },
      get scrollWidth() {
        return Math.round(this.__box.width);
      },
      get scrollHeight() {
        return Math.round(this.__box.height);
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
      get scrollTop() {
        return 0;
      },
      set scrollTop(v) {},
      get scrollLeft() {
        return 0;
      },
      set scrollLeft(v) {},
      get clientTop() {
        return 0;
      },
      get clientLeft() {
        return 0;
      },
      get offsetTop() {
        return 0;
      },
      get offsetLeft() {
        return 0;
      },
      get tabIndex() {
        const t = this.attributes && this.attributes.tabindex;
        return t != null && t !== '' ? parseInt(t, 10) || 0 : -1;
      },
      set tabIndex(v) {
        this.attributes.tabindex = String(v);
      },
      getBoundingClientRect() {
        const r = __boxRect(this.__box);
        Object.defineProperty(r, 'toJSON', {
          value: function toJSON() {
            return {
              x: this.x,
              y: this.y,
              width: this.width,
              height: this.height,
              top: this.top,
              right: this.right,
              bottom: this.bottom,
              left: this.left,
            };
          },
          enumerable: false,
          writable: true,
          configurable: true,
        });
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
        return __collection(h.length ? h : __queryAll(sel), 'NodeList');
      },
      getElementsByTagName(tag) {
        const t = String(tag);
        return __collection(
          __queryWithin(this, t === '*' ? '*' : t.toLowerCase()),
          'HTMLCollection',
        );
      },
      getElementsByClassName(names) {
        const want = String(names).trim().split(/\s+/).filter(Boolean);
        return __collection(
          want.length ? __queryWithin(this, want.map((c) => '.' + c).join('')) : [],
          'HTMLCollection',
        );
      },
      closest(sel) {
        for (
          let n = this, hops = 0;
          n && n.nodeType === 1 && hops < 512;
          n = n.parentNode, hops++
        ) {
          if (__matches(n, sel)) return n;
        }
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
      insertAdjacentHTML(where, html) {
        const box = makeElement('div');
        box.innerHTML = String(html);
        const kids = (box.childNodes || []).slice();
        const w = String(where).toLowerCase();
        if (w === 'afterbegin') {
          for (let i = kids.length - 1; i >= 0; i--) {
            this.insertBefore(kids[i], this.childNodes[0] || null);
          }
        } else if (w === 'beforeend') {
          for (const k of kids) this.appendChild(k);
        } else if (this.parentNode) {
          const at = this.parentNode.childNodes.indexOf(this);
          const anchor = w === 'beforebegin' ? this : this.parentNode.childNodes[at + 1] || null;
          for (const k of kids) this.parentNode.insertBefore(k, anchor);
        }
      },
      insertAdjacentElement(_, e) {
        return e;
      },
      get innerHTML() {
        try {
          return __serializeChildren(__SELF.get(this) || this);
        } catch (e) {
          return this.__html || '';
        }
      },
      set innerHTML(html) {
        this.__html = String(html);
        this.childNodes = [];
        this.children = [];
        try {
          for (const child of __parseHtml(this.__html)) this.appendChild(child);
        } catch (e) {}
      },
      getContext(type, attrs) {
        return __makeContext(this, String(type), attrs);
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
      for (const k of Object.getOwnPropertyNames(el)) {
        if (k.charCodeAt(0) === 95 && k.charCodeAt(1) === 95) {
          try {
            const d = Object.getOwnPropertyDescriptor(el, k);
            if (d && d.enumerable && d.configurable) {
              d.enumerable = false;
              Object.defineProperty(el, k, d);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    __tag(el.classList, 'DOMTokenList');
    __tag(el.attributes, 'NamedNodeMap');
    try {
      // `dataset` read from its own empty target and never looked at the
      // element, `textContent` was a fixed empty string, and
      // `childElementCount` was a profile stand-in.
      const self = () => __SELF.get(el) || el;
      if (el.tagName === 'IFRAME') {
        Object.defineProperty(el, 'srcdoc', {
          get() {
            return el.__srcdoc || '';
          },
          set(v) {
            el.__srcdoc = String(v);
            try {
              __maybeLoadFrame(el);
            } catch (e) {}
          },
          enumerable: true,
          configurable: true,
        });
      }
      const dashed = (k) => 'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      Object.defineProperty(el, 'dataset', {
        value: new Proxy(
          {},
          {
            get(t, k) {
              if (typeof k === 'symbol') return Reflect.get(t, k);
              const v = self().getAttribute(dashed(k));
              return v === null ? undefined : v;
            },
            set(t, k, v) {
              self().setAttribute(dashed(k), String(v));
              return true;
            },
            has(t, k) {
              return typeof k === 'symbol' ? Reflect.has(t, k) : self().hasAttribute(dashed(k));
            },
            deleteProperty(t, k) {
              self().removeAttribute(dashed(k));
              return true;
            },
            ownKeys() {
              return self()
                .getAttributeNames()
                .filter((n) => n.indexOf('data-') === 0)
                .map((n) => n.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
            },
            getOwnPropertyDescriptor(t, k) {
              if (typeof k === 'symbol') return Reflect.getOwnPropertyDescriptor(t, k);
              const v = self().getAttribute(dashed(k));
              if (v === null) return undefined;
              return { value: v, writable: true, enumerable: true, configurable: true };
            },
          },
        ),
        enumerable: true,
        configurable: true,
      });
      const textOf = (n) => {
        if (!n) return '';
        if (n.nodeType === 3)
          return String(n.nodeValue === undefined ? n.textContent : n.nodeValue);
        let out = '';
        for (const k of n.childNodes || []) out += textOf(k);
        return out;
      };
      Object.defineProperty(el, 'textContent', {
        get() {
          return textOf(self());
        },
        set(v) {
          const me = self();
          me.childNodes = [];
          me.children = [];
          me.__html = '';
          if (String(v)) me.appendChild(globalThis.document.createTextNode(String(v)));
        },
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(el, 'childElementCount', {
        get() {
          return (self().children || []).length;
        },
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(el, 'innerText', {
        get() {
          return textOf(self());
        },
        set(v) {
          this.textContent = v;
        },
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(el, 'outerText', {
        get() {
          return textOf(self());
        },
        set(v) {
          this.textContent = v;
        },
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(el, 'localName', {
        get() {
          return String(self().tagName || 'div').toLowerCase();
        },
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(el, 'baseURI', {
        get() {
          try {
            return String(globalThis.location.href);
          } catch (e) {
            return '';
          }
        },
        enumerable: true,
        configurable: true,
      });
      // Detached or unlaid-out elements report null, which is what a browser
      // gives here; the stub returned a function.
      Object.defineProperty(el, 'offsetParent', {
        get() {
          return null;
        },
        enumerable: true,
        configurable: true,
      });
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
    if (T === 'IMG') {
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
            if (!href || /^data:/i.test(href)) return;
            try {
              if (typeof __HOST_FETCH === 'function') __HOST_FETCH('GET', __absolute(href), '');
            } catch (e) {}
            try {
              __fireOn(this, 'load');
            } catch (e) {}
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
    try {
      __SELF.set(el, wrapped);
    } catch (e) {}
    (globalThis.__ELEMENTS || (globalThis.__ELEMENTS = [])).push(wrapped);
    return wrapped;
  }
  const __VOID_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);
  const __escapeText = (t) =>
    String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const __escapeAttr = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  function __serializeNode(n) {
    if (!n) return '';
    if (n.nodeType === 3) {
      return __escapeText(n.nodeValue === undefined ? n.textContent : n.nodeValue);
    }
    if (n.nodeType === 8) return '<!--' + String(n.nodeValue || '') + '-->';
    if (n.nodeType !== 1) return '';
    const tag = String(n.tagName || 'div').toLowerCase();
    let out = '<' + tag;
    try {
      for (const name of n.getAttributeNames()) {
        out += ' ' + name + '="' + __escapeAttr(n.getAttribute(name)) + '"';
      }
    } catch (e) {}
    out += '>';
    if (__VOID_TAGS.has(tag)) return out;
    return out + __serializeChildren(n) + '</' + tag + '>';
  }
  function __serializeChildren(n) {
    let out = '';
    for (const k of (n && n.childNodes) || []) out += __serializeNode(k);
    return out;
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
      // A fragment keeps its text nodes - at the top level too, and including the
      // whitespace between siblings. The old `text.trim() && stack.length` gate
      // dropped both: `div.innerHTML = 'hello'` lost its only child, and every
      // read of the parsed content came back shorter than a browser's.
      if (text) {
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
    // Text after the last tag (or a fragment that is only text) was never
    // flushed, so trailing content vanished.
    const tail = html.slice(last);
    if (tail) {
      try {
        put(document.createTextNode(tail));
      } catch (e) {}
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
    // A document's node name is the literal '#document'; the stub made
    // `typeof document.nodeName` read 'function'.
    nodeName: '#document',
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
    getAnimations() {
      return [];
    },
    timeline: {
      get currentTime() {
        try {
          return globalThis.performance.now();
        } catch (e) {
          return 0;
        }
      },
      get duration() {
        return null;
      },
    },
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
    // `document.createRange()` did not exist, so anything that measured a text
    // run or read a selection threw on the first call.
    createRange: () => {
      const r = {
        startContainer: null,
        startOffset: 0,
        endContainer: null,
        endOffset: 0,
        collapsed: true,
        commonAncestorContainer: null,
        setStart(n, off) {
          this.startContainer = n;
          this.startOffset = off | 0;
          this.collapsed =
            this.startContainer === this.endContainer && this.startOffset === this.endOffset;
        },
        setEnd(n, off) {
          this.endContainer = n;
          this.endOffset = off | 0;
          this.collapsed =
            this.startContainer === this.endContainer && this.startOffset === this.endOffset;
        },
        selectNode(n) {
          this.startContainer = n && n.parentNode;
          this.endContainer = n && n.parentNode;
          this.commonAncestorContainer = n && n.parentNode;
          this.collapsed = false;
        },
        selectNodeContents(n) {
          this.startContainer = n;
          this.endContainer = n;
          this.commonAncestorContainer = n;
          this.startOffset = 0;
          this.endOffset = (n && n.childNodes && n.childNodes.length) || 0;
          this.collapsed = this.endOffset === 0;
        },
        collapse(toStart) {
          if (toStart) this.endContainer = this.startContainer;
          else this.startContainer = this.endContainer;
          this.collapsed = true;
        },
        cloneRange() {
          return globalThis.document.createRange();
        },
        detach() {},
        toString() {
          const n = this.commonAncestorContainer;
          return n && n.textContent ? String(n.textContent) : '';
        },
        getBoundingClientRect() {
          const n = this.commonAncestorContainer;
          return n && n.getBoundingClientRect
            ? n.getBoundingClientRect()
            : { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
        },
        getClientRects() {
          return [];
        },
        createContextualFragment(html) {
          const box = makeElement('div');
          box.innerHTML = String(html);
          return box;
        },
      };
      try {
        const C = globalThis.Range;
        if (typeof C === 'function' && C.prototype) Object.setPrototypeOf(r, C.prototype);
      } catch (e) {}
      return r;
    },
    createElementNS: (ns, t) => (ns === SVG_NS ? makeSvgElement(t) : makeElement(t)),
    createTextNode: (t) => {
      const value = String(t);
      const node = {
        nodeType: 3,
        nodeName: '#text',
        get ownerDocument() {
          return globalThis.document || null;
        },
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
      return __brandNode(node, 'Text');
    },
    // Was absent, so a page calling it got `undefined` and threw on the next
    // use. A comment is a leaf text-ish node with nodeType 8.
    createComment: (t) => {
      const value = String(t);
      const node = {
        nodeType: 8,
        nodeName: '#comment',
        get ownerDocument() {
          return globalThis.document || null;
        },
        data: value,
        nodeValue: value,
        textContent: value,
        length: value.length,
        parentNode: null,
        parentElement: null,
        childNodes: [],
        nextSibling: null,
        previousSibling: null,
      };
      return __brandNode(node, 'Comment');
    },
    createDocumentFragment: () => {
      const frag = makeElement('#fragment');
      try {
        frag.nodeType = 11;
        frag.nodeName = '#document-fragment';
        __brandNode(frag, 'DocumentFragment');
      } catch (e) {}
      return frag;
    },
    getElementById: (id) => {
      const all = globalThis.__ELEMENTS || [];
      for (let i = 0; i < all.length; i++) {
        try {
          if (all[i].id === id && __inDocument(all[i])) return all[i];
        } catch (e) {}
      }
      return null;
    },
    getElementsByTagName: (t) => {
      t = String(t).toLowerCase();
      const hc = (arr) => __collection(arr, 'HTMLCollection');
      if (t === 'head') return hc([head]);
      if (t === 'body') return hc([body]);
      // The registry holds every element ever created, so returning it whole
      // counted the ones a page built and never attached: 103 against a
      // browser's 11 on the same document.
      if (t === '*') return hc((globalThis.__ELEMENTS || []).filter((el) => __inDocument(el)));
      return hc(__queryAll(t));
    },
    // A live view of the document's script tags, which is how a collector that
    // hashes each script finds them.
    get scripts() {
      return __queryAll('script');
    },
    getElementsByClassName: (c) => {
      const want = String(c).trim().split(/\s+/).filter(Boolean);
      const matched = want.length
        ? (globalThis.__ELEMENTS || []).filter((el) => {
            try {
              return (
                want.every((w) => el.classList && el.classList.contains(w)) && __inDocument(el)
              );
            } catch (e) {
              return false;
            }
          })
        : [];
      return __collection(matched, 'HTMLCollection');
    },
    querySelector: (sel) => {
      const found = __queryAll(sel);
      if (found.length) return found[0];
      if (!/^[a-z0-9]+$/i.test(String(sel))) return null;
      return (document.__registry[sel] ||= makeElement(String(sel)));
    },
    querySelectorAll: (sel) => __collection(__queryAll(sel), 'NodeList'),
    hasFocus: () => true,
    visibilityState: 'visible',
    hidden: false,
    addEventListener: (t, f) => listenerFactory('document').add(t, f),
    removeEventListener: (t, f) => listenerFactory('document').remove(t, f),
    // Was a stub returning true, so a page dispatching its own event to the
    // document saw no listener run at all.
    dispatchEvent(event) {
      if (!event) return true;
      const type = String(event.type || '');
      if (!type) return true;
      try {
        globalThis.__defineOwn(event, 'target', globalThis.document);
        globalThis.__defineOwn(event, 'currentTarget', globalThis.document);
      } catch (e) {}
      __fire('document', type, event);
      return !event.defaultPrevented;
    },
    createEvent: (name) => {
      const want = String(name).toLowerCase();
      const SUPPORTED = {
        event: 'Event',
        events: 'Event',
        htmlevents: 'Event',
        customevent: 'CustomEvent',
        mouseevent: 'MouseEvent',
        mouseevents: 'MouseEvent',
        keyboardevent: 'KeyboardEvent',
        uievent: 'UIEvent',
        uievents: 'UIEvent',
        focusevent: 'FocusEvent',
        wheelevent: 'WheelEvent',
        dragevent: 'DragEvent',
        pointerevent: 'PointerEvent',
      };
      const ctorName = SUPPORTED[want];
      if (!ctorName) {
        throw new (globalThis.DOMException || Error)(
          `Failed to execute 'createEvent' on 'Document': The provided event type ('${name}') is invalid.`,
          'NotSupportedError',
        );
      }
      const C = globalThis[ctorName] || globalThis.Event;
      const ev = new C(want);
      ev.initEvent = function (type, bubbles, cancelable) {
        try {
          globalThis.__defineOwn(this, 'type', String(type));
          globalThis.__defineOwn(this, 'bubbles', !!bubbles);
          globalThis.__defineOwn(this, 'cancelable', !!cancelable);
        } catch (e) {}
      };
      return ev;
    },
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
      try {
        let abs = '';
        try { abs = el.src || __absolute(src); } catch (e) { abs = __absolute(src); }
        if (abs) globalThis.__NET.push({ kind: 'script', url: String(abs), __size: code.length });
      } catch (e) {}
      if (__diagOn()) {
        (globalThis.__SCRIPT_SOURCES || (globalThis.__SCRIPT_SOURCES = [])).push({
          src: String(src),
          code,
        });
      }
      if (r.status >= 200 && r.status < 400 && code) {
        const prev = globalThis.document.currentScript;
        globalThis.document.currentScript = el;
        // A real <script src> runs with the script's URL as its stack origin;
        // remember it so Error stacks report the src, not `<anonymous>`.
        const prevUrl = globalThis.__ACTIVE_SCRIPT_URL;
        globalThis.__ACTIVE_SCRIPT_URL = __absolute(src);
        try {
          __runInScope(code, globalThis.__ACTIVE_SCRIPT_URL);
        } catch (e) {
          __SCRIPTS_LOADED.push({ src: String(src), threw: String(e).slice(0, 140) });
        } finally {
          globalThis.document.currentScript = prev;
          globalThis.__ACTIVE_SCRIPT_URL = prevUrl;
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
    if (
      __FRAMES_LOADED.filter(
        (f) => f && f.status === 200 && f.bytes !== undefined && f.frameScript === undefined,
      ).length >= 12
    ) {
      return;
    }
    let src, srcdoc;
    try {
      src = el.src || el.getAttribute('src');
      srcdoc = el.srcdoc || el.getAttribute('srcdoc');
    } catch (e) {
      return;
    }
    if (src && /^https?:/i.test(String(src))) {
      el.__frameLoaded = true;
      __schedule(function () {
        __loadFrameNow(el, String(src));
      }, 0);
      return;
    }
    if (srcdoc && String(srcdoc).length) {
      el.__frameLoaded = true;
      __schedule(function () {
        __loadFrameNow(el, 'about:srcdoc', String(srcdoc));
      }, 0);
    }
  };

  globalThis.__loadFrameNow = function __loadFrameNow(el, src, htmlOverride) {
    const note = (extra) => {
      const row = Object.assign({ frame: src }, extra);
      __FRAMES_LOADED.push(row);
      __SCRIPTS_LOADED.push(row);
    };
    let html;
    if (htmlOverride !== undefined) {
      html = String(htmlOverride);
      note({ status: 200, bytes: html.length, srcdoc: true });
      if (!html) return;
    } else {
      if (typeof __HOST_FETCH !== 'function') return note({ status: 'no-bridge' });
      let r;
      try {
        r = JSON.parse(__HOST_FETCH('GET', __absolute(src), ''));
      } catch (e) {
        return note({ status: 0, threw: String(e).slice(0, 120) });
      }
      html = String(r.body || '');
      note({ status: r.status, bytes: html.length });
      if (!(r.status >= 200 && r.status < 400) || !html) return;
    }

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
      for (const step of __frameScriptSteps(html)) {
        let code = step.code;
        if (step.src !== undefined) {
          const abs = __resolveFrom(src, step.src);
          try {
            const sub = JSON.parse(__HOST_FETCH('GET', abs, ''));
            if (!(sub.status >= 200 && sub.status < 400) || !sub.body) {
              note({ frameScript: abs, status: sub.status });
              continue;
            }
            code = String(sub.body);
            note({ frameScript: abs, bytes: code.length });
          } catch (e) {
            note({ frameScript: abs, threw: String(e).slice(0, 100) });
            continue;
          }
        }
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

  function __frameScriptSteps(html) {
    const out = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1] || '';
      const src = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      if (src) {
        const url = (src[2] || src[3] || src[4] || '').trim();
        if (url) out.push({ src: url });
      } else if (m[2] && m[2].trim()) {
        out.push({ code: m[2] });
      }
    }
    return out;
  }

  function __resolveFrom(base, url) {
    try {
      return new globalThis.URL(String(url), String(base)).href;
    } catch (e) {
      return String(url);
    }
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
    {
      const docKids = [documentElement];
      const def = (name, get) => {
        try {
          Object.defineProperty(document, name, { get, configurable: true });
        } catch (e) {}
      };
      if (!document.childNodes || document.childNodes.length === 0) {
        def('childNodes', () => docKids);
        def('firstChild', () => docKids[0] || null);
        def('lastChild', () => docKids[docKids.length - 1] || null);
      }
      if (!document.all || document.all.length === 0) {
        def('all', () => {
          const els = Array.prototype.slice.call(document.getElementsByTagName('*'));
          els.item = (i) => els[+i] || null;
          els.namedItem = (n) => {
            for (const e of els) if (e.id === n || e.name === n) return e;
            return null;
          };
          return els;
        });
      }
    }
  })();

  Object.defineProperty(document, '__registry', {
    value: {},
    enumerable: false,
    writable: true,
    configurable: true,
  });
  globalThis.__DOCUMENT = document;
})();
