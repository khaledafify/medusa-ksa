import { Modules, MedusaError } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

/**
 * Full paid-order + refund cycle through Medusa's Payment module against the
 * Moyasar sandbox (source/3-D Secure path), so every status transition is
 * observable:
 *
 *   createPaymentCollection → createPaymentSession(source) → authorize (3DS)
 *   → complete 3DS on Moyasar's test ACS → re-authorize (paid) → capture
 *   → refund.
 *
 * Moyasar allows ONE refund per payment, so we run two orders: order A takes a
 * PARTIAL refund, order B a FULL refund.
 *
 * Run: `pnpm --filter demo-store e2e:paid-refund`
 */

const TEST_CARD = {
  type: "creditcard",
  name: "KSA Tester",
  number: "4111111111111111",
  cvc: "123",
  month: "12",
  year: "2030",
}

/** Minimal cookie jar — Node's fetch does not persist cookies on its own. */
class Jar {
  private store: Record<string, string> = {}
  capture(res: Response) {
    const set = (res.headers as any).getSetCookie?.() ?? []
    for (const line of set) {
      const [pair] = line.split(";")
      const idx = pair.indexOf("=")
      if (idx > 0) this.store[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
    }
  }
  header(): string {
    return Object.entries(this.store).map(([k, v]) => `${k}=${v}`).join("; ")
  }
}

async function form(
  url: string,
  body: Record<string, string>,
  jar: Jar,
  method = "POST",
): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(),
    },
    body: method === "GET" ? undefined : new URLSearchParams(body).toString(),
    redirect: "follow",
  })
  jar.capture(res)
  return res.text()
}

/** Walk Moyasar's test 3-D Secure ACS emulator to a successful authentication. */
async function complete3ds(transactionUrl: string): Promise<void> {
  const base = "https://api.moyasar.com"
  const jar = new Jar()

  // 1) prepare page → device-fingerprint form posts to /authenticate
  const prepare = await fetch(transactionUrl, { headers: { Cookie: jar.header() } })
  jar.capture(prepare)
  const prepareHtml = await prepare.text()
  const authAction = /<form[^>]*action="([^"]*authenticate[^"]*)"/.exec(prepareHtml)?.[1]
  if (!authAction) throw new Error("3DS: no /authenticate form on prepare page")

  // 2) submit fingerprint → ACS emulator form with a hidden `creq`
  const acsHtml = await form(authAction, {
    color_depth: "24",
    js_enabled: "true",
    language: "en-US",
    screen_height: "900",
    screen_width: "1440",
    time_zone: "-180",
  }, jar)
  const creq = /name="creq"\s+value="([^"]*)"/.exec(acsHtml)?.[1]
  const acsAction = /<form[^>]*action="([^"]*acs_emulator[^"]*)"/.exec(acsHtml)?.[1]
  if (!creq || !acsAction) throw new Error("3DS: no creq / acs_emulator form")
  const acsUrl = acsAction.startsWith("http") ? acsAction : base + acsAction

  // 3) submit creq → result selector (set_auth_result)
  const resultHtml = await form(acsUrl, { creq }, jar)
  const resultAction = /<form[^>]*action="([^"]*set_auth_result[^"]*)"/.exec(resultHtml)?.[1]
  if (!resultAction) throw new Error("3DS: no set_auth_result form")
  const resultUrl = resultAction.startsWith("http") ? resultAction : base + resultAction

  // 4) choose AUTHENTICATED → auto-submitting form back to acs_return
  const returnHtml = await form(resultUrl, { auth_result: "AUTHENTICATED" }, jar)
  const returnAction = /<form[^>]*action="([^"]*acs_return[^"]*)"/.exec(returnHtml)?.[1]
  if (!returnAction) throw new Error("3DS: no acs_return form")
  const returnUrl = returnAction.startsWith("http") ? returnAction : base + returnAction

  // 5) finalize
  await form(returnUrl, {}, jar)
}

async function runOrder(
  payment: any,
  moyasar: string,
  label: string,
  amountSar: number,
  refundSar: number,
) {
  console.log(`\n──────── ${label} (amount ${amountSar} SAR, refund ${refundSar} SAR) ────────`)

  const collection = await payment.createPaymentCollections({ currency_code: "sar", amount: amountSar })

  const session = await payment.createPaymentSession(collection.id, {
    provider_id: moyasar,
    currency_code: "sar",
    amount: amountSar,
    data: {
      source: TEST_CARD,
      callback_url: "https://demo-store.example/checkout/return",
      description: `${label} — source/3DS`,
    },
  })
  console.log("1. session created           → status:", session.status)

  // First authorize → Saudi cards require 3DS → Medusa throws NOT_ALLOWED.
  try {
    await payment.authorizePaymentSession(session.id, {})
    throw new Error("expected 3DS requires-more, but authorize succeeded outright")
  } catch (err) {
    if (!(err instanceof MedusaError) || err.type !== MedusaError.Types.NOT_ALLOWED) throw err
  }
  const pending = await payment.retrievePaymentSession(session.id)
  const txnUrl = String((pending.data as any).transaction_url || "")
  console.log("2. authorize → 3DS required  → status:", pending.status, "| moyasar_payment_id:", (pending.data as any).moyasar_payment_id)
  if (!txnUrl) throw new Error("no transaction_url on session after authorize")

  // Complete 3DS on Moyasar's test ACS.
  await complete3ds(txnUrl)
  console.log("3. 3DS completed on Moyasar test ACS (AUTHENTICATED)")

  // Re-authorize → provider re-checks the now-paid payment → Medusa creates the Payment.
  const paymentDto = await payment.authorizePaymentSession(session.id, {})
  console.log("4. re-authorize → captured   → payment:", paymentDto.id, "| amount:", paymentDto.amount)

  // Capture (provider confirm/no-op — Moyasar captures immediately).
  await payment.capturePayment({ payment_id: paymentDto.id })
  let after = await payment.retrievePayment(paymentDto.id, { relations: ["captures", "refunds"] })
  const captured = (after.captures || []).reduce((s: number, c: any) => s + Number(c.amount), 0)
  console.log("5. capturePayment            → captured total:", captured, "of", Number(after.amount))

  // Refund.
  await payment.refundPayment({ payment_id: paymentDto.id, amount: refundSar })
  after = await payment.retrievePayment(paymentDto.id, { relations: ["captures", "refunds"] })
  const refunded = (after.refunds || []).reduce((s: number, r: any) => s + Number(r.amount), 0)
  console.log(`6. refundPayment ${refundSar} SAR        → refunded total:`, refunded, "of", Number(after.amount))

  return { amount: Number(after.amount), captured, refunded }
}

export default async function e2ePaidRefund({ container }: ExecArgs) {
  const payment = container.resolve(Modules.PAYMENT) as any
  const providers = await payment.listPaymentProviders({})
  const moyasar = providers.map((p: any) => p.id).find((id: string) => id.includes("moyasar"))
  if (!moyasar) throw new Error("Moyasar provider not registered")
  console.log("provider:", moyasar)

  const a = await runOrder(payment, moyasar, "ORDER A — PARTIAL refund", 49.99, 10)
  const b = await runOrder(payment, moyasar, "ORDER B — FULL refund", 49.99, 49.99)

  console.log("\n════════ SUMMARY ════════")
  console.log("Order A:", JSON.stringify(a), "→ partially_refunded")
  console.log("Order B:", JSON.stringify(b), "→ fully refunded")
  const ok = a.captured === 49.99 && a.refunded === 10 && b.captured === 49.99 && b.refunded === 49.99
  if (!ok) throw new Error("✗ FAILED — captured/refunded amounts did not match expectations")
  console.log("\n✅ PASS — paid order + partial refund + full refund all confirmed through Medusa against the live Moyasar sandbox.")
}
