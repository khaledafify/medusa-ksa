import type { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import type { ZatcaModuleService } from "medusa-plugin-zatca/modules/zatca";

/**
 * T1.4 gate: the ZatcaInvoice ↔ Order Module Link is synced and queryable.
 * Creates an order + a ZatcaInvoice, links them, reads the order back through
 * query.graph() from the invoice side, then cleans up.
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

  const invoice = await zatcaService.createZatcaInvoices({
    order_id: order.id,
    uuid: `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0")}`,
    icv: Math.floor(Date.now() / 1000),
    pih: "test-pih",
    invoice_hash: "test-hash",
    xml: "<Invoice/>",
  });

  try {
    // Order must match defineLink: zatcaInvoice first, then order.
    await link.create({
      zatca: { zatca_invoice_id: invoice.id },
      [Modules.ORDER]: { order_id: order.id },
    });

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
  } finally {
    await link.dismiss({
      zatca: { zatca_invoice_id: invoice.id },
      [Modules.ORDER]: { order_id: order.id },
    });
    await zatcaService.deleteZatcaInvoices(invoice.id);
    await orderService.deleteOrders(order.id);
  }

  console.log("zatca link test passed");
}
