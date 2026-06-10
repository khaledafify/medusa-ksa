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
 * (PRD §2). `initiatePayment` writes the first five fields; the storefront
 * writes back `source` + `callback_url` before authorization; the provider
 * adds `moyasar_payment_id` (+ `transaction_url` during 3-D Secure).
 */
export interface MoyasarSessionData {
  status?: string;
  publishable_key?: string;
  /** Amount in halalas, converted once at the core boundary. */
  amount?: number;
  currency?: string;
  description?: string;
  session_id?: string;
  /** Single-use token source written back by the storefront. */
  source?: Record<string, unknown>;
  /** The storefront's 3-D Secure return route. */
  callback_url?: string;
  moyasar_payment_id?: string;
  /** 3-D Secure challenge URL, surfaced while the session requires more action. */
  transaction_url?: string;
  [key: string]: unknown;
}
