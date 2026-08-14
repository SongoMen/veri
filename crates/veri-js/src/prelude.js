(function () {
  globalThis.__REC = [];
  globalThis.__DEPTH_CAP = 6;

  let NO_GHOSTS = false;
  globalThis.__setGhosts = function (on) {
    NO_GHOSTS = !on;
  };

  let DIAG = false;
  globalThis.__setDiag = function (on) {
    DIAG = !!on;
  };
  globalThis.__diagOn = function () {
    return DIAG;
  };

  function rec(op, path, extra) {
    if (!DIAG) return;
    if (__REC.length < 200000) __REC.push([op, path, extra === undefined ? null : extra]);
  }

  function ghost(path, depth) {
    depth = depth || 0;
    const target = function () {};
    target.__path = path;
    return new Proxy(target, {
      get(t, k) {
        if (k === '__isGhost') return true;
        if (k === '__path') return path;
        if (typeof k === 'symbol') {
          if (k === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : path);
          if (k === Symbol.iterator) {
            rec('iterate', path);
            return function* () {};
          }
          if (k === Symbol.toStringTag) return 'Object';
          rec('get:symbol', path + '.@@' + String(k));
          return undefined;
        }
        rec('get', path + '.' + k);
        if (depth >= __DEPTH_CAP) return undefined;
        if (k === 'toString' || k === 'valueOf') return () => path;
        if (k === 'length') return 0;
        return ghost(path + '.' + k, depth + 1);
      },
      set(t, k, v) {
        rec('set', path + '.' + String(k), typeof v);
        return true;
      },
      has(t, k) {
        rec('has', path + '.' + String(k));
        return true;
      },
      deleteProperty(t, k) {
        rec('delete', path + '.' + String(k));
        return true;
      },
      apply(t, thisArg, args) {
        rec('call', path, args.length);
        return depth >= __DEPTH_CAP ? undefined : ghost(path + '()', depth + 1);
      },
      construct(t, args) {
        rec('new', path, args.length);
        return ghost('new ' + path, depth + 1);
      },
      getPrototypeOf() {
        return Object.prototype;
      },
      ownKeys() {
        rec('ownKeys', path);
        return [];
      },
      getOwnPropertyDescriptor() {
        return { configurable: true, enumerable: true, value: undefined };
      },
    });
  }
  globalThis.__rec = rec;

  globalThis.__CAUGHT_LOG = [];
  globalThis.__CAUGHT = function (e, site) {
    if (__CAUGHT_LOG.length > 300) return;
    let d;
    try {
      d = e && e.message ? e.name + ': ' + e.message : String(e);
    } catch (_) {
      d = '<unprintable>';
    }
    // The property reads just before the throw.
    let near = [];
    try {
      near = __REC.slice(-14).map(function (r) {
        return r[0] + ' ' + r[1];
      });
    } catch (_) {}
    let stack = '';
    try {
      stack = String((e && e.stack) || '')
        .split('\n')
        .slice(1, 4)
        .join(' <- ');
    } catch (_) {}
    // Obfuscated code names nothing directly; it decodes each identifier just before
    // use.
    let names = '';
    try {
      const buf = globalThis.__ps;
      if (buf && buf.length) names = buf.slice(-12).join(' ');
    } catch (_) {}
    __CAUGHT_LOG.push({ msg: d, site: site, near: near, stack: stack, names: names });
  };

  function watch(name, real) {
    // `window` is one of these, and it wraps the global directly, so it needs the
    // same blind spot for this environment's own names as __GLOBAL_PROXY has.
    const isGlobal = real === globalThis;
    return new Proxy(real, {
      get(t, k) {
        if (typeof k === 'symbol') return Reflect.get(t, k);
        if (isGlobal && internal(t, k)) return Reflect.get(t, k);
        if (k in t) {
          rec('get:known', name + '.' + k);
          return Reflect.get(t, k);
        }
        rec('get:MISSING', name + '.' + k);
        return NO_GHOSTS ? undefined : ghost(name + '.' + k, 1);
      },
      set(t, k, v) {
        rec('set', name + '.' + String(k), typeof v);
        return Reflect.set(t, k, v);
      },
      has(t, k) {
        const present = Reflect.has(t, k);
        rec(present ? 'has:known' : 'has:MISSING', name + '.' + String(k));
        return NO_GHOSTS ? present : true;
      },
      ownKeys(t) {
        const keys = Reflect.ownKeys(t);
        return isGlobal ? keys.filter((k) => !internal(t, k)) : keys;
      },
      getOwnPropertyDescriptor(t, k) {
        if (isGlobal && internal(t, k)) return undefined;
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
    });
  }
  globalThis.__watch = watch;

  // prettier-ignore
  const ABSENT = new Set([
  'global', 'process', 'require', 'module', 'exports', 'Buffer', '__dirname', '__filename',
  'GLOBAL', 'root', 'v8debug', 'webdriver', '_phantom', 'phantom', 'callPhantom', '__nightmare',
  'domAutomation', 'domAutomationController', '_Selenium_IDE_Recorder', '__webdriver_evaluate',
  '__selenium_evaluate', '__webdriver_script_function', '__webdriver_script_func',
  '__webdriver_script_fn', '__fxdriver_evaluate', '__driver_evaluate', '__driver_unwrapped',
  '__webdriver_unwrapped', '__selenium_unwrapped', '__fxdriver_unwrapped',
  '__$webdriverAsyncExecutor', 'Selenium', 'awesomium', 'puppeteer', 'playwright', '__playwright',
  '__pw_manual', '__PW_inspect', 'spawn', 'emit'
]);
  const ABSENT_PREFIX = ['$cdc_', 'cdc_', '$chrome_asyncScriptInfo', '__lastWatirAlert'];

  globalThis.__isAbsent = isAbsent;

  function isAbsent(k) {
    if (ABSENT.has(k)) return true;
    for (let i = 0; i < ABSENT_PREFIX.length; i++) if (k.startsWith(ABSENT_PREFIX[i])) return true;
    return false;
  }

  // Internal globals are all named __*. They are snapshotted once the environment
  // is built and hidden from enumeration; reads still resolve.
  const INTERNAL = new Set();

  globalThis.__sealInternals = function () {
    for (const k of Object.getOwnPropertyNames(globalThis)) {
      if (k.startsWith('__')) INTERNAL.add(k);
    }
    INTERNAL.add('__sealInternals');
  };

  // A proxy may not hide a non-configurable own property; reporting one as absent
  // is a TypeError rather than a smaller surface.
  function internal(t, k) {
    if (typeof k !== 'string' || !INTERNAL.has(k)) return false;
    const d = Reflect.getOwnPropertyDescriptor(t, k);
    return !d || d.configurable === true;
  }

  globalThis.__GLOBAL_PROXY = new Proxy(globalThis, {
    has(t, k) {
      if (typeof k === 'string' && isAbsent(k)) {
        rec('probe:absent', 'global.' + k);
        return false;
      }
      if (typeof k === 'string' && k.startsWith('__HOST')) return false;
      const own = Reflect.getOwnPropertyDescriptor(t, k);
      if (own && own.configurable === false) return true;
      // Claiming a name that really exists makes this object the receiver for
      // every call to it, and the engine writes the receiver's type into the
      // stack: `Proxy.foo` where a browser shows `foo`. Letting real names fall
      // through to the global scope keeps the proxy for absent ones only.
      if (NO_GHOSTS) return false;
      return !Reflect.has(t, k);
    },
    get(t, k) {
      if (k === Symbol.unscopables) return undefined;
      if (typeof k === 'symbol') return Reflect.get(t, k);
      if (internal(t, k)) return Reflect.get(t, k);
      if (isAbsent(k)) {
        rec('probe:absent', 'global.' + k);
        return undefined;
      }
      if (k in t) {
        rec('get:known', 'global.' + k);
        return Reflect.get(t, k);
      }
      rec('get:MISSING', 'global.' + k);
      return NO_GHOSTS ? undefined : ghost('global.' + k, 1);
    },
    set(t, k, v) {
      rec('set', 'global.' + String(k), typeof v);
      return Reflect.set(t, k, v);
    },
    ownKeys(t) {
      return Reflect.ownKeys(t).filter((k) => !internal(t, k));
    },
    getOwnPropertyDescriptor(t, k) {
      if (internal(t, k)) return undefined;
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
  });
})();
