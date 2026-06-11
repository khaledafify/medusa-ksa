import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { sarToHalalas } from "@medusa-ksa/core";

import { ensureZatcaInvoiceOrderLink } from "../lib/zatca-order-link";
import { ZATCA_MODULE } from "../modules/zatca";
import {
  OverCreditError,
  buildRefundCreditNoteTaxBase,
  extractInvoiceSerial,
  type ExistingCreditNoteForRefund,
  type OriginalInvoiceForRefund,
} from "../modules/zatca/lib/refund-credit-note";
import type ZatcaModuleService from "../modules/zatca/service";
import {
  reportInvoiceWorkflow,
  type ReportInvoiceWorkflowInput,
} from "../workflows/report-invoice";

interface PaymentRefundView {
  id: string;
  refunds?: { id: string; amount: unknown; created_at?: string | Date }[] | null;
  payment_collection?: { order?: { id: string } | null } | null;
}

export interface RefundCreditNoteDeps {
  queryGraph(input: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
  }): Promise<{ data: unknown[] }>;
  service: {
    listZatcaInvoices(
      filter: Record<string, unknown>,
      config?: Record<string, unknown>,
    ): Promise<unknown[]>;
  };
  runReportWorkflow(input: ReportInvoiceWorkflowInput): Promise<{
    id: string;
    status: "reported" | "rejected" | "pending";
  }>;
  linkDocument(orderId: string, invoiceId: string): Promise<void>;
  logger: { info(message: string): void; warn(message: string): void };
  now(): Date;
}

function money(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && "value" in value) {
    return Number((value as { value?: unknown }).value);
  }
  return Number(value);
}

function formatIssueParts(now: Date): { issueDate: string; issueTime: string } {
  const iso = now.toISOString();
  return {
    issueDate: iso.slice(0, 10),
    issueTime: iso.slice(11, 19),
  };
}

async function originalInvoiceForOrder(
  service: RefundCreditNoteDeps["service"],
  orderId: string,
): Promise<OriginalInvoiceForRefund | null> {
  const [original] = await service.listZatcaInvoices(
    { source_type: "order", source_id: orderId },
    { take: 1 },
  );
  return (original as OriginalInvoiceForRefund | undefined) ?? null;
}

async function creditNotesForOrder(
  service: RefundCreditNoteDeps["service"],
  orderId: string,
): Promise<ExistingCreditNoteForRefund[]> {
  const rows = await service.listZatcaInvoices({
    order_id: orderId,
    document_type: "credit_note",
  });
  return rows as ExistingCreditNoteForRefund[];
}

export async function issueRefundCreditNotesForPayment(
  paymentId: string,
  deps: RefundCreditNoteDeps,
): Promise<void> {
  const { data } = await deps.queryGraph({
    entity: "payment",
    fields: [
      "id",
      "refunds.id",
      "refunds.amount",
      "refunds.created_at",
      "payment_collection.order.id",
    ],
    filters: { id: paymentId },
  });
  const payment = data[0] as PaymentRefundView | undefined;
  const orderId = payment?.payment_collection?.order?.id;
  if (!payment || !orderId) {
    deps.logger.warn(`[zatca] payment ${paymentId} has no linked order — skipped`);
    return;
  }

  const originalInvoice = await originalInvoiceForOrder(deps.service, orderId);
  if (!originalInvoice) {
    deps.logger.warn(
      `[zatca] payment ${paymentId} refund has no original invoice — skipped`,
    );
    return;
  }

  for (const refund of payment.refunds ?? []) {
    const [existing] = await deps.service.listZatcaInvoices(
      { source_type: "refund", source_id: refund.id },
      { take: 1 },
    );
    if (existing) continue;

    let input: ReportInvoiceWorkflowInput;
    try {
      const taxBase = buildRefundCreditNoteTaxBase({
        originalInvoice,
        refundAmountHalalas: sarToHalalas(money(refund.amount)),
        existingCreditNotes: await creditNotesForOrder(deps.service, orderId),
      });
      const { issueDate, issueTime } = formatIssueParts(deps.now());
      input = {
        orderId,
        documentType: "credit_note",
        sourceType: "refund",
        sourceId: refund.id,
        parentInvoiceId: originalInvoice.id,
        billingReference: extractInvoiceSerial(originalInvoice.xml),
        reason: "Refund",
        serialNumber: `CN-${refund.id}`,
        issueDate,
        issueTime,
        lines: taxBase.lines,
        documentAllowances: taxBase.documentAllowances,
        documentCharges: taxBase.documentCharges,
        expectedTaxInclusiveHalalas: taxBase.expectedTaxInclusiveHalalas,
        expectedTaxHalalas: taxBase.expectedTaxHalalas,
      };
    } catch (error) {
      const prefix =
        error instanceof OverCreditError ? "over-credit guard blocked" : "invalid refund";
      deps.logger.warn(`[zatca] ${prefix} for refund ${refund.id}: ${String(error)}`);
      continue;
    }

    const result = await deps.runReportWorkflow(input);
    await deps.linkDocument(orderId, result.id);
    deps.logger.info(
      `[zatca] refund ${refund.id} → credit note ${result.id} (${result.status})`,
    );
  }
}

export default async function zatcaRefundCreditNoteHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const query = container.resolve<{
    graph: RefundCreditNoteDeps["queryGraph"];
  }>(ContainerRegistrationKeys.QUERY);
  const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
  const logger = container.resolve<RefundCreditNoteDeps["logger"]>(
    ContainerRegistrationKeys.LOGGER,
  );

  await issueRefundCreditNotesForPayment(event.data.id, {
    queryGraph: query.graph.bind(query),
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
  event: "payment.refunded",
};
