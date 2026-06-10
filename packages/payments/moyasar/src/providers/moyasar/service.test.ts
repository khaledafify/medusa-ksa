import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MedusaError } from "@medusajs/framework/utils";

import { KsaError } from "@medusa-ksa/core";

import type { MoyasarClient } from "./client.js";
import { MoyasarProviderService, paymentIdForSession } from "./service.js";
import type {
  MoyasarCreatePaymentRequest,
  MoyasarPayment,
  MoyasarSessionData,
  MoyasarWebhookEvent,
} from "./types.js";

const OPTIONS = {
  secretKey: "sk_test_secret123",
  publishableKey: "pk_test_pub123",
};

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Hermetic env: the loader falls back to MOYASAR_* env vars, so ambient shell
// values (e.g. during a live sandbox run) must not leak into these tests.
const ENV_KEYS = [
  "MOYASAR_SECRET_KEY",
  "MOYASAR_PUBLISHABLE_KEY",
  "MOYASAR_WEBHOOK_SECRET",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    }
  }
});

function paidPayment(overrides: Partial<MoyasarPayment> = {}): MoyasarPayment {
  return {
    id: "pay_1",
    status: "paid",
    amount: 4_999,
    currency: "SAR",
    captured: 4_999,
    metadata: { session_id: "payses_1" },
    source: { type: "creditcard", message: "APPROVED" },
    ...overrides,
  };
}

function makeService(client: Partial<MoyasarClient> = {}): MoyasarProviderService {
  const service = new MoyasarProviderService({}, OPTIONS);
  Reflect.set(service, "client_", client);
  return service;
}

function sessionData(overrides: Partial<MoyasarSessionData> = {}): MoyasarSessionData {
  return {
    status: "pending",
    publishable_key: OPTIONS.publishableKey,
    amount: 4_999,
    currency: "SAR",
    session_id: "payses_1",
    source: { type: "token", token: "tok_1" },
    callback_url: "https://store.example/3ds/return",
    ...overrides,
  };
}

describe("identifier and options", () => {
  it("registers under the moyasar identifier", () => {
    expect(MoyasarProviderService.identifier).toBe("moyasar");
  });

  it("fails fast at boot when required options are missing", () => {
    expect(() =>
      MoyasarProviderService.validateOptions({ publishableKey: "pk_test_x" }),
    ).toThrowError(/MOYASAR_SECRET_KEY/);
  });

  it("accepts valid options at boot", () => {
    expect(() => MoyasarProviderService.validateOptions(OPTIONS)).not.toThrow();
  });

  it("throws at construction when options are invalid", () => {
    expect(() => new MoyasarProviderService({}, {})).toThrowError(
      /MOYASAR_SECRET_KEY/,
    );
  });
});

describe("initiatePayment", () => {
  it("makes no API call and returns pending session data with the publishable key and halalas amount", async () => {
    const createPayment = vi.fn();
    const service = makeService({ createPayment });

    const result = await service.initiatePayment({
      amount: 49.99,
      currency_code: "sar",
      data: { session_id: "payses_1" },
    });

    expect(createPayment).not.toHaveBeenCalled();
    expect(result.id).toBe("payses_1");
    expect(result.status).toBe("pending");
    expect(result.data).toMatchObject({
      status: "pending",
      publishable_key: OPTIONS.publishableKey,
      amount: 4_999,
      currency: "SAR",
      session_id: "payses_1",
    });
  });

  it("rejects a non-SAR currency", async () => {
    const service = makeService();

    await expect(
      service.initiatePayment({
        amount: 10,
        currency_code: "usd",
        data: { session_id: "payses_1" },
      }),
    ).rejects.toSatisfy(
      (err) =>
        MedusaError.isMedusaError(err) && (err as Error).message.includes('SAR'),
    );
  });

  it("carries the description into session data when provided", async () => {
    const service = makeService();

    const result = await service.initiatePayment({
      amount: 10,
      currency_code: "SAR",
      data: { session_id: "payses_1", description: "Order 1001" },
    });

    expect(result.data).toMatchObject({ description: "Order 1001" });
  });
});

describe("authorizePayment", () => {
  it("charges the source and maps a paid payment to authorized", async () => {
    const createPayment = vi.fn(
      async (_req: MoyasarCreatePaymentRequest) => paidPayment(),
    );
    const service = makeService({ createPayment });

    const result = await service.authorizePayment({ data: sessionData() });

    expect(result.status).toBe("authorized");
    expect(result.data).toMatchObject({
      moyasar_payment_id: "pay_1",
      status: "paid",
    });
    expect(createPayment).toHaveBeenCalledTimes(1);
    const request = createPayment.mock.calls[0]![0];
    expect(request).toMatchObject({
      amount: 4_999,
      currency: "SAR",
      callback_url: "https://store.example/3ds/return",
      source: { type: "token", token: "tok_1" },
      metadata: { session_id: "payses_1" },
    });
    expect(String(request.given_id)).toMatch(UUID_V4);
  });

  it("derives a deterministic given_id from the session id (provider-side idempotency)", async () => {
    expect(paymentIdForSession("payses_1")).toBe(paymentIdForSession("payses_1"));
    expect(paymentIdForSession("payses_1")).not.toBe(
      paymentIdForSession("payses_2"),
    );
    expect(paymentIdForSession("payses_1")).toMatch(UUID_V4);
  });

  it("strips the single-use source from the session data it returns", async () => {
    const service = makeService({ createPayment: async () => paidPayment() });

    const result = await service.authorizePayment({ data: sessionData() });

    expect(result.data).not.toHaveProperty("source");
  });

  it("maps an initiated payment with a transaction_url to requires_more and surfaces the redirect", async () => {
    const service = makeService({
      createPayment: async () =>
        paidPayment({
          status: "initiated",
          captured: 0,
          source: {
            type: "creditcard",
            transaction_url: "https://api.moyasar.com/3ds/challenge",
          },
        }),
    });

    const result = await service.authorizePayment({ data: sessionData() });

    expect(result.status).toBe("requires_more");
    expect(result.data).toMatchObject({
      transaction_url: "https://api.moyasar.com/3ds/challenge",
      moyasar_payment_id: "pay_1",
    });
  });

  it("maps a failed payment to the error status", async () => {
    const service = makeService({
      createPayment: async () =>
        paidPayment({
          status: "failed",
          captured: 0,
          source: { type: "creditcard", message: "DECLINED" },
        }),
    });

    const result = await service.authorizePayment({ data: sessionData() });

    expect(result.status).toBe("error");
  });

  it("re-checks the existing payment instead of charging twice on re-authorization after 3DS", async () => {
    const createPayment = vi.fn();
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ createPayment, fetchPayment });

    const result = await service.authorizePayment({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(createPayment).not.toHaveBeenCalled();
    expect(fetchPayment).toHaveBeenCalledWith("pay_1");
    expect(result.status).toBe("authorized");
  });

  it("collapses concurrent authorizations for the same session into one charge", async () => {
    let resolveCreate: ((p: MoyasarPayment) => void) | undefined;
    const createPayment = vi.fn(
      () =>
        new Promise<MoyasarPayment>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const service = makeService({ createPayment });

    const first = service.authorizePayment({ data: sessionData() });
    const second = service.authorizePayment({ data: sessionData() });
    resolveCreate!(paidPayment());

    const [a, b] = await Promise.all([first, second]);
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("authorized");
    expect(b.status).toBe("authorized");
  });

  it("rejects authorization when the storefront has not written back a source", async () => {
    const service = makeService();

    await expect(
      service.authorizePayment({ data: sessionData({ source: undefined }) }),
    ).rejects.toSatisfy(
      (err) =>
        MedusaError.isMedusaError(err) && (err as Error).message.includes('source'),
    );
  });

  it("rejects authorization when the storefront has not written back a callback_url", async () => {
    const service = makeService();

    await expect(
      service.authorizePayment({
        data: sessionData({ callback_url: undefined }),
      }),
    ).rejects.toSatisfy(
      (err) =>
        MedusaError.isMedusaError(err) &&
        (err as Error).message.includes('callback_url'),
    );
  });

  it("never leaks the secret key in authorization errors", async () => {
    const service = makeService({
      createPayment: async () => {
        throw new KsaError("POST /payments responded 401: ***", {
          prefix: "core",
          code: "http_error",
        });
      },
    });

    let caught: unknown;
    try {
      await service.authorizePayment({ data: sessionData() });
    } catch (err) {
      caught = err;
    }

    expect((caught as Error).message).not.toContain(OPTIONS.secretKey);
  });
});

describe("capturePayment", () => {
  it("confirms an already-captured payment without any write call", async () => {
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ fetchPayment });

    const result = await service.capturePayment({
      data: sessionData({ moyasar_payment_id: "pay_1", source: undefined }),
    });

    expect(fetchPayment).toHaveBeenCalledWith("pay_1");
    expect(result.data).toMatchObject({ status: "paid" });
  });

  it("is idempotent — confirming twice is two reads, never a write", async () => {
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ fetchPayment });
    const data = sessionData({ moyasar_payment_id: "pay_1" });

    await service.capturePayment({ data });
    await service.capturePayment({ data });

    expect(fetchPayment).toHaveBeenCalledTimes(2);
  });

  it("rejects confirmation when the payment was never captured by Moyasar", async () => {
    const service = makeService({
      fetchPayment: async () => paidPayment({ status: "failed", captured: 0 }),
    });

    await expect(
      service.capturePayment({
        data: sessionData({ moyasar_payment_id: "pay_1" }),
      }),
    ).rejects.toSatisfy((err) => MedusaError.isMedusaError(err));
  });

  it("rejects confirmation when no Moyasar payment exists yet", async () => {
    const service = makeService();

    await expect(
      service.capturePayment({ data: sessionData() }),
    ).rejects.toSatisfy((err) => MedusaError.isMedusaError(err));
  });
});

describe("getPaymentStatus", () => {
  const cases: [MoyasarPayment["status"], string][] = [
    ["paid", "captured"],
    ["captured", "captured"],
    ["authorized", "authorized"],
    ["failed", "error"],
    ["voided", "canceled"],
    ["refunded", "captured"],
    ["verified", "pending"],
  ];

  it.each(cases)("maps Moyasar %s to Medusa %s", async (moyasar, medusa) => {
    const service = makeService({
      fetchPayment: async () => paidPayment({ status: moyasar }),
    });

    const result = await service.getPaymentStatus({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(result.status).toBe(medusa);
  });

  it("maps an initiated payment with a 3DS challenge to requires_more", async () => {
    const service = makeService({
      fetchPayment: async () =>
        paidPayment({
          status: "initiated",
          source: { type: "creditcard", transaction_url: "https://3ds" },
        }),
    });

    const result = await service.getPaymentStatus({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(result.status).toBe("requires_more");
  });

  it("reports pending while no Moyasar payment exists yet", async () => {
    const service = makeService();

    const result = await service.getPaymentStatus({ data: sessionData() });

    expect(result.status).toBe("pending");
  });
});

describe("retrievePayment", () => {
  it("returns the payment as found at Moyasar", async () => {
    const payment = paidPayment();
    const service = makeService({ fetchPayment: async () => payment });

    const result = await service.retrievePayment({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(result.data).toMatchObject({ id: "pay_1", status: "paid" });
  });

  it("rejects retrieval when no Moyasar payment exists yet", async () => {
    const service = makeService();

    await expect(
      service.retrievePayment({ data: sessionData() }),
    ).rejects.toSatisfy((err) => MedusaError.isMedusaError(err));
  });
});

describe("updatePayment", () => {
  it("recomputes the halalas amount while no Moyasar payment exists", async () => {
    const service = makeService();

    const result = await service.updatePayment({
      amount: 100.5,
      currency_code: "SAR",
      data: sessionData(),
    });

    expect(result.data).toMatchObject({ amount: 10_050, currency: "SAR" });
  });

  it("rejects an amount change after the Moyasar payment was created", async () => {
    const service = makeService();

    await expect(
      service.updatePayment({
        amount: 999,
        currency_code: "SAR",
        data: sessionData({ moyasar_payment_id: "pay_1" }),
      }),
    ).rejects.toSatisfy((err) => MedusaError.isMedusaError(err));
  });

  it("keeps the session unchanged when the amount is identical after creation", async () => {
    const data = sessionData({ moyasar_payment_id: "pay_1" });
    const service = makeService();

    const result = await service.updatePayment({
      amount: 49.99,
      currency_code: "SAR",
      data,
    });

    expect(result.data).toMatchObject({ moyasar_payment_id: "pay_1" });
  });
});

describe("refundPayment", () => {
  it("sends a partial refund in integer halalas", async () => {
    const refundPayment = vi.fn(async (_id: string, _amount?: number) =>
      paidPayment({ status: "refunded", refunded: 1_000 }),
    );
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ refundPayment, fetchPayment });

    const result = await service.refundPayment({
      amount: 10,
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(refundPayment).toHaveBeenCalledWith("pay_1", 1_000);
    expect(result.data).toMatchObject({
      moyasar_payment_id: "pay_1",
      status: "refunded",
    });
  });

  it("sends a full refund", async () => {
    const refundPayment = vi.fn(async (_id: string, _amount?: number) =>
      paidPayment({ status: "refunded", refunded: 4_999 }),
    );
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ refundPayment, fetchPayment });

    await service.refundPayment({
      amount: 49.99,
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(refundPayment).toHaveBeenCalledWith("pay_1", 4_999);
  });

  it("is idempotent: a fully refunded payment is not refunded again", async () => {
    const refundPayment = vi.fn();
    const fetchPayment = vi.fn(async () =>
      paidPayment({ status: "refunded", refunded: 4_999 }),
    );
    const service = makeService({ refundPayment, fetchPayment });

    const result = await service.refundPayment({
      amount: 49.99,
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(refundPayment).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ status: "refunded" });
  });

  it("collapses concurrent identical refunds into one API call", async () => {
    const refundPayment = vi.fn(async (_id: string, _amount?: number) =>
      paidPayment({ status: "refunded", refunded: 1_000 }),
    );
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ refundPayment, fetchPayment });
    const input = {
      amount: 10,
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    };

    await Promise.all([
      service.refundPayment(input),
      service.refundPayment(input),
    ]);

    expect(refundPayment).toHaveBeenCalledTimes(1);
  });

  it("rejects when no Moyasar payment exists for the session", async () => {
    const service = makeService();

    await expect(
      service.refundPayment({ amount: 10, data: sessionData() }),
    ).rejects.toSatisfy((err) => MedusaError.isMedusaError(err));
  });

  it("never leaks the secret key when the refund fails", async () => {
    const refundPayment = vi.fn(async (_id: string, _amount?: number) => {
      throw new KsaError("refund failed (HTTP 400)", {
        prefix: "moyasar",
      });
    });
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ refundPayment, fetchPayment });

    await expect(
      service.refundPayment({
        amount: 10,
        data: sessionData({ moyasar_payment_id: "pay_1" }),
      }),
    ).rejects.toSatisfy(
      (err) => !(err as Error).message.includes(OPTIONS.secretKey),
    );
  });
});

describe("cancelPayment", () => {
  it("voids an authorized payment", async () => {
    const voidPayment = vi.fn(async (_id: string) =>
      paidPayment({ status: "voided" }),
    );
    const fetchPayment = vi.fn(async () => paidPayment({ status: "authorized" }));
    const service = makeService({ voidPayment, fetchPayment });

    const result = await service.cancelPayment({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(voidPayment).toHaveBeenCalledTimes(1);
    expect(voidPayment).toHaveBeenCalledWith("pay_1");
    expect(result.data).toMatchObject({ status: "voided" });
  });

  it("treats an initiated payment as canceled without voiding (nothing was charged)", async () => {
    // Verified against the live sandbox: Moyasar rejects voiding `initiated`
    // payments ("Only paid or authorized payments may be voided") — an
    // abandoned 3DS attempt simply expires.
    const voidPayment = vi.fn();
    const fetchPayment = vi.fn(async () => paidPayment({ status: "initiated" }));
    const service = makeService({ voidPayment, fetchPayment });

    const result = await service.cancelPayment({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(voidPayment).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ status: "initiated" });
  });

  it("is idempotent: an already voided payment is not voided again", async () => {
    const voidPayment = vi.fn();
    const fetchPayment = vi.fn(async () => paidPayment({ status: "voided" }));
    const service = makeService({ voidPayment, fetchPayment });

    const result = await service.cancelPayment({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(voidPayment).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ status: "voided" });
  });

  it("is a no-op while no Moyasar payment exists", async () => {
    const voidPayment = vi.fn();
    const fetchPayment = vi.fn();
    const service = makeService({ voidPayment, fetchPayment });

    const result = await service.cancelPayment({ data: sessionData() });

    expect(voidPayment).not.toHaveBeenCalled();
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(result.data).toBeDefined();
  });

  it("rejects cancelling a captured payment and points at refunds", async () => {
    const voidPayment = vi.fn();
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ voidPayment, fetchPayment });

    await expect(
      service.cancelPayment({
        data: sessionData({ moyasar_payment_id: "pay_1" }),
      }),
    ).rejects.toSatisfy(
      (err) =>
        MedusaError.isMedusaError(err) &&
        (err as Error).message.includes("refund"),
    );
    expect(voidPayment).not.toHaveBeenCalled();
  });
});

describe("deletePayment", () => {
  it("is a no-op while no Moyasar payment exists", async () => {
    const voidPayment = vi.fn();
    const fetchPayment = vi.fn();
    const service = makeService({ voidPayment, fetchPayment });

    const result = await service.deletePayment({ data: sessionData() });

    expect(voidPayment).not.toHaveBeenCalled();
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(result.data).toBeDefined();
  });

  it("voids an authorized payment when the session is deleted", async () => {
    const voidPayment = vi.fn(async (_id: string) =>
      paidPayment({ status: "voided" }),
    );
    const fetchPayment = vi.fn(async () =>
      paidPayment({ status: "authorized" }),
    );
    const service = makeService({ voidPayment, fetchPayment });

    await service.deletePayment({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(voidPayment).toHaveBeenCalledTimes(1);
    expect(voidPayment).toHaveBeenCalledWith("pay_1");
  });

  it("does not void an initiated payment on delete (Moyasar rejects it; it expires on its own)", async () => {
    const voidPayment = vi.fn();
    const fetchPayment = vi.fn(async () => paidPayment({ status: "initiated" }));
    const service = makeService({ voidPayment, fetchPayment });

    const result = await service.deletePayment({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(voidPayment).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ moyasar_payment_id: "pay_1" });
  });

  it("does not throw when the payment reached a terminal state", async () => {
    const voidPayment = vi.fn();
    const fetchPayment = vi.fn(async () => paidPayment());
    const service = makeService({ voidPayment, fetchPayment });

    const result = await service.deletePayment({
      data: sessionData({ moyasar_payment_id: "pay_1" }),
    });

    expect(voidPayment).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ moyasar_payment_id: "pay_1" });
  });
});

describe("getWebhookActionAndData", () => {
  const WEBHOOK_SECRET = "whtok_test_1";

  function webhookEvent(
    overrides: Partial<MoyasarWebhookEvent> = {},
  ): MoyasarWebhookEvent {
    return {
      id: "evt_1",
      type: "payment_paid",
      secret_token: WEBHOOK_SECRET,
      data: paidPayment(),
      ...overrides,
    };
  }

  function makeWebhookService(
    client: Partial<MoyasarClient>,
    extraOptions: Record<string, unknown> = { webhookSecret: WEBHOOK_SECRET },
  ): MoyasarProviderService {
    const service = new MoyasarProviderService(
      {},
      { ...OPTIONS, ...extraOptions },
    );
    Reflect.set(service, "client_", client);
    return service;
  }

  function payloadFor(event: MoyasarWebhookEvent) {
    return {
      data: event as unknown as Record<string, unknown>,
      rawData: JSON.stringify(event),
      headers: {},
    };
  }

  it("maps a verified payment_paid event to captured using the API-fetched state", async () => {
    const fetchPayment = vi.fn(async (_id: string) => paidPayment());
    const service = makeWebhookService({ fetchPayment });

    const result = await service.getWebhookActionAndData(
      payloadFor(webhookEvent()),
    );

    expect(fetchPayment).toHaveBeenCalledTimes(1);
    expect(fetchPayment).toHaveBeenCalledWith("pay_1");
    expect(result.action).toBe("captured");
    expect(result.data).toMatchObject({ session_id: "payses_1", amount: 49.99 });
  });

  it("maps payment_failed to failed", async () => {
    const fetchPayment = vi.fn(async (_id: string) =>
      paidPayment({ status: "failed" }),
    );
    const service = makeWebhookService({ fetchPayment });

    const result = await service.getWebhookActionAndData(
      payloadFor(
        webhookEvent({ type: "payment_failed", data: paidPayment({ status: "failed" }) }),
      ),
    );

    expect(result.action).toBe("failed");
  });

  it("trusts the API, not the payload: a tampered paid event on a failed payment maps to failed", async () => {
    // Event body claims "paid" but Moyasar's API says the payment failed.
    const fetchPayment = vi.fn(async (_id: string) =>
      paidPayment({ status: "failed" }),
    );
    const service = makeWebhookService({ fetchPayment });

    const result = await service.getWebhookActionAndData(
      payloadFor(webhookEvent()),
    );

    expect(result.action).toBe("failed");
  });

  it("rejects a wrong secret token without calling the API", async () => {
    const fetchPayment = vi.fn();
    const service = makeWebhookService({ fetchPayment });

    const result = await service.getWebhookActionAndData(
      payloadFor(webhookEvent({ secret_token: "whtok_wrong" })),
    );

    expect(fetchPayment).not.toHaveBeenCalled();
    expect(result.action).toBe("not_supported");
  });

  it("rejects a missing secret token when a webhook secret is configured", async () => {
    const fetchPayment = vi.fn();
    const service = makeWebhookService({ fetchPayment });

    const result = await service.getWebhookActionAndData(
      payloadFor(webhookEvent({ secret_token: undefined })),
    );

    expect(fetchPayment).not.toHaveBeenCalled();
    expect(result.action).toBe("not_supported");
  });

  it("still verifies against the API when no webhook secret is configured", async () => {
    const fetchPayment = vi.fn(async (_id: string) => paidPayment());
    const service = makeWebhookService({ fetchPayment }, {});

    const result = await service.getWebhookActionAndData(
      payloadFor(webhookEvent({ secret_token: undefined })),
    );

    expect(fetchPayment).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("captured");
  });

  it("is idempotent under redelivery: replaying payment_paid yields the same captured action", async () => {
    const fetchPayment = vi.fn(async (_id: string) => paidPayment());
    const service = makeWebhookService({ fetchPayment });
    const payload = payloadFor(webhookEvent());

    const first = await service.getWebhookActionAndData(payload);
    const second = await service.getWebhookActionAndData(payload);

    expect(first).toEqual(second);
    expect(second.action).toBe("captured");
  });

  it("returns not_supported for refund events (Medusa drives refunds itself)", async () => {
    const fetchPayment = vi.fn();
    const service = makeWebhookService({ fetchPayment });

    const result = await service.getWebhookActionAndData(
      payloadFor(
        webhookEvent({
          type: "payment_refunded",
          data: paidPayment({ status: "refunded", refunded: 4_999 }),
        }),
      ),
    );

    expect(fetchPayment).not.toHaveBeenCalled();
    expect(result.action).toBe("not_supported");
  });

  it("returns not_supported for a malformed payload", async () => {
    const fetchPayment = vi.fn();
    const service = makeWebhookService({ fetchPayment });

    const result = await service.getWebhookActionAndData({
      data: { nonsense: true },
      rawData: "{}",
      headers: {},
    });

    expect(fetchPayment).not.toHaveBeenCalled();
    expect(result.action).toBe("not_supported");
  });

  it("returns not_supported when the payment carries no session_id metadata", async () => {
    const orphan = paidPayment({ metadata: {} });
    const fetchPayment = vi.fn(async (_id: string) => orphan);
    const service = makeWebhookService({ fetchPayment });

    const result = await service.getWebhookActionAndData(
      payloadFor(webhookEvent({ data: orphan })),
    );

    expect(result.action).toBe("not_supported");
  });

  it("never leaks the secret key or webhook secret when the verify fetch fails", async () => {
    const fetchPayment = vi.fn(async (_id: string) => {
      throw new KsaError("fetch failed (HTTP 500)", { prefix: "moyasar" });
    });
    const service = makeWebhookService({ fetchPayment });

    await expect(
      service.getWebhookActionAndData(payloadFor(webhookEvent())),
    ).rejects.toSatisfy((err) => {
      const message = (err as Error).message;
      return (
        !message.includes(OPTIONS.secretKey) &&
        !message.includes(WEBHOOK_SECRET)
      );
    });
  });
});