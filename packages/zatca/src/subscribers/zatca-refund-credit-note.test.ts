import { describe, expect, it, vi } from "vitest";

import {
  config,
  issueRefundCreditNotesForPayment,
  type RefundCreditNoteDeps,
} from "./zatca-refund-credit-note";

const originalInvoice = {
  id: "zatinv_original",
  order_id: "order_1001",
  document_type: "invoice",
  source_type: "order",
  source_id: "order_1001",
  status: "reported",
  xml:
    '<Invoice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
    "<cbc:ProfileID>reporting:1.0</cbc:ProfileID>" +
    "<cbc:ID>INV-1001</cbc:ID>" +
    "</Invoice>",
  lines_snapshot: {
    lines: [
      {
        id: 1,
        name: "Taxable item",
        quantity: 1,
        unitPriceHalalas: 10000,
        lineExtensionHalalas: 10000,
        vatPercent: 15,
      },
    ],
    documentAllowances: [],
    documentCharges: [],
    totals: { taxInclusiveHalalas: 11500, taxHalalas: 1500 },
  },
};

function deps({
  refunds,
  original = originalInvoice,
  existingRefundIds = [],
}: {
  refunds: { id: string; amount: number }[];
  original?: typeof originalInvoice | null;
  existingRefundIds?: string[];
}) {
  const runReportWorkflow = vi.fn(async (input: Record<string, unknown>) => ({
    id: `zatinv_${String(input.sourceId)}`,
    status: "reported" as const,
  }));
  const linkDocument = vi.fn(async () => undefined);
  const service = {
    listZatcaInvoices: vi.fn(async (filter: Record<string, unknown>) => {
      if (filter.source_type === "refund") {
        return existingRefundIds.includes(String(filter.source_id))
          ? [{ id: `zatinv_${String(filter.source_id)}` }]
          : [];
      }
      if (filter.source_type === "order") {
        return original ? [original] : [];
      }
      if (filter.document_type === "invoice") {
        return original ? [original] : [];
      }
      if (filter.document_type === "credit_note") {
        return [];
      }
      return [];
    }),
  };
  const queryGraph = vi.fn(async () => ({
    data: [
      {
        id: "pay_1001",
        refunds,
        payment_collection: { order: { id: "order_1001" } },
      },
    ],
  }));
  return {
    deps: {
      queryGraph,
      service,
      runReportWorkflow,
      linkDocument,
      logger: { warn: vi.fn(), info: vi.fn() },
      now: () => new Date("2026-06-11T12:34:56.000Z"),
    } satisfies RefundCreditNoteDeps,
    runReportWorkflow,
    linkDocument,
    service,
  };
}

describe("payment.refunded ZATCA subscriber", () => {
  it("listens to payment.refunded", () => {
    expect(config.event).toBe("payment.refunded");
  });

  it("issues one reported credit note per new refund source key", async () => {
    const ctx = deps({
      refunds: [
        { id: "refund_full", amount: 115 },
        { id: "refund_partial", amount: 57.5 },
      ],
    });

    await issueRefundCreditNotesForPayment("pay_1001", ctx.deps);

    expect(ctx.runReportWorkflow).toHaveBeenCalledTimes(2);
    expect(ctx.runReportWorkflow.mock.calls[0]![0]).toMatchObject({
      orderId: "order_1001",
      documentType: "credit_note",
      sourceType: "refund",
      sourceId: "refund_full",
      parentInvoiceId: "zatinv_original",
      billingReference: "INV-1001",
      reason: "Refund",
      serialNumber: "CN-refund_full",
      issueDate: "2026-06-11",
      issueTime: "12:34:56",
      expectedTaxInclusiveHalalas: 11500,
      expectedTaxHalalas: 1500,
    });
    expect(ctx.runReportWorkflow.mock.calls[1]![0]).toMatchObject({
      sourceId: "refund_partial",
      expectedTaxInclusiveHalalas: 5750,
      expectedTaxHalalas: 750,
      lines: [
        {
          name: "Refund @ 15% VAT",
          unitPriceHalalas: 5000,
          vatPercent: 15,
        },
      ],
    });
    expect(ctx.linkDocument).toHaveBeenCalledTimes(2);
    expect(ctx.linkDocument).toHaveBeenCalledWith(
      "order_1001",
      "zatinv_refund_full",
    );
  });

  it("skips a re-fired refund source key", async () => {
    const ctx = deps({
      refunds: [{ id: "refund_full", amount: 115 }],
      existingRefundIds: ["refund_full"],
    });

    await issueRefundCreditNotesForPayment("pay_1001", ctx.deps);

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
    expect(ctx.linkDocument).not.toHaveBeenCalled();
  });

  it("no-ops when the order has no original invoice yet", async () => {
    const ctx = deps({
      refunds: [{ id: "refund_full", amount: 115 }],
      original: null,
    });

    await issueRefundCreditNotesForPayment("pay_1001", ctx.deps);

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
    expect(ctx.linkDocument).not.toHaveBeenCalled();
  });
});
