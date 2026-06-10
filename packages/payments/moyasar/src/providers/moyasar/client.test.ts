import { describe, expect, it, vi } from "vitest";

import { KsaError } from "@medusa-ksa/core";

import { MOYASAR_API_BASE_URL, MoyasarClient } from "./client.js";
import type { MoyasarPayment } from "./types.js";

const SECRET = "sk_test_supersecret123";

const PAYMENT: MoyasarPayment = {
  id: "pay_1",
  status: "paid",
  amount: 10_000,
  currency: "SAR",
  source: { type: "creditcard" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch, retry?: { retries: number; baseDelayMs: number }) {
  return new MoyasarClient({
    secretKey: SECRET,
    retry,
    fetchImpl,
    sleepImpl: () => Promise.resolve(),
  });
}

describe("MoyasarClient", () => {
  it("authenticates with HTTP Basic using the secret key as username and an empty password", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const expected = `Basic ${Buffer.from(`${SECRET}:`, "utf8").toString("base64")}`;
      expect(headers.Authorization).toBe(expected);
      return jsonResponse(PAYMENT, 201);
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.createPayment({
      amount: 10_000,
      currency: "SAR",
      source: { type: "token", token: "tok_1" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("POSTs payment creation to /payments with halalas amounts and the full body", async () => {
    let captured: { url: string; body: unknown } | undefined;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) };
      return jsonResponse(PAYMENT, 201);
    }) as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.createPayment({
      given_id: "9d2c41f0-0000-4000-8000-000000000000",
      amount: 4_999,
      currency: "SAR",
      callback_url: "https://store.example/3ds/return",
      description: "Order 1001",
      source: { type: "token", token: "tok_1" },
      metadata: { session_id: "payses_1" },
    });

    expect(captured?.url).toBe(`${MOYASAR_API_BASE_URL}/payments`);
    expect(captured?.body).toEqual({
      given_id: "9d2c41f0-0000-4000-8000-000000000000",
      amount: 4_999,
      currency: "SAR",
      callback_url: "https://store.example/3ds/return",
      description: "Order 1001",
      source: { type: "token", token: "tok_1" },
      metadata: { session_id: "payses_1" },
    });
  });

  it("GETs a payment by id", async () => {
    let captured: { url: string; method: string | undefined } | undefined;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), method: init?.method };
      return jsonResponse(PAYMENT);
    }) as typeof fetch;

    const client = makeClient(fetchImpl);
    const payment = await client.fetchPayment("pay_1");

    expect(captured?.url).toBe(`${MOYASAR_API_BASE_URL}/payments/pay_1`);
    expect(captured?.method).toBe("GET");
    expect(payment).toEqual(PAYMENT);
  });

  it("POSTs a partial refund amount in halalas", async () => {
    let captured: { url: string; body: unknown } | undefined;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) };
      return jsonResponse({ ...PAYMENT, status: "refunded", refunded: 2_000 });
    }) as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.refundPayment("pay_1", 2_000);

    expect(captured?.url).toBe(`${MOYASAR_API_BASE_URL}/payments/pay_1/refund`);
    expect(captured?.body).toEqual({ amount: 2_000 });
  });

  it("POSTs a full refund with no body when the amount is omitted", async () => {
    let captured: { body: RequestInit["body"] } | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      captured = { body: init?.body };
      return jsonResponse({ ...PAYMENT, status: "refunded" });
    }) as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.refundPayment("pay_1");

    expect(captured?.body).toBeUndefined();
  });

  it("POSTs a void to /payments/:id/void", async () => {
    let captured: { url: string } | undefined;
    const fetchImpl = (async (url: unknown) => {
      captured = { url: String(url) };
      return jsonResponse({ ...PAYMENT, status: "voided" });
    }) as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.voidPayment("pay_1");

    expect(captured?.url).toBe(`${MOYASAR_API_BASE_URL}/payments/pay_1/void`);
  });

  it("throws a KsaError on a non-2xx response", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: "Invalid source token" }, 400)) as typeof fetch;

    const client = makeClient(fetchImpl);
    let caught: unknown;
    try {
      await client.fetchPayment("pay_1");
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    expect((caught as KsaError).code).toBe("http_error");
    expect((caught as KsaError).message).toContain("400");
  });

  it("redacts the secret key from error messages when the provider echoes it back", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ message: `Bad credentials: ${SECRET}` }, 401)) as typeof fetch;

    const client = makeClient(fetchImpl);
    let caught: unknown;
    try {
      await client.fetchPayment("pay_1");
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    const message = (caught as KsaError).message;
    expect(message).not.toContain(SECRET);
    expect(message).toContain("***");
  });

  it("retries GETs on 5xx and succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls < 3 ? jsonResponse({}, 500) : jsonResponse(PAYMENT);
    }) as typeof fetch;

    const client = makeClient(fetchImpl, { retries: 2, baseDelayMs: 0 });
    const payment = await client.fetchPayment("pay_1");

    expect(calls).toBe(3);
    expect(payment).toEqual(PAYMENT);
  });

  it("retries GETs on 429", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 429) : jsonResponse(PAYMENT);
    }) as typeof fetch;

    const client = makeClient(fetchImpl, { retries: 2, baseDelayMs: 0 });
    await client.fetchPayment("pay_1");

    expect(calls).toBe(2);
  });

  it("never retries payment creation, even on 5xx", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({}, 500);
    }) as typeof fetch;

    const client = makeClient(fetchImpl, { retries: 3, baseDelayMs: 0 });
    await expect(
      client.createPayment({
        amount: 100,
        currency: "SAR",
        source: { type: "token", token: "tok_1" },
      }),
    ).rejects.toSatisfy((err) => KsaError.isKsaError(err));

    expect(calls).toBe(1);
  });

  it("never retries refunds or voids", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({}, 500);
    }) as typeof fetch;

    const client = makeClient(fetchImpl, { retries: 3, baseDelayMs: 0 });

    await expect(client.refundPayment("pay_1", 100)).rejects.toSatisfy((err) =>
      KsaError.isKsaError(err),
    );
    expect(calls).toBe(1);

    await expect(client.voidPayment("pay_1")).rejects.toSatisfy((err) =>
      KsaError.isKsaError(err),
    );
    expect(calls).toBe(2);
  });
});
