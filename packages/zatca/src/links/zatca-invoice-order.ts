import { defineLink } from "@medusajs/framework/utils";
import OrderModule from "@medusajs/medusa/order";

import ZatcaModule from "../modules/zatca";

/**
 * ZatcaInvoice ↔ Order association (ADR-0001): a Module Link, never a foreign
 * key. Synced with `medusa db:migrate`; read across modules via
 * `query.graph()` (e.g. `entity: "zatca_invoice", fields: ["order.*"]`).
 *
 * One invoice per order (the invoice side also carries a unique `order_id`).
 */
export default defineLink(
  ZatcaModule.linkable.zatcaInvoice,
  OrderModule.linkable.order,
);
