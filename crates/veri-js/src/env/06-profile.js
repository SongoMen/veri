(function () {
  const P = globalThis.__PROFILE;
  if (!P) return;

  // prettier-ignore
  const CORE = new Set([
    'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math',
    'JSON', 'Date', 'RegExp', 'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
    'TypeError', 'URIError', 'AggregateError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'WeakRef', 'FinalizationRegistry', 'Proxy', 'Reflect', 'ArrayBuffer', 'SharedArrayBuffer',
    'DataView', 'Atomics', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
    'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
    'BigUint64Array', 'Intl', 'globalThis', 'eval', 'undefined', 'NaN', 'Infinity', 'parseInt',
    'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'encodeURI', 'decodeURIComponent',
    'encodeURIComponent', 'escape', 'unescape', 'WebAssembly', 'console'
  ]);

  // prettier-ignore
  const KEEP = new Set([
    'window', 'self', 'top', 'parent', 'frames', 'globalThis', 'document', 'navigator',
    'location', 'history', 'screen', 'performance', 'crypto', 'localStorage', 'sessionStorage',
    'indexedDB', 'fetch', 'XMLHttpRequest', 'Worker', 'Blob', 'URL', 'webkitURL', 'TextEncoder',
    'TextDecoder', 'chrome', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'atob', 'btoa',
    'addEventListener', 'removeEventListener', 'dispatchEvent', 'matchMedia', 'getComputedStyle',
    'customElements', 'visualViewport', 'caches', 'CSS', 'trustedTypes', 'PerformanceObserver',
    'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'AudioContext',
    'OfflineAudioContext'
  ]);

  let created = 0,
    protoFilled = 0;

  function makeCtor(name) {
    const f = function () {};
    try {
      Object.defineProperty(f, 'name', { value: name, configurable: true });
    } catch (e) {}
    f.prototype = {};
    try {
      Object.defineProperty(f.prototype, 'constructor', {
        value: f,
        writable: true,
        configurable: true,
      });
    } catch (e) {}
    // Without this every platform object answers `[object Object]`, where a browser
    // names the interface.
    try {
      Object.defineProperty(f.prototype, Symbol.toStringTag, { value: name, configurable: true });
    } catch (e) {}
    return f;
  }

  const CHROME_UA = /Chrome\//.test((globalThis.__IDENTITY && globalThis.__IDENTITY.ua) || '');
  // prettier-ignore
  const BLINK_ONLY = new Set([
    'chrome', 'PresentationRequest', 'PresentationConnection', 'PresentationAvailability',
    'BackgroundFetchManager', 'BackgroundFetchRegistration', 'BackgroundFetchRecord',
    'IdleDetector', 'EyeDropper', 'ReportingObserver', 'DocumentPictureInPicture',
    'NavigatorUAData', 'BluetoothUUID', 'USBDevice', 'SerialPort', 'HIDDevice',
    'FileSystemWritableFileStream', 'LaunchQueue', 'VirtualKeyboard', 'InkPresenter',
    'Scheduling', 'TrustedTypePolicyFactory'
  ]);

  // prettier-ignore
  const ASSIGNED = new Set([
    'URL', 'activeElement', 'baseLatency', 'baseURI', 'caches', 'childElementCount',
    'childNodes', 'children', 'clientHeight', 'clientWidth', 'clipboard', 'connection',
    'currentScript', 'defaultView', 'destination', 'devicePixelRatio', 'documentURI',
    'entryType', 'error', 'fatal', 'format', 'gpu', 'ignoreBOM', 'indexedDB', 'keyboard',
    'listener', 'location', 'mediaDevices', 'mimeTypes', 'namespaceURI', 'nodeName',
    'nodeType', 'origin', 'outputLatency', 'parent', 'parentElement', 'parentNode',
    'permissions', 'plugins', 'pointerBeforeReferenceNode', 'port1', 'port2', 'readyState',
    'referenceNode', 'response', 'responseText', 'sampleRate', 'screenX', 'screenY',
    'searchParams', 'serviceWorker', 'state', 'status', 'storage', 'tagName',
    'userAgentData', 'values', 'window'
  ]);

  const NULL_GLOBALS = new Set(P.nullGlobals || []);

  const define = (name, value) =>
    Object.defineProperty(__G0, name, {
      value,
      writable: true,
      enumerable: /^on[a-z]/.test(name),
      configurable: true,
    });

  for (const name of Object.keys(P.globals)) {
    if (CORE.has(name) || KEEP.has(name)) continue;
    if (!CHROME_UA && (BLINK_ONLY.has(name) || /^(webkit|WebKit|Webkit)/.test(name))) continue;
    if (name.startsWith('__')) continue;
    if (globalThis.__isAbsent && globalThis.__isAbsent(name)) continue;
    if (Object.prototype.hasOwnProperty.call(__G0, name)) continue;
    const t = P.globals[name];
    try {
      if (t === 'function') {
        define(name, makeCtor(name));
        created++;
      } else if (t === 'object') {
        define(name, NULL_GLOBALS.has(name) ? null : {});
        created++;
      } else if (t === 'number' || t === 'string' || t === 'boolean') {
        /* leave to explicit config */
      }
    } catch (e) {}
  }

  if (/Firefox\//.test((globalThis.__IDENTITY && globalThis.__IDENTITY.ua) || '')) {
    try {
      __G0.mozInnerScreenX = 0;
      __G0.mozInnerScreenY = 0;
      __G0.mozRTCPeerConnection = __G0.RTCPeerConnection;
      __G0.navigator.buildID = '20181001000000';
      __G0.CSS2Properties = makeCtor('CSS2Properties');
    } catch (e) {}
  }

  let linked = 0;
  if (P.parents) {
    for (const name of Object.keys(P.parents)) {
      if (CORE.has(name)) continue;
      const parentName = P.parents[name];
      if (!parentName || parentName === 'Object') continue;
      try {
        const ctor = __G0[name],
          parent = __G0[parentName];
        if (typeof ctor !== 'function' || typeof parent !== 'function') continue;
        if (!ctor.prototype || !parent.prototype) continue;
        if (ctor.prototype === parent.prototype) continue;
        if (Object.getPrototypeOf(ctor.prototype) === parent.prototype) continue;
        Object.setPrototypeOf(ctor.prototype, parent.prototype);
        linked++;
      } catch (e) {}
    }
  }

  const BLINK_PROTO = new Map([
    [
      'Navigator',
      new Set([
        'deviceMemory',
        'userAgentData',
        'connection',
        'bluetooth',
        'usb',
        'serial',
        'hid',
        'keyboard',
        'ink',
        'presentation',
        'scheduling',
        'virtualKeyboard',
        'managed',
        'windowControlsOverlay',
        'login',
        'storageBuckets',
        'getInstalledRelatedApps',
        'setAppBadge',
        'clearAppBadge',
        'protectedAudience',
        'joinAdInterestGroup',
        'leaveAdInterestGroup',
        'runAdAuction',
        'updateAdInterestGroups',
        'adAuctionComponents',
        'clearOriginJoinedAdInterestGroups',
        'deprecatedReplaceInURN',
        'deprecatedURNToURL',
        'canLoadAdAuctionFencedFrame',
        'createAuctionNonce',
      ]),
    ],
    ['Document', new Set(['pictureInPictureEnabled', 'pictureInPictureElement', 'prerendering'])],
    ['Element', new Set(['computedStyleMap', 'scrollIntoViewIfNeeded'])],
    ['HTMLElement', new Set(['virtualKeyboardPolicy', 'editContext', 'writingSuggestions'])],
  ]);

  const stripProto = (fn) => ({ m() { return fn.apply(this, arguments); } }).m;

  for (const name of Object.keys(P.prototypes)) {
    if (CORE.has(name)) continue;
    let ctor;
    try {
      ctor = __G0[name];
    } catch (e) {
      continue;
    }
    if (typeof ctor !== 'function' || !ctor.prototype) continue;
    const proto = ctor.prototype;
    const kinds = (P.prototypeKinds && P.prototypeKinds[name]) || {};
    const nonEnum = new Set(kinds.n || []);
    const accessors = new Set(kinds.a || []);
    const readable = new Set(kinds.q || []);
    const writable = new Set(kinds.w || []);
    const constants = kinds.c || {};

    for (const prop of P.prototypes[name]) {
      if (prop === 'constructor') continue;
      if (
        !CHROME_UA &&
        (BLINK_PROTO.get(name)?.has(prop) || /^(webkit|Webkit|WebKit)/.test(prop))
      ) {
        continue;
      }
      try {
        if (Object.prototype.hasOwnProperty.call(proto, prop)) continue;
        const enumerable = !nonEnum.has(prop);

        if (Object.prototype.hasOwnProperty.call(constants, prop)) {
          Object.defineProperty(proto, prop, {
            value: constants[prop],
            writable: false,
            configurable: false,
            enumerable,
          });
          protoFilled++;
          continue;
        }

        if (accessors.has(prop) || readable.has(prop)) {
          const quiet = readable.has(prop);
          const isHandler = /^on[a-z]/.test(prop);
          const stand_in = isHandler ? null : stripProto(function () {});
          if (!isHandler) {
            Object.defineProperty(stand_in, 'name', { value: prop, configurable: true });
          }
          const get = stripProto(function () {
            if (this === proto) {
              if (quiet) return undefined;
              throw new TypeError('Illegal invocation');
            }
            if (ctor && !(this instanceof ctor)) throw new TypeError('Illegal invocation');
            return stand_in;
          });
          const set = stripProto(function (v) {
            if (this === proto) {
              if (!quiet) throw new TypeError('Illegal invocation');
              return;
            }
            // Shadow with an own property, so a write followed by a read gives
            // back what was written, exactly as a data property did.
            try {
              Object.defineProperty(this, prop, {
                value: v,
                writable: true,
                configurable: true,
                enumerable: true,
              });
            } catch (e) {}
          });
          Object.defineProperty(get, 'name', { value: 'get ' + prop, configurable: true });
          Object.defineProperty(set, 'name', { value: 'set ' + prop, configurable: true });
          const desc =
            writable.has(prop) || ASSIGNED.has(prop)
              ? { get, set, enumerable, configurable: true }
              : { get, enumerable, configurable: true };
          Object.defineProperty(proto, prop, desc);
          // 07-shims owns the native-source masking; an accessor that
          // stringifies to its own source is a tell.
          (globalThis.__NATIVE_PENDING || (globalThis.__NATIVE_PENDING = [])).push(get, set);
          protoFilled++;
          continue;
        }

        const fn = stripProto(function () {
          if (ctor && !(this instanceof ctor)) throw new TypeError('Illegal invocation');
        });
        Object.defineProperty(fn, 'name', { value: prop, configurable: true });
        Object.defineProperty(proto, prop, {
          value: fn,
          writable: true,
          configurable: true,
          enumerable,
        });
        protoFilled++;
      } catch (e) {}
    }
  }

  globalThis.__PROFILE_STATS = {
    created,
    protoFilled,
    linked,
    chrome: P.meta && P.meta.chrome,
    globals: Object.keys(P.globals).length,
  };

  // V8 hands this out unconditionally. Chrome exposes it only to a
  // cross-origin-isolated page, and the harvest ran on an ordinary one.
  if (!Object.prototype.hasOwnProperty.call(P.globals, 'SharedArrayBuffer')) {
    try {
      delete globalThis.SharedArrayBuffer;
    } catch (e) {}
  }

  try {
    delete globalThis.__PROFILE;
  } catch (e) {
    globalThis.__PROFILE = null;
  }
})();

// `Object.prototype.toString.call(window)` reads Symbol.toStringTag, and a
// browser answers [object Window] where a bare object answers [object Object].
try {
  Object.defineProperty(globalThis, Symbol.toStringTag, { value: 'Window', configurable: true });
  Object.defineProperty(globalThis.document, Symbol.toStringTag, {
    value: 'HTMLDocument',
    configurable: true,
  });
} catch (e) {}

globalThis.window = __watch('window', globalThis);
globalThis.opener = null;
globalThis.self = globalThis.window;
globalThis.top = globalThis.window;
globalThis.parent = globalThis.window;
globalThis.frames = globalThis.window;
globalThis.document.defaultView = globalThis.window;
globalThis.document.location = globalThis.location;
globalThis.document.URL = __PAGE_URL;
globalThis.document.documentURI = __PAGE_URL;
globalThis.document.baseURI = __PAGE_URL;
globalThis.document.domain = __URL.hostname;
globalThis.globalThis = globalThis.window;

(function () {
  const Ctor = (name) => {
    const f = function () {};
    Object.defineProperty(f, 'name', { value: name });
    f.prototype = {};
    return f;
  };
  // prettier-ignore
  for (const n of [
    'Element', 'HTMLElement', 'HTMLDivElement', 'HTMLCanvasElement', 'HTMLIFrameElement',
    'HTMLScriptElement', 'HTMLBodyElement', 'HTMLDocument', 'Node', 'Document',
    'DocumentFragment', 'CharacterData', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent',
    'KeyboardEvent', 'PointerEvent', 'TouchEvent', 'UIEvent', 'EventTarget', 'DOMParser',
    'XPathEvaluator', 'Range', 'Selection', 'CanvasRenderingContext2D', 'WebGLRenderingContext',
    'WebGL2RenderingContext', 'ImageData', 'Path2D', 'DOMRect', 'DOMRectReadOnly', 'DOMMatrix',
    'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response', 'WebSocket',
    'SharedWorker', 'MessageChannel', 'MessagePort', 'BroadcastChannel', 'Navigator', 'Screen',
    'Location', 'History', 'Storage', 'Performance', 'PerformanceEntry',
    'PerformanceResourceTiming', 'PerformanceNavigationTiming', 'RTCPeerConnection',
    'MediaStream', 'Notification', 'Image', 'Audio', 'XMLSerializer', 'MutationRecord',
    'AbortController', 'AbortSignal', 'NodeList', 'HTMLCollection', 'NamedNodeMap', 'Attr',
    'ShadowRoot', 'CSSStyleDeclaration', 'CSSStyleSheet', 'StyleSheet', 'MediaQueryList',
    'OffscreenCanvas', 'OffscreenCanvasRenderingContext2D', 'ImageBitmap', 'ReadableStream',
    'WritableStream', 'TransformStream', 'ByteLengthQueuingStrategy', 'CompressionStream',
    'DecompressionStream', 'IntersectionObserverEntry', 'ResizeObserverEntry',
    'PerformanceObserverEntryList', 'PerformancePaintTiming', 'PerformanceMark',
    'PerformanceMeasure', 'PerformanceServerTiming', 'ReportingObserver', 'IdleDeadline',
    'VisualViewport', 'CustomElementRegistry', 'PushManager', 'ServiceWorkerContainer',
    'ServiceWorkerRegistration', 'MediaQueryListEvent', 'ErrorEvent', 'PromiseRejectionEvent',
    'ProgressEvent', 'MessageEvent', 'CloseEvent', 'FocusEvent', 'InputEvent', 'WheelEvent',
    'AnimationEvent', 'TransitionEvent', 'ClipboardEvent', 'DragEvent', 'DOMTokenList',
    'DOMStringMap', 'DOMException', 'DOMImplementation', 'XPathResult', 'NodeIterator',
    'TreeWalker', 'HTMLImageElement', 'HTMLInputElement',
    'HTMLFormElement', 'HTMLAnchorElement', 'HTMLStyleElement', 'HTMLLinkElement',
    'HTMLMetaElement', 'HTMLSpanElement', 'HTMLParagraphElement', 'HTMLHeadingElement',
    'HTMLHeadElement', 'HTMLUnknownElement', 'SVGElement', 'SVGSVGElement', 'SVGGraphicsElement'
  ]) {
    if (!Object.prototype.hasOwnProperty.call(__G0, n)) __G0[n] = Ctor(n);
  }
})();

globalThis.customElements = {
  define() {},
  get: () => undefined,
  whenDefined: () => Promise.resolve(),
  upgrade() {},
};
globalThis.visualViewport = {
  width: __IDENTITY.innerW,
  height: __IDENTITY.innerH,
  scale: 1,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.caches = {
  open: () => Promise.resolve({}),
  has: () => Promise.resolve(false),
  keys: () => Promise.resolve([]),
};
globalThis.CSS = (function () {
  // `supports` answering true to everything claims every property any browser ever
  // shipped.
  const kebab = (k) => String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  let set = null;
  const known = (name) => {
    if (!set) {
      set = new Set();
      for (const n of globalThis.__CSS_PROPS || []) {
        set.add(String(n));
        const k = kebab(n);
        set.add(k);
        if (/^(webkit|moz|ms|o)-/.test(k)) set.add('-' + k);
      }
    }
    if (!set.size) return true;
    const n = String(name).trim();
    return set.has(n) || set.has(kebab(n));
  };
  const KEYWORDS = {
    display: [
      'block',
      'inline',
      'inline-block',
      'flex',
      'inline-flex',
      'grid',
      'inline-grid',
      'none',
      'contents',
      'flow-root',
      'table',
      'table-row',
      'table-cell',
      'list-item',
      'ruby',
      'inline-table',
    ],
    position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    overflow: ['visible', 'hidden', 'scroll', 'auto', 'clip'],
    'overflow-x': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
    'overflow-y': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
    float: ['left', 'right', 'none', 'inline-start', 'inline-end'],
    clear: ['left', 'right', 'both', 'none'],
    visibility: ['visible', 'hidden', 'collapse'],
    'box-sizing': ['content-box', 'border-box'],
    'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'],
    'text-align': ['left', 'right', 'center', 'justify', 'start', 'end'],
    'font-style': ['normal', 'italic', 'oblique'],
    'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
    'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
    'pointer-events': [
      'auto',
      'none',
      'visiblePainted',
      'visibleFill',
      'visibleStroke',
      'visible',
      'painted',
      'fill',
      'stroke',
      'all',
    ],
    'text-transform': ['none', 'capitalize', 'uppercase', 'lowercase'],
    'mix-blend-mode': [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'difference',
    ],
  };
  const GLOBAL_KW = ['inherit', 'initial', 'unset', 'revert', 'revert-layer'];
  const COLOR_NAMES =
    /^(transparent|currentcolor|black|white|red|green|blue|yellow|orange|purple|gray|grey|silver|maroon|olive|lime|aqua|teal|navy|fuchsia)$/i;
  const LENGTH =
    /^[+-]?(\d+\.?\d*|\.\d+)(px|em|rem|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pt|pc|q|%|fr|deg|rad|turn|s|ms)?$/i;
  const isColor = (v) =>
    COLOR_NAMES.test(v) ||
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
    /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(v);
  const valueOk = (prop, value) => {
    const p = kebab(String(prop).trim()).replace(/^-+/, '');
    const v = String(value).trim();
    if (!v) return false;
    if (GLOBAL_KW.indexOf(v.toLowerCase()) >= 0) return true;
    if (/^(var|calc|env|clamp|min|max)\(/i.test(v)) return true;
    const kw = KEYWORDS[p];
    if (kw) return kw.indexOf(v.toLowerCase()) >= 0;
    if (/color$/.test(p) || p === 'fill' || p === 'stroke') return isColor(v);
    if (
      /(width|height|size|top|right|bottom|left|margin|padding|gap|radius|spacing|indent|offset)$/.test(
        p,
      )
    ) {
      return v === 'auto' || v === 'none' || v.split(/\s+/).every((part) => LENGTH.test(part));
    }
    return true;
  };
  return {
    supports(a, b) {
      try {
        if (b === undefined) {
          // The one-argument form is a condition: `(display: grid)`.
          let text = String(a).trim();
          while (text.charAt(0) === '(' && text.charAt(text.length - 1) === ')') {
            text = text.slice(1, -1).trim();
          }
          const at = text.indexOf(':');
          if (at <= 0) return false;
          return known(text.slice(0, at)) && valueOk(text.slice(0, at), text.slice(at + 1));
        }
        return known(a) && valueOk(a, b);
      } catch (e) {
        return false;
      }
    },
    // https://drafts.csswg.org/cssom/#serialize-an-identifier
    escape(value) {
      const s = String(value);
      let out = '';
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        const ch = s.charAt(i);
        if (c === 0) {
          out += '�';
        } else if ((c >= 0x1 && c <= 0x1f) || c === 0x7f) {
          out += '\\' + c.toString(16) + ' ';
        } else if (i === 0 && c >= 0x30 && c <= 0x39) {
          out += '\\' + c.toString(16) + ' ';
        } else if (i === 1 && c >= 0x30 && c <= 0x39 && s.charCodeAt(0) === 0x2d) {
          out += '\\' + c.toString(16) + ' ';
        } else if (i === 0 && c === 0x2d && s.length === 1) {
          out += '\\' + ch;
        } else if (
          c >= 0x80 ||
          c === 0x2d ||
          c === 0x5f ||
          (c >= 0x30 && c <= 0x39) ||
          (c >= 0x41 && c <= 0x5a) ||
          (c >= 0x61 && c <= 0x7a)
        ) {
          out += ch;
        } else {
          out += '\\' + ch;
        }
      }
      return out;
    },
    registerProperty(descriptor) {
      const E = globalThis.DOMException || Error;
      if (!descriptor || typeof descriptor !== 'object')
        throw new TypeError(
          "Failed to execute 'registerProperty' on 'CSS': The provided value is not of type 'PropertyDefinition'.",
        );
      if (!('name' in descriptor))
        throw new TypeError(
          "Failed to execute 'registerProperty' on 'CSS': required member name is undefined.",
        );
      const name = String(descriptor.name);
      if (!/^--/.test(name))
        throw new E(
          "Failed to execute 'registerProperty' on 'CSS': Custom property names must start with '--'.",
          'SyntaxError',
        );
      const reg = globalThis.__CSS_REGISTERED || (globalThis.__CSS_REGISTERED = new Set());
      if (reg.has(name))
        throw new E(
          "Failed to execute 'registerProperty' on 'CSS': The name provided has already been registered.",
          'InvalidModificationError',
        );
      reg.add(name);
    },
  };
})();
// The typed OM unit helpers: CSS.px(3) and friends.
(function () {
  // prettier-ignore
  const UNITS = ['number','percent','em','ex','ch','rem','vw','vh','vmin','vmax','cm','mm','in',
    'pt','pc','px','Q','deg','grad','rad','turn','s','ms','Hz','kHz','dpi','dpcm','dppx','fr'];
  for (const u of UNITS) {
    try {
      const fn = (v) => {
        const o = {
          value: Number(v),
          unit: u === 'number' ? 'number' : u === 'percent' ? 'percent' : u,
        };
        o.toString = () =>
          u === 'number' ? String(o.value) : o.value + (u === 'percent' ? '%' : u);
        try {
          const C = globalThis.CSSUnitValue;
          if (typeof C === 'function' && C.prototype) Object.setPrototypeOf(o, C.prototype);
        } catch (e) {}
        return o;
      };
      Object.defineProperty(fn, 'name', { value: u, configurable: true });
      globalThis.CSS[u] = fn;
    } catch (e) {}
  }
})();
globalThis.trustedTypes = {
  createPolicy: (n, r) => ({
    name: n,
    createHTML: (x) => x,
    createScript: (x) => x,
    createScriptURL: (x) => x,
  }),
  defaultPolicy: null,
  isHTML: () => false,
  isScript: () => false,
  isScriptURL: () => false,
};

globalThis.navigator.permissions = {
  query: () => Promise.resolve({ state: 'prompt', onchange: null }),
};

// The keyboard layout map. Absent, a collector reading its size records -1
// where this machine reports fifty keys.
globalThis.navigator.keyboard = (function () {
  const L = globalThis.__KB_LAYOUT || [];
  const map = new Map(L);
  return {
    getLayoutMap: () => Promise.resolve(map),
    lock: () => Promise.resolve(),
    unlock() {},
  };
})();

// Battery. `chargingTime` is Infinity on a machine that is charged and plugged
// in, and 0 - which is what an empty stub answers - means "full in no time".
globalThis.navigator.getBattery = function getBattery() {
  const B = globalThis.__BATTERY || {};
  const num = (v, d2) => (v === 'Infinity' ? Infinity : typeof v === 'number' ? v : d2);
  return Promise.resolve({
    charging: B.charging !== false,
    chargingTime: num(B.chargingTime, Infinity),
    dischargingTime: num(B.dischargingTime, Infinity),
    level: typeof B.level === 'number' ? B.level : 1,
    onchargingchange: null,
    onchargingtimechange: null,
    ondischargingtimechange: null,
    onlevelchange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  });
};
globalThis.navigator.mediaDevices = (function () {
  // A machine with no audio or video devices at all is rare enough to be a signal, and
  // a collector here counts the devices, hashes the list and registers for
  const M = globalThis.__MEDIA_DEVICES || { constraints: {}, devices: [] };
  const listeners = [];
  return {
    ondevicechange: null,
    enumerateDevices: () =>
      Promise.resolve(
        M.devices.map((d) => ({
          kind: d.kind,
          label: d.label || '',
          deviceId: d.deviceId || '',
          groupId: d.groupId || '',
          toJSON() {
            return {
              kind: this.kind,
              label: this.label,
              deviceId: this.deviceId,
              groupId: this.groupId,
            };
          },
        })),
      ),
    getSupportedConstraints: () => Object.assign({}, M.constraints),
    getUserMedia: () => Promise.reject(new Error('NotAllowedError')),
    getDisplayMedia: () => Promise.reject(new Error('NotAllowedError')),
    setCaptureHandleConfig() {},
    addEventListener(t, f) {
      if (typeof f === 'function') listeners.push([t, f]);
    },
    removeEventListener(t, f) {
      const i = listeners.findIndex((e) => e[0] === t && e[1] === f);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent() {
      return true;
    },
  };
})();
globalThis.navigator.connection = (function () {
  // Harvested. `downlink` is a measurement, so a flat 10 - the ceiling Chrome
  // clamps to - is not a value a real connection reports; it moves per run
  // around what this machine actually saw.
  const C = globalThis.__CONNECTION || {
    effectiveType: '4g',
    rtt: 50,
    downlink: 1.55,
    saveData: false,
  };
  const jitter = Math.round((C.downlink + ((Date.now() / 997) % 5) / 20) * 100) / 100;
  return {
    onchange: null,
    effectiveType: C.effectiveType,
    rtt: C.rtt,
    downlink: jitter,
    saveData: C.saveData === true,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
})();
globalThis.navigator.storage = (function () {
  // Harvested: Chrome reports a fixed share of the disk, not the disk.
  const S = globalThis.__STORAGE_EST || { quota: 10737418240, usage: 0 };
  return {
    estimate: () => Promise.resolve({ quota: S.quota, usage: S.usage, usageDetails: {} }),
    persisted: () => Promise.resolve(false),
    persist: () => Promise.resolve(false),
  };
})();
globalThis.navigator.clipboard = {};

globalThis.navigator.serviceWorker = {
  register: () => Promise.resolve({}),
  controller: null,
  ready: Promise.resolve({}),
};

globalThis.navigator.mediaSession = {
  metadata: null,
  playbackState: 'none',
  setActionHandler() {},
  setPositionState() {},
  setMicrophoneActive() {},
  setCameraActive() {},
};
globalThis.navigator.bluetooth = {
  getAvailability: () => Promise.resolve(false),
  getDevices: () => Promise.resolve([]),
  requestDevice: () =>
    Promise.reject(
      new (globalThis.DOMException || Error)(
        'User cancelled the requestDevice() chooser.',
        'NotFoundError',
      ),
    ),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
};

(function () {
  const Old = globalThis.MediaMetadata;
  const proto = (Old && Old.prototype) || {};
  function MediaMetadata(init) {
    const d = init || {};
    this.title = d.title !== undefined ? String(d.title) : '';
    this.artist = d.artist !== undefined ? String(d.artist) : '';
    this.album = d.album !== undefined ? String(d.album) : '';
    this.artwork = Array.isArray(d.artwork)
      ? d.artwork.map((a) => ({
          src: String((a && a.src) || ''),
          sizes: String((a && a.sizes) || ''),
          type: String((a && a.type) || ''),
        }))
      : [];
  }
  try {
    Object.defineProperty(MediaMetadata, 'name', { value: 'MediaMetadata', configurable: true });
  } catch (e) {}
  MediaMetadata.prototype = proto;
  try {
    Object.defineProperty(proto, 'constructor', {
      value: MediaMetadata,
      writable: true,
      configurable: true,
    });
  } catch (e) {}
  globalThis.MediaMetadata = MediaMetadata;
})();

globalThis.navigator.credentials = {
  get: () => Promise.resolve(null),
  create: () => Promise.resolve(null),
  store: (c) => Promise.resolve(c),
  preventSilentAccess: () => Promise.resolve(),
};
try {
  if (globalThis.PublicKeyCredential) {
    globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () =>
      Promise.resolve(true);
    globalThis.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(true);
  }
} catch (e) {}

globalThis.__MQ = (function () {
  const t = {};
  const src = globalThis.__MEDIA_QUERIES || {};
  for (const k of Object.keys(src)) t[String(k).replace(/\s+/g, '')] = src[k];
  return t;
})();
// Only `min-width: 0` used to match, so `(min-width: 100px)` came back false on
// a 1512px viewport. The harvested table answers the preference queries; the
// dimensional ones are evaluated against the window the identity reports.
globalThis.__evalMedia = function __evalMedia(q) {
  const text = String(q).trim();
  const k = text.replace(/\s+/g, '');
  if (Object.prototype.hasOwnProperty.call(__MQ, k)) return __MQ[k] === true;
  if (!text || text === 'all') return true;
  // A comma is a union, and every comma-free part must hold.
  if (text.indexOf(',') >= 0) return text.split(',').some((p) => __evalMedia(p));
  let ok = true;
  let sawFeature = false;
  const re = /\(\s*([a-z-]+)\s*(?::\s*([^)]+))?\)/g;
  let m;
  while ((m = re.exec(text))) {
    sawFeature = true;
    const feat = m[1];
    const raw = (m[2] || '').trim();
    const num = parseFloat(raw);
    const px = /rem$|em$/.test(raw) ? num * 16 : num;
    const W = globalThis.innerWidth || 0;
    const H = globalThis.innerHeight || 0;
    const dpr = globalThis.devicePixelRatio || 1;
    let val;
    if (feat === 'min-width') val = W >= px;
    else if (feat === 'max-width') val = W <= px;
    else if (feat === 'width') val = W === px;
    else if (feat === 'min-height') val = H >= px;
    else if (feat === 'max-height') val = H <= px;
    else if (feat === 'height') val = H === px;
    else if (feat === 'min-device-width') val = (globalThis.screen || {}).width >= px;
    else if (feat === 'max-device-width') val = (globalThis.screen || {}).width <= px;
    else if (feat === 'orientation') val = raw === (W >= H ? 'landscape' : 'portrait');
    else if (feat === 'min-resolution') val = dpr * 96 >= (/dppx/.test(raw) ? num * 96 : num);
    else if (feat === 'max-resolution') val = dpr * 96 <= (/dppx/.test(raw) ? num * 96 : num);
    else if (feat === 'min-device-pixel-ratio' || feat === '-webkit-min-device-pixel-ratio')
      val = dpr >= num;
    else if (feat === 'max-device-pixel-ratio' || feat === '-webkit-max-device-pixel-ratio')
      val = dpr <= num;
    else {
      const kk = ('(' + feat + (raw ? ':' + raw : '') + ')').replace(/\s+/g, '');
      val = Object.prototype.hasOwnProperty.call(__MQ, kk) ? __MQ[kk] === true : false;
    }
    ok = ok && val;
  }
  if (!sawFeature) return /^(screen|all)$/i.test(text.replace(/^only\s+/i, ''));
  if (/^\s*not\s/i.test(text)) return !ok;
  return ok;
};
globalThis.matchMedia = (q) => {
  const mql = {
    matches: globalThis.__evalMedia(q),
    media: String(q),
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
    onchange: null,
  };
  try {
    const C = globalThis.MediaQueryList;
    if (typeof C === 'function' && C.prototype) Object.setPrototypeOf(mql, C.prototype);
  } catch (e) {}
  return mql;
};
// The computed properties a real element reports, in the order it reports them.
globalThis.__CSS_LONGHAND = Object.keys(globalThis.__COMPUTED || {});
// Other fragments need this to tell a CSS property from any other name.
globalThis.__CSS_LONGHAND = __CSS_LONGHAND;

globalThis.getComputedStyle = function (el) {
  const __asCSSStyleDeclaration = (o) => {
    try {
      const C = globalThis.CSSStyleDeclaration;
      if (o && typeof C === 'function' && C.prototype && Object.getPrototypeOf(o) !== C.prototype) {
        Object.setPrototypeOf(o, C.prototype);
      }
    } catch (e) {}
    return o;
  };
  let __connected = true;
  try {
    __connected = el ? globalThis.__isConnected(el) : false;
  } catch (e) {
    __connected = false;
  }
  const SYS = globalThis.__SYSTEM_FONTS || {};
  let sys = null;
  try {
    const shorthand = el && el.style && el.style.font;
    if (shorthand && Object.prototype.hasOwnProperty.call(SYS, String(shorthand).trim())) {
      sys = SYS[String(shorthand).trim()];
    }
  } catch (e) {}
  const COMPUTED = Object.assign(
    {
      'font-family': (sys && sys.family) || 'system-ui, sans-serif',
      'font-size': (sys && sys.size) || '16px',
      'font-weight': (sys && sys.weight) || '400',
      'font-style': 'normal',
      'line-height': 'normal',
      'letter-spacing': 'normal',
      'text-align': 'start',
      color: 'rgb(0, 0, 0)',
      'background-color': 'rgba(0, 0, 0, 0)',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      position: 'static',
      'z-index': 'auto',
      transform: 'none',
      direction: 'ltr',
      'writing-mode': 'horizontal-tb',
    },
    globalThis.__COMPUTED || {},
    sys
      ? {
          'font-family': sys.family,
          'font-size': sys.size,
          'font-weight': sys.weight,
        }
      : {},
    __connected
      ? (function () {
          let box;
          try {
            box = el.__box;
          } catch (e) {
            box = null;
          }
          const w = (box ? Math.round(box.width) : 0) + 'px';
          const h = (box ? box.height : 0) + 'px';
          return {
            width: w,
            height: h,
            'inline-size': w,
            'block-size': h,
            'transform-origin':
              (box ? Math.round(box.width) / 2 : 0) + 'px ' + (box ? box.height / 2 : 0) + 'px',
            'perspective-origin':
              (box ? Math.round(box.width) / 2 : 0) + 'px ' + (box ? box.height / 2 : 0) + 'px',
          };
        })()
      : {},
  );
  try {
    const __tag = el && el.tagName ? String(el.tagName).toUpperCase() : '';
    const __INLINE = {
      SPAN: 1, A: 1, B: 1, I: 1, EM: 1, STRONG: 1, SMALL: 1, LABEL: 1, CODE: 1,
      ABBR: 1, CITE: 1, Q: 1, S: 1, U: 1, SUB: 1, SUP: 1, MARK: 1, TIME: 1,
      VAR: 1, KBD: 1, SAMP: 1, BDI: 1, BDO: 1, DFN: 1, TT: 1,
    };
    if (__INLINE[__tag]) {
      COMPUTED['display'] = 'inline';
      COMPUTED['width'] = 'auto';
      COMPUTED['height'] = 'auto';
      COMPUTED['inline-size'] = 'auto';
      COMPUTED['block-size'] = 'auto';
    }
    // A fresh element is fully opaque with normal bidi; these are not per-element
    // harvest values.
    COMPUTED['opacity'] = '1';
    COMPUTED['unicode-bidi'] = 'normal';
  } catch (e) {}
  try {
    const own = el && el.style;
    if (own && typeof own.getPropertyValue === 'function' && own.length) {
      for (const name of own) {
        const v = own.getPropertyValue(name);
        if (v !== '' && v != null) COMPUTED[String(name).toLowerCase()] = v;
      }
    }
  } catch (e) {}
  const __LH = __connected ? __CSS_LONGHAND : [];
  const style = {
    getPropertyValue(k) {
      const n = String(k).toLowerCase();
      if (n in COMPUTED) return COMPUTED[n];
      if (!__connected) return '';
      try {
        if (el && el.style && typeof el.style.getPropertyValue === 'function') {
          return el.style.getPropertyValue(n);
        }
      } catch (e) {}
      return '';
    },
    getPropertyPriority() {
      return '';
    },
    setProperty() {},
    removeProperty() {
      return '';
    },
    item(i) {
      return __LH[i] || '';
    },
    get length() {
      return __LH.length;
    },
    get cssText() {
      return '';
    },
  };
  // Enumerable indices, so `for (const k in style)` yields the property names.
  __LH.forEach((name, i) => {
    Object.defineProperty(style, i, { value: name, enumerable: true });
  });
  try {
    style[Symbol.iterator] = function* () {
      for (let i = 0; i < __LH.length; i++) yield __LH[i];
    };
  } catch (e) {}
  for (const k of Object.keys(COMPUTED)) {
    const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    style[camel] = COMPUTED[k];
    style[k] = COMPUTED[k];
  }
  if (!__connected) {
    for (const name of __CSS_LONGHAND) {
      const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!(camel in style)) Object.defineProperty(style, camel, { value: '', configurable: true });
      if (!(name in style)) Object.defineProperty(style, name, { value: '', configurable: true });
    }
  }
  return __asCSSStyleDeclaration(style);
};
globalThis.scrollTo = function () {};
globalThis.scrollBy = function () {};
globalThis.open = function () {
  return null;
};
globalThis.close = function () {};
globalThis.focus = function () {};
globalThis.blur = function () {};
globalThis.getSelection = () => {
  const sel = {
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    isCollapsed: true,
    rangeCount: 0,
    type: 'None',
    toString: () => '',
    getRangeAt() {
      throw new (globalThis.DOMException || Error)('index out of range', 'IndexSizeError');
    },
    removeAllRanges() {},
    addRange() {},
    collapse() {},
    selectAllChildren() {},
    containsNode: () => false,
  };
  try {
    const C = globalThis.Selection;
    if (typeof C === 'function' && C.prototype) Object.setPrototypeOf(sel, C.prototype);
  } catch (e) {}
  return sel;
};
globalThis.indexedDB = {
  open: () => ({ addEventListener() {}, onsuccess: null, onerror: null }),
  deleteDatabase: () => ({}),
};

if (/Chrome\//.test((globalThis.__IDENTITY && globalThis.__IDENTITY.ua) || ''))
  globalThis.chrome = {
    loadTimes: function () {
      return undefined;
    },
    csi: function () {
      return { onloadT: 1786174209000, startE: 1786174209000, tran: 15 };
    },
    app: {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    },
  };

// ---- APIs a fingerprint reaches for ----------------------------------------- The
// profile creates bare constructors for these, so the object exists and the method

// WebGPU. `navigator.gpu.getPreferredCanvasFormat()` and the WGSL feature set
// are both read; `wgslLanguageFeatures` is a Set, so `.size` must work.
globalThis.navigator.gpu = (function () {
  // Harvested. The hand-written set had 8 adapter features and 8 limits where
  // this machine reports 22 and 36, and a collector that reads the limits back
  // sees a shape no adapter has.
  const G = globalThis.__GPU || {};
  const limits = G.limits || { maxTextureDimension2D: 16384, maxBufferSize: 4294967292 };
  const devLimits = G.deviceLimits || limits;
  return {
    getPreferredCanvasFormat() {
      return G.preferredFormat || 'bgra8unorm';
    },
    wgslLanguageFeatures: new Set(G.wgsl || []),
    requestAdapter() {
      return Promise.resolve({
        features: new Set(G.features || []),
        limits: limits,
        isFallbackAdapter: G.isFallbackAdapter === true,
        info: G.info || { vendor: '', architecture: '', device: '', description: '' },
        // GPUAdapterInfo carries more than the four obvious fields.
        requestAdapterInfo() {
          return Promise.resolve(G.info || {});
        },
        requestDevice() {
          return Promise.resolve({
            features: new Set(G.deviceFeatures || []),
            limits: devLimits,
            queue: {},
            destroy() {},
            lost: new Promise(() => {}),
          });
        },
      });
    },
  };
})();

// Speech synthesis. `getVoices()` legitimately answers empty until the voice
// list loads, so an empty array is honest rather than invented.
globalThis.speechSynthesis = (function () {
  const V = globalThis.__VOICES || [];
  const Ctor = globalThis.SpeechSynthesisVoice;
  const voices = V.map((v) => {
    const o = {
      name: v.name,
      lang: v.lang,
      default: v.default === true,
      localService: v.localService === true,
      voiceURI: v.voiceURI,
    };
    try {
      if (Ctor && Ctor.prototype) Object.setPrototypeOf(o, Ctor.prototype);
    } catch (e) {}
    return o;
  });
  const listeners = [];
  return {
    pending: false,
    speaking: false,
    paused: false,
    onvoiceschanged: null,
    getVoices() {
      return voices.slice();
    },
    speak() {},
    cancel() {},
    pause() {},
    resume() {},
    addEventListener(t, f) {
      if (typeof f === 'function') listeners.push([t, f]);
    },
    removeEventListener(t, f) {
      const i2 = listeners.findIndex((e) => e[0] === t && e[1] === f);
      if (i2 >= 0) listeners.splice(i2, 1);
    },
    dispatchEvent() {
      return true;
    },
  };
})();

(function () {
  // prettier-ignore
  const SUPPORTED = [
    'video/webm', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/mp4',
    'video/mp4;codecs="avc1.42E01E"', 'audio/webm', 'audio/webm;codecs=opus', 'audio/mp4',
    'audio/mpeg'
  ];
  const supports = (t) => {
    const s = String(t || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    return SUPPORTED.some((x) => s.indexOf(x.toLowerCase().replace(/\s+/g, '')) === 0);
  };
  // Harvested, because the answers are not a rule: `audio/mpeg` is 'probably'
  // with no codecs named, and Chrome answers '' for theora, which it dropped.
  const MEDIA = globalThis.__MEDIA_TABLE || {};
  const norm = (t) =>
    String(t || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/["']/g, '')
      .replace(/;+$/, '');
  const table = {};
  for (const k of Object.keys(MEDIA.canPlayType || {})) table[norm(k)] = MEDIA.canPlayType[k];
  const rec = {};
  for (const k of Object.keys(MEDIA.mediaRecorder || {})) {
    rec[norm(k)] = MEDIA.mediaRecorder[k] === 'true' || MEDIA.mediaRecorder[k] === true;
  }
  for (const name of ['MediaRecorder', 'MediaSource']) {
    try {
      if (typeof globalThis[name] === 'function') {
        globalThis[name].isTypeSupported = (t) => {
          const k = norm(t);
          return Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : supports(t);
        };
      }
    } catch (e) {}
  }
  globalThis.__canPlayType = (t) => {
    const k = norm(t);
    if (Object.prototype.hasOwnProperty.call(table, k)) return table[k];
    if (!supports(t)) return '';
    return /codecs\s*=/i.test(String(t)) ? 'probably' : 'maybe';
  };
})();

// The harvested plugin list, materialised as real Plugin and MimeType objects: a
// bare `length` dies on plugins[0].name. Chrome hands out one MimeType per type
// across the whole browser, so the plugins share the objects rather than copying.
(function () {
  const HARVEST = globalThis.__PLUGINS || [];

  const proto = (name) => {
    const c = globalThis[name];
    return c && c.prototype ? c.prototype : Object.prototype;
  };

  const markNative = (fn, name, len) => {
    try {
      if (name) Object.defineProperty(fn, 'name', { value: name, configurable: true });
      if (len !== undefined) Object.defineProperty(fn, 'length', { value: len, configurable: true });
      if (globalThis.__markNativeFn) globalThis.__markNativeFn(fn);
    } catch (e) {}
    return fn;
  };
  const mimeData = new WeakMap();
  const pluginData = new WeakMap();

  const mkMime = (t, owner) => {
    const m = Object.create(proto('MimeType'));
    mimeData.set(m, {
      type: t.type,
      suffixes: t.suffixes,
      description: t.description,
      enabledPlugin: owner,
    });
    return m;
  };
  (function setupMimeProto() {
    const C = globalThis.MimeType;
    if (!C || !C.prototype) return;
    ['type', 'suffixes', 'description', 'enabledPlugin'].forEach((k) => {
      const g = markNative(
        function () {
          const d = mimeData.get(this);
          return d ? d[k] : undefined;
        },
        'get ' + k,
        0,
      );
      try {
        Object.defineProperty(C.prototype, k, { get: g, enumerable: true, configurable: true });
      } catch (e) {}
    });
  })();

  const globalMimes = [];
  const globalByType = Object.create(null);

  const plugins = HARVEST.map((src) => {
    const types = src.mimeTypes || [];
    const p = Object.create(proto('Plugin'));
    pluginData.set(p, {
      name: src.name,
      filename: src.filename,
      description: src.description,
      length: types.length,
      types: types,
    });
    types.forEach((t, i) => {
      Object.defineProperty(p, i, { value: mkMime(t, p), enumerable: true, configurable: true });
      Object.defineProperty(p, t.type, {
        get: () => mkMime(t, p),
        enumerable: false,
        configurable: true,
      });
    });
    return p;
  });
  (function setupPluginProto() {
    const C = globalThis.Plugin;
    if (!C || !C.prototype) return;
    ['name', 'filename', 'description', 'length'].forEach((k) => {
      const g = markNative(
        function () {
          const d = pluginData.get(this);
          return d ? d[k] : undefined;
        },
        'get ' + k,
        0,
      );
      try {
        Object.defineProperty(C.prototype, k, { get: g, enumerable: true, configurable: true });
      } catch (e) {}
    });
    const put = (name, fn, len) => {
      markNative(fn, name, len);
      try {
        Object.defineProperty(C.prototype, name, {
          value: fn,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } catch (e) {}
    };
    put(
      'item',
      function item(i) {
        const d = pluginData.get(this);
        if (!d) return null;
        const t = d.types[i >>> 0];
        return t ? mkMime(t, this) : null;
      },
      1,
    );
    put(
      'namedItem',
      function namedItem(n) {
        const d = pluginData.get(this);
        if (!d) return null;
        const t = d.types.find((x) => x.type === String(n));
        return t ? mkMime(t, this) : null;
      },
      1,
    );
    try {
      Object.defineProperty(C.prototype, Symbol.iterator, {
        value: markNative(function* () {
          const d = pluginData.get(this);
          const n = d ? d.types.length : 0;
          for (let i = 0; i < n; i++) yield this[i];
        }),
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch (e) {}
  })();

  HARVEST.forEach((src, pi) => {
    for (const t of src.mimeTypes || []) {
      if (globalByType[t.type]) continue;
      const gm = mkMime(t, plugins[pi]);
      globalByType[t.type] = gm;
      globalMimes.push(gm);
    }
  });
  const mimes = globalMimes;

  const setupProto = (protoName) => {
    const C = globalThis[protoName];
    if (!C || !C.prototype) return;
    const pr = C.prototype;
    const put = (name, fn, len) => {
      try {
        Object.defineProperty(fn, 'name', { value: name, configurable: true });
        Object.defineProperty(fn, 'length', { value: len, configurable: true });
        if (globalThis.__markNativeFn) globalThis.__markNativeFn(fn);
        Object.defineProperty(pr, name, {
          value: fn,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } catch (e) {}
    };
    put('item', function item(i) { i = i >>> 0; return this[i] != null ? this[i] : null; }, 1);
    put('namedItem', function namedItem(n) { const v = this[String(n)]; return v != null ? v : null; }, 1);
    if (protoName === 'PluginArray') put('refresh', function refresh() {}, 0);
    try {
      const lenGet = function length() {
        let n = 0;
        while (Object.prototype.hasOwnProperty.call(this, n)) n++;
        return n;
      };
      Object.defineProperty(lenGet, 'name', { value: 'get length', configurable: true });
      if (globalThis.__markNativeFn) globalThis.__markNativeFn(lenGet);
      Object.defineProperty(pr, 'length', { get: lenGet, enumerable: true, configurable: true });
    } catch (e) {}
    try {
      const it = function* () {
        const len = this.length;
        for (let i = 0; i < len; i++) yield this[i];
      };
      Object.defineProperty(pr, Symbol.iterator, {
        value: it,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    } catch (e) {}
  };

  const list = (items, protoName, key) => {
    const a = Object.create(proto(protoName));
    items.forEach((it, i) => {
      Object.defineProperty(a, i, { value: it, enumerable: true, configurable: true });
      Object.defineProperty(a, it[key], { value: it, enumerable: false, configurable: true });
    });
    return a;
  };

  try {
    setupProto('PluginArray');
    setupProto('MimeTypeArray');
    globalThis.navigator.plugins = list(plugins, 'PluginArray', 'name');
    globalThis.navigator.mimeTypes = list(mimes, 'MimeTypeArray', 'type');
  } catch (e) {}
})();

// Chrome's on-device model APIs answer availability rather than existing as
// bare constructors, which is what a collector calls.
for (const name of ['Summarizer', 'LanguageDetector', 'Translator', 'Writer', 'Rewriter']) {
  try {
    const c = globalThis[name];
    if (typeof c === 'function' && typeof c.availability !== 'function') {
      c.availability = () => Promise.resolve('unavailable');
      c.create = () => Promise.reject(new Error('NotSupportedError'));
    }
  } catch (e) {}
}
