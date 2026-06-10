import { KsaError, KsaErrorCodes } from "./errors.js";
import { redactSecrets } from "./redact.js";

/**
 * Per-request shape accepted by {@link HttpClient.request}.
 *
 * `idempotent` marks a non-safe method (POST/PUT/PATCH/DELETE) as safe to
 * retry. Safe methods (GET/HEAD) are always retryable.
 */
export interface HttpClientRequest {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  idempotent?: boolean;
}

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
  headers?: Record<string, string>;
  retry?: HttpClientRetry;
  /** Extra secret strings to scrub from any thrown error message. */
  redact?: string[];
  /** Injectable fetch (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep (tests). Defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

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
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly redactList: string[];

  constructor(opts: HttpClientOptions) {
    if (!opts.baseUrl) {
      throw new KsaError("HttpClient requires a non-empty baseUrl.", {
        prefix: "core",
        code: KsaErrorCodes.INVALID_OPTIONS,
      });
    }
    if (typeof opts.timeoutMs !== "number" || opts.timeoutMs <= 0) {
      throw new KsaError(
        "HttpClient requires a positive timeoutMs — unbounded calls are not allowed.",
        { prefix: "core", code: KsaErrorCodes.INVALID_OPTIONS },
      );
    }

    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs;
    this.baseHeaders = opts.headers ?? {};
    this.retry = opts.retry ?? { retries: 0, baseDelayMs: 0 };
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;

    // Secrets to scrub from error messages: explicit list + every header value
    // (auth tokens routinely live in headers). Empty values are ignored by
    // redactSecrets itself.
    this.redactList = [...(opts.redact ?? []), ...Object.values(this.baseHeaders)];
  }

  async request<T>(req: HttpClientRequest): Promise<T> {
    const method = req.method.toUpperCase();
    const retryable = SAFE_METHODS.has(method) || req.idempotent === true;
    const maxAttempts = retryable ? this.retry.retries + 1 : 1;

    // Per-request secrets include header values supplied on this call.
    const perRequestSecrets = [
      ...this.redactList,
      ...Object.values(req.headers ?? {}),
    ];

    const url = this.buildUrl(req.path);
    const headers = this.buildHeaders(req);
    const init = this.buildInit(method, req, headers);

    let attempt = 0;
    // Loop runs maxAttempts times; we either return, sleep+retry, or throw.
    for (;;) {
      attempt += 1;

      let response: Response | undefined;
      let transportError: unknown;
      try {
        response = await this.fetchWithTimeout(url, init);
      } catch (err) {
        transportError = err;
      }

      // --- Transport (network/timeout/abort) error path ---
      if (transportError !== undefined) {
        if (retryable && attempt < maxAttempts) {
          await this.backoff(attempt, undefined);
          continue;
        }
        throw this.toTransportError(transportError, method, req.path, perRequestSecrets);
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

  private buildUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }

  private buildHeaders(req: HttpClientRequest): Record<string, string> {
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
    req: HttpClientRequest,
    headers: Record<string, string>,
  ): RequestInit {
    const init: RequestInit = { method, headers };
    if (req.body !== undefined) {
      init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }
    return init;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
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
    secrets: string[],
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
    secrets: string[],
  ): KsaError {
    const aborted =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    const detail = err instanceof Error ? err.message : String(err);
    const message = aborted
      ? `${method} ${path} timed out after ${this.timeoutMs}ms.`
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
    secrets: string[],
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
