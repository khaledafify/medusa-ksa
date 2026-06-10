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
  halalasToSar,
  idempotencyKey,
  sarToHalalas,
  toMedusaError,
  verifySecretToken,
  withIdempotency,
} from "@medusa-ksa/core";
import type { SarAmount } from "@medusa-ksa/core";

import { MoyasarClient } from "./client.js";
import type {
  MoyasarHostedPayment,
  MoyasarOptions,
  MoyasarPayment,
  MoyasarSessionData,
  MoyasarWebhookEvent,
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

/**
 * The payment attempt that carries (or carried) the money on a hosted
 * payment. Failed attempts may precede it — customers can retry on the
 * hosted page — so the settled one is matched by state, not position.
 */
function settledPayment(
  hosted: MoyasarHostedPayment,
): MoyasarPayment | undefined {
  return hosted.payments?.find(
    (payment) =>
      payment.status === "paid" ||
      payment.status === "captured" ||
      payment.status === "refunded" ||
      payment.status === "authorized",
  );
}

/** Map a hosted payment (no settled attempt) to the Medusa session status. */
function mapHostedStatus(
  hosted: MoyasarHostedPayment,
): PaymentSessionStatus {
  switch (hosted.status) {
    case "paid":
    case "refunded":
      return "captured";
    case "initiated":
      return "requires_more";
    case "failed":
      return "error";
    case "canceled":
    case "expired":
    case "voided":
      return "canceled";
    case "on_hold":
    default:
      return "pending";
  }
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
 * Moyasar payment provider for Medusa v2 (ADR-0005) — dual-mode.
 *
 * Hosted redirect (Flow B, default): when the session carries no `source`,
 * {@link authorizePayment} creates a Moyasar hosted payment and returns
 * `requires_more` with its checkout `url`; the storefront simply redirects —
 * no Moyasar.js, no PCI exposure. The customer pays any enabled method
 * (card / Mada / Apple Pay / STC Pay / Samsung Pay) on Moyasar's page.
 *
 * Source (Flow A, optional): the storefront tokenizes with Moyasar.js using
 * the publishable key surfaced by {@link initiatePayment}, writes `source` +
 * `callback_url` back onto the session, and {@link authorizePayment} charges
 * via `POST /payments`. Saudi cards mandate 3-D Secure, so authorization
 * frequently returns `requires_more` with Moyasar's `transaction_url`.
 *
 * Both modes converge: the webhook (`payment_paid` / `payment_failed`) is the
 * source of truth for the final outcome — the browser return is never trusted.
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
        amount: halalas,
        currency: "SAR",
        session_id: sessionId,
      };
      // Only the embedded source path needs the publishable key; the
      // hosted-redirect default has nothing to tokenize.
      if (this.options_.publishableKey !== undefined) {
        sessionData.publishable_key = this.options_.publishableKey;
      }
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
   * Dual-mode authorization (ADR-0005). A session with a storefront-written
   * `source` is charged via `POST /payments` (Flow A); `initiated` +
   * `transaction_url` surfaces as `requires_more` (3-D Secure). A session
   * without one gets a hosted payment whose checkout `url` surfaces as
   * `requires_more` (Flow B — the hosted-redirect default). Subsequent calls
   * (after the customer returns) re-check the existing payment or hosted
   * payment instead of charging again.
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
      if (typeof data.moyasar_hosted_payment_id === "string") {
        const hosted = await this.client_.fetchHostedPayment(
          data.moyasar_hosted_payment_id,
        );
        return this.toAuthorizeResultFromHosted(hosted, data);
      }

      const sessionId = data.session_id;
      if (typeof sessionId !== "string" || sessionId === "") {
        throw new KsaError(
          "payment session has no session_id — initiate the payment session before authorizing it.",
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_INPUT },
        );
      }
      if (typeof data.callback_url !== "string" || data.callback_url === "") {
        throw new KsaError(
          "payment session has no callback_url — the storefront must write its return route onto the session before authorization.",
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_INPUT },
        );
      }
      if (!Number.isInteger(data.amount) || (data.amount!) < 0) {
        throw new KsaError(
          "payment session has no valid halalas amount — re-initiate the payment session.",
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_AMOUNT },
        );
      }

      if (data.source === undefined || data.source === null) {
        // Flow B (default): no source → hosted payment, storefront redirects.
        const hosted = await withIdempotency(
          `moyasar:hosted:${sessionId}`,
          () =>
            this.client_.createHostedPayment({
              amount: data.amount!,
              currency: "SAR",
              // Moyasar requires a description and shows it on the hosted page.
              description: data.description ?? `Payment ${sessionId}`,
              success_url: data.callback_url!,
              back_url: data.callback_url!,
              metadata: { session_id: sessionId },
            }),
        );

        return this.toAuthorizeResultFromHosted(hosted, data);
      }

      // Flow A: charge the storefront-written source.
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

      if (
        typeof data.moyasar_payment_id !== "string" &&
        typeof data.moyasar_hosted_payment_id === "string"
      ) {
        // Hosted mode: confirm via the settled attempt on the hosted payment.
        const hosted = await this.client_.fetchHostedPayment(
          data.moyasar_hosted_payment_id,
        );
        const settled = settledPayment(hosted);
        if (
          settled !== undefined &&
          (settled.status === "paid" || settled.status === "captured")
        ) {
          return {
            data: this.mergePaymentIntoData(
              this.hostedBase(data, hosted),
              settled,
            ),
          };
        }
        throw new KsaError(
          `cannot confirm capture — hosted payment ${hosted.id} is "${hosted.status}" with no paid attempt. The customer has not completed the hosted checkout.`,
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.PROVIDER_ERROR },
        );
      }

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

      if (typeof data.moyasar_payment_id === "string") {
        const payment = await this.client_.fetchPayment(data.moyasar_payment_id);
        return {
          status: mapPaymentStatus(payment),
          data: this.mergePaymentIntoData(data, payment),
        };
      }

      if (typeof data.moyasar_hosted_payment_id === "string") {
        const hosted = await this.client_.fetchHostedPayment(
          data.moyasar_hosted_payment_id,
        );
        const settled = settledPayment(hosted);
        if (settled !== undefined) {
          return {
            status: mapPaymentStatus(settled),
            data: this.mergePaymentIntoData(this.hostedBase(data, hosted), settled),
          };
        }
        return {
          status: mapHostedStatus(hosted),
          data: this.mergeHostedIntoData(data, hosted),
        };
      }

      // Nothing charged yet — the session is still collecting checkout input.
      return { status: "pending" };
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * The payment as found at Moyasar — in hosted mode, the settled attempt
   * once one exists, otherwise the hosted payment itself.
   */
  async retrievePayment(
    input: RetrievePaymentInput,
  ): Promise<RetrievePaymentOutput> {
    try {
      const data = (input.data ?? {}) as MoyasarSessionData;

      if (
        typeof data.moyasar_payment_id !== "string" &&
        typeof data.moyasar_hosted_payment_id === "string"
      ) {
        const hosted = await this.client_.fetchHostedPayment(
          data.moyasar_hosted_payment_id,
        );
        const settled = settledPayment(hosted);
        return { data: settled ?? hosted };
      }

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
      let data = (input.data ?? {}) as MoyasarSessionData;

      if (
        typeof data.moyasar_payment_id !== "string" &&
        typeof data.moyasar_hosted_payment_id === "string"
      ) {
        // Hosted mode before any state merge: the money lives on the settled
        // attempt — resolve it so the refund targets a real payment.
        const hosted = await this.client_.fetchHostedPayment(
          data.moyasar_hosted_payment_id,
        );
        const settled = settledPayment(hosted);
        if (settled !== undefined) {
          data = {
            ...this.hostedBase(data, hosted),
            moyasar_payment_id: settled.id,
          };
        }
      }

      const id = this.requirePaymentId(data, "refund");
      const halalas = sarToHalalas(bigNumberToNumber(input.amount));
      if (halalas <= 0) {
        throw new KsaError(
          "refund amount must be at least 1 halala.",
          { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.INVALID_AMOUNT },
        );
      }

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
        if (typeof data.moyasar_hosted_payment_id === "string") {
          return await this.cancelHosted(data, /* lenient */ false);
        }
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
          // Moyasar rejects voiding `initiated` payments ("Only paid or
          // authorized payments may be voided" — verified against the live
          // sandbox). Nothing was charged; the abandoned attempt expires.
          return { data: this.mergePaymentIntoData(data, payment) };
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
        if (typeof data.moyasar_hosted_payment_id === "string") {
          return await this.cancelHosted(data, /* lenient */ true);
        }
        return { data: { ...data } };
      }

      const payment = await this.client_.fetchPayment(data.moyasar_payment_id);
      // Only `authorized` payments are voidable; `initiated` ones expire on
      // their own and everything else is terminal (verified in sandbox).
      if (payment.status === "authorized") {
        const voided = await this.client_.voidPayment(payment.id);
        return { data: this.mergePaymentIntoData(data, voided) };
      }

      return { data: this.mergePaymentIntoData(data, payment) };
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * Webhook is the source of truth for the final payment outcome (ADR-0005),
   * but the **payload itself is never trusted**:
   *
   * 1. When `MOYASAR_WEBHOOK_SECRET` is configured, the payload's
   *    `secret_token` is checked in constant time (core `verifySecretToken`);
   *    a tampered or missing token is rejected as `not_supported` before any
   *    API call.
   * 2. The authoritative state is then re-fetched via `GET /payments/:id` —
   *    the action is derived from Moyasar's answer, never from the event body,
   *    so a forged "paid" body cannot capture anything.
   *
   * Redelivery is naturally idempotent: re-processing `payment_paid` on an
   * already-captured Medusa payment is a no-op in Medusa's payment state
   * (no dedup table, per ADR-0005).
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    try {
      const event = payload.data as Partial<MoyasarWebhookEvent> | null | undefined;
      const paymentId = event?.data?.id;
      if (
        event === null ||
        event === undefined ||
        typeof event.type !== "string" ||
        typeof paymentId !== "string" ||
        paymentId === ""
      ) {
        return { action: "not_supported" };
      }

      if (
        this.options_.webhookSecret !== undefined &&
        !verifySecretToken(event.secret_token, this.options_.webhookSecret)
      ) {
        return { action: "not_supported" };
      }

      // Refunds are initiated by Medusa through refundPayment; the
      // confirmation event carries nothing for Medusa to act on.
      if (event.type === "payment_refunded") {
        return { action: "not_supported" };
      }

      const payment = await this.client_.fetchPayment(paymentId);

      let sessionId = payment.metadata?.session_id;
      if (
        (typeof sessionId !== "string" || sessionId === "") &&
        typeof payment.invoice_id === "string" &&
        payment.invoice_id !== ""
      ) {
        // Hosted-page payments do not inherit the hosted payment's metadata
        // (verified in the live sandbox) — route via the hosted payment.
        const hosted = await this.client_.fetchHostedPayment(payment.invoice_id);
        sessionId = hosted.metadata?.session_id;
      }
      if (typeof sessionId !== "string" || sessionId === "") {
        // Not a payment this provider created — nothing to route it to.
        return { action: "not_supported" };
      }

      const data = {
        session_id: sessionId,
        amount: halalasToSar(payment.amount as SarAmount),
      };

      switch (payment.status) {
        case "paid":
        case "captured":
          return { action: "captured", data };
        case "authorized":
          return { action: "authorized", data };
        case "failed":
          return { action: "failed", data };
        case "voided":
          return { action: "canceled", data };
        case "initiated":
          return { action: "pending", data };
        default:
          return { action: "not_supported" };
      }
    } catch (err) {
      // Surface transport failures: Medusa responds non-2xx and Moyasar
      // redelivers, so a transient outage cannot drop a paid event.
      throw toMedusaError(err);
    }
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

  /**
   * Session data carrying the hosted-payment identity, with the single-use
   * fields cleared. The hosted `url` is re-added only while the hosted
   * payment is still awaiting the customer.
   */
  private hostedBase(
    data: MoyasarSessionData,
    hosted: MoyasarHostedPayment,
  ): MoyasarSessionData {
    const base: MoyasarSessionData = {
      ...data,
      moyasar_hosted_payment_id: hosted.id,
    };
    delete base.source;
    delete base.url;
    return base;
  }

  /** Session data persisted back to Medusa after a hosted-payment call. */
  private mergeHostedIntoData(
    data: MoyasarSessionData,
    hosted: MoyasarHostedPayment,
  ): Record<string, unknown> {
    const merged = this.hostedBase(data, hosted);
    merged.status = hosted.status;
    if (hosted.status === "initiated") {
      merged.url = hosted.url;
    }
    return merged;
  }

  private toAuthorizeResultFromHosted(
    hosted: MoyasarHostedPayment,
    data: MoyasarSessionData,
  ): AuthorizePaymentOutput {
    const settled = settledPayment(hosted);
    if (settled !== undefined) {
      return this.toAuthorizeResult(settled, this.hostedBase(data, hosted));
    }

    const merged = this.mergeHostedIntoData(data, hosted);
    switch (hosted.status) {
      case "initiated":
        return { status: "requires_more", data: merged };
      case "paid":
      case "refunded":
        // Paid but the attempt list is missing — trust the hosted state.
        return { status: "authorized", data: merged };
      case "failed":
        return { status: "error", data: merged };
      case "canceled":
      case "expired":
      case "voided":
        return { status: "canceled", data: merged };
      case "on_hold":
      default:
        return { status: "pending", data: merged };
    }
  }

  /**
   * Cancel a hosted payment nobody paid yet (`PUT /invoices/:id/cancel`).
   * Terminal states are an idempotent no-op; a paid hosted payment cannot be
   * cancelled — strict callers get an error pointing at refunds, lenient
   * (delete) callers get the merged state back.
   */
  private async cancelHosted(
    data: MoyasarSessionData,
    lenient: boolean,
  ): Promise<{ data: Record<string, unknown> }> {
    const hosted = await this.client_.fetchHostedPayment(
      data.moyasar_hosted_payment_id!,
    );
    const settled = settledPayment(hosted);

    if (settled !== undefined || hosted.status === "paid" || hosted.status === "refunded") {
      if (lenient) {
        return {
          data:
            settled !== undefined
              ? this.mergePaymentIntoData(this.hostedBase(data, hosted), settled)
              : this.mergeHostedIntoData(data, hosted),
        };
      }
      throw new KsaError(
        `cannot cancel — hosted payment ${hosted.id} was paid and Moyasar captures immediately. Issue a refund instead.`,
        { prefix: MOYASAR_PREFIX, code: KsaErrorCodes.PROVIDER_ERROR },
      );
    }

    if (hosted.status === "initiated" || hosted.status === "on_hold") {
      const canceled = await this.client_.cancelHostedPayment(hosted.id);
      return { data: this.mergeHostedIntoData(data, canceled) };
    }

    // canceled / expired / voided / failed — already terminal, no-op.
    return { data: this.mergeHostedIntoData(data, hosted) };
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
