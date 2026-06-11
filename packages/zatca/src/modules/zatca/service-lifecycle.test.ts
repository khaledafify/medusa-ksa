import { describe, expect, it, vi } from "vitest";

import ZatcaModuleService from "./service";

describe("ZatcaModuleService lifecycle document generation", () => {
  it("returns an existing document by source key without entering the chain", async () => {
    const existing = {
      id: "zatinv_existing_refund",
      order_id: "order_1001",
      document_type: "credit_note",
      invoice_type: "simplified",
      source_type: "refund",
      source_id: "refund_1001",
      parent_invoice_id: "zatinv_original",
      billing_reference: "INV-1001",
      reason: "Refund",
      lines_snapshot: null,
      uuid: "11111111-1111-4111-8111-111111111111",
      icv: 42,
      pih: "previous-hash",
      invoice_hash: "hash",
      xml: "<Invoice/>",
      qr_code: "qr",
      status: "pending",
    };
    const transactional = vi.fn(async () => {
      throw new Error("idempotent lookup must not enter generation");
    });
    const listZatcaInvoices = vi.fn(async () => [existing]);
    const service = Object.assign(Object.create(ZatcaModuleService.prototype), {
      listZatcaInvoices,
      manager: { transactional },
    }) as {
      generateLifecycleDocument(input: Record<string, unknown>): Promise<unknown>;
    };

    await expect(
      service.generateLifecycleDocument({
        orderId: "order_1001",
        documentType: "credit_note",
        sourceType: "refund",
        sourceId: "refund_1001",
      }),
    ).resolves.toBe(existing);

    expect(listZatcaInvoices).toHaveBeenCalledWith(
      { source_type: "refund", source_id: "refund_1001" },
      { take: 1 },
    );
    expect(transactional).not.toHaveBeenCalled();
  });
});
