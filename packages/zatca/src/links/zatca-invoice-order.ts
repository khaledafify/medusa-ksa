import { defineLink } from "@medusajs/framework/utils";
import OrderModule from "@medusajs/medusa/order";

import ZatcaModule from "../modules/zatca";

/**
 * ZatcaInvoice ↔ Order association (ADR-0001): a Module Link, never a foreign
 * key. Synced with `medusa db:migrate`; read across modules via
 * `query.graph()` (e.g. `entity: "zatca_invoice", fields: ["order.*"]`).
 *
 * One order can own one invoice plus lifecycle credit/debit notes; idempotency
 * is enforced on `ZatcaInvoice.source_type + source_id`, not `order_id`.
 */
export default defineLink(
  ZatcaModule.linkable.zatcaInvoice,
  OrderModule.linkable.order,
);
