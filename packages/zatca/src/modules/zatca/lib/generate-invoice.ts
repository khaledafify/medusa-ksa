import { randomUUID } from "node:crypto";

import {
  acquireChainLock,
  nextAllocation,
  readChainHead,
  type SqlExecutor,
} from "./hash-chain";
import { computeInvoiceHash } from "./invoice-hash";
import { generateQr } from "./qr";
import { signInvoice } from "./signer";
import {
  ZATCA_DOCUMENT_TYPE,
  ZATCA_LIFECYCLE_SOURCE_TYPE,
  ZATCA_INVOICE_STATUS,
  type ZatcaDocumentType,
  type ZatcaLifecycleSourceType,
} from "./lifecycle";
import {
  buildSimplifiedInvoiceXml,
  formatHalalas,
  type SimplifiedInvoiceProps,
} from "./xml-builder";
import {
  assertSimplifiedInvoiceReconciles,
  ReconciliationMismatchError,
} from "./tax-base";

/**
 * Generate pipeline (ADR-0004): under the per-EGS chain lock,
 * allocate ICV/PIH → build UBL XML → reconcile → hash → sign (XAdES) →
 * stamp QR → persist a ZatcaInvoice. Reconciliation mismatches persist as
 * `failed` and are never signed or reported. ZATCA submission (Reporting)
 * always stays outside the lock — the deferred engine picks pending invoices up.
 */

export type { ZatcaDocumentType, ZatcaLifecycleSourceType };

const INVOICE_TYPE_CODE_BY_DOCUMENT_TYPE: Record<ZatcaDocumentType, string> = {
  [ZATCA_DOCUMENT_TYPE.INVOICE]: "388",
  [ZATCA_DOCUMENT_TYPE.CREDIT_NOTE]: "381",
  [ZATCA_DOCUMENT_TYPE.DEBIT_NOTE]: "383",
};

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
  /** Legal document kind. Defaults to a Simplified tax invoice (388). */
  documentType?: ZatcaDocumentType;
  /** Lifecycle source used as the idempotency key. Defaults to `order`. */
  sourceType?: ZatcaLifecycleSourceType;
  /** Triggering entity id; defaults to `orderId` for original invoices. */
  sourceId?: string;
  /** Original invoice row id for credit/debit notes. */
  parentInvoiceId?: string | null;
  /** KSA-10 reason; mapped to cbc:InstructionNote for notes. */
  reason?: string | null;
  /** Exact line basis persisted for later lifecycle apportionment. */
  linesSnapshot?: Record<string, unknown> | null;
}

/** Field-for-field shape of a pending `zatca_invoice` row. */
export interface PendingZatcaInvoiceRecord {
  order_id: string;
  document_type: ZatcaDocumentType;
  invoice_type: "simplified";
  source_type: ZatcaLifecycleSourceType;
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
  /** TLV 9-tag QR, base64. Null for local failed reconciliation rows. */
  qr_code: string | null;
  status:
    | typeof ZATCA_INVOICE_STATUS.PENDING
    | typeof ZATCA_INVOICE_STATUS.FAILED;
  zatca_response?: Record<string, unknown>;
}

function defaultLinesSnapshot(
  input: {
    lines: GenerateInvoiceInput["lines"];
    documentAllowances?: GenerateInvoiceInput["documentAllowances"];
    documentCharges?: GenerateInvoiceInput["documentCharges"];
    totals: { taxInclusiveHalalas: number; taxHalalas: number };
  },
): Record<string, unknown> {
  return {
    lines: input.lines.map((line) => ({
      id: line.id,
      sourceItemId: line.sourceItemId ?? null,
      name: line.name,
      quantity: line.quantity,
      unitPriceHalalas: line.unitPriceHalalas,
      lineExtensionHalalas: line.lineExtensionHalalas ?? null,
      vatPercent: line.vatPercent,
    })),
    documentAllowances: input.documentAllowances ?? [],
    documentCharges: input.documentCharges ?? [],
    totals: input.totals,
  };
}

function assertLifecycleFields(
  documentType: ZatcaDocumentType,
  input: {
    invoiceTypeCode?: string;
    parentInvoiceId: string | null;
    billingReference?: string;
    reason: string | null;
    instructionNote?: string;
  },
): void {
  const expectedCode = INVOICE_TYPE_CODE_BY_DOCUMENT_TYPE[documentType];
  if (input.invoiceTypeCode && input.invoiceTypeCode !== expectedCode) {
    throw new Error(
      `documentType ${documentType} must use InvoiceTypeCode ${expectedCode}, got ${input.invoiceTypeCode}`,
    );
  }

  if (documentType === ZATCA_DOCUMENT_TYPE.INVOICE) {
    return;
  }

  if (!input.parentInvoiceId) {
    throw new Error(`${documentType} requires parentInvoiceId`);
  }
  if (!input.billingReference) {
    throw new Error(`${documentType} requires billingReference`);
  }
  if (!input.reason && !input.instructionNote) {
    throw new Error(`${documentType} requires reason`);
  }
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
    documentType = ZATCA_DOCUMENT_TYPE.INVOICE,
    sourceType = ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER,
    sourceId,
    parentInvoiceId,
    reason,
    linesSnapshot,
    ...invoiceProps
  } = input;
  const resolvedSourceId = sourceId ?? orderId;
  const resolvedParentInvoiceId = parentInvoiceId ?? null;
  const resolvedReason = reason ?? null;
  assertLifecycleFields(documentType, {
    invoiceTypeCode: invoiceProps.invoiceTypeCode,
    parentInvoiceId: resolvedParentInvoiceId,
    billingReference: invoiceProps.billingReference,
    reason: resolvedReason,
    instructionNote: invoiceProps.instructionNote,
  });

  await acquireChainLock(ex, egsKey);
  const { icv, pih } = nextAllocation(await readChainHead(ex));

  const uuid = providedUuid ?? randomUUID();
  const built = buildSimplifiedInvoiceXml({
    ...invoiceProps,
    invoiceTypeCode: INVOICE_TYPE_CODE_BY_DOCUMENT_TYPE[documentType],
    instructionNote: invoiceProps.instructionNote ?? resolvedReason ?? undefined,
    uuid,
    icv,
    pih,
  });

  const baseRecord = {
    order_id: orderId,
    document_type: documentType,
    invoice_type: "simplified" as const,
    source_type: sourceType,
    source_id: resolvedSourceId,
    parent_invoice_id: resolvedParentInvoiceId,
    billing_reference: invoiceProps.billingReference ?? null,
    reason: resolvedReason,
    lines_snapshot:
      linesSnapshot ??
      defaultLinesSnapshot({
        lines: invoiceProps.lines,
        documentAllowances: invoiceProps.documentAllowances,
        documentCharges: invoiceProps.documentCharges,
        totals: {
          taxInclusiveHalalas: built.taxInclusiveHalalas,
          taxHalalas: built.taxHalalas,
        },
      }),
    uuid,
    icv,
    pih,
  };

  if (
    expectedTaxInclusiveHalalas !== undefined ||
    expectedTaxHalalas !== undefined
  ) {
    try {
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
    } catch (error) {
      if (!(error instanceof ReconciliationMismatchError)) {
        throw error;
      }
      const failedRecord: PendingZatcaInvoiceRecord = {
        ...baseRecord,
        invoice_hash: computeInvoiceHash(built.xml),
        xml: built.xml,
        qr_code: null,
        status: ZATCA_INVOICE_STATUS.FAILED,
        zatca_response: {
          error: error.code,
          built: error.built,
          expected: error.expected,
        },
      };
      await persist(failedRecord);
      return failedRecord;
    }
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
    ...baseRecord,
    invoice_hash: invoiceHash,
    xml: signedXml.replace("SET_QR_CODE_DATA", qrCode),
    qr_code: qrCode,
    status: ZATCA_INVOICE_STATUS.PENDING,
  };

  await persist(record);
  return record;
}
