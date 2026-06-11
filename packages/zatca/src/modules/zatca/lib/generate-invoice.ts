import { randomUUID } from "node:crypto";

import {
  acquireChainLock,
  nextAllocation,
  readChainHead,
  type SqlExecutor,
} from "./hash-chain";
import { generateQr } from "./qr";
import { signInvoice } from "./signer";
import {
  buildSimplifiedInvoiceXml,
  formatHalalas,
  type SimplifiedInvoiceProps,
} from "./xml-builder";
import { assertSimplifiedInvoiceReconciles } from "./tax-base";

/**
 * Generate pipeline (ADR-0004): under the per-EGS chain lock,
 * allocate ICV/PIH → build UBL XML → hash → sign (XAdES) → stamp QR →
 * persist a **pending** ZatcaInvoice. ZATCA submission (Reporting) always
 * stays outside the lock — the deferred engine picks pending invoices up.
 */

/** Builder input minus the chain-allocated fields; UUID minted if absent. */
export interface GenerateInvoiceInput
  extends Omit<SimplifiedInvoiceProps, "icv" | "pih" | "uuid"> {
  /** Medusa order this invoice belongs to (Module Link target). */
  orderId: string;
  /** EGS identity keying the advisory lock (single EGS in v1). */
  egsKey: string;
  /** KSA-1 UUID; minted (v4) when not provided. */
  uuid?: string;
  /** Signing certificate — CSID-issued (base64 body or PEM). */
  certificate: string;
  /** secp256k1 private key (base64 SEC1 body or PEM). Never logged. */
  privateKey: string;
  /** Signing-time override for reproducible tests; defaults to now. */
  signingTime?: string;
  /** Expected Medusa order total; mismatch fails closed before signing/reporting. */
  expectedTaxInclusiveHalalas?: number;
  /** Expected Medusa order VAT total; mismatch fails closed before signing/reporting. */
  expectedTaxHalalas?: number;
}

/** Field-for-field shape of a pending `zatca_invoice` row. */
export interface PendingZatcaInvoiceRecord {
  order_id: string;
  document_type: "invoice" | "credit_note" | "debit_note";
  invoice_type: "simplified";
  source_type: "order" | "refund" | "return" | "order_cancel" | "order_edit";
  source_id: string;
  parent_invoice_id: string | null;
  billing_reference: string | null;
  reason: string | null;
  lines_snapshot: Record<string, unknown> | null;
  uuid: string;
  icv: number;
  pih: string;
  invoice_hash: string;
  /** Signed, QR-stamped UBL XML. */
  xml: string;
  /** TLV 9-tag QR, base64. */
  qr_code: string;
  status: "pending";
}

/**
 * Generate and persist one signed pending invoice at the next chain position.
 *
 * MUST run inside an open transaction: the advisory lock is
 * transaction-scoped, and `persist` must write through the same
 * transaction so the new chain head is visible before the lock releases.
 * ICV is consumed here — on later rejection the position is never reused.
 */
export async function generatePendingInvoice(
  ex: SqlExecutor,
  input: GenerateInvoiceInput,
  persist: (record: PendingZatcaInvoiceRecord) => Promise<void>,
): Promise<PendingZatcaInvoiceRecord> {
  const {
    orderId,
    egsKey,
    uuid: providedUuid,
    certificate,
    privateKey,
    signingTime,
    expectedTaxInclusiveHalalas,
    expectedTaxHalalas,
    ...invoiceProps
  } = input;

  await acquireChainLock(ex, egsKey);
  const { icv, pih } = nextAllocation(await readChainHead(ex));

  const uuid = providedUuid ?? randomUUID();
  const built = buildSimplifiedInvoiceXml({ ...invoiceProps, uuid, icv, pih });
  if (
    expectedTaxInclusiveHalalas !== undefined ||
    expectedTaxHalalas !== undefined
  ) {
    assertSimplifiedInvoiceReconciles(
      {
        taxInclusiveHalalas: built.taxInclusiveHalalas,
        taxHalalas: built.taxHalalas,
      },
      {
        expectedTaxInclusiveHalalas:
          expectedTaxInclusiveHalalas ?? built.taxInclusiveHalalas,
        expectedTaxHalalas: expectedTaxHalalas ?? built.taxHalalas,
      },
    );
  }

  const { signedXml, invoiceHash, digitalSignature } = signInvoice({
    xml: built.xml,
    certificate,
    privateKey,
    signingTime,
  });

  const qrCode = generateQr({
    sellerName: invoiceProps.supplier.name,
    vatNumber: invoiceProps.supplier.vatNumber,
    issueDateTime: `${invoiceProps.issueDate}T${invoiceProps.issueTime}`,
    taxInclusiveTotal: formatHalalas(built.taxInclusiveHalalas),
    vatTotal: formatHalalas(built.taxHalalas),
    invoiceHash,
    digitalSignature,
    certificate,
  });

  const record: PendingZatcaInvoiceRecord = {
    order_id: orderId,
    document_type: "invoice",
    invoice_type: "simplified",
    source_type: "order",
    source_id: orderId,
    parent_invoice_id: null,
    billing_reference: null,
    reason: null,
    lines_snapshot: null,
    uuid,
    icv,
    pih,
    invoice_hash: invoiceHash,
    xml: signedXml.replace("SET_QR_CODE_DATA", qrCode),
    qr_code: qrCode,
    status: "pending",
  };

  await persist(record);
  return record;
}
