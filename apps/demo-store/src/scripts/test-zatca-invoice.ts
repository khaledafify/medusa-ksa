import { randomUUID } from "node:crypto";

import type { ExecArgs } from "@medusajs/framework/types";
import type { ZatcaModuleService } from "medusa-plugin-zatca/modules/zatca";
import { onboardEgsWorkflow } from "medusa-plugin-zatca/workflows";
import { reportInvoiceWorkflow } from "medusa-plugin-zatca/workflows";

/**
 * S5 gate: the report-invoice workflow generates, signs, QR-stamps, persists,
 * and reports a Simplified invoice to the live sandbox — and is idempotent.
 *
 * Asserts:
 *  - invoice reaches `reported` against the sandbox Reporting API
 *  - the persisted row carries QR + signed XML + chain fields
 *  - a second run for the same order returns the same invoice (no double ICV)
 *  - the workflow result carries no secret
 *
 * Run: ../../node_modules/.bin/medusa exec ./src/scripts/test-zatca-invoice.ts
 */
export default async function testZatcaInvoice({ container }: ExecArgs) {
  const service: InstanceType<typeof ZatcaModuleService> =
    container.resolve("zatca");

  const supplier = {
    crn: "1010010000",
    street: "الامير سلطان | Prince Sultan",
    building: "2322",
    citySubdivision: "المربع | Al-Murabba",
    city: "الرياض | Riyadh",
    postalZone: "23333",
    vatNumber: "399999999900003",
    name: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
  };

  // Ensure a production-onboarded EGS exists (idempotent: reuse if present).
  const status = await service.getOnboardingStatus();
  if (status.status !== "production") {
    await onboardEgsWorkflow(container).run({
      input: {
        otp: "123456",
        commonName: "TST-886431145-399999999900003",
        solutionName: "medusa-ksa",
        model: "1.0",
        serialNumber: `egs-${Date.now()}`,
        vatNumber: supplier.vatNumber,
        organizationName: "Maximum Speed Tech Supply LTD",
        branchName: "Riyadh Branch",
        address: "RRRD2929",
        industry: "Supply activities",
        crn: supplier.crn,
        supplier,
      },
    });
  } else {
    // Backfill the supplier party for rows onboarded before the column existed.
    const [credential] = await service.listZatcaCredentials({}, { take: 1 });
    if (credential && !credential.supplier) {
      await service.updateZatcaCredentials({ id: credential.id, supplier });
    }
  }

  const orderId = `order_e2e_${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const input = {
    orderId,
    serialNumber: `INV-E2E-${Date.now()}`,
    issueDate: now.toISOString().slice(0, 10),
    issueTime: now.toISOString().slice(11, 19),
    lines: [
      { id: 1, name: "قلم رصاص | Pencil", quantity: 2, unitPriceHalalas: 300, vatPercent: 15 },
      { id: 2, name: "دفتر | Notebook", quantity: 1, unitPriceHalalas: 1250, vatPercent: 15 },
    ],
  };

  // 1. First run: generated + reported live.
  const { result } = await reportInvoiceWorkflow(container).run({ input });
  if (result.status !== "reported") {
    throw new Error(`expected reported, got ${JSON.stringify(result)}`);
  }
  const resultJson = JSON.stringify(result);
  for (const marker of ["PRIVATE KEY", "secret", "csid"]) {
    if (resultJson.toLowerCase().includes(marker.toLowerCase())) {
      throw new Error(`workflow result leaks "${marker}": ${resultJson}`);
    }
  }

  // 2. At rest: signed XML + QR + chain fields, response recorded.
  const row = await service.retrieveZatcaInvoice(result.id);
  if (row.order_id !== orderId) throw new Error("invoice not linked to order");
  if (row.status !== "reported") throw new Error(`row status ${row.status}`);
  if (!row.qr_code || Buffer.from(row.qr_code, "base64").length < 50) {
    throw new Error("QR missing or implausibly small");
  }
  if (!row.xml.includes("<ds:SignatureValue>")) {
    throw new Error("persisted XML is not signed");
  }
  if (!row.xml.includes(row.qr_code)) {
    throw new Error("persisted XML is missing the stamped QR");
  }
  if (!Number.isInteger(row.icv) || row.icv < 1 || !row.pih || !row.invoice_hash) {
    throw new Error("chain fields missing on persisted invoice");
  }
  if (!row.reported_at || !row.submitted_at || row.attempts < 1) {
    throw new Error("reporting bookkeeping missing");
  }

  // 3. Idempotency: same order → same invoice, no new ICV.
  const second = await reportInvoiceWorkflow(container).run({ input });
  if (second.result.id !== result.id) {
    throw new Error(
      `second run minted a new invoice: ${second.result.id} != ${result.id}`,
    );
  }

  console.log(
    `zatca invoice test passed: ${row.id} icv=${row.icv} status=${row.status}`,
  );
}
