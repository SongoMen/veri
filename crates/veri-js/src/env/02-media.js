(function () {
  const __defineOwn = (o, k, v) =>
    Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });

  const __M = (globalThis.__PROFILE && globalThis.__PROFILE.misc) || {};

  const __FONTS = __M.fonts || { advances: {}, heights: {}, present: [], first: 32, refSize: 16 };

  globalThis.__fontFamilies = function __fontFamilies(font) {
    const m = /(?:^|\s)(\d+(?:\.\d+)?)px\s+(.+)$/.exec(String(font || ''));
    if (!m) return { size: 16, families: [] };
    const families = m[2].split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
    return { size: parseFloat(m[1]), families };
  };

  function __table(group, fam) {
    const g = __FONTS[group];
    if (!g || !g.index) return null;
    const i = g.index[fam];
    return i === undefined ? null : g.tables[i];
  }

  const __INK = (__FONTS && __FONTS.ink) || null;

  const __GENERIC = {
    serif: 'Times',
    'sans-serif': 'Helvetica',
    monospace: 'Menlo',
    cursive: 'Apple Chancery',
    fantasy: 'Papyrus',
    'system-ui': 'Helvetica',
    '-apple-system': 'Helvetica',
    'ui-monospace': 'Menlo',
    'ui-serif': 'Times',
    'ui-sans-serif': 'Helvetica',
  };
  function __pickFamily(families) {
    const index = (__FONTS.advances && __FONTS.advances.index) || {};
    const fallback = index.__default__;
    const inkIndex = (__INK && __INK.index) || {};
    const inkFallback = inkIndex.__default__;
    const usable = (f) => {
      if (!Object.prototype.hasOwnProperty.call(index, f)) return false;
      if (index[f] !== fallback) return true;
      return inkIndex[f] !== undefined && inkIndex[f] !== inkFallback;
    };
    for (const f of families) {
      if (usable(f)) return f;
      const g = __GENERIC[String(f).toLowerCase()];
      if (g && usable(g)) return g;
    }
    return '__default__';
  }

  function __inkTable(fam) {
    if (!__INK) return null;
    const i = __INK.index[fam];
    return i === undefined ? null : __INK.tables[i];
  }
  function __inkBox(text, fam, size) {
    const t = __inkTable(fam) || __inkTable('__default__');
    const s = String(text);
    if (!t || !s) return null;
    const scale = (size || 10) / (__INK.refSize || 100);
    let a = 0;
    let d = 0;
    let saw = false;
    for (let i = 0; i < s.length; i++) {
      const idx = s.charCodeAt(i) - 32;
      if (idx < 0 || idx >= t[0].length) continue;
      saw = true;
      if (t[0][idx] > a) a = t[0][idx];
      if (t[1][idx] > d) d = t[1][idx];
    }
    if (!saw) return null;
    return { a: Math.round(a * scale * 1000) / 1000, d: Math.round(d * scale * 1000) / 1000 };
  }

  globalThis.__measure = function __measure(text, font) {
    if (globalThis.__noteFont) {
      try {
        __noteFont(String(font));
      } catch (e) {}
    }
    const { size, families } = __fontFamilies(font);
    const fam = __pickFamily(families);
    const adv = __table('advances', fam) || __table('advances', '__default__') || [];
    const kern = __table('kerning', fam) || __table('kerning', '__default__') || {};
    const first = __FONTS.first || 32;
    let sum = 0;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const idx = s.charCodeAt(i) - first;
      sum += idx >= 0 && idx < adv.length ? adv[idx] : adv['x'.charCodeAt(0) - first] || 0;
      if (i > 0) {
        const d = kern[s.charAt(i - 1) + s.charAt(i)];
        if (d !== undefined) sum += d;
      }
    }
    const h = (__FONTS.heights && (__FONTS.heights[fam] || __FONTS.heights.__default__)) || {
      h: {},
      a: 14,
      d: 3,
    };
    const scale = size / (__FONTS.refSize || 16);
    // Line height is harvested per size: it is not a single ratio, because the
    // ascent and descent are rounded to whole pixels before they are added.
    let lineHeight = h.h && h.h[String(size)];
    if (lineHeight === undefined) {
      const known = Object.keys(h.h || {})
        .map(Number)
        .sort((a, b) => a - b);
      const near = known.length
        ? known.reduce((p2, c) => (Math.abs(c - size) < Math.abs(p2 - size) ? c : p2))
        : 0;
      lineHeight = near
        ? Math.round((h.h[String(near)] * size) / near)
        : Math.round(size * 1.15625);
    }
    return {
      width: sum * scale,
      family: fam,
      size,
      lineHeight,
      ascent: h.a * scale,
      descent: h.d * scale,
      ink: __inkBox(s, fam, size),
    };
  };

  globalThis.__setUniform = function __setUniform(gl, loc, values) {
    if (!gl || !loc || !loc.__name) return;
    (gl.__uniforms || (gl.__uniforms = {}))[loc.__name] = values;
  };

  function __glslLive(src) {
    const s = String(src)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    const ids = (t) => String(t).match(/[A-Za-z_]\w*/g) || [];
    const outs = Object.create(null);
    for (const n of ['gl_Position', 'gl_FragColor', 'gl_FragDepth', 'gl_FragData']) outs[n] = 1;
    const declOut =
      /\b(?:out|varying)\s+(?:(?:lowp|mediump|highp)\s+)?[A-Za-z_]\w*\s+([A-Za-z_]\w*)/g;
    let m;
    while ((m = declOut.exec(s))) outs[m[1]] = 1;

    const bodies = Object.create(null);
    const fnRe = /\b([A-Za-z_]\w*)\s*\([^()]*\)\s*\{/g;
    while ((m = fnRe.exec(s))) {
      let depth = 1;
      let i = fnRe.lastIndex;
      while (i < s.length && depth > 0) {
        const c = s[i++];
        if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      bodies[m[1]] = s.slice(fnRe.lastIndex, i - 1);
    }

    const deps = Object.create(null);
    const live = Object.create(null);
    const addAll = (t) => {
      for (const x of ids(t)) live[x] = 1;
    };
    for (const raw of s.split(';')) {
      const st = raw.trim();
      if (!st) continue;
      const cf = /\b(?:if|for|while|switch)\s*\(([\s\S]*)$/.exec(st);
      if (cf) addAll(cf[1]);
      const eq = st.search(/[^=!<>+\-*/%]=[^=]/);
      if (eq < 0) continue;
      const lhsIds = ids(st.slice(0, eq + 1));
      const lhs = lhsIds[lhsIds.length - 1];
      if (!lhs) continue;
      const rhs = ids(st.slice(eq + 2));
      if (outs[lhs]) addAll(rhs.join(' '));
      else (deps[lhs] || (deps[lhs] = [])).push.apply(deps[lhs], rhs);
    }

    const expanded = Object.create(null);
    for (let pass = 0; pass < 32; pass++) {
      let grew = false;
      for (const k of Object.keys(live)) {
        const d = deps[k];
        if (d) {
          for (const x of d) {
            if (!live[x]) {
              live[x] = 1;
              grew = true;
            }
          }
        }
        if (bodies[k] && !expanded[k]) {
          expanded[k] = 1;
          addAll(bodies[k]);
          grew = true;
        }
      }
      if (!grew) break;
    }
    return live;
  }

  globalThis.__uniformActive = function __uniformActive(pr, name) {
    if (!pr || !pr.__shaders || !pr.__shaders.length) return true;
    let live = pr.__live;
    if (!live) {
      let src = '';
      for (const sh of pr.__shaders) src += ((sh && sh.__src) || '') + '\n';
      if (!/\bmain\s*\(/.test(src)) return true;
      live = pr.__live = __glslLive(src);
    }
    return live[name] === 1;
  };

  const F = Math.fround;
  function __glsl(src, uniforms) {
    const vars = Object.create(null);
    for (const k of Object.keys(uniforms || {})) {
      const v = uniforms[k];
      vars[k] = Array.isArray(v) ? v.map(F) : F(v);
    }
    const FN = {
      floor: (a) => F(Math.floor(a)),
      ceil: (a) => F(Math.ceil(a)),
      abs: (a) => F(Math.abs(a)),
      sqrt: (a) => F(Math.sqrt(a)),
      sign: (a) => F(Math.sign(a)),
      fract: (a) => F(a - Math.floor(a)),
      exp: (a) => F(Math.exp(a)),
      log: (a) => F(Math.log(a)),
      sin: (a) => F(Math.sin(a)),
      cos: (a) => F(Math.cos(a)),
      tan: (a) => F(Math.tan(a)),
      max: (a, b) => F(Math.max(a, b)),
      min: (a, b) => F(Math.min(a, b)),
      pow: (a, b) => F(Math.pow(a, b)),
      mod: (a, b) => F(a - b * Math.floor(a / b)),
      step: (a, b) => (b < a ? 0 : 1),
      clamp: (a, b, c) => F(Math.min(Math.max(a, b), c)),
      mix: (a, b, t) => F(a * (1 - t) + b * t),
    };
    // Tokeniser and a precedence-climbing parser over the float subset.
    const evalExpr = (text) => {
      const toks = String(text).match(/[A-Za-z_]\w*|\d*\.\d+|\d+\.?|[()+\-*/,]/g) || [];
      let i = 0;
      const peek = () => toks[i];
      const primary = () => {
        let t = toks[i++];
        if (t === '(') {
          const v = expr(0);
          i++;
          return v;
        }
        if (t === '-') return F(-primary());
        if (t === '+') return primary();
        if (/^[A-Za-z_]/.test(t)) {
          if (peek() === '(') {
            i++;
            const args = [];
            if (peek() !== ')') {
              for (;;) {
                args.push(expr(0));
                if (peek() === ',') {
                  i++;
                  continue;
                }
                break;
              }
            }
            i++;
            const f = FN[t];
            return f ? F(f.apply(null, args)) : 0;
          }
          const v = vars[t];
          return v === undefined ? 0 : Array.isArray(v) ? v[0] : v;
        }
        return F(parseFloat(t));
      };
      const expr = (min) => {
        let left = primary();
        for (;;) {
          const op = peek();
          const prec = op === '+' || op === '-' ? 1 : op === '*' || op === '/' ? 2 : -1;
          if (prec < min || prec < 0) return left;
          i++;
          const right = expr(prec + 1);
          left =
            op === '+'
              ? F(left + right)
              : op === '-'
                ? F(left - right)
                : op === '*'
                  ? F(left * right)
                  : F(left / right);
        }
      };
      return expr(0);
    };
    const body = String(src).replace(/\s+/g, ' ');
    for (const m of body.matchAll(/\b(?:float|int)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)) {
      try {
        vars[m[1]] = evalExpr(m[2]);
      } catch (e) {
        vars[m[1]] = 0;
      }
    }
    const out = /gl_FragColor\s*=\s*vec4\s*\(([^;]+)\)\s*;/.exec(body);
    if (!out) return null;
    const parts = [];
    let depth = 0;
    let buf = '';
    for (const ch of out[1]) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(buf);
        buf = '';
        continue;
      }
      buf += ch;
    }
    parts.push(buf);
    return parts.slice(0, 4).map((p) => {
      try {
        return evalExpr(p);
      } catch (e) {
        return 0;
      }
    });
  }

  globalThis.__shadePixels = function __shadePixels(gl, w, h, out) {
    if (!out || !out.length) return;
    let rgba = null;
    try {
      const pr = gl && gl.__program;
      const frag =
        pr &&
        (pr.__shaders || []).map((sh) => sh && sh.__src).find((x) => /gl_FragColor/.test(x || ''));
      if (frag) rgba = __glsl(frag, gl.__uniforms || {});
    } catch (e) {}
    if (!rgba) return;
    const px = rgba.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
    for (let i = 0; i + 3 < out.length; i += 4) {
      out[i] = px[0];
      out[i + 1] = px[1];
      out[i + 2] = px[2];
      out[i + 3] = px[3] === undefined ? 255 : px[3];
    }
  };

  // prettier-ignore
  const __NAMED = { black:'#000000', white:'#ffffff', red:'#ff0000', green:'#008000', blue:'#0000ff',
    yellow:'#ffff00', orange:'#ffa500', purple:'#800080', gray:'#808080', grey:'#808080',
    silver:'#c0c0c0', maroon:'#800000', olive:'#808000', lime:'#00ff00', aqua:'#00ffff',
    cyan:'#00ffff', teal:'#008080', navy:'#000080', fuchsia:'#ff00ff', magenta:'#ff00ff',
    transparent:'rgba(0, 0, 0, 0)' };
  function __cssColor(v) {
    const t = String(v).trim();
    const lower = t.toLowerCase();
    if (__NAMED[lower]) return __NAMED[lower];
    let m = /^#([0-9a-f]{3})$/i.exec(t);
    if (m)
      return (
        '#' +
        m[1]
          .toLowerCase()
          .split('')
          .map((c) => c + c)
          .join('')
      );
    m = /^#([0-9a-f]{6})$/i.exec(t);
    if (m) return '#' + m[1].toLowerCase();
    // An opaque colour reads back as hex however it was written.
    const hex2 = (n) => ('0' + (n | 0).toString(16)).slice(-2);
    m = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(t);
    if (m) return '#' + hex2(m[1]) + hex2(m[2]) + hex2(m[3]);
    m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(t);
    if (m)
      return (
        'rgba(' + (m[1] | 0) + ', ' + (m[2] | 0) + ', ' + (m[3] | 0) + ', ' + parseFloat(m[4]) + ')'
      );
    return t;
  }

  globalThis.__draw = function __draw(canvas, op) {
    try {
      const parts = [op];
      for (let i = 2; i < arguments.length; i++) parts.push(String(arguments[i]));
      canvas.__ops = (canvas.__ops || '') + parts.join(',') + ';';
    } catch (e) {}
  };

  // FNV-1a: a hash, not a checksum. It only has to be stable and well spread.
  globalThis.__opHash = function __opHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  };

  // Encodes the canvas pixels as a real PNG. Deflate uses fixed Huffman with runs
  // collapsed, so the encoded size tracks the canvas the way a browser's does.
  const __CRC_T = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function __crc32(bytes, start, end) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = __CRC_T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function __adler32(bytes) {
    let a = 1,
      b = 0;
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  globalThis.__pngFromPixels = function __pngFromPixels(width, height, pixels) {
    const w = Math.max(1, width | 0),
      h = Math.max(1, height | 0);
    const raw = new Uint8Array((w * 4 + 1) * h);
    let o = 0;
    for (let y = 0; y < h; y++) {
      raw[o++] = 0;
      const row = y * w * 4;
      for (let i = 0; i < w * 4; i++) raw[o++] = pixels[row + i] & 255;
    }

    const bits = [];
    let cur = 0,
      nbits = 0;
    const out = [];
    const put = (val, n) => {
      for (let i = 0; i < n; i++) {
        cur |= ((val >>> i) & 1) << nbits;
        if (++nbits === 8) {
          out.push(cur);
          cur = 0;
          nbits = 0;
        }
      }
    };
    const putRev = (val, n) => {
      for (let i = n - 1; i >= 0; i--) {
        cur |= ((val >>> i) & 1) << nbits;
        if (++nbits === 8) {
          out.push(cur);
          cur = 0;
          nbits = 0;
        }
      }
    };
    const literal = (b) => {
      if (b <= 143) putRev(0x30 + b, 8);
      else putRev(0x190 + b - 144, 9);
    };
    const LEN_BASE = [
      3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
      163, 195, 227, 258,
    ];
    const LEN_EXTRA = [
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
    ];
    const DIST_CODE = { 1: 0, 2: 1, 3: 2, 4: 3 };
    const emitLen = (len, dist) => {
      let i = LEN_BASE.length - 1;
      while (i > 0 && LEN_BASE[i] > len) i--;
      const code = 257 + i;
      if (code <= 279) putRev(code - 256, 7);
      else putRev(0xc0 + code - 280, 8);
      if (LEN_EXTRA[i]) put(len - LEN_BASE[i], LEN_EXTRA[i]);
      putRev(DIST_CODE[dist], 5);
    };

    put(1, 1); // final block
    put(1, 2); // fixed Huffman
    // Distance 4 repeats the previous pixel, which is what a flat fill is; distance 1
    // repeats the previous byte.
    let i2 = 0;
    while (i2 < raw.length) {
      let best = 0,
        bestDist = 1;
      for (const dist of [4, 1]) {
        if (i2 < dist) continue;
        let n = 0;
        while (i2 + n < raw.length && n < 258 && raw[i2 + n] === raw[i2 + n - dist]) n++;
        if (n > best) {
          best = n;
          bestDist = dist;
        }
      }
      if (best >= 3) {
        emitLen(best, bestDist);
        i2 += best;
      } else {
        literal(raw[i2]);
        i2++;
      }
    }
    putRev(0, 7); // end of block
    if (nbits) out.push(cur);

    const ad = __adler32(raw);
    const z = new Uint8Array(2 + out.length + 4);
    let p = 0;
    z[p++] = 0x78;
    z[p++] = 0x01;
    for (const b of out) z[p++] = b;
    z[p++] = (ad >>> 24) & 255;
    z[p++] = (ad >>> 16) & 255;
    z[p++] = (ad >>> 8) & 255;
    z[p++] = ad & 255;
    const zlib = z.subarray(0, p);

    const chunks = [];
    const chunk = (type, data) => {
      const c = new Uint8Array(12 + data.length);
      const n = data.length;
      c[0] = (n >>> 24) & 255;
      c[1] = (n >>> 16) & 255;
      c[2] = (n >>> 8) & 255;
      c[3] = n & 255;
      for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
      c.set(data, 8);
      const crc = __crc32(c, 4, 8 + n);
      c[8 + n] = (crc >>> 24) & 255;
      c[9 + n] = (crc >>> 16) & 255;
      c[10 + n] = (crc >>> 8) & 255;
      c[11 + n] = crc & 255;
      chunks.push(c);
    };
    const ihdr = new Uint8Array(13);
    ihdr[0] = (w >>> 24) & 255;
    ihdr[1] = (w >>> 16) & 255;
    ihdr[2] = (w >>> 8) & 255;
    ihdr[3] = w & 255;
    ihdr[4] = (h >>> 24) & 255;
    ihdr[5] = (h >>> 16) & 255;
    ihdr[6] = (h >>> 8) & 255;
    ihdr[7] = h & 255;
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    chunk('IHDR', ihdr);
    chunk('IDAT', zlib);
    chunk('IEND', new Uint8Array(0));

    let total = 8;
    for (const c of chunks) total += c.length;
    const png = new Uint8Array(total);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    let q = 8;
    for (const c of chunks) {
      png.set(c, q);
      q += c.length;
    }

    let bin = '';
    for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i]);
    return 'data:image/png;base64,' + btoa(bin);
  };

  // Parses "#abc", "#aabbcc", "rgb(a,b,c)" and "rgba(a,b,c,d)". Anything else is
  // opaque black, which is what an unset fillStyle already is.
  function __color(css) {
    const s = String(css || '#000').trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      const x = m[1];
      const p = (i, n) => parseInt(x.length <= 4 ? x[i].repeat(2) : x.substr(i * 2, 2), 16);
      return [p(0), p(1), p(2), x.length === 4 || x.length === 8 ? p(3) / 255 : 1];
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
      const v = m[1].split(',').map((t) => parseFloat(t));
      return [v[0] | 0, v[1] | 0, v[2] | 0, v.length > 3 ? v[3] : 1];
    }
    return [0, 0, 0, 1];
  }

  // Source-over with per-pixel coverage, which is what makes a fractional
  // fillRect read back as a partly covered pixel rather than a solid one.
  function __blend(d, W, H, x0, y0, x1, y1, col) {
    const [r, g, b, a] = col;
    const px0 = Math.max(0, Math.floor(Math.min(x0, x1)));
    const px1 = Math.min(W, Math.ceil(Math.max(x0, x1)));
    const py0 = Math.max(0, Math.floor(Math.min(y0, y1)));
    const py1 = Math.min(H, Math.ceil(Math.max(y0, y1)));
    for (let y = py0; y < py1; y++) {
      const cy = Math.max(0, Math.min(y + 1, Math.max(y0, y1)) - Math.max(y, Math.min(y0, y1)));
      if (cy <= 0) continue;
      for (let x = px0; x < px1; x++) {
        const cx = Math.max(0, Math.min(x + 1, Math.max(x0, x1)) - Math.max(x, Math.min(x0, x1)));
        if (cx <= 0) continue;
        const sa = a * cx * cy;
        if (sa <= 0) continue;
        const o = (y * W + x) * 4;
        const da = d[o + 3] / 255;
        const oa = sa + da * (1 - sa);
        if (oa <= 0) continue;
        d[o] = (r * sa + d[o] * da * (1 - sa)) / oa;
        d[o + 1] = (g * sa + d[o + 1] * da * (1 - sa)) / oa;
        d[o + 2] = (b * sa + d[o + 2] * da * (1 - sa)) / oa;
        d[o + 3] = oa * 255;
      }
    }
  }

  globalThis.__canvasPixels = function __canvasPixels(canvas, w, h) {
    const W = Math.max(1, w | 0),
      H = Math.max(1, h | 0);
    const d = new Uint8ClampedArray(W * H * 4);
    const ops = (canvas && canvas.__ops) || '';
    // Nothing drawn is transparent black, which is what a browser reports and
    // what compresses to the couple of kilobytes a blank canvas should encode to.
    if (!ops) return d;

    for (const raw of ops.split(';')) {
      if (!raw) continue;
      const p = raw.split(',');
      const op = p[0];
      const n = (i) => parseFloat(p[i]) || 0;
      if (op === 'fr' || op === 'sr') {
        const x = n(1),
          y = n(2),
          rw = n(3),
          rh = n(4);
        const col = __color(p[5]);
        if (op === 'fr') {
          __blend(d, W, H, x, y, x + rw, y + rh, col);
        } else {
          __blend(d, W, H, x, y, x + rw, y + 1, col);
          __blend(d, W, H, x, y + rh - 1, x + rw, y + rh, col);
          __blend(d, W, H, x, y, x + 1, y + rh, col);
          __blend(d, W, H, x + rw - 1, y, x + rw, y + rh, col);
        }
      } else if (op === 'cr') {
        const x = n(1),
          y = n(2),
          rw = n(3),
          rh = n(4);
        for (let yy = Math.max(0, y | 0); yy < Math.min(H, Math.ceil(y + rh)); yy++) {
          for (let xx = Math.max(0, x | 0); xx < Math.min(W, Math.ceil(x + rw)); xx++) {
            const o = (yy * W + xx) * 4;
            d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;
          }
        }
      } else if (op === 'ft' || op === 'st') {
        const col = __color(p[p.length - 1]);
        const font = p[p.length - 2];
        const ty = parseFloat(p[p.length - 3]) || 0;
        const tx = parseFloat(p[p.length - 4]) || 0;
        const text = p.slice(1, p.length - 4).join(',');
        let m;
        try {
          m = globalThis.__measure(text, font);
        } catch (e) {
          m = { width: text.length * 8, ascent: 10, descent: 2 };
        }
        const asc = m.ascent || 10;
        let pen = tx;
        for (let ci = 0; ci < text.length; ci++) {
          const ch = text[ci];
          let cw;
          try {
            cw = globalThis.__measure(ch, font).width;
          } catch (e) {
            cw = (m.width || 8) / Math.max(1, text.length);
          }
          if (ch !== ' ' && cw > 0) {
            const top = ty - asc * 0.72;
            __blend(d, W, H, pen + cw * 0.08, top, pen + cw * 0.92, ty + asc * 0.06, col);
          }
          pen += cw;
        }
      }
    }
    return d;
  };

  const CANVAS_B64 = globalThis.__B64_CHARS;

  // Same image data, perturbed by what was drawn. Deterministic for identical
  // drawing, which is what a fingerprint expects.
  globalThis.__renderedPng = function __renderedPng(canvas) {
    // Encoded from the same pixels getImageData reports, so the two agree.
    try {
      const w = (canvas && canvas.width) || 300;
      const h = (canvas && canvas.height) || 150;
      if (w * h <= 4194304) {
        return __pngFromPixels(w, h, __canvasPixels(canvas, w, h));
      }
    } catch (e) {}
    const ops = (canvas && canvas.__ops) || '';
    if (!ops) return CANVAS_PNG;
    const at = CANVAS_PNG.indexOf(',') + 1;
    const head = CANVAS_PNG.slice(0, at);
    const body = CANVAS_PNG.slice(at);
    let h = __opHash(ops + '|' + (canvas.width | 0) + 'x' + (canvas.height | 0));
    const start = 24 + (h % Math.max(1, body.length - 96));
    let out = body.slice(0, start);
    for (let i = 0; i < 64; i++) {
      h = (h * 1664525 + 1013904223) >>> 0;
      out += CANVAS_B64[(h >>> 8) & 63];
    }
    return head + out + body.slice(start + 64);
  };

  const CANVAS_PNG =
    __M.canvasDataURL ||
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAYAAABkW7XSAAAAAXNSR0IArs4c6QAAIABJREFUeF7t3Qm4JEV5//G3qs/M3Hv3ZReQRRZBFllEZFEUFEFRUVEUFRVFRUVFRUVFRUVFRUVFRUVFRUVFRf8=';

  const __CTX_TAG = {
    '2d': 'CanvasRenderingContext2D',
    webgl: 'WebGLRenderingContext',
    'experimental-webgl': 'WebGLRenderingContext',
    webgl2: 'WebGL2RenderingContext',
    bitmaprenderer: 'ImageBitmapRenderingContext',
  };

  function tagContext(ctx, type) {
    if (!ctx) return ctx;
    try {
      const tag = __CTX_TAG[type];
      if (tag) {
        Object.defineProperty(ctx, Symbol.toStringTag, { value: tag, configurable: true });
        const C = globalThis[tag];
        if (typeof C === 'function' && C.prototype) Object.setPrototypeOf(ctx, C.prototype);
      }
      if (globalThis.__markNative) __markNative(ctx);
    } catch (e) {}
    return ctx;
  }

  globalThis.__makeContext = makeContext;
  const __CTX_DEFAULTS = {
    webgl: {
      alpha: true,
      antialias: true,
      depth: true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'default',
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
      xrCompatible: false,
    },
    '2d': { alpha: true, desynchronized: false, colorSpace: 'srgb', willReadFrequently: false },
  };

  function makeContext(canvas, type, attrs) {
    if (type !== '2d') {
      globalThis.__TIME_COST = (globalThis.__TIME_COST || 0) + 2.3;
    }
    const ctx = tagContext(makeContextInner(canvas, type), type);
    try {
      const base = type === '2d' ? __CTX_DEFAULTS['2d'] : __CTX_DEFAULTS.webgl;
      const got = {};
      for (const k of Object.keys(base)) {
        const want = attrs && typeof attrs === 'object' ? attrs[k] : undefined;
        if (want === undefined) got[k] = base[k];
        else got[k] = typeof base[k] === 'boolean' ? !!want : String(want);
      }
      if (ctx && typeof ctx === 'object') ctx.__attrs = got;
    } catch (e) {}
    return ctx;
  }

  function makeContextInner(canvas, type) {
    if (type === '2d') {
      return {
        canvas,
        __fill: '#000000',
        __stroke: '#000000',
        get fillStyle() {
          return this.__fill;
        },
        set fillStyle(v) {
          this.__fill = __cssColor(v);
        },
        get strokeStyle() {
          return this.__stroke;
        },
        set strokeStyle(v) {
          this.__stroke = __cssColor(v);
        },
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        textBaseline: 'alphabetic',
        textAlign: 'start',
        lineWidth: 1,
        save() {},
        restore() {},
        scale() {},
        rotate() {},
        translate() {},
        transform() {},
        setTransform() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        bezierCurveTo() {},
        quadraticCurveTo() {},
        arc() {},
        arcTo() {},
        rect() {},
        fill() {},
        stroke() {},
        clip() {},
        fillRect(x, y, w, h) {
          __draw(canvas, 'fr', x, y, w, h, this.fillStyle);
        },
        strokeRect(x, y, w, h) {
          __draw(canvas, 'sr', x, y, w, h);
        },
        clearRect(x, y, w, h) {
          __draw(canvas, 'cr', x, y, w, h);
        },
        fillText(t, x, y) {
          __draw(canvas, 'ft', t, x, y, this.font, this.fillStyle);
        },
        strokeText(t, x, y) {
          __draw(canvas, 'st', t, x, y, this.font, this.strokeStyle);
        },
        get font() {
          return this.__font === undefined ? '10px sans-serif' : this.__font;
        },
        set font(v) {
          // An unparseable value leaves the previous font in place.
          if (
            /^\s*(?:[a-z-]+\s+)*?\d*\.?\d+(?:px|pt|em|rem|%|ex|ch|vw|vh|cm|mm|in|pc)\s+\S/i.test(
              String(v),
            )
          ) {
            this.__font = String(v);
          }
        },
        measureText(t) {
          const m = __measure(t, this.font);
          return {
            width: m.width,
            actualBoundingBoxLeft: -0.5,
            actualBoundingBoxRight: m.width - 0.5,
            actualBoundingBoxAscent: m.ink ? m.ink.a : m.ascent * 0.818,
            actualBoundingBoxDescent: m.ink ? m.ink.d : m.descent * 0.0625,
            fontBoundingBoxAscent: m.ascent,
            fontBoundingBoxDescent: m.descent,
            emHeightAscent: m.ascent,
            emHeightDescent: m.descent,
            alphabeticBaseline: 0,
            hangingBaseline: m.ascent * 0.8,
            ideographicBaseline: -m.descent,
          };
        },
        createLinearGradient() {
          return { addColorStop() {} };
        },
        createRadialGradient() {
          return { addColorStop() {} };
        },
        createPattern() {
          return {};
        },
        drawImage() {},
        putImageData() {},
        // Derived from the harvested PNG so the pixels vary and stay stable per profile.
        getImageData(x, y, w, h) {
          return {
            data: __canvasPixels(canvas, w, h),
            width: w | 0,
            height: h | 0,
            colorSpace: 'srgb',
          };
        },
        createImageData(w, h) {
          return {
            data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)),
            width: w | 0,
            height: h | 0,
          };
        },
        isPointInPath() {
          return false;
        },
        getContextAttributes() {
          return Object.assign({}, this.__attrs || __CTX_DEFAULTS['2d']);
        },
      };
    }
    if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
      const P = {
        7936: 'WebKit',
        7937: 'WebKit WebGL',
        7938: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
        35724: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
        37445: 'Google Inc. (Apple)',
        37446: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
        3379: 16384,
        34076: 16384,
        3386: [32767, 32767],
        36349: 1024,
        34921: 16,
        35660: 16,
        34930: 16,
        35661: 32,
        36347: 4095,
        3410: 8,
        3411: 8,
        3412: 8,
        3413: 8,
        3414: 24,
        3415: 8,
        33901: [1, 1],
        33902: [1, 1],
      };
      if (__M.webgl && __M.webgl.params) {
        for (const k in __M.webgl.params) P[k] = __M.webgl.params[k];
      }
      // Those were read from a WebGL 1 context, so the two strings that name the
      // context itself are wrong once they are handed to a WebGL 2 one.
      if (type === 'webgl2') {
        P[7938] = 'WebGL 2.0 (OpenGL ES 3.0 Chromium)';
        P[35724] = 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)';
      }
      const ENUMS = {
        VENDOR: 7936,
        RENDERER: 7937,
        VERSION: 7938,
        SHADING_LANGUAGE_VERSION: 35724,
        MAX_TEXTURE_SIZE: 3379,
        MAX_CUBE_MAP_TEXTURE_SIZE: 34076,
        MAX_VIEWPORT_DIMS: 3386,
        MAX_RENDERBUFFER_SIZE: 34024,
        MAX_VERTEX_ATTRIBS: 34921,
        MAX_VARYING_VECTORS: 36348,
        MAX_VERTEX_UNIFORM_VECTORS: 36347,
        MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
        MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
        MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660,
        MAX_TEXTURE_IMAGE_UNITS: 34930,
        ALIASED_LINE_WIDTH_RANGE: 33902,
        ALIASED_POINT_SIZE_RANGE: 33901,
        RED_BITS: 3410,
        GREEN_BITS: 3411,
        BLUE_BITS: 3412,
        ALPHA_BITS: 3413,
        DEPTH_BITS: 3414,
        STENCIL_BITS: 3415,
        SUBPIXEL_BITS: 3408,
        SAMPLES: 32937,
        SAMPLE_BUFFERS: 32936,
        MAX_DRAW_BUFFERS_WEBGL: 34852,
        UNMASKED_VENDOR_WEBGL: 37445,
        UNMASKED_RENDERER_WEBGL: 37446,
        COLOR_BUFFER_BIT: 16384,
        DEPTH_BUFFER_BIT: 256,
        STENCIL_BUFFER_BIT: 1024,
        TEXTURE_2D: 3553,
        TRIANGLES: 4,
        FLOAT: 5126,
        UNSIGNED_BYTE: 5121,
        ARRAY_BUFFER: 34962,
        STATIC_DRAW: 35044,
        VERTEX_SHADER: 35633,
        FRAGMENT_SHADER: 35632,
        COMPILE_STATUS: 35713,
        LINK_STATUS: 35714,
      };

      const ctx = {
        canvas,
        drawingBufferWidth: canvas.width || 300,
        drawingBufferHeight: canvas.height || 150,
        ...ENUMS,
        getParameter(p) {
          const H = (__M.webglParams && __M.webglParams[type === 'webgl2' ? 'gl2' : 'gl1']) || {};
          if (Object.prototype.hasOwnProperty.call(H, String(p))) return H[String(p)];
          return p in P ? P[p] : null;
        },
        getSupportedExtensions() {
          const H = __M.webglParams;
          if (H) {
            const list = type === 'webgl2' ? H.ext2 : H.ext1;
            if (Array.isArray(list) && list.length) return list.slice();
          }
          if (__M.webgl && Array.isArray(__M.webgl.extensions)) return __M.webgl.extensions.slice();
          // prettier-ignore
          return [
          'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float',
          'EXT_float_blend', 'EXT_frag_depth', 'EXT_shader_texture_lod',
          'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc',
          'EXT_texture_filter_anisotropic', 'EXT_sRGB', 'OES_element_index_uint',
          'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float',
          'OES_texture_float_linear', 'OES_texture_half_float', 'OES_texture_half_float_linear',
          'OES_vertex_array_object', 'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_astc',
          'WEBGL_compressed_texture_etc', 'WEBGL_compressed_texture_etc1',
          'WEBGL_compressed_texture_pvrtc', 'WEBGL_compressed_texture_s3tc',
          'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info',
          'WEBGL_debug_shaders', 'WEBGL_depth_texture', 'WEBGL_draw_buffers',
          'WEBGL_lose_context', 'WEBGL_multi_draw'
        ];
        },
        getExtension(n) {
          if (n === 'WEBGL_debug_renderer_info')
            return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
          if (n === 'WEBGL_lose_context') return { loseContext() {}, restoreContext() {} };
          if (n === 'EXT_texture_filter_anisotropic')
            return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047, TEXTURE_MAX_ANISOTROPY_EXT: 34046 };
          return {};
        },
        // Precision varies by shader stage and type on real hardware; one answer
        // for all twelve combinations is a fingerprint of its own.
        getShaderPrecisionFormat(stage, ptype) {
          const H = (__M.webglParams && __M.webglParams.shader) || {};
          const sName = stage === 35633 ? 'VERTEX_SHADER' : 'FRAGMENT_SHADER';
          const pNames = {
            36336: 'LOW_FLOAT',
            36337: 'MEDIUM_FLOAT',
            36338: 'HIGH_FLOAT',
            36339: 'LOW_INT',
            36340: 'MEDIUM_INT',
            36341: 'HIGH_INT',
          };
          const key = sName + '.' + (pNames[ptype] || 'HIGH_FLOAT');
          const v = H[key];
          if (v) return { rangeMin: v[0], rangeMax: v[1], precision: v[2] };
          return { rangeMin: 127, rangeMax: 127, precision: 23 };
        },
        getContextAttributes() {
          return Object.assign({}, this.__attrs || __CTX_DEFAULTS.webgl);
        },
        createBuffer() {
          return {};
        },
        bindBuffer() {},
        bufferData() {},
        createShader(kind) {
          return { __kind: kind, __src: '' };
        },
        shaderSource(sh, src) {
          if (sh) sh.__src = String(src);
        },
        compileShader() {},
        createProgram() {
          return { __shaders: [] };
        },
        attachShader(pr, sh) {
          if (pr && sh) pr.__shaders.push(sh);
        },
        linkProgram() {},
        useProgram(pr) {
          this.__program = pr;
        },
        getAttribLocation() {
          return 0;
        },
        getUniformLocation(pr, name) {
          if (!__uniformActive(pr, String(name))) return null;
          const loc = { __name: String(name), __program: pr };
          try {
            const C = globalThis.WebGLUniformLocation;
            if (typeof C === 'function' && C.prototype) Object.setPrototypeOf(loc, C.prototype);
          } catch (e) {}
          return loc;
        },
        enableVertexAttribArray() {},
        vertexAttribPointer() {},
        drawArrays() {
          this.__drawn = true;
        },
        drawElements() {},
        viewport() {},
        clearColor() {},
        clear() {},
        enable() {},
        disable() {},
        getProgramParameter() {
          return true;
        },
        getShaderParameter() {
          return true;
        },
        getError() {
          return 0;
        },
        uniform1f(loc, a) {
          __setUniform(this, loc, [a]);
        },
        uniform2f(loc, a, b) {
          __setUniform(this, loc, [a, b]);
        },
        uniform3f(loc, a, b, c) {
          __setUniform(this, loc, [a, b, c]);
        },
        uniform4f(loc, a, b, c, d) {
          __setUniform(this, loc, [a, b, c, d]);
        },
        uniform1i(loc, a) {
          __setUniform(this, loc, [a]);
        },
        uniform2i(loc, a, b) {
          __setUniform(this, loc, [a, b]);
        },
        uniform1fv(loc, v) {
          __setUniform(this, loc, Array.prototype.slice.call(v || []));
        },
        uniform2fv(loc, v) {
          __setUniform(this, loc, Array.prototype.slice.call(v || []));
        },
        uniform3fv(loc, v) {
          __setUniform(this, loc, Array.prototype.slice.call(v || []));
        },
        uniform4fv(loc, v) {
          __setUniform(this, loc, Array.prototype.slice.call(v || []));
        },
        uniformMatrix2fv() {},
        uniformMatrix3fv() {},
        uniformMatrix4fv() {},
        getShaderInfoLog() {
          return '';
        },
        getProgramInfoLog() {
          return '';
        },
        deleteShader() {},
        deleteProgram() {},
        deleteBuffer() {},
        detachShader() {},
        validateProgram() {},
        readPixels(x, y, w, h, fmt, type, out) {
          __shadePixels(this, w | 0, h | 0, out);
        },
        activeTexture() {},
        bindTexture() {},
        createTexture() {
          return {};
        },
        texParameteri() {},
        texImage2D() {},
        generateMipmap() {},
        isContextLost() {
          return false;
        },
      };
      return ctx;
    }
    return null;
  }

  function makeAudioNode(extra) {
    return Object.assign(
      {
        connect() {
          return makeAudioNode({});
        },
        disconnect() {},
        start() {},
        stop() {},
        frequency: { value: 440, setValueAtTime() {} },
        gain: { value: 1, setValueAtTime() {} },
        type: 'sine',
        channelCount: 2,
      },
      extra || {},
    );
  }
  const __AUDIO = (__M.media && __M.media.audio) || {};
  // The profile is deleted once it has been materialised, so the media
  // tables are carried forward for the fragments that load after it.
  globalThis.__MEDIA_TABLE = __M.media || {};
  globalThis.__MEDIA_QUERIES = __M.mediaQueries || {};
  globalThis.__STORAGE_EST = __M.storage || null;
  globalThis.__SYSTEM_FONTS = __M.systemFonts || {};
  globalThis.__UA_DATA = __M.uaData || {};
  globalThis.__GPU = __M.gpu || {};
  globalThis.__MEDIA_DEVICES = __M.mediaDevices || null;
  globalThis.__CONNECTION = __M.connection || null;
  globalThis.__VOICES = __M.voices || [];
  globalThis.__CSS_PROPS = __M.cssProperties || null;
  globalThis.__COMPUTED = __M.computedStyle || null;
  globalThis.__KB_LAYOUT = __M.keyboardLayout || null;
  globalThis.__BATTERY = __M.battery || null;
  globalThis.__ARITY = __M.arity || null;
  globalThis.__PLUGINS =
    (globalThis.__PROFILE &&
      globalThis.__PROFILE.navigator &&
      globalThis.__PROFILE.navigator.plugins) ||
    [];
  function __node(n, ctorName) {
    try {
      const C = globalThis[ctorName];
      if (n && typeof C === 'function' && C.prototype) Object.setPrototypeOf(n, C.prototype);
    } catch (e) {}
    return n;
  }

  function AudioContextShim() {
    this.sampleRate = __AUDIO.sampleRate || 48000;
    this.state = __AUDIO.state || 'suspended';
    this.baseLatency =
      __AUDIO.baseLatency !== undefined ? __AUDIO.baseLatency : 0.005333333333333333;
    this.outputLatency = __AUDIO.outputLatency !== undefined ? __AUDIO.outputLatency : 0;
    __defineOwn(this, 'currentTime', 0);
    this.destination = makeAudioNode({
      maxChannelCount: __AUDIO.maxChannelCount || 2,
      numberOfInputs: __AUDIO.numberOfInputs !== undefined ? __AUDIO.numberOfInputs : 1,
      numberOfOutputs: __AUDIO.numberOfOutputs !== undefined ? __AUDIO.numberOfOutputs : 0,
      channelCount: __AUDIO.channelCount || 2,
    });
    this.listener = {};
    this.createOscillator = () => __node(makeAudioNode({ type: 'sine' }), 'OscillatorNode');
    this.createGain = () => __node(makeAudioNode({}), 'GainNode');
    this.createAnalyser = () =>
      __node(
        makeAudioNode({
          fftSize: 2048,
          frequencyBinCount: 1024,
          getFloatFrequencyData(a) {
            for (let i = 0; i < a.length; i++) a[i] = -100 - (i % 30);
          },
          getByteFrequencyData(a) {
            for (let i = 0; i < a.length; i++) a[i] = 128 - (i % 30);
          },
        }),
        'AnalyserNode',
      );
    this.createDynamicsCompressor = () =>
      makeAudioNode({
        threshold: { value: -24 },
        knee: { value: 30 },
        ratio: { value: 12 },
        attack: { value: 0.003 },
        release: { value: 0.25 },
      });
    this.createScriptProcessor = () => makeAudioNode({});
    this.createBuffer = (c, l, r) => ({
      sampleRate: r,
      length: l,
      duration: l / r,
      numberOfChannels: c,
      getChannelData: () => {
        const a = new Float32Array(l);
        const src = __M.audio && __M.audio.slice;
        if (Array.isArray(src) && src.length) {
          for (let i = 0; i < l; i++) a[i] = src[i % src.length];
        }
        return a;
      },
    });
    this.createBufferSource = () => makeAudioNode({ buffer: null });
    this.startRendering = () => Promise.resolve(this.createBuffer(1, 44100, 44100));
    this.close = () => Promise.resolve();
    this.resume = () => Promise.resolve();
  }
  try {
    Object.defineProperty(AudioContextShim, 'name', { value: 'AudioContext', configurable: true });
  } catch (e) {}
  globalThis.AudioContext = AudioContextShim;
  const OfflineAudioContext = function OfflineAudioContext(ch, len, rate) {
    AudioContextShim.call(this);
    if (rate) this.sampleRate = rate;
    this.length = len || 0;
    this.startRendering = () => Promise.resolve(null);
  };
  OfflineAudioContext.prototype = AudioContextShim.prototype;
  globalThis.OfflineAudioContext = OfflineAudioContext;

  // OffscreenCanvas needs a real context: the profile only creates a bare
  // constructor, and the WebGL vendor and renderer are read through this path.
  globalThis.OffscreenCanvas = function OffscreenCanvas(w, h) {
    if (!(this instanceof globalThis.OffscreenCanvas)) {
      throw new TypeError("Failed to construct 'OffscreenCanvas': Please use the 'new' operator");
    }
    this.width = w | 0;
    this.height = h | 0;
    const self = this;
    this.getContext = function (type, attrs) {
      return makeContext(self, String(type), attrs);
    };
    this.convertToBlob = function () {
      return Promise.resolve({ size: 1024, type: 'image/png' });
    };
    this.transferToImageBitmap = function () {
      return { width: self.width, height: self.height, close() {} };
    };
    return this;
  };
  globalThis.OffscreenCanvas.prototype = { constructor: globalThis.OffscreenCanvas };
})();
