import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ensureZatcaInvoiceOrderLink } from "../lib/zatca-order-link";
import { ZATCA_MODULE } from "../modules/zatca";
import {
  ZATCA_DOCUMENT_TYPE,
  ZATCA_INVOICE_STATUS,
  ZATCA_LIFECYCLE_SOURCE_TYPE,
  ZATCA_MEDUSA_EVENT,
  ZATCA_NOTE_REASON,
} from "../modules/zatca/lib/lifecycle";
import {
  buildRefundCreditNoteTaxBase,
  extractInvoiceSerial,
  originalInvoiceTotals,
  type ExistingCreditNoteForRefund,
  type OriginalInvoiceForRefund,
} from "../modules/zatca/lib/refund-credit-note";
import type ZatcaModuleService from "../modules/zatca/service";
import {
  reportInvoiceWorkflow,
  type ReportInvoiceWorkflowInput,
  type ReportInvoiceWorkflowResult,
} from "../workflows/report-invoice";

interface OriginalInvoiceForCancellation extends OriginalInvoiceForRefund {
  status?: string;
}

export interface CancellationCreditNoteDeps {
  service: {
    listZatcaInvoices(
      filter: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown[]>;
  };
  runReportWorkflow(input: ReportInvoiceWorkflowInput): Promise<ReportInvoiceWorkflowResult>;
  linkDocument(orderId: string, invoiceId: string): Promise<void>;
  logger: { info(message: string): void; warn(message: string): void };
  now(): Date;
}

function formatIssueParts(now: Date): { issueDate: string; issueTime: string } {
  const iso = now.toISOString();
  return {
    issueDate: iso.slice(0, 10),
    issueTime: iso.slice(11, 19),
  };
}

async function originalInvoiceForOrder(
  service: CancellationCreditNoteDeps["service"],
  orderId: string,
): Promise<OriginalInvoiceForCancellation | null> {
  const [original] = await service.listZatcaInvoices(
    { source_type: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER, source_id: orderId },
    { take: 1 },
  );
  return (original as OriginalInvoiceForCancellation | undefined) ?? null;
}

async function creditNotesForOrder(
  service: CancellationCreditNoteDeps["service"],
  orderId: string,
): Promise<ExistingCreditNoteForRefund[]> {
  const rows = await service.listZatcaInvoices({
    order_id: orderId,
    document_type: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
  });
  return rows as ExistingCreditNoteForRefund[];
}

export async function issueCancellationCreditNote(
  orderId: string,
  deps: CancellationCreditNoteDeps,
): Promise<void> {
  const [existing] = await deps.service.listZatcaInvoices(
    { source_type: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_CANCEL, source_id: orderId },
    { take: 1 },
  );
  if (existing) return;

  const originalInvoice = await originalInvoiceForOrder(deps.service, orderId);
  if (!originalInvoice) {
    deps.logger.warn(`[zatca] canceled order ${orderId} has no invoice — skipped`);
    return;
  }
  if (originalInvoice.status !== ZATCA_INVOICE_STATUS.REPORTED) {
    deps.logger.warn(
      `[zatca] canceled order ${orderId} invoice is ${originalInvoice.status ?? "unknown"} — skipped`,
    );
    return;
  }

  let input: ReportInvoiceWorkflowInput;
  try {
    const totals = originalInvoiceTotals(originalInvoice);
    const taxBase = buildRefundCreditNoteTaxBase({
      originalInvoice,
      refundAmountHalalas: totals.taxInclusiveHalalas,
      existingCreditNotes: await creditNotesForOrder(deps.service, orderId),
    });
    const { issueDate, issueTime } = formatIssueParts(deps.now());
    input = {
      orderId,
      documentType: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
      sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_CANCEL,
      sourceId: orderId,
      parentInvoiceId: originalInvoice.id,
      billingReference: extractInvoiceSerial(originalInvoice.xml),
      reason: ZATCA_NOTE_REASON.ORDER_CANCELLED,
      serialNumber: `CN-CANCEL-${orderId}`,
      issueDate,
      issueTime,
      lines: taxBase.lines,
      documentAllowances: taxBase.documentAllowances,
      documentCharges: taxBase.documentCharges,
      expectedTaxInclusiveHalalas: taxBase.expectedTaxInclusiveHalalas,
      expectedTaxHalalas: taxBase.expectedTaxHalalas,
    };
  } catch (error) {
    deps.logger.warn(`[zatca] invalid cancellation ${orderId}: ${String(error)}`);
    return;
  }

  const result = await deps.runReportWorkflow(input);
  await deps.linkDocument(orderId, result.id);
  deps.logger.info(
    `[zatca] canceled order ${orderId} → credit note ${result.id} (${result.status})`,
  );
}

export default async function zatcaCancelCreditNoteHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
  const logger = container.resolve<CancellationCreditNoteDeps["logger"]>(
    ContainerRegistrationKeys.LOGGER,
  );

  await issueCancellationCreditNote(event.data.id, {
    service,
    logger,
    now: () => new Date(),
    runReportWorkflow: async (input) => {
      const { result } = await reportInvoiceWorkflow(container).run({ input });
      return result;
    },
    linkDocument: (orderId, invoiceId) =>
      ensureZatcaInvoiceOrderLink(container, orderId, invoiceId),
  });
}

export const config: SubscriberConfig = {
  event: ZATCA_MEDUSA_EVENT.ORDER_CANCELED,
};
