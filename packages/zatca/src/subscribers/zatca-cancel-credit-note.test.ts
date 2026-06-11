import { describe, expect, it, vi } from "vitest";

import {
  config,
  issueCancellationCreditNote,
  type CancellationCreditNoteDeps,
} from "./zatca-cancel-credit-note";

const originalInvoice = {
  id: "zatinv_original",
  order_id: "order_3001",
  document_type: "invoice",
  source_type: "order",
  source_id: "order_3001",
  status: "reported",
  xml:
    '<Invoice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
    "<cbc:ID>INV-3001</cbc:ID>" +
    "</Invoice>",
  lines_snapshot: {
    lines: [
      {
        id: 1,
        sourceItemId: "item_taxable",
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
  original = originalInvoice,
  existingCancel = false,
}: {
  original?: typeof originalInvoice | null;
  existingCancel?: boolean;
}) {
  const runReportWorkflow = vi.fn(async (input: Record<string, unknown>) => ({
    id: `zatinv_${String(input.sourceId)}`,
    status: "reported" as const,
  }));
  const linkDocument = vi.fn(async () => undefined);
  const service = {
    listZatcaInvoices: vi.fn(async (filter: Record<string, unknown>) => {
      if (filter.source_type === "order_cancel") {
        return existingCancel ? [{ id: "zatinv_cancel_3001" }] : [];
      }
      if (filter.source_type === "order") {
        return original ? [original] : [];
      }
      if (filter.document_type === "credit_note") {
        return [];
      }
      return [];
    }),
  };
  return {
    deps: {
      service,
      runReportWorkflow,
      linkDocument,
      logger: { warn: vi.fn(), info: vi.fn() },
      now: () => new Date("2026-06-11T16:17:18.000Z"),
    } satisfies CancellationCreditNoteDeps,
    runReportWorkflow,
    linkDocument,
  };
}

describe("order.canceled ZATCA subscriber", () => {
  it("listens to order.canceled", () => {
    expect(config.event).toBe("order.canceled");
  });

  it("issues a full credit note for a canceled order with a reported invoice", async () => {
    const ctx = deps({});

    await issueCancellationCreditNote("order_3001", ctx.deps);

    expect(ctx.runReportWorkflow).toHaveBeenCalledTimes(1);
    expect(ctx.runReportWorkflow.mock.calls[0]![0]).toMatchObject({
      orderId: "order_3001",
      documentType: "credit_note",
      sourceType: "order_cancel",
      sourceId: "order_3001",
      parentInvoiceId: "zatinv_original",
      billingReference: "INV-3001",
      reason: "Order cancelled",
      serialNumber: "CN-CANCEL-order_3001",
      issueDate: "2026-06-11",
      issueTime: "16:17:18",
      expectedTaxInclusiveHalalas: 11500,
      expectedTaxHalalas: 1500,
    });
    expect(ctx.linkDocument).toHaveBeenCalledWith(
      "order_3001",
      "zatinv_order_3001",
    );
  });

  it("skips a re-fired cancellation source key", async () => {
    const ctx = deps({ existingCancel: true });

    await issueCancellationCreditNote("order_3001", ctx.deps);

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
    expect(ctx.linkDocument).not.toHaveBeenCalled();
  });

  it("no-ops without an original invoice", async () => {
    const ctx = deps({ original: null });

    await issueCancellationCreditNote("order_3001", ctx.deps);

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
    expect(ctx.linkDocument).not.toHaveBeenCalled();
  });

  it("no-ops unless the original invoice is reported", async () => {
    const ctx = deps({
      original: { ...originalInvoice, status: "pending" },
    });

    await issueCancellationCreditNote("order_3001", ctx.deps);

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
    expect(ctx.linkDocument).not.toHaveBeenCalled();
  });
});
