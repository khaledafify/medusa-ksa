import { describe, expect, it, vi } from "vitest";

import { ReconciliationMismatchError } from "../modules/zatca/lib/tax-base";
import { notifyZatcaGenerationFailure } from "./zatca-remediation-notification";

describe("notifyZatcaGenerationFailure", () => {
  it("emits a non-secret admin notification for reconciliation mismatches", async () => {
    const logger = { error: vi.fn() };
    const notification = { createNotifications: vi.fn(() => Promise.resolve()) };
    const container = {
      resolve(key: string) {
        if (key === "logger") return logger;
        if (key === "notification") return notification;
        throw new Error(`unexpected resolve ${key}`);
      },
    };

    await notifyZatcaGenerationFailure(
      container as never,
      {
        orderId: "order_123",
        sourceType: "order",
        sourceId: "order_123",
        serialNumber: "INV-123",
      } as never,
      new ReconciliationMismatchError(
        { taxInclusiveHalalas: 1150, taxHalalas: 150 },
        { expectedTaxInclusiveHalalas: 1160, expectedTaxHalalas: 151 },
      ),
    );

    expect(notification.createNotifications).toHaveBeenCalledWith({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: expect.objectContaining({
        title: "ZATCA document failed reconciliation",
        order_id: "order_123",
        action: "review_order_tax_totals",
      }),
    });
    expect(JSON.stringify(notification.createNotifications.mock.calls)).not.toMatch(
      /<Invoice|certificate|private|secret|csid/i,
    );
  });
});
