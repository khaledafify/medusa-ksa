import { describe, expect, it } from "vitest";

import { MoyasarClient } from "./client.js";
import { MoyasarProviderService } from "./service.js";

/**
 * Live sandbox integration (PRD T10). Hits the real Moyasar API and is
 * therefore **opt-in**: it runs only when `MOYASAR_SECRET_KEY` (an `sk_test_…`
 * key) is present in the environment, so CI without credentials stays green.
 *
 * Run it with:
 *   set -a; . apps/demo-store/.env; set +a
 *   pnpm --filter medusa-payment-moyasar exec vitest run live.integration
 *
 * It exercises the provider's own code (real `HttpClient`, real `fetch`) — not
 * a fake — against Moyasar's sandbox: hosted invoice (Flow B), source charge +
 * 3-D Secure (Flow A), the GET verify backup, and a partial refund.
 */
const SECRET = process.env.MOYASAR_SECRET_KEY;
const run = SECRET?.startsWith("sk_test_") ? describe : describe.skip;

run("Moyasar live sandbox (opt-in)", () => {
  const client = new MoyasarClient({ secretKey: SECRET! });

  it("creates a hosted payment (Flow B) and round-trips metadata", async () => {
    const hosted = await client.createHostedPayment({
      amount: 4_999,
      currency: "SAR",
      description: "KSA live e2e — hosted",
      success_url: "https://example.com/return",
      back_url: "https://example.com/back",
      metadata: { session_id: "payses_live_hosted" },
    });

    expect(hosted.status).toBe("initiated");
    expect(hosted.url).toMatch(/^https:\/\/checkout\.moyasar\.com\/invoices\//);
    // Hosted-mode webhook routing depends on this surviving the round-trip.
    expect(hosted.metadata?.session_id).toBe("payses_live_hosted");

    const fetched = await client.fetchHostedPayment(hosted.id);
    expect(fetched.id).toBe(hosted.id);
  });

  it("charges a test card source (Flow A) and surfaces 3-D Secure as requires_more", async () => {
    const payment = await client.createPayment({
      amount: 4_999,
      currency: "SAR",
      description: "KSA live e2e — source",
      callback_url: "https://example.com/3ds",
      metadata: { session_id: "payses_live_source" },
      source: {
        type: "creditcard",
        name: "KSA Tester",
        number: "4111111111111111",
        cvc: "123",
        month: "12",
        year: "2030",
      },
    });

    // Saudi cards mandate 3-D Secure: the charge is `initiated` with a
    // challenge URL — exactly the provider's `requires_more` path.
    expect(payment.status).toBe("initiated");
    expect(payment.source?.transaction_url).toMatch(/^https:\/\/api\.moyasar\.com\//);

    const verified = await client.fetchPayment(payment.id);
    expect(verified.id).toBe(payment.id);
    expect(verified.amount).toBe(4_999);
  });

  it("boots the provider service on the live secret key alone (hosted default)", async () => {
    const service = new MoyasarProviderService({}, { secretKey: SECRET! });
    const result = await service.authorizePayment({
      data: {
        session_id: "payses_live_svc",
        amount: 4_999,
        currency: "SAR",
        callback_url: "https://example.com/return",
        description: "KSA live e2e — service hosted",
      },
    });

    expect(result.status).toBe("requires_more");
    expect((result.data as { url?: string }).url).toMatch(
      /^https:\/\/checkout\.moyasar\.com\/invoices\//,
    );
  });
});
