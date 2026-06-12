import { HttpClient, KsaError, KsaErrorCodes } from "@medusa-ksa/core";
import type { HttpClientRetry, HttpRequest } from "@medusa-ksa/core";

import {
  DEFAULTS,
  TOROD_HTTP_ERROR_MARKERS,
  TOROD_HTTP_HEADERS,
  TOROD_HTTP_METHOD,
  TOROD_MEDIA_TYPES,
  TOROD_PREFIX,
  TOROD_REQUEST_FIELDS,
  TOROD_TOKEN,
} from "./constants.js";

export interface TorodClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  timeoutMs?: number;
  retry?: HttpClientRetry;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
}

interface TorodTokenResponse {
  status?: boolean;
  code?: number;
  message?: string;
  data?: TorodTokenData;
}

interface TorodTokenData {
  [TOROD_TOKEN.RESPONSE_TOKEN_FIELD]?: string;
  [TOROD_TOKEN.GENERATED_DATE_FIELD]?: string;
  [TOROD_TOKEN.EXPIRES_IN_FIELD]?: string | number;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export class TorodClient {
  private readonly options: Required<
    Pick<TorodClientOptions, "clientId" | "clientSecret">
  > &
    Pick<TorodClientOptions, "fetchImpl" | "sleepImpl"> & {
      baseUrl: string;
      timeoutMs: number;
      retry: HttpClientRetry;
      nowImpl: () => number;
    };

  private cachedToken: CachedToken | undefined;

  constructor(options: TorodClientOptions) {
    this.options = {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      baseUrl: options.baseUrl ?? DEFAULTS.BASE_URL,
      timeoutMs: options.timeoutMs ?? DEFAULTS.TIMEOUT_MS,
      retry:
        options.retry ?? {
          retries: DEFAULTS.RETRY.RETRIES,
          baseDelayMs: DEFAULTS.RETRY.BASE_DELAY_MS,
        },
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
      nowImpl: options.nowImpl ?? Date.now,
    };
  }

  async request<T>(request: HttpRequest): Promise<T> {
    const token = await this.getBearerToken();
    const encodedRequest = this.formEncodedRequest(request);
    try {
      return await this.authedHttp(token).request<T>(encodedRequest);
    } catch (err) {
      if (!this.isUnauthorized(err)) {
        throw err;
      }
      const refreshed = await this.refreshBearerToken();
      return await this.authedHttp(refreshed).request<T>(encodedRequest);
    }
  }

  private async getBearerToken(): Promise<string> {
    if (
      this.cachedToken !== undefined &&
      this.cachedToken.expiresAtMs > this.options.nowImpl()
    ) {
      return this.cachedToken.token;
    }
    return await this.refreshBearerToken();
  }

  private async refreshBearerToken(): Promise<string> {
    const tokenResponse = await this.fetchToken();
    const token = tokenResponse.data?.[TOROD_TOKEN.RESPONSE_TOKEN_FIELD];
    if (typeof token !== "string" || token.length === 0) {
      throw new KsaError("Torod token response did not include a bearer token.", {
        prefix: TOROD_PREFIX,
        code: KsaErrorCodes.PROVIDER_ERROR,
      });
    }
    this.cachedToken = {
      token,
      expiresAtMs: this.resolveTokenExpiry(tokenResponse),
    };
    return token;
  }

  private async fetchToken(): Promise<TorodTokenResponse> {
    try {
      return await this.tokenHttp().request<TorodTokenResponse>({
        method: TOROD_HTTP_METHOD.POST,
        path: TOROD_TOKEN.PATH,
        body: {
          [TOROD_REQUEST_FIELDS.CLIENT_ID]: this.options.clientId,
          [TOROD_REQUEST_FIELDS.CLIENT_SECRET]: this.options.clientSecret,
        },
      });
    } catch (err) {
      if (!this.isTokenContentTypeError(err)) {
        throw err;
      }
      return await this.tokenHttp().request<TorodTokenResponse>({
        method: TOROD_HTTP_METHOD.POST,
        path: TOROD_TOKEN.PATH,
        headers: {
          [TOROD_HTTP_HEADERS.CONTENT_TYPE]: TOROD_MEDIA_TYPES.FORM_URLENCODED,
        },
        body: this.formEncodedTokenBody(),
      });
    }
  }

  private tokenHttp(): HttpClient {
    return new HttpClient({
      baseUrl: this.options.baseUrl,
      timeoutMs: this.options.timeoutMs,
      retry: { retries: 0, baseDelayMs: 0 },
      redact: [this.options.clientId, this.options.clientSecret],
      fetchImpl: this.options.fetchImpl,
      sleepImpl: this.options.sleepImpl,
    });
  }

  private authedHttp(token: string): HttpClient {
    return new HttpClient({
      baseUrl: this.options.baseUrl,
      timeoutMs: this.options.timeoutMs,
      auth: { type: "bearer", token },
      retry: this.options.retry,
      redact: [this.options.clientId, this.options.clientSecret],
      fetchImpl: this.options.fetchImpl,
      sleepImpl: this.options.sleepImpl,
    });
  }

  private formEncodedTokenBody(): string {
    const body = new URLSearchParams();
    body.set(TOROD_REQUEST_FIELDS.CLIENT_ID, this.options.clientId);
    body.set(TOROD_REQUEST_FIELDS.CLIENT_SECRET, this.options.clientSecret);
    return body.toString();
  }

  private formEncodedRequest(request: HttpRequest): HttpRequest {
    if (
      request.body === undefined ||
      typeof request.body === "string" ||
      !this.isRecord(request.body) ||
      this.hasContentTypeHeader(request.headers)
    ) {
      return request;
    }

    return {
      ...request,
      headers: {
        ...(request.headers ?? {}),
        [TOROD_HTTP_HEADERS.CONTENT_TYPE]: TOROD_MEDIA_TYPES.FORM_URLENCODED,
      },
      body: this.formEncodedBody(request.body),
    };
  }

  private formEncodedBody(value: Record<string, unknown>): string {
    const body = new URLSearchParams();
    for (const [key, raw] of Object.entries(value)) {
      if (raw === undefined) {
        continue;
      }
      body.set(key, this.formEncodedValue(raw));
    }
    return body.toString();
  }

  private formEncodedValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value.toString();
    }
    if (typeof value === "boolean") {
      return value.toString();
    }
    throw new KsaError("Torod form request body values must be primitive.", {
      prefix: TOROD_PREFIX,
      code: KsaErrorCodes.INVALID_INPUT,
    });
  }

  private hasContentTypeHeader(
    headers: Record<string, string> | undefined,
  ): boolean {
    if (headers === undefined) {
      return false;
    }
    const contentTypeHeader = TOROD_HTTP_HEADERS.CONTENT_TYPE.toLowerCase();
    return Object.keys(headers).some(
      (header) => header.toLowerCase() === contentTypeHeader,
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private resolveTokenExpiry(response: TorodTokenResponse): number {
    const generatedAt = this.parseGeneratedAt(response);
    const expiresInMs = this.parseExpiresIn(response.data?.expires_in);
    return generatedAt + expiresInMs;
  }

  private parseGeneratedAt(response: TorodTokenResponse): number {
    const raw = response.data?.[TOROD_TOKEN.GENERATED_DATE_FIELD];
    if (typeof raw === "string") {
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return this.options.nowImpl();
  }

  private parseExpiresIn(value: string | number | undefined): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value * 1000;
    }
    if (typeof value !== "string") {
      return TOROD_TOKEN.FALLBACK_EXPIRES_IN_HOURS * 60 * 60 * 1000;
    }
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return TOROD_TOKEN.FALLBACK_EXPIRES_IN_HOURS * 60 * 60 * 1000;
    }
    const normalized = value.toLowerCase();
    if (normalized.includes("day")) {
      return amount * 24 * 60 * 60 * 1000;
    }
    if (normalized.includes("hour")) {
      return amount * 60 * 60 * 1000;
    }
    if (normalized.includes("minute")) {
      return amount * 60 * 1000;
    }
    return amount * 1000;
  }

  private isUnauthorized(err: unknown): boolean {
    return (
      KsaError.isKsaError(err) &&
      err.code === KsaErrorCodes.HTTP_ERROR &&
      err.message.includes(TOROD_HTTP_ERROR_MARKERS.UNAUTHORIZED)
    );
  }

  private isTokenContentTypeError(err: unknown): boolean {
    return (
      KsaError.isKsaError(err) &&
      err.code === KsaErrorCodes.HTTP_ERROR &&
      (err.message.includes(TOROD_HTTP_ERROR_MARKERS.BAD_REQUEST) ||
        err.message.includes(TOROD_HTTP_ERROR_MARKERS.UNSUPPORTED_MEDIA_TYPE) ||
        err.message.includes(TOROD_HTTP_ERROR_MARKERS.UNPROCESSABLE_ENTITY))
    );
  }
}
