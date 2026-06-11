import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ensureZatcaInvoiceOrderLink } from "../lib/zatca-order-link";
import { ZATCA_MODULE } from "../modules/zatca";
import { extractInvoiceSerial } from "../modules/zatca/lib/refund-credit-note";
import {
  buildReturnCreditNoteTaxBase,
  type ExistingCreditNoteForReturn,
  type OriginalInvoiceForReturn,
  type ReturnItemForCredit,
} from "../modules/zatca/lib/return-credit-note";
import type ZatcaModuleService from "../modules/zatca/service";
import {
  reportInvoiceWorkflow,
  type ReportInvoiceWorkflowInput,
} from "../workflows/report-invoice";

interface ReturnView {
  id: string;
  order_id?: string | null;
  reason?: string | null;
  items?: ReturnItemForCredit[] | null;
}

export interface ReturnCreditNoteDeps {
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

function formatIssueParts(now: Date): { issueDate: string; issueTime: string } {
  const iso = now.toISOString();
  return {
    issueDate: iso.slice(0, 10),
    issueTime: iso.slice(11, 19),
  };
}

async function originalInvoiceForOrder(
  service: ReturnCreditNoteDeps["service"],
  orderId: string,
): Promise<OriginalInvoiceForReturn | null> {
  const [original] = await service.listZatcaInvoices(
    { source_type: "order", source_id: orderId },
    { take: 1 },
  );
  return (original as OriginalInvoiceForReturn | undefined) ?? null;
}

async function creditNotesForOrder(
  service: ReturnCreditNoteDeps["service"],
  orderId: string,
): Promise<ExistingCreditNoteForReturn[]> {
  const rows = await service.listZatcaInvoices({
    order_id: orderId,
    document_type: "credit_note",
  });
  return rows as ExistingCreditNoteForReturn[];
}

export async function issueReturnCreditNote(
  eventData: { order_id: string; return_id: string },
  deps: ReturnCreditNoteDeps,
): Promise<void> {
  const [existing] = await deps.service.listZatcaInvoices(
    { source_type: "return", source_id: eventData.return_id },
    { take: 1 },
  );
  if (existing) return;

  const originalInvoice = await originalInvoiceForOrder(
    deps.service,
    eventData.order_id,
  );
  if (!originalInvoice) {
    deps.logger.warn(
      `[zatca] return ${eventData.return_id} has no original invoice — skipped`,
    );
    return;
  }

  const { data } = await deps.queryGraph({
    entity: "return",
    fields: [
      "id",
      "order_id",
      "reason",
      "items.item_id",
      "items.quantity",
      "items.received_quantity",
    ],
    filters: { id: eventData.return_id },
  });
  const returnRow = data[0] as ReturnView | undefined;
  if (!returnRow) {
    deps.logger.warn(`[zatca] return ${eventData.return_id} not found — skipped`);
    return;
  }

  let input: ReportInvoiceWorkflowInput;
  try {
    const taxBase = buildReturnCreditNoteTaxBase({
      originalInvoice,
      returnItems: returnRow.items ?? [],
      existingCreditNotes: await creditNotesForOrder(deps.service, eventData.order_id),
    });
    const { issueDate, issueTime } = formatIssueParts(deps.now());
    input = {
      orderId: eventData.order_id,
      documentType: "credit_note",
      sourceType: "return",
      sourceId: eventData.return_id,
      parentInvoiceId: originalInvoice.id,
      billingReference: extractInvoiceSerial(originalInvoice.xml),
      reason: returnRow.reason ?? "Return received",
      serialNumber: `CN-${eventData.return_id}`,
      issueDate,
      issueTime,
      lines: taxBase.lines,
      documentAllowances: taxBase.documentAllowances,
      documentCharges: taxBase.documentCharges,
      expectedTaxInclusiveHalalas: taxBase.expectedTaxInclusiveHalalas,
      expectedTaxHalalas: taxBase.expectedTaxHalalas,
    };
  } catch (error) {
    deps.logger.warn(
      `[zatca] invalid return ${eventData.return_id}: ${String(error)}`,
    );
    return;
  }

  const result = await deps.runReportWorkflow(input);
  await deps.linkDocument(eventData.order_id, result.id);
  deps.logger.info(
    `[zatca] return ${eventData.return_id} → credit note ${result.id} (${result.status})`,
  );
}

export default async function zatcaReturnCreditNoteHandler({
  event,
  container,
}: SubscriberArgs<{ order_id: string; return_id: string }>): Promise<void> {
  const query = container.resolve<{
    graph: ReturnCreditNoteDeps["queryGraph"];
  }>(ContainerRegistrationKeys.QUERY);
  const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
  const logger = container.resolve<ReturnCreditNoteDeps["logger"]>(
    ContainerRegistrationKeys.LOGGER,
  );

  await issueReturnCreditNote(event.data, {
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
  event: "order.return_received",
};
