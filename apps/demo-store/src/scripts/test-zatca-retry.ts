import { randomUUID } from "node:crypto";

import type { ExecArgs } from "@medusajs/framework/types";
import type { ZatcaModuleService } from "medusa-plugin-zatca/modules/zatca";
import retryZatcaReporting from "medusa-plugin-zatca/jobs/retry-zatca-reporting";

/**
 * S6 gate: the retry engine picks up a pending invoice and reports it to the
 * live sandbox, and flips an invoice that outlived the 24h window to
 * `failed` — all through the scheduled-job entry point.
 *
 * Run: ../../node_modules/.bin/medusa exec ./src/scripts/test-zatca-retry.ts
 * (Requires a production-onboarded EGS — run test-zatca-invoice.ts first.)
 */
export default async function testZatcaRetry({ container }: ExecArgs) {
  const service: InstanceType<typeof ZatcaModuleService> =
    container.resolve("zatca");

  const status = await service.getOnboardingStatus();
  if (status.status !== "production") {
    throw new Error("run test-zatca-invoice.ts first (EGS not onboarded)");
  }

  const now = new Date();

  // 1. A pending invoice inside the window → the job reports it live.
  const pendingOrder = `order_retry_${randomUUID().slice(0, 8)}`;
  const pending = await service.generateInvoiceForOrder({
    orderId: pendingOrder,
    serialNumber: `INV-RETRY-${Date.now()}`,
    issueDate: now.toISOString().slice(0, 10),
    issueTime: now.toISOString().slice(11, 19),
    lines: [
      { id: 1, name: "Pencil", quantity: 1, unitPriceHalalas: 500, vatPercent: 15 },
    ],
  });
  if (pending.status !== "pending") {
    throw new Error(`expected pending after generation, got ${pending.status}`);
  }

  // 2. A pending invoice that outlived the 24h window → terminal failure.
  const expiredOrder = `order_expired_${randomUUID().slice(0, 8)}`;
  const expired = await service.generateInvoiceForOrder({
    orderId: expiredOrder,
    serialNumber: `INV-EXPIRED-${Date.now()}`,
    issueDate: now.toISOString().slice(0, 10),
    issueTime: now.toISOString().slice(11, 19),
    lines: [
      { id: 1, name: "Pencil", quantity: 1, unitPriceHalalas: 500, vatPercent: 15 },
    ],
  });
  await service.updateZatcaInvoices({
    id: expired.id,
    created_at: new Date(now.getTime() - 25 * 60 * 60 * 1000),
  } as never);

  // 3. Drive the engine through the scheduled-job entry point.
  await retryZatcaReporting(container);

  const reportedRow = await service.retrieveZatcaInvoice(pending.id);
  if (reportedRow.status !== "reported") {
    throw new Error(
      `retry engine left invoice ${pending.id} as ${reportedRow.status}: ${JSON.stringify(reportedRow.zatca_response)}`,
    );
  }
  if (reportedRow.attempts < 1 || !reportedRow.reported_at) {
    throw new Error("reported invoice missing retry bookkeeping");
  }

  const failedRow = await service.retrieveZatcaInvoice(expired.id);
  if (failedRow.status !== "failed") {
    throw new Error(
      `expected expired invoice to fail, got ${failedRow.status}`,
    );
  }

  // 4. A second job run is a no-op for both (no double reporting).
  await retryZatcaReporting(container);
  const again = await service.retrieveZatcaInvoice(pending.id);
  if (again.attempts !== reportedRow.attempts) {
    throw new Error("second job run re-reported an already-reported invoice");
  }

  console.log(
    `zatca retry test passed: reported=${pending.id} failed=${expired.id}`,
  );
}
