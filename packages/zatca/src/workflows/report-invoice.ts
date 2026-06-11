import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { ZATCA_MODULE } from "../modules/zatca";
import type ZatcaModuleService from "../modules/zatca/service";
import type { GenerateLifecycleDocumentInput } from "../modules/zatca/service";

/**
 * `report-invoice` workflow (S5, SPEC §4): generate + persist the signed,
 * QR-stamped Simplified invoice (inside the chain lock), then report it to
 * ZATCA (outside the lock). Reporting failure never rolls the invoice back —
 * the ICV is consumed and the retry engine (S6) finishes the job. The order
 * is never affected.
 */

export type ReportInvoiceWorkflowInput = GenerateLifecycleDocumentInput;

const generateLifecycleDocumentStep = createStep(
  "zatca-generate-lifecycle-document",
  async (input: ReportInvoiceWorkflowInput, { container }) => {
    const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
    const invoice = await service.generateLifecycleDocument(input);
    return new StepResponse({ invoiceId: invoice.id, status: invoice.status });
  },
);

const reportInvoiceStep = createStep(
  "zatca-report-invoice",
  async (input: { invoiceId: string }, { container }) => {
    const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
    try {
      const result = await service.reportZatcaInvoice(input.invoiceId);
      return new StepResponse(result);
    } catch {
      // Transient failure: the invoice stays pending; S6 retries within the
      // 24h window. The workflow itself succeeds — the order must never feel
      // a ZATCA outage.
      return new StepResponse({ id: input.invoiceId, status: "pending" as const });
    }
  },
);

export const reportInvoiceWorkflow = createWorkflow(
  "zatca-report-invoice",
  function (input: ReportInvoiceWorkflowInput) {
    const generated = generateLifecycleDocumentStep(input);
    const reported = reportInvoiceStep({ invoiceId: generated.invoiceId });
    return new WorkflowResponse(reported);
  },
);

export default reportInvoiceWorkflow;
