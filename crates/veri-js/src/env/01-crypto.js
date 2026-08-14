(function () {
  globalThis.__sha256 = function __sha256(bytes) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
      0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
      0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
      0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
      0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
      0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
      0xc67178f2,
    ];
    let h = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
      0x5be0cd19,
    ];
    const l = bytes.length,
      bl = l * 8,
      wl = (((l + 8) >> 6) + 1) * 16,
      m = new Int32Array(wl);
    for (let i = 0; i < l; i++) m[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    m[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    m[wl - 1] = bl;
    const w = new Int32Array(64);
    const rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < wl; i += 16) {
      for (let j = 0; j < 16; j++) w[j] = m[i + j];
      for (let j = 16; j < 64; j++) {
        const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let j = 0; j < 64; j++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25),
          ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[j] + w[j]) | 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22),
          mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      h = [
        (h[0] + a) | 0,
        (h[1] + b) | 0,
        (h[2] + c) | 0,
        (h[3] + d) | 0,
        (h[4] + e) | 0,
        (h[5] + f) | 0,
        (h[6] + g) | 0,
        (h[7] + hh) | 0,
      ];
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = h[i] >>> 24;
      out[i * 4 + 1] = (h[i] >>> 16) & 255;
      out[i * 4 + 2] = (h[i] >>> 8) & 255;
      out[i * 4 + 3] = h[i] & 255;
    }
    return out;
  };
  globalThis.__B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  globalThis.__b64 = function __b64(bytes) {
    const T = globalThis.__B64_CHARS;
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i],
        b = bytes[i + 1],
        c = bytes[i + 2];
      out += T[a >> 2] + T[((a & 3) << 4) | ((b || 0) >> 4)];
      out += i + 1 < bytes.length ? T[((b & 15) << 2) | ((c || 0) >> 6)] : '=';
      out += i + 2 < bytes.length ? T[c & 63] : '=';
    }
    return out;
  };

  globalThis.__unb64 = function __unb64(s) {
    const T = globalThis.__B64_CHARS;
    const clean = String(s).replace(/[^A-Za-z0-9+/]/g, '');
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let n = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const a = T.indexOf(clean[i]),
        b = T.indexOf(clean[i + 1]),
        c = T.indexOf(clean[i + 2]),
        d = T.indexOf(clean[i + 3]);
      const v = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
      out[n++] = (v >> 16) & 255;
      if (c >= 0) out[n++] = (v >> 8) & 255;
      if (d >= 0) out[n++] = v & 255;
    }
    return out.subarray(0, n);
  };

  globalThis.__toBytes = function __toBytes(d) {
    if (!d) return new Uint8Array(0);
    if (d instanceof Uint8Array) return d;
    if (d.buffer) return new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength);
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    return new Uint8Array(0);
  };
  // AES-GCM. A pass-through `encrypt` returned the plaintext, and AWS WAF's
  // challenge encrypts its signal blob before submitting it - so the payload went
  // out readable, the token came back, and the edge refused it.
  const __AES_SBOX = (function () {
    const s = new Uint8Array(256);
    const inv = new Uint8Array(256);
    let p = 1,
      q = 1;
    do {
      p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
      q ^= q << 1;
      q ^= q << 2;
      q ^= q << 4;
      q &= 0xff;
      if (q & 0x80) q ^= 0x09;
      const x =
        q ^
        ((q << 1) | (q >> 7)) ^
        ((q << 2) | (q >> 6)) ^
        ((q << 3) | (q >> 5)) ^
        ((q << 4) | (q >> 4));
      s[p] = (x ^ 0x63) & 0xff;
      inv[s[p]] = p;
    } while (p !== 1);
    s[0] = 0x63;
    return s;
  })();

  function __xtime(a) {
    return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
  }

  function __aesExpandKey(key) {
    const nk = key.length / 4;
    const rounds = nk + 6;
    const w = new Uint8Array(16 * (rounds + 1));
    w.set(key);
    let rcon = 1;
    for (let i = nk; i < 4 * (rounds + 1); i++) {
      let t0 = w[(i - 1) * 4],
        t1 = w[(i - 1) * 4 + 1],
        t2 = w[(i - 1) * 4 + 2],
        t3 = w[(i - 1) * 4 + 3];
      if (i % nk === 0) {
        const tmp = t0;
        t0 = __AES_SBOX[t1] ^ rcon;
        t1 = __AES_SBOX[t2];
        t2 = __AES_SBOX[t3];
        t3 = __AES_SBOX[tmp];
        rcon = __xtime(rcon);
      } else if (nk > 6 && i % nk === 4) {
        t0 = __AES_SBOX[t0];
        t1 = __AES_SBOX[t1];
        t2 = __AES_SBOX[t2];
        t3 = __AES_SBOX[t3];
      }
      w[i * 4] = w[(i - nk) * 4] ^ t0;
      w[i * 4 + 1] = w[(i - nk) * 4 + 1] ^ t1;
      w[i * 4 + 2] = w[(i - nk) * 4 + 2] ^ t2;
      w[i * 4 + 3] = w[(i - nk) * 4 + 3] ^ t3;
    }
    return { w, rounds };
  }

  function __aesEncryptBlock(ks, block) {
    const s = block.slice();
    const { w, rounds } = ks;
    for (let i = 0; i < 16; i++) s[i] ^= w[i];
    for (let r = 1; r <= rounds; r++) {
      for (let i = 0; i < 16; i++) s[i] = __AES_SBOX[s[i]];
      // ShiftRows, on the column-major state AES defines.
      let t = s[1];
      s[1] = s[5];
      s[5] = s[9];
      s[9] = s[13];
      s[13] = t;
      t = s[2];
      s[2] = s[10];
      s[10] = t;
      t = s[6];
      s[6] = s[14];
      s[14] = t;
      t = s[15];
      s[15] = s[11];
      s[11] = s[7];
      s[7] = s[3];
      s[3] = t;
      if (r !== rounds) {
        for (let c = 0; c < 4; c++) {
          const o = c * 4;
          const a0 = s[o],
            a1 = s[o + 1],
            a2 = s[o + 2],
            a3 = s[o + 3];
          const all = a0 ^ a1 ^ a2 ^ a3;
          s[o] ^= all ^ __xtime(a0 ^ a1);
          s[o + 1] ^= all ^ __xtime(a1 ^ a2);
          s[o + 2] ^= all ^ __xtime(a2 ^ a3);
          s[o + 3] ^= all ^ __xtime(a3 ^ a0);
        }
      }
      for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
    }
    return s;
  }

  // Multiplication in GF(2^128) with the bit ordering GCM specifies.
  function __ghashMul(X, Y) {
    const z = new Uint8Array(16);
    const v = Y.slice();
    for (let i = 0; i < 128; i++) {
      if ((X[i >> 3] >> (7 - (i & 7))) & 1) {
        for (let j = 0; j < 16; j++) z[j] ^= v[j];
      }
      const lsb = v[15] & 1;
      for (let j = 15; j > 0; j--) v[j] = ((v[j] >> 1) | ((v[j - 1] & 1) << 7)) & 0xff;
      v[0] >>= 1;
      if (lsb) v[0] ^= 0xe1;
    }
    return z;
  }

  function __ghash(H, data) {
    let y = new Uint8Array(16);
    for (let i = 0; i < data.length; i += 16) {
      const block = new Uint8Array(16);
      block.set(data.subarray(i, Math.min(i + 16, data.length)));
      for (let j = 0; j < 16; j++) y[j] ^= block[j];
      y = __ghashMul(y, H);
    }
    return y;
  }

  function __gcmLengths(aadLen, ctLen) {
    const b = new Uint8Array(16);
    const hi = Math.floor((aadLen * 8) / 0x100000000);
    const lo = (aadLen * 8) >>> 0;
    b[0] = (hi >>> 24) & 0xff;
    b[1] = (hi >>> 16) & 0xff;
    b[2] = (hi >>> 8) & 0xff;
    b[3] = hi & 0xff;
    b[4] = (lo >>> 24) & 0xff;
    b[5] = (lo >>> 16) & 0xff;
    b[6] = (lo >>> 8) & 0xff;
    b[7] = lo & 0xff;
    const hi2 = Math.floor((ctLen * 8) / 0x100000000);
    const lo2 = (ctLen * 8) >>> 0;
    b[8] = (hi2 >>> 24) & 0xff;
    b[9] = (hi2 >>> 16) & 0xff;
    b[10] = (hi2 >>> 8) & 0xff;
    b[11] = hi2 & 0xff;
    b[12] = (lo2 >>> 24) & 0xff;
    b[13] = (lo2 >>> 16) & 0xff;
    b[14] = (lo2 >>> 8) & 0xff;
    b[15] = lo2 & 0xff;
    return b;
  }

  function __gcmCore(keyBytes, iv, input, aad, tagLenBytes) {
    const ks = __aesExpandKey(keyBytes);
    const H = __aesEncryptBlock(ks, new Uint8Array(16));
    let J0;
    if (iv.length === 12) {
      J0 = new Uint8Array(16);
      J0.set(iv);
      J0[15] = 1;
    } else {
      const padded = new Uint8Array(Math.ceil(iv.length / 16) * 16 + 16);
      padded.set(iv);
      padded.set(__gcmLengths(0, iv.length), padded.length - 16);
      J0 = __ghash(H, padded);
    }
    const counter = J0.slice();
    const inc = () => {
      for (let i = 15; i >= 12; i--) {
        counter[i] = (counter[i] + 1) & 0xff;
        if (counter[i] !== 0) break;
      }
    };
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i += 16) {
      inc();
      const ks2 = __aesEncryptBlock(ks, counter);
      const n = Math.min(16, input.length - i);
      for (let j = 0; j < n; j++) out[i + j] = input[i + j] ^ ks2[j];
    }
    return { ks, H, J0, out, tagLenBytes };
  }

  globalThis.__aesGcmEncrypt = function (keyBytes, iv, plain, aad, tagLenBytes) {
    const t = tagLenBytes || 16;
    const { ks, H, J0, out } = __gcmCore(keyBytes, iv, plain, aad, t);
    const a = aad || new Uint8Array(0);
    const buf = new Uint8Array(
      Math.ceil(a.length / 16) * 16 + Math.ceil(out.length / 16) * 16 + 16,
    );
    buf.set(a, 0);
    buf.set(out, Math.ceil(a.length / 16) * 16);
    buf.set(__gcmLengths(a.length, out.length), buf.length - 16);
    const S = __ghash(H, buf);
    const E = __aesEncryptBlock(ks, J0);
    const res = new Uint8Array(out.length + t);
    res.set(out);
    for (let i = 0; i < t; i++) res[out.length + i] = S[i] ^ E[i];
    return res;
  };

  globalThis.__aesGcmDecrypt = function (keyBytes, iv, data, aad, tagLenBytes) {
    const t = tagLenBytes || 16;
    if (data.length < t) return null;
    const ct = data.subarray(0, data.length - t);
    const tag = data.subarray(data.length - t);
    const { ks, H, J0, out } = __gcmCore(keyBytes, iv, ct, aad, t);
    const a = aad || new Uint8Array(0);
    const buf = new Uint8Array(Math.ceil(a.length / 16) * 16 + Math.ceil(ct.length / 16) * 16 + 16);
    buf.set(a, 0);
    buf.set(ct, Math.ceil(a.length / 16) * 16);
    buf.set(__gcmLengths(a.length, ct.length), buf.length - 16);
    const S = __ghash(H, buf);
    const E = __aesEncryptBlock(ks, J0);
    for (let i = 0; i < t; i++) {
      if ((S[i] ^ E[i]) !== tag[i]) return null;
    }
    return out;
  };

  const __SUBTLE = {
    digest(alg, data) {
      const name = (typeof alg === 'string' ? alg : (alg && alg.name) || '').toUpperCase();
      if (name === 'SHA-256' || name === '')
        return Promise.resolve(__sha256(__toBytes(data)).buffer);
      return Promise.reject(new Error('Unrecognized algorithm name: ' + name));
    },
    importKey(_f, key, alg, extractable, usages) {
      const raw = __toBytes(key);
      return Promise.resolve({
        type: 'secret',
        extractable: extractable !== false,
        algorithm: { name: (alg && alg.name) || 'AES-GCM', length: raw.length * 8 },
        usages: usages || ['encrypt', 'decrypt'],
        __raw: raw,
      });
    },
    exportKey(_f, key) {
      return Promise.resolve((key && key.__raw ? key.__raw : new Uint8Array(32)).buffer);
    },
    generateKey() {
      return Promise.resolve({
        type: 'secret',
        extractable: true,
        algorithm: { name: 'AES-GCM', length: 256 },
        usages: ['encrypt', 'decrypt'],
        __raw: new Uint8Array(32),
      });
    },
    encrypt(alg, key, data) {
      const name = ((alg && alg.name) || '').toUpperCase();
      if (name !== 'AES-GCM') {
        return Promise.reject(new Error('Unrecognized algorithm name: ' + name));
      }
      const iv = __toBytes(alg.iv);
      const aad = alg.additionalData ? __toBytes(alg.additionalData) : new Uint8Array(0);
      const tag = alg.tagLength ? alg.tagLength / 8 : 16;
      const raw = (key && key.__raw) || new Uint8Array(16);
      return Promise.resolve(__aesGcmEncrypt(raw, iv, __toBytes(data), aad, tag).buffer);
    },
    decrypt(alg, key, data) {
      const name = ((alg && alg.name) || '').toUpperCase();
      if (name !== 'AES-GCM') {
        return Promise.reject(new Error('Unrecognized algorithm name: ' + name));
      }
      const iv = __toBytes(alg.iv);
      const aad = alg.additionalData ? __toBytes(alg.additionalData) : new Uint8Array(0);
      const tag = alg.tagLength ? alg.tagLength / 8 : 16;
      const raw = (key && key.__raw) || new Uint8Array(16);
      const out = __aesGcmDecrypt(raw, iv, __toBytes(data), aad, tag);
      return out ? Promise.resolve(out.buffer) : Promise.reject(new Error('OperationError'));
    },
    sign(_a, _k, data) {
      return Promise.resolve(__sha256(__toBytes(data)).buffer);
    },
    verify() {
      return Promise.resolve(true);
    },
    deriveBits() {
      return Promise.resolve(new Uint8Array(32).buffer);
    },
    deriveKey() {
      return Promise.resolve({
        type: 'secret',
        algorithm: { name: 'AES-GCM', length: 256 },
        __raw: new Uint8Array(32),
      });
    },
    wrapKey() {
      return Promise.resolve(new Uint8Array(32).buffer);
    },
    unwrapKey() {
      return Promise.resolve({ type: 'secret', __raw: new Uint8Array(32) });
    },
  };
  globalThis.SubtleCrypto = function SubtleCrypto() {};
  globalThis.CryptoKey = function CryptoKey() {};

  const __TAG_CTOR = {
    A: 'HTMLAnchorElement',
    AREA: 'HTMLAreaElement',
    AUDIO: 'HTMLAudioElement',
    BASE: 'HTMLBaseElement',
    BODY: 'HTMLBodyElement',
    BR: 'HTMLBRElement',
    BUTTON: 'HTMLButtonElement',
    CANVAS: 'HTMLCanvasElement',
    DIV: 'HTMLDivElement',
    DL: 'HTMLDListElement',
    EMBED: 'HTMLEmbedElement',
    FIELDSET: 'HTMLFieldSetElement',
    FORM: 'HTMLFormElement',
    H1: 'HTMLHeadingElement',
    H2: 'HTMLHeadingElement',
    H3: 'HTMLHeadingElement',
    H4: 'HTMLHeadingElement',
    H5: 'HTMLHeadingElement',
    H6: 'HTMLHeadingElement',
    HEAD: 'HTMLHeadElement',
    HR: 'HTMLHRElement',
    HTML: 'HTMLHtmlElement',
    IFRAME: 'HTMLIFrameElement',
    IMG: 'HTMLImageElement',
    INPUT: 'HTMLInputElement',
    LABEL: 'HTMLLabelElement',
    LI: 'HTMLLIElement',
    LINK: 'HTMLLinkElement',
    META: 'HTMLMetaElement',
    OBJECT: 'HTMLObjectElement',
    OL: 'HTMLOListElement',
    OPTION: 'HTMLOptionElement',
    P: 'HTMLParagraphElement',
    PRE: 'HTMLPreElement',
    SCRIPT: 'HTMLScriptElement',
    SELECT: 'HTMLSelectElement',
    SLOT: 'HTMLSlotElement',
    SOURCE: 'HTMLSourceElement',
    SPAN: 'HTMLSpanElement',
    STYLE: 'HTMLStyleElement',
    TABLE: 'HTMLTableElement',
    TEMPLATE: 'HTMLTemplateElement',
    TEXTAREA: 'HTMLTextAreaElement',
    TITLE: 'HTMLTitleElement',
    UL: 'HTMLUListElement',
    VIDEO: 'HTMLVideoElement',
    SVG: 'SVGSVGElement',
    PATH: 'SVGPathElement',
    CIRCLE: 'SVGCircleElement',
    G: 'SVGGElement',
  };

  globalThis.TextEncoder = function TextEncoder() {
    this.encoding = 'utf-8';
    this.encode = function (str) {
      str = String(str === undefined ? '' : str);
      const out = [];
      for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
          const n = str.charCodeAt(i + 1);
          if (n >= 0xdc00 && n <= 0xdfff) {
            c = 0x10000 + ((c - 0xd800) << 10) + (n - 0xdc00);
            i++;
          }
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else
          out.push(
            0xf0 | (c >> 18),
            0x80 | ((c >> 12) & 63),
            0x80 | ((c >> 6) & 63),
            0x80 | (c & 63),
          );
      }
      return new Uint8Array(out);
    };
    this.encodeInto = function (str, dest) {
      const enc = this.encode(str);
      const n = Math.min(enc.length, dest.length);
      for (let i = 0; i < n; i++) dest[i] = enc[i];
      return { read: str.length, written: n };
    };
  };
  globalThis.TextDecoder = function TextDecoder(enc) {
    this.encoding = (enc || 'utf-8').toLowerCase();
    this.fatal = false;
    this.ignoreBOM = false;
    this.decode = function (buf) {
      if (buf === undefined || buf === null) return '';
      const b = ArrayBuffer.isView(buf)
        ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        : new Uint8Array(buf);
      let out = '';
      for (let i = 0; i < b.length;) {
        const c = b[i];
        if (c < 0x80) {
          out += String.fromCharCode(c);
          i += 1;
        } else if (c < 0xe0) {
          out += String.fromCharCode(((c & 31) << 6) | (b[i + 1] & 63));
          i += 2;
        } else if (c < 0xf0) {
          out += String.fromCharCode(((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63));
          i += 3;
        } else {
          const cp =
            ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63);
          const v = cp - 0x10000;
          out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
          i += 4;
        }
      }
      return out;
    };
  };

  globalThis.__SUBTLE = __SUBTLE;
  globalThis.__TAG_CTOR = __TAG_CTOR;
})();
