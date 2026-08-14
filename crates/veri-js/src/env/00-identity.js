(function () {
  const PAGE_URL = globalThis.__URL_OVERRIDE || 'https://example.invalid/';
  const _U = (function (u) {
    const m = /^(https?:)\/\/([^\/:?#]+)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(u) || [];
    return {
      protocol: m[1] || 'https:',
      hostname: m[2] || '',
      port: m[3] || '',
      pathname: m[4] || '/',
      search: m[5] || '',
      hash: m[6] || '',
    };
  })(PAGE_URL);

  // Real global captured BEFORE `globalThis` is aliased to the watch proxy.
  const G0 = globalThis;

  const _P = globalThis.__PROFILE || {};
  const _NAV = _P.navigator || {};
  const _SCR = _P.screen || {};
  const _MISC = _P.misc || {};

  const IDENTITY = {
    ua:
      globalThis.__UA_OVERRIDE ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    platform: _NAV.platform || 'MacIntel',
    language: 'en-US',
    languages: ['en-US', 'en'],
    hardwareConcurrency: _NAV.hardwareConcurrency || 10,
    deviceMemory: _NAV.deviceMemory || 16,
    screenW: _SCR.width || 1512,
    screenH: _SCR.height || 982,
    availTop: _SCR.availTop ?? 33,
    availH: _SCR.availHeight || 870,
    colorDepth: _SCR.colorDepth || 30,
    innerW: 1512,
    innerH: 860,
    dpr: _MISC.devicePixelRatio || 2,
    tz: globalThis.__TZ_OVERRIDE || _MISC.timezone || 'America/New_York',
  };
  globalThis.__IDENTITY = IDENTITY;
  globalThis.__PAGE_URL = PAGE_URL;
  globalThis.__URL = _U;
  globalThis.__G0 = G0;
})();
