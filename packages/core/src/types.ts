/**
 * Shared option and handshake shapes reused by every connector in the suite.
 *
 * Per ADR-0002 these types live here once so that "learning one connector
 * teaches all": payments, fulfillment and notification packages all configure
 * against the same vocabulary. Connectors extend these with their own
 * provider-specific fields rather than reinventing the common surface.
 *
 * `SarAmount` lives in `money.ts` (its owner); it is re-exported from the
 * barrel, so consumers import money + types from the same package entrypoint.
 */

/**
 * How an {@link HttpClient} authenticates outbound requests.
 *
 * The discriminant `type` keeps the union exhaustive so a connector can hand a
 * strategy to core without ever assembling an `Authorization` header itself.
 */
export type AuthStrategy =
  | {
      /** `Authorization: Bearer <token>`. */
      type: "bearer";
      token: string;
    }
  | {
      /** `Authorization: Basic base64(username:password)`. */
      type: "basic";
      username: string;
      password: string;
    }
  | {
      /** A single custom header, e.g. `x-api-key: <value>`. */
      type: "api-key";
      /** Header name to send the key under. Defaults to `Authorization`. */
      header?: string;
      value: string;
    };

/** HTTP verbs accepted by {@link HttpRequest}. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A single outbound request handed to {@link HttpClient.request}.
 *
 * `path` is resolved against the client's `baseUrl`; `body` is serialized by
 * the client (connectors never `JSON.stringify` or set content-type by hand).
 */
export interface HttpRequest {
  method: HttpMethod;
  /** Path or absolute URL resolved against the client `baseUrl`. */
  path: string;
  /** Request payload; serialized to JSON by the client when present. */
  body?: unknown;
  /** Per-request headers, merged over the client's default headers. */
  headers?: Record<string, string>;
  /**
   * Query parameters appended to the URL. `undefined` values are dropped so
   * connectors can build params conditionally without manual filtering.
   */
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Marks the operation as safe to retry. Only idempotent requests are retried
   * by the client's backoff policy (CONTRACT.md "Outbound HTTP").
   */
  idempotent?: boolean;
  /** Per-request timeout override, in milliseconds. */
  timeoutMs?: number;
}

/**
 * Fields shared by every connector's options block, regardless of category.
 *
 * Every connector is env-first (CLAUDE.md §7.1): omitting a value falls back to
 * the documented env var, validated at boot by `createLoader`. Sandbox vs live
 * is inferred from credentials via `detectSandbox`, never a `mode` flag, so it
 * is intentionally absent here.
 */
export interface KsaConnectorOptions {
  /**
   * Stable provider id used in `medusa-config.ts` (e.g. `"moyasar"`). Lets a
   * store register the same connector twice under different ids if needed.
   */
  id?: string;
  /** Override the provider's default API base URL (e.g. a self-hosted proxy). */
  baseUrl?: string;
  /** Outbound request timeout in milliseconds. */
  timeoutMs?: number;
  /** Retry policy applied to idempotent outbound calls only. */
  retry?: {
    retries: number;
    baseDelayMs: number;
  };
}

/**
 * Options shared by every payment gateway connector
 * (`medusa-payment-*`). Currency defaults to SAR and amounts are always
 * integer halalas (`SarAmount`); connectors never see floats (CONTRACT.md
 * "Money").
 */
export interface KsaPaymentOptions extends KsaConnectorOptions {
  /** Secret/API key. Falls back to the connector's documented env var. */
  secretKey?: string;
  /** Optional publishable key, where a gateway distinguishes the two. */
  publishableKey?: string;
  /** Webhook signing secret verified via `verifyWebhook`. */
  webhookSecret?: string;
  /** ISO-4217 currency code. Guarded by `assertSar`; defaults to `"SAR"`. */
  currency?: string;
  /** URL the gateway redirects the shopper to after an off-site payment. */
  callbackUrl?: string;
}

/**
 * Options shared by every fulfillment/courier connector
 * (`medusa-fulfillment-*`), including the Torod aggregator.
 */
export interface KsaFulfillmentOptions extends KsaConnectorOptions {
  /** Secret/API key. Falls back to the connector's documented env var. */
  apiKey?: string;
  /** Account/merchant identifier required by some couriers. */
  accountId?: string;
  /** Webhook signing secret for tracking/status callbacks. */
  webhookSecret?: string;
  /** Origin/pickup city used when the courier requires it on rate quotes. */
  originCity?: string;
  /** Whether to request cash-on-delivery support from the carrier. */
  codEnabled?: boolean;
}

/** SMS/notification delivery channels supported across providers. */
export type KsaNotificationChannel = "sms" | "whatsapp" | "email";

/**
 * Options shared by every notification connector
 * (`medusa-notification-*`). Channels are config-driven (CLAUDE.md §6).
 */
export interface KsaNotificationOptions extends KsaConnectorOptions {
  /** Secret/API key. Falls back to the connector's documented env var. */
  apiKey?: string;
  /** Channels this provider instance is allowed to dispatch on. */
  channels?: KsaNotificationChannel[];
  /** Default sender id / originator name shown to the recipient. */
  senderId?: string;
}
