export type Verdict = 'ok' | 'challenged' | 'blocked' | 'rate-limited' | 'unreachable' | string;

export interface VeriOptions {
  /**
   * Proxy URL. Use a STICKY proxy if you rely on challenge clearing: clearance
   * is bound to the IP that earned it
   */
  proxy?: string;
  /** Clear challenges rather than only reporting them. Default true. */
  solver?: boolean;
  /** Pin one identity, disabling laddering. */
  identity?: string;
  /** Custom identity order. */
  ladder?: string[];
  /**
   * Total time for one attempt, redirects and body read included.
   * Default 60000. `0` removes it, which is rarely what you want.
   */
  timeoutMs?: number;
  /** Time allowed to establish a connection. Default 10000. */
  connectTimeoutMs?: number;
  /**
   * Retries per request, shared across the whole identity ladder rather than
   * per rung. Default 2. `0` disables retrying.
   */
  retries?: number;
  /**
   * Largest response body to buffer, in bytes. Default 67108864 (64 MiB).
   * `0` removes the cap, bodies are held in memory, so this is what stops one
   * oversized response taking down the process.
   */
  maxResponseBytes?: number;
  /**
   * Backstop for a daemon that accepts a request and never answers. Not the
   * request timeout, that is `timeoutMs`. Default 300000. `0` removes it.
   */
  daemonDeadlineMs?: number;
  /** Explicit path to the veri-daemon binary. */
  daemonPath?: string;
  /** Extra argv for the daemon, e.g. to run it through an interpreter. */
  daemonArgs?: string[];
}

/** Serialised with `String()`. An array repeats the key; `undefined` and `null` are dropped. */
export type ParamValue = string | number | boolean;

export interface RequestOptions {
  method?: string;
  url?: string;
  headers?: Record<string, ParamValue | ParamValue[]>;
  query?: Record<string, ParamValue | ParamValue[]>;
  json?: unknown;
  body?: string;
  /** Override the client's timeout for this request only. */
  timeoutMs?: number;
}

export interface ProbeRow {
  identity: string;
  verdict: Verdict;
  status: number;
  ms: number;
  bytes: number;
  protection: string | null;
  /** Providers named by the response headers, e.g. ['datadome','cloudfront']. */
  hints: string[];
  cleared: boolean;
}

export class VeriResponse {
  status: number;
  verdict: Verdict;
  /** Last value wins for repeated headers; use `getAll` for all of them. */
  headers: Record<string, string>;
  /** Every header as an ordered [name, value] pair, duplicates included. */
  headersList: Array<[string, string]>;
  /** Every value for a repeated header, in order. Use for `set-cookie`. */
  getAll(name: string): string[];
  body: string;
  identity: string;
  attempts: number;
  cleared: string | null;
  usedClearance: boolean;
  json<T = unknown>(): T;
  text(): string;
  bytes(): Buffer;
  readonly isBinary: boolean;
  /** HTTP 2xx. A challenge page can arrive with a 200, so this is not `ok`. */
  readonly isSuccess: boolean;
  /** A real response rather than a challenge or block. */
  readonly ok: boolean;
}

export class VeriError extends Error {
  /** The last response the ladder saw, when a rung answered at all. */
  response?: VeriResponse;
  /** Shorthand for `response.status`. */
  status?: number;
  /** Shorthand for `response.body`. */
  body?: string;
  sawChallenge?: boolean;
  /** Clearance was obtained but this path re-challenged anyway. */
  clearedButRechallenged?: boolean;
  /** A timeout was involved. Back off rather than treating it as a refusal. */
  timedOut?: boolean;
  /** No identity reached the host at all. */
  unreachable?: boolean;
}

export class Veri {
  constructor(opts?: VeriOptions);
  /** Version string the daemon reported at startup, once it has started. */
  daemonVersion?: string;
  request(opts: RequestOptions): Promise<VeriResponse>;
  get(url: string, opts?: RequestOptions): Promise<VeriResponse>;
  post(url: string, opts?: RequestOptions): Promise<VeriResponse>;
  put(url: string, opts?: RequestOptions): Promise<VeriResponse>;
  patch(url: string, opts?: RequestOptions): Promise<VeriResponse>;
  delete(url: string, opts?: RequestOptions): Promise<VeriResponse>;
  head(url: string, opts?: RequestOptions): Promise<VeriResponse>;
  /**
   * Change a setting on the live client. Anything that rebuilds it starts a
   * fresh cookie jar, so clearance earned earlier is gone: the reply's
   * `rebuilt` says whether that happened. Configure before the first request
   * where you can.
   */
  configure(opts: VeriOptions): Promise<unknown>;
  /**
   * Seed the jar for a host, so every later request carries it, including
   * every rung of the identity ladder. Merged with the jar, not swapped for it.
   */
  setCookie(host: string, cookie: string): Promise<void>;
  /** The value of a cookie the jar holds for a host, if any. */
  cookie(host: string, name: string): Promise<string | null>;
  /**
   * Drop every session for a host, cookies and clearance included. Returns how
   * many were dropped.
   */
  forget(host: string): Promise<number>;
  probe(url: string): Promise<ProbeRow[]>;
  info(): Promise<unknown>;
  close(): Promise<void>;
}
