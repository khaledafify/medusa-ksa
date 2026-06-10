import { HttpClient } from "@medusa-ksa/core";

import type {
  MoyasarCreatePaymentRequest,
  MoyasarPayment,
} from "./types.js";

/** Moyasar REST API base URL (verified against docs.moyasar.com). */
export const MOYASAR_API_BASE_URL = "https://api.moyasar.com/v1";

/** Bounded by default — no unbounded outbound calls in the suite (ADR-0002). */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Applied to safe (GET) requests only; writes are never retried. */
const DEFAULT_RETRY = { retries: 2, baseDelayMs: 250 };

/** Constructor options for {@link MoyasarClient}. */
export interface MoyasarClientOptions {
  /** Moyasar secret key (`sk_test_…` / `sk_live_…`). */
  secretKey: string;
  /** Override the API base URL (e.g. a self-hosted proxy). */
  baseUrl?: string;
  /** Outbound request timeout in milliseconds. */
  timeoutMs?: number;
  /** Retry policy for safe (GET) requests. */
  retry?: { retries: number; baseDelayMs: number };
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Injectable sleep (tests). */
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Thin Moyasar API wrapper over the core {@link HttpClient} — the only
 * sanctioned network path (ADR-0002). Authentication is HTTP Basic with the
 * secret key as username and an empty password; core builds and redacts the
 * header, so the key can never leak into an error message.
 *
 * Write operations (create / refund / void) are never retried at the
 * transport level: a retried charge or refund could move money twice.
 * Creation idempotency is carried by Moyasar's `given_id` instead.
 */
export class MoyasarClient {
  private readonly http: HttpClient;

  constructor(options: MoyasarClientOptions) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? MOYASAR_API_BASE_URL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      auth: { type: "basic", username: options.secretKey, password: "" },
      retry: options.retry ?? DEFAULT_RETRY,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    });
  }

  /** `POST /payments` — charge a tokenized source. Amounts are halalas. */
  async createPayment(
    request: MoyasarCreatePaymentRequest,
  ): Promise<MoyasarPayment> {
    return this.http.request<MoyasarPayment>({
      method: "POST",
      path: "/payments",
      body: request,
    });
  }

  /** `GET /payments/:id` — the verify backup behind the webhook (ADR-0005). */
  async fetchPayment(id: string): Promise<MoyasarPayment> {
    return this.http.request<MoyasarPayment>({
      method: "GET",
      path: `/payments/${encodeURIComponent(id)}`,
    });
  }

  /**
   * `POST /payments/:id/refund` — partial when `amountHalalas` is given,
   * full when omitted.
   */
  async refundPayment(
    id: string,
    amountHalalas?: number,
  ): Promise<MoyasarPayment> {
    return this.http.request<MoyasarPayment>({
      method: "POST",
      path: `/payments/${encodeURIComponent(id)}/refund`,
      body: amountHalalas === undefined ? undefined : { amount: amountHalalas },
    });
  }

  /**
   * `POST /payments/:id/void` — releases an authorized hold or reverses a
   * paid/captured payment inside Moyasar's void window.
   */
  async voidPayment(id: string): Promise<MoyasarPayment> {
    return this.http.request<MoyasarPayment>({
      method: "POST",
      path: `/payments/${encodeURIComponent(id)}/void`,
    });
  }
}
