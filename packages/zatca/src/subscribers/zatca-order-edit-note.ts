import { createHash } from "node:crypto";

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ensureZatcaInvoiceOrderLink } from "../lib/zatca-order-link";
import { ZATCA_MODULE } from "../modules/zatca";
import {
  ZATCA_DOCUMENT_TYPE,
  ZATCA_INVOICE_STATUS,
  ZATCA_LIFECYCLE_SOURCE_TYPE,
} from "../modules/zatca/lib/lifecycle";
import { buildOrderEditLifecycleTaxBase } from "../modules/zatca/lib/order-edit-note";
import { extractInvoiceSerial } from "../modules/zatca/lib/refund-credit-note";
import {
  deriveSimplifiedInvoiceTaxBase,
  type OrderGraphForZatcaTaxBase,
} from "../modules/zatca/lib/tax-base";
import type ZatcaModuleService from "../modules/zatca/service";
import {
  reportInvoiceWorkflow,
  type ReportInvoiceWorkflowInput,
} from "../workflows/report-invoice";

interface OrderEditEventData {
  id?: string;
  edit_id?: string;
  order_id: string;
  actions?: unknown[];
}

interface OriginalInvoiceForOrderEdit {
  id: string;
  order_id: string;
  status?: string;
  xml: string;
  lines_snapshot: unknown;
}

interface OrderView extends OrderGraphForZatcaTaxBase {
  id: string;
  currency_code: string;
  status: string;
}

export interface OrderEditNoteDeps {
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
    status:
      | typeof ZATCA_INVOICE_STATUS.REPORTED
      | typeof ZATCA_INVOICE_STATUS.REJECTED
      | typeof ZATCA_INVOICE_STATUS.PENDING;
  }>;
  linkDocument(orderId: string, invoiceId: string): Promise<void>;
  logger: { info(message: string): void; warn(message: string): void };
  now(): Date;
}

const ORDER_TAX_BASE_FIELDS = [
  "id",
  "currency_code",
  "status",
  "total",
  "tax_total",
  "items.id",
  "items.title",
  "items.quantity",
  "items.detail.quantity",
  "items.unit_price",
  "items.is_tax_inclusive",
  "items.subtotal",
  "items.total",
  "items.tax_total",
  "items.discount_total",
  "items.discount_tax_total",
  "items.tax_lines.rate",
  "items.tax_lines.total",
  "items.tax_lines.subtotal",
  "shipping_methods.total",
  "shipping_methods.tax_total",
  "shipping_methods.tax_lines.rate",
] as const;

function sourceIdForEdit(eventData: OrderEditEventData): string {
  if (eventData.id) return eventData.id;
  if (eventData.edit_id) return eventData.edit_id;
  const digest = createHash("sha256")
    .update(JSON.stringify(eventData.actions ?? []))
    .digest("hex")
    .slice(0, 16);
  return `${eventData.order_id}:${digest}`;
}

function formatIssueParts(now: Date): { issueDate: string; issueTime: string } {
  const iso = now.toISOString();
  return {
    issueDate: iso.slice(0, 10),
    issueTime: iso.slice(11, 19),
  };
}

async function originalInvoiceForOrder(
  service: OrderEditNoteDeps["service"],
  orderId: string,
): Promise<OriginalInvoiceForOrderEdit | null> {
  const [original] = await service.listZatcaInvoices(
    { source_type: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER, source_id: orderId },
    { take: 1 },
  );
  return (original as OriginalInvoiceForOrderEdit | undefined) ?? null;
}

export async function issueOrderEditNote(
  eventData: OrderEditEventData,
  deps: OrderEditNoteDeps,
): Promise<void> {
  const sourceId = sourceIdForEdit(eventData);
  const [existing] = await deps.service.listZatcaInvoices(
    { source_type: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_EDIT, source_id: sourceId },
    { take: 1 },
  );
  if (existing) return;

  const originalInvoice = await originalInvoiceForOrder(
    deps.service,
    eventData.order_id,
  );
  if (originalInvoice?.status !== ZATCA_INVOICE_STATUS.REPORTED) {
    deps.logger.warn(
      `[zatca] order edit ${sourceId} has no reported original invoice — skipped`,
    );
    return;
  }

  const { data } = await deps.queryGraph({
    entity: "order",
    fields: [...ORDER_TAX_BASE_FIELDS],
    filters: { id: eventData.order_id },
  });
  const order = data[0] as OrderView | undefined;
  if (!order) {
    deps.logger.warn(`[zatca] order ${eventData.order_id} not found — skipped`);
    return;
  }
  if (order.currency_code !== "sar") {
    deps.logger.warn(`[zatca] order ${eventData.order_id} is not SAR — skipped`);
    return;
  }

  let lifecycleTaxBase: ReturnType<typeof buildOrderEditLifecycleTaxBase>;
  try {
    lifecycleTaxBase = buildOrderEditLifecycleTaxBase({
      originalInvoice,
      currentTaxBase: deriveSimplifiedInvoiceTaxBase(order),
    });
  } catch (error) {
    deps.logger.warn(`[zatca] invalid order edit ${sourceId}: ${String(error)}`);
    return;
  }
  if (!lifecycleTaxBase) return;

  const { issueDate, issueTime } = formatIssueParts(deps.now());
  const serialPrefix =
    lifecycleTaxBase.documentType === ZATCA_DOCUMENT_TYPE.DEBIT_NOTE
      ? "DN"
      : "CN";
  const input: ReportInvoiceWorkflowInput = {
    orderId: eventData.order_id,
    documentType: lifecycleTaxBase.documentType,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_EDIT,
    sourceId,
    parentInvoiceId: originalInvoice.id,
    billingReference: extractInvoiceSerial(originalInvoice.xml),
    reason: lifecycleTaxBase.reason,
    serialNumber: `${serialPrefix}-${sourceId}`,
    issueDate,
    issueTime,
    lines: lifecycleTaxBase.lines,
    documentAllowances: lifecycleTaxBase.documentAllowances,
    documentCharges: lifecycleTaxBase.documentCharges,
    expectedTaxInclusiveHalalas: lifecycleTaxBase.expectedTaxInclusiveHalalas,
    expectedTaxHalalas: lifecycleTaxBase.expectedTaxHalalas,
  };

  const result = await deps.runReportWorkflow(input);
  await deps.linkDocument(eventData.order_id, result.id);
  deps.logger.info(
    `[zatca] order edit ${sourceId} → ${lifecycleTaxBase.documentType} ${result.id} (${result.status})`,
  );
}

export default async function zatcaOrderEditNoteHandler({
  event,
  container,
}: SubscriberArgs<OrderEditEventData>): Promise<void> {
  const query = container.resolve<{
    graph: OrderEditNoteDeps["queryGraph"];
  }>(ContainerRegistrationKeys.QUERY);
  const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
  const logger = container.resolve<OrderEditNoteDeps["logger"]>(
    ContainerRegistrationKeys.LOGGER,
  );

  await issueOrderEditNote(event.data, {
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
  event: "order-edit.confirmed",
};
