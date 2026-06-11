import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { ZATCA_MODULE } from "../modules/zatca";
import {
  ZATCA_ERROR_CODE,
  ZATCA_INVOICE_STATUS,
  type ZatcaInvoiceStatus,
} from "../modules/zatca/lib/lifecycle";
import type ZatcaModuleService from "../modules/zatca/service";
import type { GenerateLifecycleDocumentInput } from "../modules/zatca/service";
import {
  notifyZatcaGenerationFailure,
  notifyZatcaRemediation,
} from "../lib/zatca-remediation-notification";
import { ReconciliationMismatchError } from "../modules/zatca/lib/tax-base";

/**
 * `report-invoice` workflow (S5, SPEC §4): generate + persist the signed,
 * QR-stamped Simplified invoice (inside the chain lock), then report it to
 * ZATCA (outside the lock). Reporting failure never rolls the invoice back —
 * the ICV is consumed and the retry engine (S6) finishes the job. The order
 * is never affected.
 */

export type ReportInvoiceWorkflowInput = GenerateLifecycleDocumentInput;

export interface ReportInvoiceWorkflowResult {
  id: string;
  status: ZatcaInvoiceStatus;
}

interface GenerateLifecycleDocumentStepResult {
  invoiceId: string;
  status: typeof ZATCA_INVOICE_STATUS.PENDING | typeof ZATCA_INVOICE_STATUS.FAILED;
}

interface ReportInvoiceStepInput {
  invoiceId: string;
  status: typeof ZATCA_INVOICE_STATUS.PENDING | typeof ZATCA_INVOICE_STATUS.FAILED;
}

const generateLifecycleDocumentStep = createStep<
  ReportInvoiceWorkflowInput,
  GenerateLifecycleDocumentStepResult,
  GenerateLifecycleDocumentStepResult
>(
  "zatca-generate-lifecycle-document",
  async (input: ReportInvoiceWorkflowInput, { container }) => {
    const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
    let invoice: Awaited<ReturnType<ZatcaModuleService["generateLifecycleDocument"]>>;
    try {
      invoice = await service.generateLifecycleDocument(input);
    } catch (error) {
      if (error instanceof ReconciliationMismatchError) {
        await notifyZatcaGenerationFailure(container, input, error);
      }
      throw error;
    }
    if (
      invoice.status === ZATCA_INVOICE_STATUS.FAILED &&
      invoice.zatca_response?.error === ZATCA_ERROR_CODE.RECONCILIATION_MISMATCH
    ) {
      const built = invoice.zatca_response.built as ConstructorParameters<
        typeof ReconciliationMismatchError
      >[0];
      const expected = invoice.zatca_response.expected as ConstructorParameters<
        typeof ReconciliationMismatchError
      >[1];
      await notifyZatcaGenerationFailure(
        container,
        input,
        new ReconciliationMismatchError(built, expected),
      );
    }
    return new StepResponse({ invoiceId: invoice.id, status: invoice.status });
  },
);

const reportInvoiceStep = createStep<
  ReportInvoiceStepInput,
  ReportInvoiceWorkflowResult,
  ReportInvoiceWorkflowResult
>(
  "zatca-report-invoice",
  async (input, { container }) => {
    if (input.status !== ZATCA_INVOICE_STATUS.PENDING) {
      return new StepResponse({ id: input.invoiceId, status: input.status });
    }
    const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
    try {
      const result = await service.reportZatcaInvoice(input.invoiceId);
      if (result.status === ZATCA_INVOICE_STATUS.REJECTED) {
        await notifyZatcaRemediation(container, input.invoiceId);
      }
      return new StepResponse(result);
    } catch {
      // Transient failure: the invoice stays pending; S6 retries within the
      // 24h window. The workflow itself succeeds — the order must never feel
      // a ZATCA outage.
      return new StepResponse({
        id: input.invoiceId,
        status: ZATCA_INVOICE_STATUS.PENDING,
      });
    }
  },
);

export const reportInvoiceWorkflow = createWorkflow(
  "zatca-report-invoice",
  function (input: ReportInvoiceWorkflowInput) {
    const generated = generateLifecycleDocumentStep(input);
    const reported = reportInvoiceStep({
      invoiceId: generated.invoiceId,
      status: generated.status,
    });
    return new WorkflowResponse(reported);
  },
);

export default reportInvoiceWorkflow;
