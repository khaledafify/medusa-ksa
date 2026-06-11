import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { ZatcaModuleService } from "medusa-plugin-zatca/modules/zatca";
import zatcaIssueInvoiceHandler from "medusa-plugin-zatca/subscribers/zatca-issue-invoice";

/**
 * T5.2 gate: the issuance subscriber takes a real Medusa order from event to
 * reported invoice — order lookup via query.graph, SAR/line mapping, the
 * report-invoice workflow, and the order↔invoice Module Link.
 *
 * Run with the order_placed trigger so no payment fixture plumbing is needed
 * (the handler's trigger gate itself is also asserted):
 *
 *   ZATCA_TRIGGER=order_placed ../../node_modules/.bin/medusa exec ./src/scripts/test-zatca-subscriber.ts
 */
export default async function testZatcaSubscriber({ container }: ExecArgs) {
  const service: InstanceType<typeof ZatcaModuleService> =
    container.resolve("zatca");
  if (service.getTrigger() !== "order_placed") {
    throw new Error("run with ZATCA_TRIGGER=order_placed");
  }

  const orderModule = container.resolve(Modules.ORDER);
  const order = await orderModule.createOrders({
    currency_code: "sar",
    email: "e2e@example.com",
    items: [
      { title: "قلم رصاص | Pencil", quantity: 2, unit_price: 3 },
      { title: "دفتر | Notebook", quantity: 1, unit_price: 12.5 },
    ],
  });

  // The wrong-trigger event must be ignored (no invoice minted).
  await zatcaIssueInvoiceHandler({
    event: { name: "payment.captured", data: { id: "pay_ignored" } },
    container,
  } as Parameters<typeof zatcaIssueInvoiceHandler>[0]);
  const [premature] = await service.listZatcaInvoices(
    { order_id: order.id },
    { take: 1 },
  );
  if (premature) throw new Error("wrong-trigger event minted an invoice");

  // The configured trigger drives the full pipeline.
  await zatcaIssueInvoiceHandler({
    event: { name: "order.placed", data: { id: order.id } },
    container,
  } as Parameters<typeof zatcaIssueInvoiceHandler>[0]);

  const [invoice] = await service.listZatcaInvoices(
    { order_id: order.id },
    { take: 1 },
  );
  if (!invoice) throw new Error("subscriber did not mint an invoice");
  if (invoice.status !== "reported") {
    throw new Error(`expected reported, got ${invoice.status}`);
  }

  // Idempotency: a re-fired event never mints a second invoice.
  await zatcaIssueInvoiceHandler({
    event: { name: "order.placed", data: { id: order.id } },
    container,
  } as Parameters<typeof zatcaIssueInvoiceHandler>[0]);
  const all = await service.listZatcaInvoices({ order_id: order.id });
  if (all.length !== 1) {
    throw new Error(`re-fired event minted ${all.length} invoices`);
  }

  // The Module Link resolves order → invoice through query.graph.
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "zatca_invoice.id", "zatca_invoice.status"],
    filters: { id: order.id },
  });
  const linked = data[0]?.zatca_invoice;
  if (!linked || linked.id !== invoice.id) {
    throw new Error("order → zatca_invoice link not traversable");
  }

  console.log(
    `zatca subscriber test passed: order=${order.id} invoice=${invoice.id} icv=${invoice.icv}`,
  );
}
