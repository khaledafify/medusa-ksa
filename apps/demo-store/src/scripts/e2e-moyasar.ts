import { Modules, MedusaError } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

/**
 * In-Medusa live e2e for `medusa-payment-moyasar` (PRD T10).
 *
 * Drives a real payment session through Medusa's Payment module against the
 * Moyasar sandbox — the hosted-redirect default (no `source`):
 *
 *   createPaymentCollection → createPaymentSession (provider initiatePayment)
 *   → authorizePaymentSession (provider authorizePayment → POST /invoices)
 *
 * Medusa's contract: when the provider returns `requires_more` it persists the
 * hosted `url` + status onto the session and THEN throws `NOT_ALLOWED` — the
 * storefront is meant to redirect the customer and re-authorize on return. So
 * we expect the throw, then read the session back and assert the hosted url.
 *
 * Run: `pnpm --filter demo-store e2e:moyasar` (after `db:migrate`).
 */
export default async function e2eMoyasar({ container }: ExecArgs) {
  const payment = container.resolve(Modules.PAYMENT) as any

  const providers = await payment.listPaymentProviders({})
  const ids = providers.map((p: { id: string }) => p.id)
  console.log("[e2e] registered payment providers:", ids)

  const moyasar = ids.find((id: string) => id.includes("moyasar"))
  if (!moyasar) {
    throw new Error(
      "[e2e] Moyasar provider is NOT registered — check medusa-config.ts and that the package is built.",
    )
  }
  console.log("[e2e] using provider:", moyasar)

  const collection = await payment.createPaymentCollections({
    currency_code: "sar",
    amount: 49.99,
  })
  console.log("[e2e] payment collection:", collection.id, collection.amount, collection.currency_code)

  const session = await payment.createPaymentSession(collection.id, {
    provider_id: moyasar,
    currency_code: "sar",
    amount: 49.99,
    data: {
      // Hosted-redirect default: no `source`. callback_url is required in both
      // modes; the storefront supplies its return route.
      callback_url: "https://demo-store.example/checkout/return",
      description: "KSA demo-store e2e — hosted",
    },
  })
  console.log("[e2e] session created. status:", session.status)

  // requires_more is signalled by Medusa as a thrown NOT_ALLOWED — expected here.
  try {
    await payment.authorizePaymentSession(session.id, {})
    throw new Error(
      "[e2e] FAILED — hosted flow should require more action, but authorize succeeded outright.",
    )
  } catch (err) {
    if (!(err instanceof MedusaError) || err.type !== MedusaError.Types.NOT_ALLOWED) {
      throw err
    }
    console.log("[e2e] authorize signalled requires-more (expected):", err.message)
  }

  const authorized = await payment.retrievePaymentSession(session.id)
  const data = (authorized.data || {}) as Record<string, unknown>
  console.log("[e2e] session status after authorize:", authorized.status)
  console.log("[e2e] hosted url:", data.url)
  console.log("[e2e] moyasar_hosted_payment_id:", data.moyasar_hosted_payment_id)

  const url = String(data.url || "")
  const ok =
    authorized.status === "requires_more" &&
    /^https:\/\/checkout\.moyasar\.com\/invoices\//.test(url)

  if (!ok) {
    throw new Error(
      `[e2e] FAILED — expected requires_more + a hosted checkout url, got status=${authorized.status} url=${url}`,
    )
  }
  console.log("\n✅ [e2e] PASS — Moyasar hosted-redirect flow works end-to-end through Medusa.")
  console.log("    (Open the hosted url above to complete a sandbox payment; the webhook then marks it paid.)")
}
