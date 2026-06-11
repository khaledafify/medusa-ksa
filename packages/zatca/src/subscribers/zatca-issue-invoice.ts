import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { sarToHalalas } from "@medusa-ksa/core";

import { ZATCA_MODULE } from "../modules/zatca";
import type ZatcaModuleService from "../modules/zatca/service";
import { reportInvoiceWorkflow } from "../workflows/report-invoice";

/**
 * Invoice issuance subscriber (S5, PRD §1.3): listens to both supported
 * triggers and acts only on the configured one (`payment_captured` default,
 * `order_placed` for COD/auth-only stores). Idempotent — the unique
 * `order_id` plus the service's existence check mean a re-fired event never
 * mints a second invoice.
 *
 * Reporting failures never propagate: the invoice stays pending for the
 * retry engine. The order is never affected.
 */

interface OrderLine {
  id: number;
  name: string;
  quantity: number;
  unitPriceHalalas: number;
  vatPercent: number;
}

/** The slice of the order graph this subscriber reads. */
interface OrderView {
  id: string;
  display_id: number;
  currency_code: string;
  items?: ({
    title: string;
    quantity: number;
    unit_price: number;
    tax_lines?: { rate: number }[] | null;
  } | null)[];
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
    trigger === "payment_captured" ? "payment.captured" : "order.placed";
  if (event.name !== expectedEvent) return;

  // Resolve the order id for the configured trigger.
  let orderId: string;
  if (event.name === "payment.captured") {
    const { data } = await query.graph({
      entity: "payment",
      fields: ["id", "payment_collection.order.id"],
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
    entity: "order",
    fields: [
      "id",
      "display_id",
      "currency_code",
      "items.id",
      "items.title",
      "items.quantity",
      // quantity is computed from the detail; without this it stays undefined
      "items.detail.quantity",
      "items.unit_price",
      "items.tax_lines.rate",
    ],
    filters: { id: orderId },
  });
  const order = orders[0] as OrderView | undefined;
  if (!order) {
    logger.warn(`[zatca] order ${orderId} not found — skipped`);
    return;
  }
  if (order.currency_code !== "sar") {
    logger.warn(`[zatca] order ${orderId} is not SAR — skipped`);
    return;
  }

  const items = order.items ?? [];
  const lines: OrderLine[] = items.flatMap((item, idx) =>
    item
      ? [
          {
            id: idx + 1,
            name: item.title,
            quantity: Number(item.quantity),
            unitPriceHalalas: sarToHalalas(Number(item.unit_price)),
            vatPercent: Number(item.tax_lines?.[0]?.rate ?? 15),
          },
        ]
      : [],
  );
  if (lines.length === 0) {
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
      lines,
    },
  });

  // Link the invoice to its order (Module Link, ADR-0001) — once. The link
  // module rejects duplicate pairs, so a re-fired event must skip it.
  const { data: linked } = await query.graph({
    entity: "order",
    fields: ["id", "zatca_invoice.id"],
    filters: { id: orderId },
  });
  const existingLink = linked[0] as
    | { zatca_invoice?: { id: string } | null }
    | undefined;
  if (!existingLink?.zatca_invoice?.id) {
    const link = container.resolve(ContainerRegistrationKeys.LINK);
    await link.create({
      [ZATCA_MODULE]: { zatca_invoice_id: result.id },
      [Modules.ORDER]: { order_id: orderId },
    });
  }

  logger.info(`[zatca] order ${orderId} → invoice ${result.id} (${result.status})`);
}

export const config: SubscriberConfig = {
  event: ["payment.captured", "order.placed"],
};
