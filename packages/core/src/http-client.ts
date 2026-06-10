import { KsaError, KsaErrorCodes } from "./errors.js";
import type { RedactNeedle } from "./redact.js";
import { redactSecrets } from "./redact.js";
import type { AuthStrategy, HttpRequest } from "./types.js";

/** Retry policy. Backoff is exponential with full jitter. */
export interface HttpClientRetry {
  retries: number;
  baseDelayMs: number;
}

/**
 * Constructor options for {@link HttpClient}.
 *
 * `timeoutMs` is mandatory — there are no unbounded outbound calls in the
 * suite (CONTRACT.md: "the #1 cause of hung checkouts").
 */
export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Authentication strategy; core builds and redacts the auth header. */
  auth?: AuthStrategy;
  headers?: Record<string, string>;
  retry?: HttpClientRetry;
  /** Extra secret strings/patterns to scrub from any thrown error message. */
  redact?: RedactNeedle[];
  /**
   * Allow `req.path` to be an absolute `http(s)://` URL, bypassing `baseUrl`.
   * Defaults to `false`: absolute paths are rejected so a connector can never
   * be steered to an attacker-controlled host (SSRF) by malformed input.
   */
  allowAbsoluteUrls?: boolean;
  /** Injectable fetch (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep (tests). Defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Build the auth header for a strategy plus the secret fragments that must be
 * scrubbed from any error message. Centralizes header assembly so no connector
 * hand-rolls an `Authorization` value (CONTRACT.md "Outbound HTTP").
 */
function buildAuthHeader(auth: AuthStrategy): {
  name: string;
  value: string;
  secrets: string[];
} {
  switch (auth.type) {
    case "bearer": {
      const value = `Bearer ${auth.token}`;
      // Redact both the full header value and the bare token, since providers
      // sometimes echo just the token back in an error body.
      return { name: "Authorization", value, secrets: [value, auth.token] };
    }
    case "basic": {
      const credentials = `${auth.username}:${auth.password}`;
      const encoded = Buffer.from(credentials, "utf8").toString("base64");
      const value = `Basic ${encoded}`;
      return {
        name: "Authorization",
        value,
        secrets: [value, encoded, credentials, auth.username, auth.password],
      };
    }
    case "api-key": {
      const name = auth.header ?? "Authorization";
      return { name, value: auth.value, secrets: [auth.value] };
    }
  }
}

/**
 * Serialize a query map into a URL query string, dropping `undefined` values so
 * connectors can build params conditionally without manual filtering.
 */
function serializeQuery(
  query: HttpRequest["query"],
): string {
  if (query === undefined) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    params.append(key, String(value));
  }
  return params.toString();
}

/** Default real sleep — overridable for deterministic tests. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The single outbound network path for the whole suite (ADR-0002).
 *
 * - Every call is bounded by `timeoutMs` via an `AbortController`.
 * - Retries (exponential backoff + full jitter) apply only to safe methods or
 *   requests explicitly flagged `idempotent`, on network errors / 429 / 5xx,
 *   honoring `Retry-After`, capped at `retry.retries`.
 * - All failures surface as {@link KsaError}; configured secrets and header
 *   values are redacted from every thrown message.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly baseHeaders: Record<string, string>;
  private readonly retry: HttpClientRetry;
  private readonly allowAbsoluteUrls: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly redactList: RedactNeedle[];

  constructor(opts: HttpClientOptions) {
    if (!opts.baseUrl) {
      throw new KsaError("HttpClient requires a non-empty baseUrl.", {
        prefix: "core",
        code: KsaErrorCodes.INVALID_OPTIONS,
      });
    }
    if (
      typeof opts.timeoutMs !== "number" ||
      !Number.isFinite(opts.timeoutMs) ||
      opts.timeoutMs <= 0
    ) {
      throw new KsaError(
        "HttpClient requires a finite, positive timeoutMs — unbounded calls are not allowed.",
        { prefix: "core", code: KsaErrorCodes.INVALID_OPTIONS },
      );
    }
    if (opts.retry !== undefined) {
      const { retries, baseDelayMs } = opts.retry;
      if (!Number.isInteger(retries) || retries < 0) {
        throw new KsaError(
          "HttpClient retry.retries must be a finite integer >= 0.",
          { prefix: "core", code: KsaErrorCodes.INVALID_OPTIONS },
        );
      }
      if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
        throw new KsaError(
          "HttpClient retry.baseDelayMs must be a finite number >= 0.",
          { prefix: "core", code: KsaErrorCodes.INVALID_OPTIONS },
        );
      }
    }

    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs;
    this.allowAbsoluteUrls = opts.allowAbsoluteUrls ?? false;

    // Assemble base headers, folding in the auth strategy's header (if any) so
    // a connector never builds an Authorization value by hand.
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const authSecrets: string[] = [];
    if (opts.auth !== undefined) {
      const { name, value, secrets } = buildAuthHeader(opts.auth);
      headers[name] = value;
      authSecrets.push(...secrets);
    }
    this.baseHeaders = headers;
    this.retry = opts.retry ?? { retries: 0, baseDelayMs: 0 };
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;

    // Secrets to scrub from error messages: explicit list + every header value
    // (auth tokens routinely live in headers) + the raw auth credential parts.
    // Empty values are ignored by redactSecrets itself.
    this.redactList = [
      ...(opts.redact ?? []),
      ...Object.values(this.baseHeaders),
      ...authSecrets,
    ];
  }

  async request<T>(req: HttpRequest): Promise<T> {
    const method = req.method.toUpperCase();
    const retryable = SAFE_METHODS.has(method) || req.idempotent === true;
    const maxAttempts = retryable ? this.retry.retries + 1 : 1;

    // Per-request secrets include header values supplied on this call.
    const perRequestSecrets: RedactNeedle[] = [
      ...this.redactList,
      ...Object.values(req.headers ?? {}),
    ];

    const timeoutMs = this.resolveTimeout(req.timeoutMs);
    const url = this.buildUrl(req.path, req.query);
    const headers = this.buildHeaders(req);
    const init = this.buildInit(method, req, headers);

    let attempt = 0;
    // Loop runs maxAttempts times; we either return, sleep+retry, or throw.
    for (;;) {
      attempt += 1;

      let response: Response | undefined;
      let transportError: unknown;
      try {
        response = await this.fetchWithTimeout(url, init, timeoutMs);
      } catch (err) {
        transportError = err;
      }

      // --- Transport (network/timeout/abort) error path ---
      if (transportError !== undefined) {
        if (retryable && attempt < maxAttempts) {
          await this.backoff(attempt, undefined);
          continue;
        }
        throw this.toTransportError(transportError, method, req.path, perRequestSecrets, timeoutMs);
      }

      const res = response!;

      // --- Retryable status path (429 / 5xx) ---
      if ((res.status === 429 || res.status >= 500) && retryable && attempt < maxAttempts) {
        await this.backoff(attempt, res.headers.get("retry-after"));
        continue;
      }

      // --- Non-2xx (terminal) ---
      if (!res.ok) {
        throw await this.toStatusError(res, method, req.path, perRequestSecrets);
      }

      // --- Success: parse JSON (tolerating empty bodies) ---
      return await this.parseBody<T>(res, method, req.path, perRequestSecrets);
    }
  }

  /**
   * Resolve the effective timeout for a request, validating any per-request
   * override (the public {@link HttpRequest} type exposes `timeoutMs`).
   */
  private resolveTimeout(perRequest: number | undefined): number {
    if (perRequest === undefined) {
      return this.timeoutMs;
    }
    if (
      typeof perRequest !== "number" ||
      !Number.isFinite(perRequest) ||
      perRequest <= 0
    ) {
      throw new KsaError(
        "Per-request timeoutMs must be a finite, positive number.",
        { prefix: "core", code: KsaErrorCodes.INVALID_INPUT },
      );
    }
    return perRequest;
  }

  private buildUrl(path: string, query: HttpRequest["query"]): string {
    const isAbsolute = /^https?:\/\//i.test(path);
    if (isAbsolute && !this.allowAbsoluteUrls) {
      throw new KsaError(
        "Absolute URLs are not allowed; pass a path relative to baseUrl " +
          "(set allowAbsoluteUrls to opt in).",
        { prefix: "core", code: KsaErrorCodes.INVALID_INPUT },
      );
    }

    const base = isAbsolute
      ? path
      : `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
    const qs = serializeQuery(query);
    if (qs === "") {
      return base;
    }
    return base.includes("?") ? `${base}&${qs}` : `${base}?${qs}`;
  }

  private buildHeaders(req: HttpRequest): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.baseHeaders,
      ...(req.headers ?? {}),
    };
    if (req.body !== undefined && headers["Content-Type"] === undefined && headers["content-type"] === undefined) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  private buildInit(
    method: string,
    req: HttpRequest,
    headers: Record<string, string>,
  ): RequestInit {
    const init: RequestInit = { method, headers };
    if (req.body !== undefined) {
      init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }
    return init;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exponential backoff + full jitter, honoring a `Retry-After` header. */
  private async backoff(attempt: number, retryAfter: string | null | undefined): Promise<void> {
    const retryAfterMs = this.parseRetryAfter(retryAfter);
    if (retryAfterMs !== undefined) {
      await this.sleepImpl(retryAfterMs);
      return;
    }
    const exp = this.retry.baseDelayMs * 2 ** (attempt - 1);
    const jittered = Math.floor(Math.random() * (exp + 1));
    await this.sleepImpl(jittered);
  }

  /** Supports both delta-seconds and HTTP-date forms of `Retry-After`. */
  private parseRetryAfter(value: string | null | undefined): number | undefined {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const date = Date.parse(value);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - Date.now());
    }
    return undefined;
  }

  private async parseBody<T>(
    res: Response,
    method: string,
    path: string,
    secrets: RedactNeedle[],
  ): Promise<T> {
    const text = await res.text();
    if (text === "") {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new KsaError(
        redactSecrets(
          `${method} ${path} returned ${res.status} but the body was not valid JSON.`,
          secrets,
        ),
        { prefix: "core", code: KsaErrorCodes.HTTP_ERROR },
      );
    }
  }

  private toTransportError(
    err: unknown,
    method: string,
    path: string,
    secrets: RedactNeedle[],
    timeoutMs: number,
  ): KsaError {
    const aborted =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    const detail = err instanceof Error ? err.message : String(err);
    const message = aborted
      ? `${method} ${path} timed out after ${timeoutMs}ms.`
      : `${method} ${path} failed before a response was received: ${detail}`;
    return new KsaError(redactSecrets(message, secrets), {
      prefix: "core",
      code: KsaErrorCodes.HTTP_ERROR,
      cause: err,
    });
  }

  private async toStatusError(
    res: Response,
    method: string,
    path: string,
    secrets: RedactNeedle[],
  ): Promise<KsaError> {
    let bodySnippet = "";
    try {
      bodySnippet = (await res.text()).slice(0, 500);
    } catch {
      bodySnippet = "";
    }
    const message = `${method} ${path} responded ${res.status} ${res.statusText}${
      bodySnippet ? `: ${bodySnippet}` : ""
    }`;
    return new KsaError(redactSecrets(message, secrets), {
      prefix: "core",
      code: KsaErrorCodes.HTTP_ERROR,
    });
  }
}
