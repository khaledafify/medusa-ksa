import { AbstractPaymentProvider } from "@medusajs/framework/utils";
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  BigNumberInput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  PaymentSessionStatus,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types";

import {
  KsaError,
  KsaErrorCodes,
  assertSar,
  idempotencyKey,
  sarToHalalas,
  toMedusaError,
  withIdempotency,
} from "@medusa-ksa/core";

import { MoyasarClient } from "./client.js";
import type {
  MoyasarOptions,
  MoyasarPayment,
  MoyasarSessionData,
} from "./types.js";
import { MOYASAR_PREFIX, resolveMoyasarOptions } from "./types.js";

/**
 * Derive the deterministic Moyasar payment id (`given_id`) for a Medusa
 * payment session. Moyasar uses the caller-supplied UUID as the payment id and
 * rejects a duplicate, so a retried or concurrent authorization for the same
 * session can never charge the customer twice (PRD §6 — double-fire guard).
 *
 * The UUID is formatted from core's deterministic `idempotencyKey` hash with
 * the version/variant nibbles fixed to the v4 shape Moyasar recommends.
 */
export function paymentIdForSession(sessionId: string): string {
  const hex = idempotencyKey(`moyasar:payment:${sessionId}`);
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/** Convert Medusa's BigNumberInput into a plain number for `sarToHalalas`. */
function bigNumberToNumber(value: BigNumberInput): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  if (typeof value === "object" && value !== null) {
    if ("numeric" in value && typeof value.numeric === "number") {
      return value.numeric;
    }
    if ("value" in value) {
      return Number((value as { value: string | number }).value);
    }
    const candidate = value as { toNumber?: () => number };
    if (typeof candidate.toNumber === "function") {
      return candidate.toNumber();
    }
  }
  return Number.NaN;
}

/** Map a Moyasar payment to the Medusa payment-session status. */
function mapPaymentStatus(payment: MoyasarPayment): PaymentSessionStatus {
  switch (payment.status) {
    case "paid":
    case "captured":
      return "captured";
    // Refunds are tracked on the Payment record; the session's money was captured.
    case "refunded":
      return "captured";
    case "authorized":
      return "authorized";
    case "failed":
      return "error";
    case "voided":
      return "canceled";
    case "initiated":
      return payment.source?.transaction_url ? "requires_more" : "pending";
    default:
      return "pending";
  }
}

/**
 * Moyasar payment provider for Medusa v2 (ADR-0005).
 *
 * Flow A (source/token): the storefront tokenizes with Moyasar.js using the
 * publishable key surfaced by {@link initiatePayment}, writes `source` +
 * `callback_url` back onto the session, and {@link authorizePayment} charges
 * via `POST /payments`. Saudi cards mandate 3-D Secure, so authorization
 * frequently returns `requires_more` with Moyasar's `transaction_url`; the
 * webhook (`payment_paid` / `payment_failed`) is the source of truth for the
 * final outcome — the browser return is never trusted.
 *
 * Moyasar captures immediately on a successful charge, so
 * {@link capturePayment} is a confirm/no-op and there is no `capture` option.
 */
export class MoyasarProviderService extends AbstractPaymentProvider<
  Record<string, unknown>
> {
  static override identifier = "moyasar";

  protected readonly options_: MoyasarOptions;
  protected readonly client_: MoyasarClient;

  /** Fail-fast boot validation (CLAUDE.md §7.2): bad config never reaches checkout. */
  static override validateOptions(options: Record<string, unknown>): void {
    resolveMoyasarOptions(options);
  }

  constructor(cradle: Record<string, unknown>, config: Record<string, unknown>) {
    super(cradle, config);

    this.options_ = resolveMoyasarOptions(config);
    this.client_ = new MoyasarClient({
      secretKey: this.options_.secretKey,
      baseUrl: this.options_.baseUrl,
      timeoutMs: this.options_.timeoutMs,
      retry: this.options_.retry,
    });
  }

  /**
   * No API call (PRD §3): returns the pending session data the storefront
   * needs to tokenize — publishable key, halalas amount, and currency.
   */
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    try {
      assertSar(input.currency_code);
      const halalas = sarToHalalas(bigNumberToNumber(input.amount));

      const data = (input.data ?? {}) as MoyasarSessionData;
      const sessionId =
        typeof data.session_id === "string" && data.session_id !== ""
          ? data.session_id
          : idempotencyKey();

      const sessionData: MoyasarSessionData = {
        status: "pending",
        publishable_key: this.options_.publishableKey,
        amount: halalas,
        currency: "SAR",
        session_id: sessionId,
      };
      if (typeof data.description === "string") {
        sessionData.description = data.description;
      }

      return Promise.resolve({
        id: sessionId,
        status: "pending",
        data: sessionData,
      });
    } catch (err) {
      return Promise.reject(toMedusaError(err));
    }
  }

  /**
   * First call charges the storefront-written `source` via `POST /payments`;
   * `initiated` + `transaction_url` surfaces as `requires_more` (3-D Secure).
   * Subsequent calls (after the 3DS return) re-check the existing payment via
   * `GET /payments/:id` instead of charging again.
   */
  async authorizePayment(
    input: AuthorizePaymentInput,
  ): Promise<AuthorizePaymentOutput> {
    try {
      const data = (input.data ?? {}) as MoyasarSessionData;

      if (typeof data.moyasar_payment_id === "string") {
        const payment = await this.client_.fetchPayment(data.moyasar_payment_id);
        return this.toAuthorizeResult(payment, data);
      }

      const sessionId = data.session_id;
      if (typeof sessionId !== "string" || sessionId === "") {
        throw new KsaError(
          "payment session has no session_id — initiate the payment session before authorizing it.",
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_INPUT },
        );
      }
      if (data.source === undefined || data.source === null) {
        throw new KsaError(
          "payment session has no source — the storefront must tokenize with Moyasar.js and write `source` back onto the session before authorization.",
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_INPUT },
        );
      }
      if (typeof data.callback_url !== "string" || data.callback_url === "") {
        throw new KsaError(
          "payment session has no callback_url — the storefront must write its 3-D Secure return route onto the session before authorization.",
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_INPUT },
        );
      }
      if (!Number.isInteger(data.amount) || (data.amount!) < 0) {
        throw new KsaError(
          "payment session has no valid halalas amount — re-initiate the payment session.",
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_AMOUNT },
        );
      }

      const payment = await withIdempotency(
        `moyasar:create:${sessionId}`,
        () =>
          this.client_.createPayment({
            given_id: paymentIdForSession(sessionId),
            amount: data.amount!,
            currency: "SAR",
            callback_url: data.callback_url!,
            description: data.description,
            source: data.source!,
            metadata: { session_id: sessionId },
          }),
      );

      return this.toAuthorizeResult(payment, data);
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * Confirm/no-op (ADR-0005): Moyasar already captured on the successful
   * charge, so capturing verifies the payment state with a read — never a
   * write — and is therefore inherently idempotent.
   */
  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<CapturePaymentOutput> {
    try {
      const data = (input.data ?? {}) as MoyasarSessionData;
      const id = this.requirePaymentId(data, "capture");

      const payment = await this.client_.fetchPayment(id);
      if (payment.status === "paid" || payment.status === "captured") {
        return { data: this.mergePaymentIntoData(data, payment) };
      }

      throw new KsaError(
        `cannot confirm capture — payment ${id} is "${payment.status}". Moyasar captures immediately on a successful charge; an uncaptured payment means the charge never succeeded.`,
        { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.PROVIDER_ERROR },
      );
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput,
  ): Promise<GetPaymentStatusOutput> {
    try {
      const data = (input.data ?? {}) as MoyasarSessionData;
      if (typeof data.moyasar_payment_id !== "string") {
        // Nothing charged yet — the session is still collecting checkout input.
        return { status: "pending" };
      }

      const payment = await this.client_.fetchPayment(data.moyasar_payment_id);
      return {
        status: mapPaymentStatus(payment),
        data: this.mergePaymentIntoData(data, payment),
      };
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /** `GET /payments/:id` — the payment as found at Moyasar. */
  async retrievePayment(
    input: RetrievePaymentInput,
  ): Promise<RetrievePaymentOutput> {
    try {
      const data = (input.data ?? {}) as MoyasarSessionData;
      const id = this.requirePaymentId(data, "retrieve");
      const payment = await this.client_.fetchPayment(id);
      return { data: payment };
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * Moyasar payments are immutable once created, so updates are only valid
   * while the session has not been charged yet (pre-authorization).
   */
  updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    try {
      assertSar(input.currency_code);
      const halalas = sarToHalalas(bigNumberToNumber(input.amount));
      const data = (input.data ?? {}) as MoyasarSessionData;

      if (typeof data.moyasar_payment_id === "string") {
        if (data.amount !== halalas) {
          throw new KsaError(
            "the amount cannot change after the Moyasar payment was created — delete the payment session and start a new one.",
            { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_INPUT },
          );
        }
        return Promise.resolve({ data: { ...data } });
      }

      return Promise.resolve({
        status: "pending",
        data: { ...data, amount: halalas, currency: "SAR" },
      });
    } catch (err) {
      return Promise.reject(toMedusaError(err));
    }
  }

  /**
   * `POST /payments/:id/refund` with the halalas amount (partial + full).
   * A payment Moyasar already reports as fully refunded is returned as-is, so
   * a redelivered refund instruction cannot double-refund; concurrent
   * identical refunds collapse into one API call via core's `withIdempotency`.
   */
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    try {
      const data = (input.data ?? {}) as MoyasarSessionData;
      const id = this.requirePaymentId(data, "refund");
      const halalas = sarToHalalas(bigNumberToNumber(input.amount));

      const payment = await this.client_.fetchPayment(id);
      if (payment.status === "refunded" && (payment.refunded ?? 0) >= halalas) {
        return { data: this.mergePaymentIntoData(data, payment) };
      }

      const refunded = await withIdempotency(
        `moyasar:refund:${id}:${halalas}`,
        () => this.client_.refundPayment(id, halalas),
      );

      return { data: this.mergePaymentIntoData(data, refunded) };
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * `POST /payments/:id/void` while the payment is still voidable
   * (`initiated` / `authorized`). Captured money cannot be voided — Moyasar
   * captures immediately — so a captured payment must be refunded instead.
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    try {
      const data = (input.data ?? {}) as MoyasarSessionData;
      if (typeof data.moyasar_payment_id !== "string") {
        // Nothing was charged — cancelling the session needs no provider call.
        return { data: { ...data } };
      }

      const payment = await this.client_.fetchPayment(data.moyasar_payment_id);
      switch (payment.status) {
        case "voided":
        case "failed":
          // Already terminal in the cancelled direction — idempotent no-op.
          return { data: this.mergePaymentIntoData(data, payment) };
        case "initiated":
        case "authorized": {
          const voided = await this.client_.voidPayment(payment.id);
          return { data: this.mergePaymentIntoData(data, voided) };
        }
        default:
          throw new KsaError(
            `cannot cancel — payment ${payment.id} is "${payment.status}" and Moyasar captures immediately. Issue a refund instead.`,
            { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.PROVIDER_ERROR },
          );
      }
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * Session cleanup: voids a still-voidable payment but never fails the
   * caller's flow over a payment that already reached a terminal state.
   */
  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    try {
      const data = (input.data ?? {}) as MoyasarSessionData;
      if (typeof data.moyasar_payment_id !== "string") {
        return { data: { ...data } };
      }

      const payment = await this.client_.fetchPayment(data.moyasar_payment_id);
      if (payment.status === "initiated" || payment.status === "authorized") {
        const voided = await this.client_.voidPayment(payment.id);
        return { data: this.mergePaymentIntoData(data, voided) };
      }

      return { data: this.mergePaymentIntoData(data, payment) };
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    return Promise.reject(
      toMedusaError(
        new KsaError("getWebhookActionAndData is not implemented yet.", {
          prefix: MOYASAR_PREFIX,
          code: KsaErrorCodes.UNEXPECTED,
        }),
      ),
    );
  }

  /** Session/payment data persisted back to Medusa after a provider call. */
  private mergePaymentIntoData(
    data: MoyasarSessionData,
    payment: MoyasarPayment,
  ): Record<string, unknown> {
    const merged: MoyasarSessionData = {
      ...data,
      moyasar_payment_id: payment.id,
      status: payment.status,
    };

    // The source token is single-use and may carry sensitive fields — never
    // persist it back onto the session once the charge has been attempted.
    delete merged.source;

    if (payment.source?.transaction_url) {
      merged.transaction_url = payment.source.transaction_url;
    } else {
      delete merged.transaction_url;
    }

    return merged;
  }

  private toAuthorizeResult(
    payment: MoyasarPayment,
    data: MoyasarSessionData,
  ): AuthorizePaymentOutput {
    const merged = this.mergePaymentIntoData(data, payment);

    switch (payment.status) {
      case "paid":
      case "captured":
      case "authorized":
        return { status: "authorized", data: merged };
      case "initiated":
        return {
          status: payment.source?.transaction_url ? "requires_more" : "pending",
          data: merged,
        };
      case "failed":
        return { status: "error", data: merged };
      case "voided":
        return { status: "canceled", data: merged };
      default:
        return { status: "pending", data: merged };
    }
  }

  private requirePaymentId(
    data: MoyasarSessionData,
    operation: string,
  ): string {
    const id = data.moyasar_payment_id;
    if (typeof id !== "string" || id === "") {
      throw new KsaError(
        `cannot ${operation} — no Moyasar payment exists for this session yet.`,
        { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_INPUT },
      );
    }
    return id;
  }
}
