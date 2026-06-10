import { z } from "zod";

import type { EnvMap } from "@medusa-ksa/core";
import { validateOptions } from "@medusa-ksa/core";

/** Connector tag used to prefix every error raised by this package. */
export const MOYASAR_PREFIX = "moyasar";

const KEY_HINT =
  "copy it from the Moyasar Dashboard → Settings → API Keys (https://dashboard.moyasar.com)";
const WEBHOOK_HINT =
  "use the shared secret you set in the Moyasar Dashboard → Settings → Webhooks";

/**
 * Maps each option to its documented env var (CLAUDE.md §7.1 — env-first with
 * fallback). Omitting an option in `medusa-config.ts` reads the env var.
 */
const ENV_MAP: EnvMap = {
  secretKey: "MOYASAR_SECRET_KEY",
  publishableKey: "MOYASAR_PUBLISHABLE_KEY",
  webhookSecret: "MOYASAR_WEBHOOK_SECRET",
};

/**
 * Provider options (ADR-0005): `secretKey` is required; `publishableKey` is
 * optional — it is only needed for the embedded source path (Moyasar.js), and
 * the hosted-redirect default works on the secret key alone. `webhookSecret`
 * is optional but strongly recommended. There is deliberately no `capture`
 * option (Moyasar captures immediately on a successful `POST /payments`) and
 * no mode flag (sandbox is detected from the key prefix).
 */
const moyasarOptionsSchema = z.object({
  secretKey: z
    .string({
      required_error: `is required — ${KEY_HINT}`,
      invalid_type_error: `must be a string — ${KEY_HINT}`,
    })
    .min(1, `must not be empty — ${KEY_HINT}`),
  publishableKey: z
    .string({ invalid_type_error: `must be a string — ${KEY_HINT}` })
    .min(1, `must not be empty — ${KEY_HINT}`)
    .optional(),
  webhookSecret: z
    .string({ invalid_type_error: `must be a string — ${WEBHOOK_HINT}` })
    .min(1, `must not be empty — ${WEBHOOK_HINT}`)
    .optional(),
  baseUrl: z.string().url().optional(),
  timeoutMs: z.number().int().positive().optional(),
  retry: z
    .object({
      retries: z.number().int().min(0),
      baseDelayMs: z.number().min(0),
    })
    .optional(),
});

/** Validated, typed options the provider runs with. */
export type MoyasarOptions = z.infer<typeof moyasarOptionsSchema>;

/**
 * Validate raw provider options at boot (fail-fast, ADR-0002). Merges the
 * env-var fallback per {@link ENV_MAP}, then parses. Throws a `KsaError`
 * naming the offending option, the env var to set, and where to get the value
 * — never echoing the bad value itself.
 */
export function resolveMoyasarOptions(
  rawOptions: unknown,
  env: NodeJS.ProcessEnv = process.env,
): MoyasarOptions {
  return validateOptions(moyasarOptionsSchema, rawOptions, env, {
    prefix: MOYASAR_PREFIX,
    envMap: ENV_MAP,
  });
}

/** Moyasar payment lifecycle states (verified against docs.moyasar.com). */
export type MoyasarPaymentStatus =
  | "initiated"
  | "paid"
  | "authorized"
  | "failed"
  | "refunded"
  | "captured"
  | "voided"
  | "verified";

/**
 * The `source` object on a Moyasar payment response. `transaction_url` is the
 * 3-D Secure challenge URL, present while the payment is `initiated`.
 */
export interface MoyasarSource {
  type: string;
  transaction_url?: string;
  message?: string;
  company?: string;
  [key: string]: unknown;
}

/** A Moyasar payment object. All amounts are integer halalas. */
export interface MoyasarPayment {
  id: string;
  status: MoyasarPaymentStatus;
  /** Payment amount in halalas. */
  amount: number;
  currency: string;
  /** Refunded amount in halalas. */
  refunded?: number;
  /** Captured amount in halalas. */
  captured?: number;
  description?: string | null;
  callback_url?: string | null;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, string> | null;
  /**
   * Set when the payment was made against a hosted payment. Hosted-page
   * payments do **not** inherit the hosted payment's metadata (verified in
   * the live sandbox), so this id is the only route back to the session.
   */
  invoice_id?: string | null;
  source?: MoyasarSource;
  [key: string]: unknown;
}

/** Body for `POST /payments` (verified against docs.moyasar.com). */
export interface MoyasarCreatePaymentRequest {
  /**
   * Caller-generated UUID that becomes the payment id — Moyasar's idempotency
   * mechanism for payment creation.
   */
  given_id?: string;
  /** Amount in halalas. */
  amount: number;
  currency: string;
  description?: string;
  /** Where Moyasar returns the customer after the 3-D Secure challenge. */
  callback_url?: string;
  /** Tokenized payment source produced by the storefront (Moyasar.js). */
  source: Record<string, unknown>;
  metadata?: Record<string, string>;
}

/**
 * Hosted-payment lifecycle states (Moyasar's Invoices API on the wire —
 * verified against docs.moyasar.com).
 */
export type MoyasarHostedPaymentStatus =
  | "initiated"
  | "paid"
  | "failed"
  | "refunded"
  | "canceled"
  | "on_hold"
  | "expired"
  | "voided";

/**
 * A Moyasar hosted payment (`/invoices` resource). `url` is the
 * gateway-hosted checkout page the storefront redirects the customer to;
 * `payments` lists the attempts made against it. The customer pays on
 * Moyasar's page, so no client SDK or PCI exposure is involved (ADR-0005).
 */
export interface MoyasarHostedPayment {
  id: string;
  status: MoyasarHostedPaymentStatus;
  /** Amount in halalas. */
  amount: number;
  currency: string;
  description?: string | null;
  /** The hosted checkout page URL. */
  url: string;
  success_url?: string | null;
  back_url?: string | null;
  expired_at?: string | null;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, string> | null;
  /** Payment attempts; the paid one carries the money. */
  payments?: MoyasarPayment[];
  [key: string]: unknown;
}

/**
 * Body for `POST /invoices` (verified against docs.moyasar.com and the live
 * sandbox). `description` is required by Moyasar and shown to the customer on
 * the hosted page. `success_url` redirects the customer back after paying —
 * the hosted-flow equivalent of Flow A's 3-D Secure return. The invoice-level
 * `callback_url` is deliberately not used: it posts an invoice object, not a
 * payment webhook event, so Medusa's built-in webhook route could not parse it.
 */
export interface MoyasarCreateHostedPaymentRequest {
  /** Amount in halalas (Moyasar minimum: 100). */
  amount: number;
  currency: string;
  description: string;
  /** Where the customer is redirected after paying on the hosted page. */
  success_url?: string;
  /** Where the customer is redirected when abandoning the hosted page. */
  back_url?: string;
  metadata?: Record<string, string>;
}

/**
 * The webhook envelope Moyasar POSTs to `/hooks/payment/moyasar_{id}`.
 * `secret_token` is the merchant-assigned shared secret — Moyasar does not
 * sign webhook bodies with an HMAC.
 */
export interface MoyasarWebhookEvent {
  id: string;
  type: string;
  created_at?: string;
  secret_token?: string;
  account_name?: string;
  live?: boolean;
  data: MoyasarPayment;
}

/**
 * The payment-session data contract between this provider and the storefront
 * (PRD §2). `initiatePayment` writes the base fields; the storefront writes
 * back `callback_url` (both modes) and optionally a `source` (embedded mode);
 * the provider adds `moyasar_hosted_payment_id` + `url` (hosted mode) or
 * `moyasar_payment_id` (+ `transaction_url` during 3-D Secure).
 */
export interface MoyasarSessionData {
  status?: string;
  /** Present only when a publishable key is configured (embedded source path). */
  publishable_key?: string;
  /** Amount in halalas, converted once at the core boundary. */
  amount?: number;
  currency?: string;
  description?: string;
  session_id?: string;
  /** Single-use token source written back by the storefront (embedded mode). */
  source?: Record<string, unknown>;
  /** The storefront's return route (3-D Secure / hosted-page redirect back). */
  callback_url?: string;
  moyasar_payment_id?: string;
  /** Set once the hosted payment is created (hosted-redirect mode). */
  moyasar_hosted_payment_id?: string;
  /** Hosted checkout page URL, surfaced while the session requires more action. */
  url?: string;
  /** 3-D Secure challenge URL, surfaced while the session requires more action. */
  transaction_url?: string;
  [key: string]: unknown;
}
