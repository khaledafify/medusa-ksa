import { model } from "@medusajs/framework/utils";

/**
 * One ZATCA invoice per Medusa order, associated via a Module Link
 * (src/links/zatca-invoice-order.ts) — never a foreign key (ADR-0001).
 *
 * v1 is B2C only (ADR-0006): every invoice is `simplified` and goes through
 * Reporting. ICV/PIH form the legal hash chain (ADR-0004) — `icv` is unique
 * per EGS (single EGS in v1 → globally unique), and `order_id` is unique so a
 * re-fired trigger can never mint a second invoice for the same order.
 */
const ZatcaInvoice = model
  .define("zatca_invoice", {
    id: model.id({ prefix: "zatinv" }).primaryKey(),
    /** Linked Medusa order (Module Link, not a FK). */
    order_id: model.text(),
    /** v1 ships B2C only; `standard` (B2B) is future work. */
    invoice_type: model.enum(["simplified"]).default("simplified"),
    /** UUID v4 embedded in the UBL document. */
    uuid: model.text(),
    /** Invoice Counter Value — sequential per EGS, from 1. */
    icv: model.number(),
    /** Previous Invoice Hash — SHA-256 of the prior invoice's XML. */
    pih: model.text(),
    /** SHA-256 of this invoice's canonical XML. */
    invoice_hash: model.text(),
    /** Signed UBL 2.1 XML — stored in the DB as text in v1. */
    xml: model.text(),
    /** TLV 9-tag Base64 QR. Stamped during generation (S3). */
    qr_code: model.text().nullable(),
    status: model
      .enum(["pending", "reported", "rejected", "failed"])
      .default("pending"),
    /** Raw ZATCA Reporting response: status, warnings, errors. */
    zatca_response: model.json().nullable(),
    submitted_at: model.dateTime().nullable(),
    reported_at: model.dateTime().nullable(),
    /** Reporting attempts consumed by the retry engine (S6). */
    attempts: model.number().default(0),
  })
  .indexes([
    { on: ["order_id"], unique: true },
    { on: ["icv"], unique: true },
    { on: ["uuid"], unique: true },
    { on: ["status"] },
  ]);

export default ZatcaInvoice;
