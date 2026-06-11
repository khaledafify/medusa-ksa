import { sarToHalalas } from "@medusa-ksa/core";

import type {
  ZatcaDocumentAllowanceCharge,
  ZatcaInvoiceLine,
} from "./xml-builder";
import {
  ZATCA_ALLOWANCE_CHARGE_REASON,
  ZATCA_ERROR_CODE,
  ZATCA_VAT,
} from "./lifecycle";

interface MoneyLike {
  value?: unknown;
}

interface TaxLineView {
  rate?: number | string | MoneyLike | null;
  total?: number | string | MoneyLike | null;
  subtotal?: number | string | MoneyLike | null;
}

interface OrderItemView {
  id: string;
  title: string;
  quantity?: number | string | MoneyLike | null;
  unit_price?: number | string | MoneyLike | null;
  is_tax_inclusive?: boolean | null;
  subtotal?: number | string | MoneyLike | null;
  total?: number | string | MoneyLike | null;
  tax_total?: number | string | MoneyLike | null;
  discount_total?: number | string | MoneyLike | null;
  discount_tax_total?: number | string | MoneyLike | null;
  tax_lines?: TaxLineView[] | null;
  detail?: { quantity?: number | string | MoneyLike | null } | null;
}

interface ShippingMethodView {
  total?: number | string | MoneyLike | null;
  tax_total?: number | string | MoneyLike | null;
  tax_lines?: TaxLineView[] | null;
}

export interface OrderGraphForZatcaTaxBase {
  id: string;
  total: number | string | MoneyLike;
  tax_total: number | string | MoneyLike;
  items?: OrderItemView[] | null;
  shipping_methods?: ShippingMethodView[] | null;
}

export interface DerivedSimplifiedInvoiceTaxBase {
  lines: ZatcaInvoiceLine[];
  documentAllowances: ZatcaDocumentAllowanceCharge[];
  documentCharges: ZatcaDocumentAllowanceCharge[];
  expectedTaxInclusiveHalalas: number;
  expectedTaxHalalas: number;
}

export interface ReconciliationExpectedTotals {
  expectedTaxInclusiveHalalas: number;
  expectedTaxHalalas: number;
}

export interface ReconciliationBuiltTotals {
  taxInclusiveHalalas: number;
  taxHalalas: number;
}

export class ReconciliationMismatchError extends Error {
  readonly code = ZATCA_ERROR_CODE.RECONCILIATION_MISMATCH;

  constructor(
    readonly built: ReconciliationBuiltTotals,
    readonly expected: ReconciliationExpectedTotals,
  ) {
    super(
      `${ZATCA_ERROR_CODE.RECONCILIATION_MISMATCH}: built total/tax ${built.taxInclusiveHalalas}/${built.taxHalalas} does not match expected ${expected.expectedTaxInclusiveHalalas}/${expected.expectedTaxHalalas}`,
    );
  }
}

function money(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && "value" in value) {
    return Number((value as MoneyLike).value);
  }
  return Number(value);
}

function halalas(value: unknown): number {
  return sarToHalalas(money(value));
}

function rateOf(taxLines?: TaxLineView[] | null): number {
  return money(taxLines?.[0]?.rate ?? ZATCA_VAT.DEFAULT_PERCENT);
}

function quantityOf(item: OrderItemView): number {
  return money(item.detail?.quantity ?? item.quantity);
}

function unitHalalasFromSubtotal(item: OrderItemView): number {
  const quantity = quantityOf(item);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`order item ${item.id}: quantity must be positive`);
  }
  const subtotal = money(item.subtotal ?? money(item.unit_price) * quantity);
  return sarToHalalas(subtotal / quantity);
}

export function deriveSimplifiedInvoiceTaxBase(
  order: OrderGraphForZatcaTaxBase,
): DerivedSimplifiedInvoiceTaxBase {
  const lines: ZatcaInvoiceLine[] = [];
  const documentAllowances = new Map<string, ZatcaDocumentAllowanceCharge>();
  const documentCharges = new Map<string, ZatcaDocumentAllowanceCharge>();

  (order.items ?? []).forEach((item, idx) => {
    const vatPercent = rateOf(item.tax_lines);
    const discountExHalalas = halalas(
      money(item.discount_total) - money(item.discount_tax_total),
    );
    if (discountExHalalas > 0) {
      const key = String(vatPercent);
      const existing = documentAllowances.get(key);
      documentAllowances.set(key, {
        amountHalalas: (existing?.amountHalalas ?? 0) + discountExHalalas,
        vatPercent,
        reason: ZATCA_ALLOWANCE_CHARGE_REASON.DISCOUNT,
      });
    }

    lines.push({
      id: idx + 1,
      sourceItemId: item.id,
      name: item.title,
      quantity: quantityOf(item),
      unitPriceHalalas: unitHalalasFromSubtotal(item),
      lineExtensionHalalas: halalas(item.subtotal),
      vatPercent,
    });
  });

  (order.shipping_methods ?? []).forEach((method) => {
    const vatPercent = rateOf(method.tax_lines);
    const taxableHalalas = halalas(money(method.total) - money(method.tax_total));
    if (taxableHalalas <= 0) return;
    const key = String(vatPercent);
    const existing = documentCharges.get(key);
    documentCharges.set(key, {
      amountHalalas: (existing?.amountHalalas ?? 0) + taxableHalalas,
      vatPercent,
      reason: ZATCA_ALLOWANCE_CHARGE_REASON.SHIPPING,
    });
  });

  return {
    lines,
    documentAllowances: [...documentAllowances.values()],
    documentCharges: [...documentCharges.values()],
    expectedTaxInclusiveHalalas: halalas(order.total),
    expectedTaxHalalas: halalas(order.tax_total),
  };
}

export function assertSimplifiedInvoiceReconciles(
  built: ReconciliationBuiltTotals,
  expected: ReconciliationExpectedTotals,
): void {
  if (
    built.taxInclusiveHalalas !== expected.expectedTaxInclusiveHalalas ||
    built.taxHalalas !== expected.expectedTaxHalalas
  ) {
    throw new ReconciliationMismatchError(built, expected);
  }
}
