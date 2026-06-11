import { describe, expect, it, vi } from "vitest";

import {
  config,
  issueReturnCreditNote,
  type ReturnCreditNoteDeps,
} from "./zatca-return-credit-note";

const originalInvoice = {
  id: "zatinv_original",
  order_id: "order_2001",
  document_type: "invoice",
  source_type: "order",
  source_id: "order_2001",
  status: "reported",
  xml:
    '<Invoice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
    "<cbc:ID>INV-2001</cbc:ID>" +
    "</Invoice>",
  lines_snapshot: {
    lines: [
      {
        id: 1,
        sourceItemId: "item_taxable",
        name: "Taxable item",
        quantity: 2,
        unitPriceHalalas: 10000,
        lineExtensionHalalas: 20000,
        vatPercent: 15,
      },
    ],
    documentAllowances: [],
    documentCharges: [],
    totals: { taxInclusiveHalalas: 23000, taxHalalas: 3000 },
  },
};

function deps({
  original = originalInvoice,
  existingReturn = false,
}: {
  original?: typeof originalInvoice | null;
  existingReturn?: boolean;
}) {
  const runReportWorkflow = vi.fn(async (input: Record<string, unknown>) => ({
    id: `zatinv_${String(input.sourceId)}`,
    status: "reported" as const,
  }));
  const linkDocument = vi.fn(async () => undefined);
  const service = {
    listZatcaInvoices: vi.fn(async (filter: Record<string, unknown>) => {
      if (filter.source_type === "return") {
        return existingReturn ? [{ id: "zatinv_return_2001" }] : [];
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
  const queryGraph = vi.fn(async () => ({
    data: [
      {
        id: "return_2001",
        order_id: "order_2001",
        reason: "Customer return",
        items: [{ item_id: "item_taxable", received_quantity: 1 }],
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
      now: () => new Date("2026-06-11T15:00:01.000Z"),
    } satisfies ReturnCreditNoteDeps,
    runReportWorkflow,
    linkDocument,
  };
}

describe("order.return_received ZATCA subscriber", () => {
  it("listens to order.return_received", () => {
    expect(config.event).toBe("order.return_received");
  });

  it("issues a credit note for returned items", async () => {
    const ctx = deps({});

    await issueReturnCreditNote(
      { order_id: "order_2001", return_id: "return_2001" },
      ctx.deps,
    );

    expect(ctx.runReportWorkflow).toHaveBeenCalledTimes(1);
    expect(ctx.runReportWorkflow.mock.calls[0]![0]).toMatchObject({
      orderId: "order_2001",
      documentType: "credit_note",
      sourceType: "return",
      sourceId: "return_2001",
      parentInvoiceId: "zatinv_original",
      billingReference: "INV-2001",
      reason: "Customer return",
      serialNumber: "CN-return_2001",
      issueDate: "2026-06-11",
      issueTime: "15:00:01",
      expectedTaxInclusiveHalalas: 11500,
      expectedTaxHalalas: 1500,
    });
    expect(ctx.linkDocument).toHaveBeenCalledWith(
      "order_2001",
      "zatinv_return_2001",
    );
  });

  it("skips a re-fired return source key", async () => {
    const ctx = deps({ existingReturn: true });

    await issueReturnCreditNote(
      { order_id: "order_2001", return_id: "return_2001" },
      ctx.deps,
    );

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
    expect(ctx.linkDocument).not.toHaveBeenCalled();
  });

  it("no-ops when the order has no original invoice yet", async () => {
    const ctx = deps({ original: null });

    await issueReturnCreditNote(
      { order_id: "order_2001", return_id: "return_2001" },
      ctx.deps,
    );

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
    expect(ctx.linkDocument).not.toHaveBeenCalled();
  });
});
