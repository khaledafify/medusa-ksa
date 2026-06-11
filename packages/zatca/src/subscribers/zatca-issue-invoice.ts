import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { ZATCA_MODULE } from "../modules/zatca";
import {
  ZATCA_CURRENCY,
  ZATCA_MEDUSA_EVENT,
  ZATCA_ORIGINAL_INVOICE_ORDER_FIELDS,
  ZATCA_PAYMENT_ORDER_FIELDS,
  ZATCA_QUERY_ENTITY,
} from "../modules/zatca/lib/lifecycle";
import {
  deriveSimplifiedInvoiceTaxBase,
  type OrderGraphForZatcaTaxBase,
} from "../modules/zatca/lib/tax-base";
import type ZatcaModuleService from "../modules/zatca/service";
import { reportInvoiceWorkflow } from "../workflows/report-invoice";
import { ensureZatcaInvoiceOrderLink } from "../lib/zatca-order-link";

/**
 * Invoice issuance subscriber (S5, PRD §1.3): listens to both supported
 * triggers and acts only on the configured one (`payment_captured` default,
 * `order_placed` for COD/auth-only stores). Idempotent — the unique
 * `(source_type, source_id)` plus the service's existence check mean a
 * re-fired event never mints a second invoice.
 *
 * Reporting failures never propagate: the invoice stays pending for the
 * retry engine. The order is never affected.
 */

/** The slice of the order graph this subscriber reads. */
interface OrderView extends OrderGraphForZatcaTaxBase {
  display_id: number;
  currency_code: string;
  status: string;
}

export default async function zatcaIssueInvoiceHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const trigger = service.getTrigger();
  const expectedEvent =
    trigger === "payment_captured"
      ? ZATCA_MEDUSA_EVENT.PAYMENT_CAPTURED
      : ZATCA_MEDUSA_EVENT.ORDER_PLACED;
  if (event.name !== expectedEvent) return;

  // Resolve the order id for the configured trigger.
  let orderId: string;
  if (event.name === ZATCA_MEDUSA_EVENT.PAYMENT_CAPTURED) {
    const { data } = await query.graph({
      entity: ZATCA_QUERY_ENTITY.PAYMENT,
      fields: [...ZATCA_PAYMENT_ORDER_FIELDS],
      filters: { id: event.data.id },
    });
    const payment = data[0] as
      | { payment_collection?: { order?: { id: string } | null } | null }
      | undefined;
    const linkedOrderId = payment?.payment_collection?.order?.id;
    if (!linkedOrderId) {
      logger.warn(`[zatca] payment ${event.data.id} has no linked order — skipped`);
      return;
    }
    orderId = linkedOrderId;
  } else {
    orderId = event.data.id;
  }

  const { data: orders } = await query.graph({
    entity: ZATCA_QUERY_ENTITY.ORDER,
    fields: [...ZATCA_ORIGINAL_INVOICE_ORDER_FIELDS],
    filters: { id: orderId },
  });
  const order = orders[0] as OrderView | undefined;
  if (!order) {
    logger.warn(`[zatca] order ${orderId} not found — skipped`);
    return;
  }
  if (order.currency_code !== ZATCA_CURRENCY.SAR_LOWERCASE) {
    logger.warn(`[zatca] order ${orderId} is not SAR — skipped`);
    return;
  }
  if (order.status === "canceled") {
    logger.warn(`[zatca] order ${orderId} is canceled — skipped`);
    return;
  }
  if (Number(order.total) <= 0) {
    logger.warn(`[zatca] order ${orderId} has a zero total — skipped`);
    return;
  }

  const taxBase = deriveSimplifiedInvoiceTaxBase(order);
  if (taxBase.lines.length === 0) {
    logger.warn(`[zatca] order ${orderId} has no items — skipped`);
    return;
  }

  const now = new Date();
  const { result } = await reportInvoiceWorkflow(container).run({
    input: {
      orderId,
      serialNumber: `INV-${order.display_id}`,
      issueDate: now.toISOString().slice(0, 10),
      issueTime: now.toISOString().slice(11, 19),
      lines: taxBase.lines,
      documentAllowances: taxBase.documentAllowances,
      documentCharges: taxBase.documentCharges,
      expectedTaxInclusiveHalalas: taxBase.expectedTaxInclusiveHalalas,
      expectedTaxHalalas: taxBase.expectedTaxHalalas,
    },
  });

  await ensureZatcaInvoiceOrderLink(container, orderId, result.id);

  logger.info(`[zatca] order ${orderId} → invoice ${result.id} (${result.status})`);
}

export const config: SubscriberConfig = {
  event: [ZATCA_MEDUSA_EVENT.PAYMENT_CAPTURED, ZATCA_MEDUSA_EVENT.ORDER_PLACED],
};
