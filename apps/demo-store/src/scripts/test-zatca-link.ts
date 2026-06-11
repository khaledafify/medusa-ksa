import type { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import {
  ZATCA_DOCUMENT_TYPE,
  ZATCA_INVOICE_STATUS,
  ZATCA_LIFECYCLE_SOURCE_TYPE,
  type ZatcaModuleService,
} from "medusa-plugin-zatca/modules/zatca";

/**
 * T1.4 gate: the ZatcaInvoice ↔ Order Module Link is synced and queryable.
 * Creates an order + multiple ZatcaInvoice rows, links them, reads the order
 * back through query.graph() from both sides, then cleans up.
 *
 * Run: ../../node_modules/.bin/medusa exec ./src/scripts/test-zatca-link.ts
 */
export default async function testZatcaLink({ container }: ExecArgs) {
  const orderService = container.resolve(Modules.ORDER);
  const zatcaService: InstanceType<typeof ZatcaModuleService> =
    container.resolve("zatca");
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const order = await orderService.createOrders({
    currency_code: "sar",
    email: "link-test@example.com",
    items: [
      {
        title: "Link test item",
        quantity: 1,
        unit_price: 100,
      },
    ],
  });

  const suffix = Date.now().toString(16).slice(-12).padStart(12, "0");
  const invoice = await zatcaService.createZatcaInvoices({
    order_id: order.id,
    document_type: ZATCA_DOCUMENT_TYPE.INVOICE,
    source_type: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER,
    source_id: order.id,
    lines_snapshot: { lines: [] },
    uuid: `00000000-0000-4000-8000-${suffix}`,
    icv: Math.floor(Date.now() / 1000),
    pih: "test-pih",
    invoice_hash: "test-hash",
    xml: "<Invoice/>",
    status: ZATCA_INVOICE_STATUS.PENDING,
  });
  const creditNote1 = await zatcaService.createZatcaInvoices({
    order_id: order.id,
    document_type: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    source_type: ZATCA_LIFECYCLE_SOURCE_TYPE.REFUND,
    source_id: `refund_${suffix}`,
    parent_invoice_id: invoice.id,
    billing_reference: `INV-${order.id}`,
    reason: "Refund",
    lines_snapshot: { lines: [] },
    uuid: `11111111-1111-4111-8111-${suffix}`,
    icv: invoice.icv + 1,
    pih: "test-hash",
    invoice_hash: "test-credit-hash-1",
    xml: "<Invoice/>",
    status: ZATCA_INVOICE_STATUS.PENDING,
  });
  const creditNote2 = await zatcaService.createZatcaInvoices({
    order_id: order.id,
    document_type: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    source_type: ZATCA_LIFECYCLE_SOURCE_TYPE.RETURN,
    source_id: `return_${suffix}`,
    parent_invoice_id: invoice.id,
    billing_reference: `INV-${order.id}`,
    reason: "Return received",
    lines_snapshot: { lines: [] },
    uuid: `22222222-2222-4222-8222-${suffix}`,
    icv: invoice.icv + 2,
    pih: "test-credit-hash-1",
    invoice_hash: "test-credit-hash-2",
    xml: "<Invoice/>",
    status: ZATCA_INVOICE_STATUS.PENDING,
  });
  const documents = [invoice, creditNote1, creditNote2];

  try {
    // Order must match defineLink: zatcaInvoice first, then order.
    for (const document of documents) {
      await link.create({
        zatca: { zatca_invoice_id: document.id },
        [Modules.ORDER]: { order_id: order.id },
      });
    }

    const { data } = await query.graph({
      entity: "zatca_invoice",
      fields: ["id", "icv", "order.id", "order.email"],
      filters: { id: invoice.id },
    });

    const row = data[0];
    if (!row) {
      throw new Error("zatca_invoice not found via query.graph()");
    }
    if (!row.order || row.order.id !== order.id) {
      throw new Error(
        `linked order not readable via query.graph(): got ${JSON.stringify(row.order)}`,
      );
    }

    console.log(
      `link verified: zatca_invoice ${row.id} -> order ${row.order.id}`,
    );

    const { data: orderRows } = await query.graph({
      entity: "order",
      fields: ["id", "zatca_invoices.id", "zatca_invoices.document_type"],
      filters: { id: order.id },
    });
    const linkedDocuments = orderRows[0]?.zatca_invoices;
    const linkedList = Array.isArray(linkedDocuments)
      ? linkedDocuments
      : linkedDocuments
        ? [linkedDocuments]
        : [];
    const linkedIds = new Set(linkedList.map((doc) => doc.id));
    for (const document of documents) {
      if (!linkedIds.has(document.id)) {
        throw new Error(`order is missing linked document ${document.id}`);
      }
    }
    if (linkedList.length !== documents.length) {
      throw new Error(
        `expected ${documents.length} linked ZATCA documents, got ${linkedList.length}`,
      );
    }
  } finally {
    for (const document of documents) {
      await link.dismiss({
        zatca: { zatca_invoice_id: document.id },
        [Modules.ORDER]: { order_id: order.id },
      });
      await zatcaService.deleteZatcaInvoices(document.id);
    }
    await orderService.deleteOrders(order.id);
  }

  console.log("zatca link test passed");
}
