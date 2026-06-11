import { randomUUID } from "node:crypto";

import {
  acquireChainLock,
  nextAllocation,
  readChainHead,
  type SqlExecutor,
} from "./hash-chain";
import { computeInvoiceHash } from "./invoice-hash";
import {
  buildSimplifiedInvoiceXml,
  type SimplifiedInvoiceProps,
} from "./xml-builder";

/**
 * S2 generate path (ADR-0004): under the per-EGS chain lock,
 * allocate ICV/PIH → build UBL XML → hash → persist a **pending**
 * ZatcaInvoice. Signing + QR slot in between hash and persist in S3;
 * ZATCA submission always stays outside the lock.
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
}

/** Field-for-field shape of a pending `zatca_invoice` row. */
export interface PendingZatcaInvoiceRecord {
  order_id: string;
  invoice_type: "simplified";
  uuid: string;
  icv: number;
  pih: string;
  invoice_hash: string;
  /** Unsigned UBL XML in S2 — replaced by the signed document in S3. */
  xml: string;
  qr_code: null;
  status: "pending";
}

/**
 * Generate and persist one pending invoice at the next chain position.
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
  const { orderId, egsKey, uuid: providedUuid, ...invoiceProps } = input;

  await acquireChainLock(ex, egsKey);
  const { icv, pih } = nextAllocation(await readChainHead(ex));

  const uuid = providedUuid ?? randomUUID();
  const { xml } = buildSimplifiedInvoiceXml({ ...invoiceProps, uuid, icv, pih });

  const record: PendingZatcaInvoiceRecord = {
    order_id: orderId,
    invoice_type: "simplified",
    uuid,
    icv,
    pih,
    invoice_hash: computeInvoiceHash(xml),
    xml,
    qr_code: null,
    status: "pending",
  };

  await persist(record);
  return record;
}
