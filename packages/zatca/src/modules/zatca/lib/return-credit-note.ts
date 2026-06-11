import type {
  ZatcaDocumentAllowanceCharge,
  ZatcaInvoiceLine,
} from "./xml-builder";

export interface ReturnItemForCredit {
  item_id: string;
  quantity?: number | string | null;
  received_quantity?: number | string | null;
}

interface SnapshotTotals {
  taxInclusiveHalalas: number;
  taxHalalas: number;
}

interface ReturnSnapshot {
  lines: ZatcaInvoiceLine[];
  documentAllowances: ZatcaDocumentAllowanceCharge[];
  documentCharges: ZatcaDocumentAllowanceCharge[];
  totals?: SnapshotTotals;
}

export interface OriginalInvoiceForReturn {
  id: string;
  order_id: string;
  xml: string;
  lines_snapshot: unknown;
}

export interface ExistingCreditNoteForReturn {
  id: string;
  lines_snapshot?: unknown;
}

export interface ReturnCreditNoteTaxBase {
  lines: ZatcaInvoiceLine[];
  documentAllowances: ZatcaDocumentAllowanceCharge[];
  documentCharges: ZatcaDocumentAllowanceCharge[];
  expectedTaxInclusiveHalalas: number;
  expectedTaxHalalas: number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("invoice lines_snapshot is missing or invalid");
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function numberField(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be numeric`);
  }
  return n;
}

function halalasField(value: unknown, label: string): number {
  const n = numberField(value, label);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer halalas`);
  }
  return n;
}

function normalizeLine(value: unknown, fallbackId: number): ZatcaInvoiceLine {
  const r = record(value);
  const sourceItemId = optionalString(r.sourceItemId);
  if (!sourceItemId) {
    throw new Error(`invoice line ${fallbackId} is missing sourceItemId`);
  }
  return {
    id: Number.isSafeInteger(Number(r.id)) ? Number(r.id) : fallbackId,
    sourceItemId,
    name: optionalString(r.name) ?? `Line ${fallbackId}`,
    quantity: numberField(r.quantity, "quantity"),
    unitPriceHalalas: halalasField(r.unitPriceHalalas, "unitPriceHalalas"),
    lineExtensionHalalas:
      r.lineExtensionHalalas === null || r.lineExtensionHalalas === undefined
        ? undefined
        : halalasField(r.lineExtensionHalalas, "lineExtensionHalalas"),
    vatPercent: numberField(r.vatPercent, "vatPercent"),
  };
}

function normalizeAllowanceCharge(
  value: unknown,
): ZatcaDocumentAllowanceCharge {
  const r = record(value);
  return {
    amountHalalas: halalasField(r.amountHalalas, "amountHalalas"),
    vatPercent: numberField(r.vatPercent, "vatPercent"),
    reason: optionalString(r.reason),
  };
}

function normalizeSnapshot(value: unknown): ReturnSnapshot {
  const r = record(value);
  const rawLines = Array.isArray(r.lines) ? r.lines : [];
  if (rawLines.length === 0) {
    throw new Error("invoice lines_snapshot has no lines");
  }
  const rawAllowances = Array.isArray(r.documentAllowances)
    ? r.documentAllowances
    : [];
  const rawCharges = Array.isArray(r.documentCharges) ? r.documentCharges : [];
  const totalsRecord =
    r.totals && typeof r.totals === "object"
      ? (r.totals as Record<string, unknown>)
      : null;

  return {
    lines: rawLines.map((line, idx) => normalizeLine(line, idx + 1)),
    documentAllowances: rawAllowances.map(normalizeAllowanceCharge),
    documentCharges: rawCharges.map(normalizeAllowanceCharge),
    totals: totalsRecord
      ? {
          taxInclusiveHalalas: halalasField(
            totalsRecord.taxInclusiveHalalas,
            "totals.taxInclusiveHalalas",
          ),
          taxHalalas: halalasField(totalsRecord.taxHalalas, "totals.taxHalalas"),
        }
      : undefined,
  };
}

function lineExtensionHalalas(line: ZatcaInvoiceLine): number {
  return (
    line.lineExtensionHalalas ?? Math.round(line.quantity * line.unitPriceHalalas)
  );
}

function vatOf(taxExclusiveHalalas: number, vatPercent: number): number {
  const bp = Math.round(vatPercent * 100);
  return Math.round((taxExclusiveHalalas * bp) / 10_000);
}

function totalsForLines(lines: ZatcaInvoiceLine[]): SnapshotTotals {
  const taxHalalas = lines.reduce(
    (sum, line) => sum + vatOf(lineExtensionHalalas(line), line.vatPercent),
    0,
  );
  const taxExclusiveHalalas = lines.reduce(
    (sum, line) => sum + lineExtensionHalalas(line),
    0,
  );
  return {
    taxInclusiveHalalas: taxExclusiveHalalas + taxHalalas,
    taxHalalas,
  };
}

function fullSnapshotTotals(snapshot: ReturnSnapshot): SnapshotTotals {
  if (snapshot.totals) return snapshot.totals;
  const lineTotals = totalsForLines(snapshot.lines);
  const chargeTaxable = snapshot.documentCharges.reduce(
    (sum, charge) => sum + charge.amountHalalas,
    0,
  );
  const chargeTax = snapshot.documentCharges.reduce(
    (sum, charge) => sum + vatOf(charge.amountHalalas, charge.vatPercent),
    0,
  );
  const allowanceTaxable = snapshot.documentAllowances.reduce(
    (sum, allowance) => sum + allowance.amountHalalas,
    0,
  );
  const allowanceTax = snapshot.documentAllowances.reduce(
    (sum, allowance) => sum + vatOf(allowance.amountHalalas, allowance.vatPercent),
    0,
  );
  return {
    taxInclusiveHalalas:
      lineTotals.taxInclusiveHalalas +
      chargeTaxable +
      chargeTax -
      allowanceTaxable -
      allowanceTax,
    taxHalalas: lineTotals.taxHalalas + chargeTax - allowanceTax,
  };
}

function returnedQuantity(item: ReturnItemForCredit): number {
  return numberField(item.received_quantity ?? item.quantity, "return quantity");
}

function returnedQuantitiesByItem(items: ReturnItemForCredit[]): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const item of items) {
    const quantity = returnedQuantity(item);
    if (quantity <= 0) continue;
    quantities.set(item.item_id, (quantities.get(item.item_id) ?? 0) + quantity);
  }
  return quantities;
}

function isFullReturn(
  snapshot: ReturnSnapshot,
  returnedByItem: Map<string, number>,
): boolean {
  return snapshot.lines.every(
    (line) => (returnedByItem.get(line.sourceItemId ?? "") ?? 0) >= line.quantity,
  );
}

function assertReturnedQuantitiesWithinInvoice(
  snapshot: ReturnSnapshot,
  returnedByItem: Map<string, number>,
): void {
  for (const line of snapshot.lines) {
    const quantity = returnedByItem.get(line.sourceItemId ?? "") ?? 0;
    if (quantity > line.quantity) {
      throw new Error(
        `returned quantity ${quantity} for ${line.sourceItemId} exceeds invoiced quantity ${line.quantity}`,
      );
    }
  }
}

function returnedLines(
  snapshot: ReturnSnapshot,
  returnedByItem: Map<string, number>,
): ZatcaInvoiceLine[] {
  const lines: ZatcaInvoiceLine[] = [];
  for (const originalLine of snapshot.lines) {
    const quantity = returnedByItem.get(originalLine.sourceItemId ?? "") ?? 0;
    if (quantity <= 0) continue;
    if (quantity > originalLine.quantity) {
      throw new Error(
        `returned quantity ${quantity} for ${originalLine.sourceItemId} exceeds invoiced quantity ${originalLine.quantity}`,
      );
    }
    const originalExtension = lineExtensionHalalas(originalLine);
    const lineExtension = Math.round(
      (originalExtension * quantity) / originalLine.quantity,
    );
    lines.push({
      id: lines.length + 1,
      name: `Return: ${originalLine.name}`,
      quantity,
      unitPriceHalalas: Math.round(originalExtension / originalLine.quantity),
      lineExtensionHalalas: lineExtension,
      vatPercent: originalLine.vatPercent,
    });
  }
  return lines;
}

function creditedTotal(note: ExistingCreditNoteForReturn): number {
  if (!note.lines_snapshot) return 0;
  const raw = record(note.lines_snapshot);
  const totals =
    raw.totals && typeof raw.totals === "object"
      ? (raw.totals as Record<string, unknown>)
      : null;
  return totals
    ? halalasField(totals.taxInclusiveHalalas, "totals.taxInclusiveHalalas")
    : 0;
}

export function buildReturnCreditNoteTaxBase(input: {
  originalInvoice: OriginalInvoiceForReturn;
  returnItems: ReturnItemForCredit[];
  existingCreditNotes: ExistingCreditNoteForReturn[];
}): ReturnCreditNoteTaxBase {
  const snapshot = normalizeSnapshot(input.originalInvoice.lines_snapshot);
  const returnedByItem = returnedQuantitiesByItem(input.returnItems);
  assertReturnedQuantitiesWithinInvoice(snapshot, returnedByItem);
  if (isFullReturn(snapshot, returnedByItem)) {
    const totals = fullSnapshotTotals(snapshot);
    return {
      lines: snapshot.lines,
      documentAllowances: snapshot.documentAllowances,
      documentCharges: snapshot.documentCharges,
      expectedTaxInclusiveHalalas: totals.taxInclusiveHalalas,
      expectedTaxHalalas: totals.taxHalalas,
    };
  }

  const lines = returnedLines(snapshot, returnedByItem);
  if (lines.length === 0) {
    throw new Error("return has no items matching the original invoice");
  }
  const totals = totalsForLines(lines);
  const originalTotals = fullSnapshotTotals(snapshot);
  const alreadyCredited = input.existingCreditNotes.reduce(
    (sum, note) => sum + creditedTotal(note),
    0,
  );
  if (alreadyCredited + totals.taxInclusiveHalalas > originalTotals.taxInclusiveHalalas) {
    throw new Error("return credit would exceed original invoice total");
  }

  return {
    lines,
    documentAllowances: [],
    documentCharges: [],
    expectedTaxInclusiveHalalas: totals.taxInclusiveHalalas,
    expectedTaxHalalas: totals.taxHalalas,
  };
}
