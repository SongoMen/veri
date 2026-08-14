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

  for (const name of Object.keys(P.globals)) {
    if (CORE.has(name) || KEEP.has(name)) continue;
    if (!CHROME_UA && (BLINK_ONLY.has(name) || /^(webkit|WebKit|Webkit)/.test(name))) continue;
    if (name.startsWith('__')) continue;
    if (globalThis.__isAbsent && globalThis.__isAbsent(name)) continue;
    if (Object.prototype.hasOwnProperty.call(__G0, name)) continue;
    const t = P.globals[name];
    try {
      if (t === 'function') {
        __G0[name] = makeCtor(name);
        created++;
      } else if (t === 'object') {
        __G0[name] = {};
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
    const constants = kinds.c || {};

    for (const prop of P.prototypes[name]) {
      if (prop === 'constructor') continue;
      try {
        if (Object.prototype.hasOwnProperty.call(proto, prop)) continue;
        const enumerable = !nonEnum.has(prop);

        if (Object.prototype.hasOwnProperty.call(constants, prop)) {
          Object.defineProperty(proto, prop, {
            value: constants[prop],
            writable: false,
            configurable: true,
            enumerable,
          });
          protoFilled++;
          continue;
        }

        // An interface accessor lives on the prototype but needs an instance to
        // read. Reaching for it on the prototype throws, and a fingerprint that
        // walks the prototype counts which ones do.
        if (accessors.has(prop) || readable.has(prop)) {
          const quiet = readable.has(prop);
          // Only the read off the prototype changes. An instance still sees
          // what it saw before, so nothing downstream of this shifts.
          const stand_in = function () {};
          Object.defineProperty(stand_in, 'name', { value: prop, configurable: true });
          const get = function () {
            if (this === proto) {
              if (quiet) return undefined;
              throw new TypeError('Illegal invocation');
            }
            return stand_in;
          };
          const set = function (v) {
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
          };
          Object.defineProperty(get, 'name', { value: 'get ' + prop, configurable: true });
          Object.defineProperty(set, 'name', { value: 'set ' + prop, configurable: true });
          Object.defineProperty(proto, prop, { get, set, configurable: true, enumerable });
          // 07-shims owns the native-source masking; an accessor that
          // stringifies to its own source is a tell.
          (globalThis.__NATIVE_PENDING || (globalThis.__NATIVE_PENDING = [])).push(get, set);
          protoFilled++;
          continue;
        }

        const fn = function () {};
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
  return {
    supports(a, b) {
      try {
        if (b === undefined) {
          const at = String(a).indexOf(':');
          return at > 0 ? known(String(a).slice(0, at)) : false;
        }
        return known(a);
      } catch (e) {
        return false;
      }
    },
    escape: (s) => String(s),
  };
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

globalThis.__MQ = (function () {
  const t = {};
  const src = globalThis.__MEDIA_QUERIES || {};
  for (const k of Object.keys(src)) t[String(k).replace(/\s+/g, '')] = src[k];
  return t;
})();
globalThis.matchMedia = (q) => ({
  matches: (function () {
    const k = String(q).replace(/\s+/g, '');
    if (Object.prototype.hasOwnProperty.call(__MQ, k)) return __MQ[k] === true;
    return /min-width:\s*0|all/.test(String(q));
  })(),
  media: String(q),
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  onchange: null,
});
// The computed properties a real element reports, in the order it reports them.
globalThis.__CSS_LONGHAND = Object.keys(globalThis.__COMPUTED || {});
// Other fragments need this to tell a CSS property from any other name.
globalThis.__CSS_LONGHAND = __CSS_LONGHAND;

// A computed style with one method answers one question and throws on the rest.
// Font measurement is a standard fingerprint and it reads several.
globalThis.getComputedStyle = function (el) {
  // `font: caption` and its five siblings are system fonts: the browser
  // resolves each to a real family, size and weight. Left unresolved they all
  // computed to the page default, so a collector asking what the six system
  // fonts are got one answer six times.
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
    // Last, because the harvest measured one particular element: these are
    // used values for *this* one, and they have to agree with its offsetWidth.
    // Computed width and height are always px, never the 'auto' a stylesheet
    // would have written.
    (function () {
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
    })(),
  );
  const style = {
    getPropertyValue(k) {
      const n = String(k).toLowerCase();
      if (n in COMPUTED) return COMPUTED[n];
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
      return __CSS_LONGHAND[i] || '';
    },
    get length() {
      return __CSS_LONGHAND.length;
    },
    get cssText() {
      return '';
    },
  };
  // Enumerable indices, so `for (const k in style)` yields the property names.
  __CSS_LONGHAND.forEach((name, i) => {
    Object.defineProperty(style, i, { value: name, enumerable: true });
  });
  try {
    style[Symbol.iterator] = function* () {
      for (let i = 0; i < __CSS_LONGHAND.length; i++) yield __CSS_LONGHAND[i];
    };
  } catch (e) {}
  for (const k of Object.keys(COMPUTED)) {
    const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    style[camel] = COMPUTED[k];
    style[k] = COMPUTED[k];
  }
  return style;
};
globalThis.scrollTo = function () {};
globalThis.scrollBy = function () {};
globalThis.open = function () {
  return null;
};
globalThis.close = function () {};
globalThis.focus = function () {};
globalThis.blur = function () {};
globalThis.getSelection = () => ({ toString: () => '', rangeCount: 0 });
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

  const mimes = [];
  const byType = Object.create(null);
  for (const src of HARVEST) {
    for (const t of src.mimeTypes || []) {
      if (byType[t.type]) continue;
      const m = Object.create(proto('MimeType'));
      Object.defineProperties(m, {
        type: { value: t.type, enumerable: true },
        suffixes: { value: t.suffixes, enumerable: true },
        description: { value: t.description, enumerable: true },
      });
      byType[t.type] = m;
      mimes.push(m);
    }
  }

  const plugins = HARVEST.map((src) => {
    const own = (src.mimeTypes || []).map((t) => byType[t.type]);
    const p = Object.create(proto('Plugin'));
    Object.defineProperties(p, {
      name: { value: src.name, enumerable: true },
      filename: { value: src.filename, enumerable: true },
      description: { value: src.description, enumerable: true },
      length: { value: own.length, enumerable: true },
    });
    own.forEach((m, i) => {
      Object.defineProperty(p, i, { value: m, enumerable: true });
      Object.defineProperty(p, m.type, { value: m, enumerable: false });
    });
    p.item = (i) => p[i] || null;
    p.namedItem = (n) => p[n] || null;
    return p;
  });

  mimes.forEach((m) => {
    Object.defineProperty(m, 'enabledPlugin', { value: plugins[0], enumerable: true });
  });

  const list = (items, protoName, key) => {
    const a = Object.create(proto(protoName));
    items.forEach((it, i) => {
      Object.defineProperty(a, i, { value: it, enumerable: true });
      Object.defineProperty(a, it[key], { value: it, enumerable: false });
    });
    Object.defineProperty(a, 'length', { value: items.length, enumerable: true });
    a.item = (i) => a[i] || null;
    a.namedItem = (n) => a[n] || null;
    a.refresh = () => {};
    try {
      a[Symbol.iterator] = function* () {
        for (let i = 0; i < items.length; i++) yield items[i];
      };
    } catch (e) {}
    return a;
  };

  try {
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
