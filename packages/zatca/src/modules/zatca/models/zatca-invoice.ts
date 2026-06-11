import { model } from "@medusajs/framework/utils";

import {
  ZATCA_DOCUMENT_TYPE,
  ZATCA_DOCUMENT_TYPES,
  ZATCA_INVOICE_TYPE,
  ZATCA_INVOICE_TYPES,
  ZATCA_INVOICE_STATUS,
  ZATCA_INVOICE_STATUSES,
  ZATCA_LIFECYCLE_SOURCE_TYPE,
  ZATCA_LIFECYCLE_SOURCE_TYPES,
  ZATCA_TABLE,
} from "../lib/lifecycle";

/**
 * ZATCA documents for a Medusa order, associated via a Module Link
 * (src/links/zatca-invoice-order.ts) — never a foreign key (ADR-0001).
 *
 * v1 is B2C only (ADR-0006): every invoice is `simplified` and goes through
 * Reporting. ICV/PIH form the legal hash chain (ADR-0004) — `icv` is unique
 * per EGS (single EGS in v1 → globally unique). Idempotency is keyed by the
 * lifecycle source so one order can have one invoice and multiple notes.
 */
const ZatcaInvoice = model
  .define(ZATCA_TABLE.INVOICE, {
    id: model.id({ prefix: "zatinv" }).primaryKey(),
    /** Linked Medusa order (Module Link, not a FK). */
    order_id: model.text(),
    /** v1 ships B2C only; `standard` (B2B) is future work. */
    invoice_type: model
      .enum([...ZATCA_INVOICE_TYPES])
      .default(ZATCA_INVOICE_TYPE.SIMPLIFIED),
    /** Document kind; all use the UBL Invoice root. */
    document_type: model
      .enum([...ZATCA_DOCUMENT_TYPES])
      .default(ZATCA_DOCUMENT_TYPE.INVOICE),
    /** Lifecycle source that triggered this document. */
    source_type: model
      .enum([...ZATCA_LIFECYCLE_SOURCE_TYPES])
      .default(ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER),
    /** Triggering entity id: order id, refund id, return id, or edit id. */
    source_id: model.text(),
    /** Original invoice row for credit/debit notes. */
    parent_invoice_id: model.text().nullable(),
    /** Bare original serial for BR-KSA-56; null for original invoices. */
    billing_reference: model.text().nullable(),
    /** KSA-10 reason/instruction note for credit/debit notes. */
    reason: model.text().nullable(),
    /** Auditable line snapshot used for later lifecycle apportionment. */
    lines_snapshot: model.json().nullable(),
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
      .enum([...ZATCA_INVOICE_STATUSES])
      .default(ZATCA_INVOICE_STATUS.PENDING),
    /** Raw ZATCA Reporting response: status, warnings, errors. */
    zatca_response: model.json().nullable(),
    submitted_at: model.dateTime().nullable(),
    reported_at: model.dateTime().nullable(),
    /** Reporting attempts consumed by the retry engine (S6). */
    attempts: model.number().default(0),
  })
  .indexes([
    { on: ["order_id"] },
    { on: ["source_type", "source_id"], unique: true },
    { on: ["icv"], unique: true },
    { on: ["uuid"], unique: true },
    { on: ["status"] },
    { on: ["parent_invoice_id"] },
    { on: ["status", "document_type"] },
  ]);

export default ZatcaInvoice;
