import { ZATCA_DOCUMENT_TYPE } from "./lifecycle";
import type { DerivedSimplifiedInvoiceTaxBase } from "./tax-base";
import type {
  ZatcaDocumentAllowanceCharge,
  ZatcaInvoiceLine,
} from "./xml-builder";

interface OriginalInvoiceForEdit {
  id: string;
  order_id: string;
  lines_snapshot: unknown;
}

type EditDocumentType =
  | typeof ZATCA_DOCUMENT_TYPE.CREDIT_NOTE
  | typeof ZATCA_DOCUMENT_TYPE.DEBIT_NOTE;

const ORDER_EDIT_REASON_BY_DOCUMENT_TYPE: Record<EditDocumentType, string> = {
  [ZATCA_DOCUMENT_TYPE.CREDIT_NOTE]: "Order edit decrease",
  [ZATCA_DOCUMENT_TYPE.DEBIT_NOTE]: "Order edit increase",
};

export interface OrderEditLifecycleTaxBase {
  documentType: EditDocumentType;
  reason: (typeof ORDER_EDIT_REASON_BY_DOCUMENT_TYPE)[EditDocumentType];
  lines: ZatcaInvoiceLine[];
  documentAllowances: ZatcaDocumentAllowanceCharge[];
  documentCharges: ZatcaDocumentAllowanceCharge[];
  expectedTaxInclusiveHalalas: number;
  expectedTaxHalalas: number;
}

interface SnapshotLike {
  lines: ZatcaInvoiceLine[];
  documentAllowances: ZatcaDocumentAllowanceCharge[];
  documentCharges: ZatcaDocumentAllowanceCharge[];
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
  return {
    id: Number.isSafeInteger(Number(r.id)) ? Number(r.id) : fallbackId,
    sourceItemId: optionalString(r.sourceItemId),
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

function snapshotFromOriginal(original: OriginalInvoiceForEdit): SnapshotLike {
  const raw = record(original.lines_snapshot);
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  if (rawLines.length === 0) {
    throw new Error("invoice lines_snapshot has no lines");
  }
  return {
    lines: rawLines.map((line, idx) => normalizeLine(line, idx + 1)),
    documentAllowances: Array.isArray(raw.documentAllowances)
      ? raw.documentAllowances.map(normalizeAllowanceCharge)
      : [],
    documentCharges: Array.isArray(raw.documentCharges)
      ? raw.documentCharges.map(normalizeAllowanceCharge)
      : [],
  };
}

function lineExtensionHalalas(line: ZatcaInvoiceLine): number {
  return (
    line.lineExtensionHalalas ?? Math.round(line.quantity * line.unitPriceHalalas)
  );
}

function taxableByVat(input: SnapshotLike): Map<string, { vatPercent: number; taxable: number }> {
  const byVat = new Map<string, { vatPercent: number; taxable: number }>();
  const add = (vatPercent: number, amount: number) => {
    const key = String(vatPercent);
    const current = byVat.get(key);
    byVat.set(key, {
      vatPercent,
      taxable: (current?.taxable ?? 0) + amount,
    });
  };

  input.lines.forEach((line) => add(line.vatPercent, lineExtensionHalalas(line)));
  input.documentAllowances.forEach((allowance) =>
    add(allowance.vatPercent, -allowance.amountHalalas),
  );
  input.documentCharges.forEach((charge) =>
    add(charge.vatPercent, charge.amountHalalas),
  );
  return byVat;
}

function vatOf(taxExclusiveHalalas: number, vatPercent: number): number {
  const bp = Math.round(vatPercent * 100);
  return Math.round((taxExclusiveHalalas * bp) / 10_000);
}

export function buildOrderEditLifecycleTaxBase(input: {
  originalInvoice: OriginalInvoiceForEdit;
  currentTaxBase: DerivedSimplifiedInvoiceTaxBase;
}): OrderEditLifecycleTaxBase | null {
  const originalByVat = taxableByVat(snapshotFromOriginal(input.originalInvoice));
  const currentByVat = taxableByVat(input.currentTaxBase);
  const vatKeys = new Set([...originalByVat.keys(), ...currentByVat.keys()]);

  const deltas = [...vatKeys]
    .map((key) => {
      const vatPercent =
        currentByVat.get(key)?.vatPercent ?? originalByVat.get(key)!.vatPercent;
      return {
        vatPercent,
        taxableDelta:
          (currentByVat.get(key)?.taxable ?? 0) -
          (originalByVat.get(key)?.taxable ?? 0),
      };
    })
    .filter((delta) => delta.taxableDelta !== 0);
  if (deltas.length === 0) return null;

  const totalTaxableDelta = deltas.reduce(
    (sum, delta) => sum + delta.taxableDelta,
    0,
  );
  const documentType: EditDocumentType =
    totalTaxableDelta < 0
      ? ZATCA_DOCUMENT_TYPE.CREDIT_NOTE
      : ZATCA_DOCUMENT_TYPE.DEBIT_NOTE;
  const sign = documentType === ZATCA_DOCUMENT_TYPE.CREDIT_NOTE ? -1 : 1;
  if (deltas.some((delta) => Math.sign(delta.taxableDelta) !== sign)) {
    throw new Error("mixed-direction order edit deltas require manual review");
  }

  let expectedTaxHalalas = 0;
  const lines = deltas.map((delta, idx) => {
    const amountHalalas = Math.abs(delta.taxableDelta);
    const taxHalalas = vatOf(amountHalalas, delta.vatPercent);
    expectedTaxHalalas += taxHalalas;
    const reason = ORDER_EDIT_REASON_BY_DOCUMENT_TYPE[documentType];
    return {
      id: idx + 1,
      name: `${reason} @ ${delta.vatPercent}% VAT`,
      quantity: 1,
      unitPriceHalalas: amountHalalas,
      lineExtensionHalalas: amountHalalas,
      vatPercent: delta.vatPercent,
    };
  });
  const expectedTaxExclusiveHalalas = lines.reduce(
    (sum, line) => sum + lineExtensionHalalas(line),
    0,
  );

  return {
    documentType,
    reason: ORDER_EDIT_REASON_BY_DOCUMENT_TYPE[documentType],
    lines,
    documentAllowances: [],
    documentCharges: [],
    expectedTaxInclusiveHalalas:
      expectedTaxExclusiveHalalas + expectedTaxHalalas,
    expectedTaxHalalas,
  };
}
