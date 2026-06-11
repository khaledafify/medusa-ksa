import { DOMParser, type Node } from "@xmldom/xmldom";
import { sarToHalalas } from "@medusa-ksa/core";

import type {
  ZatcaDocumentAllowanceCharge,
  ZatcaInvoiceLine,
} from "./xml-builder";

interface SnapshotTotals {
  taxInclusiveHalalas: number;
  taxHalalas: number;
}

export interface InvoiceLinesSnapshot {
  lines: ZatcaInvoiceLine[];
  documentAllowances: ZatcaDocumentAllowanceCharge[];
  documentCharges: ZatcaDocumentAllowanceCharge[];
  totals?: SnapshotTotals;
}

export interface OriginalInvoiceForRefund {
  id: string;
  order_id: string;
  xml: string;
  lines_snapshot: unknown;
}

export interface ExistingCreditNoteForRefund {
  id: string;
  xml?: string | null;
  lines_snapshot?: unknown;
}

export interface RefundCreditNoteTaxBase {
  lines: ZatcaInvoiceLine[];
  documentAllowances: ZatcaDocumentAllowanceCharge[];
  documentCharges: ZatcaDocumentAllowanceCharge[];
  expectedTaxInclusiveHalalas: number;
  expectedTaxHalalas: number;
}

export class OverCreditError extends Error {
  readonly code = "zatca_over_credit";

  constructor(
    readonly originalTaxInclusiveHalalas: number,
    readonly alreadyCreditedHalalas: number,
    readonly candidateHalalas: number,
  ) {
    super(
      `zatca_over_credit: existing credits ${alreadyCreditedHalalas} plus candidate ${candidateHalalas} exceed original ${originalTaxInclusiveHalalas}`,
    );
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("invoice lines_snapshot is missing or invalid");
  }
  return value as Record<string, unknown>;
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

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function normalizeLine(value: unknown, fallbackId: number): ZatcaInvoiceLine {
  const r = record(value);
  const lineExtension =
    r.lineExtensionHalalas === null || r.lineExtensionHalalas === undefined
      ? undefined
      : halalasField(r.lineExtensionHalalas, "lineExtensionHalalas");
  return {
    id: Number.isSafeInteger(Number(r.id)) ? Number(r.id) : fallbackId,
    name: optionalString(r.name) ?? `Line ${fallbackId}`,
    quantity: numberField(r.quantity, "quantity"),
    unitPriceHalalas: halalasField(r.unitPriceHalalas, "unitPriceHalalas"),
    lineExtensionHalalas: lineExtension,
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

function normalizeSnapshot(value: unknown): InvoiceLinesSnapshot {
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

function vatOf(taxExclusiveHalalas: number, vatPercent: number): number {
  const bp = Math.round(vatPercent * 100);
  return Math.round((taxExclusiveHalalas * bp) / 10_000);
}

function splitInclusive(
  taxInclusiveHalalas: number,
  vatPercent: number,
): { netHalalas: number; taxHalalas: number } {
  const bp = Math.round(vatPercent * 100);
  const taxHalalas = Math.round(
    (taxInclusiveHalalas * bp) / (10_000 + bp),
  );
  return {
    netHalalas: taxInclusiveHalalas - taxHalalas,
    taxHalalas,
  };
}

function lineExtensionHalalas(line: ZatcaInvoiceLine): number {
  return (
    line.lineExtensionHalalas ?? Math.round(line.quantity * line.unitPriceHalalas)
  );
}

function categoryTaxables(snapshot: InvoiceLinesSnapshot): {
  vatPercent: number;
  taxableHalalas: number;
  taxInclusiveHalalas: number;
}[] {
  const byRate = new Map<string, { vatPercent: number; taxableHalalas: number }>();
  const add = (vatPercent: number, amountHalalas: number) => {
    const key = String(vatPercent);
    const existing = byRate.get(key);
    byRate.set(key, {
      vatPercent,
      taxableHalalas: (existing?.taxableHalalas ?? 0) + amountHalalas,
    });
  };

  snapshot.lines.forEach((line) => add(line.vatPercent, lineExtensionHalalas(line)));
  snapshot.documentAllowances.forEach((allowance) =>
    add(allowance.vatPercent, -allowance.amountHalalas),
  );
  snapshot.documentCharges.forEach((charge) =>
    add(charge.vatPercent, charge.amountHalalas),
  );

  return [...byRate.values()]
    .filter((category) => category.taxableHalalas > 0)
    .map((category) => ({
      ...category,
      taxInclusiveHalalas:
        category.taxableHalalas +
        vatOf(category.taxableHalalas, category.vatPercent),
    }));
}

function computeTotals(snapshot: InvoiceLinesSnapshot): SnapshotTotals {
  const categories = categoryTaxables(snapshot);
  const taxHalalas = categories.reduce(
    (sum, category) => sum + vatOf(category.taxableHalalas, category.vatPercent),
    0,
  );
  const taxExclusiveHalalas = categories.reduce(
    (sum, category) => sum + category.taxableHalalas,
    0,
  );
  return {
    taxInclusiveHalalas: taxExclusiveHalalas + taxHalalas,
    taxHalalas,
  };
}

function snapshotTotals(snapshot: InvoiceLinesSnapshot): SnapshotTotals {
  return snapshot.totals ?? computeTotals(snapshot);
}

function parseXml(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (!doc.documentElement || doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("invalid invoice XML");
  }
  return doc;
}

function localName(node: Node): string {
  return node.nodeName.split(":").pop() ?? node.nodeName;
}

export function extractInvoiceSerial(xml: string): string {
  const root = parseXml(xml).documentElement;
  if (!root) {
    throw new Error("original invoice XML has no root element");
  }
  for (let node: Node | null = root.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && localName(node) === "ID") {
      const serial = node.textContent?.trim();
      if (serial) return serial;
    }
  }
  throw new Error("original invoice XML has no cbc:ID serial");
}

function parsePayableAmountHalalas(xml: string): number {
  const doc = parseXml(xml);
  const [payable] = Array.from(doc.getElementsByTagName("cbc:PayableAmount"));
  const text = payable?.textContent?.trim();
  if (!text) {
    throw new Error("credit-note XML has no cbc:PayableAmount");
  }
  return sarToHalalas(Number(text));
}

function creditedHalalas(note: ExistingCreditNoteForRefund): number {
  if (note.lines_snapshot) {
    const raw = record(note.lines_snapshot);
    const rawTotals =
      raw.totals && typeof raw.totals === "object"
        ? (raw.totals as Record<string, unknown>)
        : null;
    if (rawTotals) {
      return halalasField(
        rawTotals.taxInclusiveHalalas,
        "totals.taxInclusiveHalalas",
      );
    }
    const snapshot = normalizeSnapshot(note.lines_snapshot);
    return snapshotTotals(snapshot).taxInclusiveHalalas;
  }
  if (note.xml) {
    return parsePayableAmountHalalas(note.xml);
  }
  throw new Error(`credit note ${note.id} has no auditable total`);
}

function allocateProportionally(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  return weights.map((weight, idx) => {
    if (idx === weights.length - 1) {
      return total - allocated;
    }
    const share = Math.round((total * weight) / weightSum);
    allocated += share;
    return share;
  });
}

function partialRefundLines(
  snapshot: InvoiceLinesSnapshot,
  refundAmountHalalas: number,
): { lines: ZatcaInvoiceLine[]; taxHalalas: number } {
  const categories = categoryTaxables(snapshot);
  if (categories.length === 0) {
    throw new Error("original invoice has no taxable categories to refund");
  }

  const allocations =
    categories.length === 1
      ? [refundAmountHalalas]
      : allocateProportionally(
          refundAmountHalalas,
          categories.map((category) => category.taxInclusiveHalalas),
        );

  let taxHalalas = 0;
  const lines = categories.map((category, idx) => {
    const split = splitInclusive(allocations[idx]!, category.vatPercent);
    taxHalalas += split.taxHalalas;
    return {
      id: idx + 1,
      name: `Refund @ ${category.vatPercent}% VAT`,
      quantity: 1,
      unitPriceHalalas: split.netHalalas,
      lineExtensionHalalas: split.netHalalas,
      vatPercent: category.vatPercent,
    };
  });

  return { lines, taxHalalas };
}

export function buildRefundCreditNoteTaxBase(input: {
  originalInvoice: OriginalInvoiceForRefund;
  refundAmountHalalas: number;
  existingCreditNotes: ExistingCreditNoteForRefund[];
}): RefundCreditNoteTaxBase {
  if (
    !Number.isSafeInteger(input.refundAmountHalalas) ||
    input.refundAmountHalalas <= 0
  ) {
    throw new Error("refund amount must be a positive integer halalas");
  }

  const snapshot = normalizeSnapshot(input.originalInvoice.lines_snapshot);
  const originalTotals = snapshotTotals(snapshot);
  const alreadyCreditedHalalas = input.existingCreditNotes.reduce(
    (sum, note) => sum + creditedHalalas(note),
    0,
  );
  if (
    alreadyCreditedHalalas + input.refundAmountHalalas >
    originalTotals.taxInclusiveHalalas
  ) {
    throw new OverCreditError(
      originalTotals.taxInclusiveHalalas,
      alreadyCreditedHalalas,
      input.refundAmountHalalas,
    );
  }

  if (
    alreadyCreditedHalalas === 0 &&
    input.refundAmountHalalas === originalTotals.taxInclusiveHalalas
  ) {
    return {
      lines: snapshot.lines,
      documentAllowances: snapshot.documentAllowances,
      documentCharges: snapshot.documentCharges,
      expectedTaxInclusiveHalalas: originalTotals.taxInclusiveHalalas,
      expectedTaxHalalas: originalTotals.taxHalalas,
    };
  }

  const partial = partialRefundLines(snapshot, input.refundAmountHalalas);
  return {
    lines: partial.lines,
    documentAllowances: [],
    documentCharges: [],
    expectedTaxInclusiveHalalas: input.refundAmountHalalas,
    expectedTaxHalalas: partial.taxHalalas,
  };
}
