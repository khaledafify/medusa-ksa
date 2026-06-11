import { describe, expect, it, vi } from "vitest";

import {
  config,
  issueOrderEditNote,
  type OrderEditNoteDeps,
} from "./zatca-order-edit-note";

const originalInvoice = {
  id: "zatinv_original",
  order_id: "order_4001",
  document_type: "invoice",
  source_type: "order",
  source_id: "order_4001",
  status: "reported",
  xml:
    '<Invoice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
    "<cbc:ID>INV-4001</cbc:ID>" +
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

function order(total: number, taxTotal: number, subtotal: number) {
  return {
    id: "order_4001",
    display_id: 4001,
    currency_code: "sar",
    status: "completed",
    total,
    tax_total: taxTotal,
    items: [
      {
        id: "item_taxable",
        title: "Taxable item",
        quantity: 1,
        unit_price: subtotal,
        subtotal,
        total,
        tax_total: taxTotal,
        discount_total: 0,
        discount_tax_total: 0,
        tax_lines: [{ rate: 15, total: taxTotal, subtotal: taxTotal }],
        detail: { quantity: 1 },
      },
    ],
    shipping_methods: [],
  };
}

function deps({
  currentOrder = order(230, 30, 200),
  original = originalInvoice,
  existingEdit = false,
}: {
  currentOrder?: ReturnType<typeof order>;
  original?: typeof originalInvoice | null;
  existingEdit?: boolean;
}) {
  const runReportWorkflow = vi.fn(async (input: Record<string, unknown>) => ({
    id: `zatinv_${String(input.sourceId)}`,
    status: "reported" as const,
  }));
  const linkDocument = vi.fn(async () => undefined);
  const service = {
    listZatcaInvoices: vi.fn(async (filter: Record<string, unknown>) => {
      if (filter.source_type === "order_edit") {
        return existingEdit ? [{ id: "zatinv_edit_4001" }] : [];
      }
      if (filter.source_type === "order") {
        return original ? [original] : [];
      }
      return [];
    }),
  };
  const queryGraph = vi.fn(async () => ({ data: [currentOrder] }));
  return {
    deps: {
      queryGraph,
      service,
      runReportWorkflow,
      linkDocument,
      logger: { warn: vi.fn(), info: vi.fn() },
      now: () => new Date("2026-06-11T17:18:19.000Z"),
    } satisfies OrderEditNoteDeps,
    runReportWorkflow,
    linkDocument,
  };
}

describe("order-edit.confirmed ZATCA subscriber", () => {
  it("listens to order-edit.confirmed", () => {
    expect(config.event).toBe("order-edit.confirmed");
  });

  it("issues a debit note when an edit increases the order value", async () => {
    const ctx = deps({});

    await issueOrderEditNote(
      { id: "edit_4001", order_id: "order_4001", actions: [] },
      ctx.deps,
    );

    expect(ctx.runReportWorkflow).toHaveBeenCalledTimes(1);
    expect(ctx.runReportWorkflow.mock.calls[0]![0]).toMatchObject({
      orderId: "order_4001",
      documentType: "debit_note",
      sourceType: "order_edit",
      sourceId: "edit_4001",
      parentInvoiceId: "zatinv_original",
      billingReference: "INV-4001",
      reason: "Order edit increase",
      serialNumber: "DN-edit_4001",
      issueDate: "2026-06-11",
      issueTime: "17:18:19",
      expectedTaxInclusiveHalalas: 11500,
      expectedTaxHalalas: 1500,
    });
    expect(ctx.linkDocument).toHaveBeenCalledWith("order_4001", "zatinv_edit_4001");
  });

  it("issues a credit note when an edit decreases the order value", async () => {
    const ctx = deps({ currentOrder: order(57.5, 7.5, 50) });

    await issueOrderEditNote(
      { id: "edit_4002", order_id: "order_4001", actions: [] },
      ctx.deps,
    );

    expect(ctx.runReportWorkflow.mock.calls[0]![0]).toMatchObject({
      documentType: "credit_note",
      sourceId: "edit_4002",
      reason: "Order edit decrease",
      serialNumber: "CN-edit_4002",
      expectedTaxInclusiveHalalas: 5750,
      expectedTaxHalalas: 750,
    });
  });

  it("skips re-fired edit source keys", async () => {
    const ctx = deps({ existingEdit: true });

    await issueOrderEditNote(
      { id: "edit_4001", order_id: "order_4001", actions: [] },
      ctx.deps,
    );

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
  });

  it("no-ops before any original invoice is reported", async () => {
    const ctx = deps({ original: null });

    await issueOrderEditNote(
      { id: "edit_4001", order_id: "order_4001", actions: [] },
      ctx.deps,
    );

    expect(ctx.runReportWorkflow).not.toHaveBeenCalled();
  });
});
