import assert from "node:assert/strict";

import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  ZATCA_CURRENCY,
  ZATCA_ORIGINAL_INVOICE_ORDER_FIELDS,
  ZATCA_QUERY_ENTITY,
  ZATCA_VAT,
} from "medusa-plugin-zatca/modules/zatca";

/*
 * Observed with `pnpm --filter demo-store probe:tax-semantics` on 2026-06-11:
 *
 * - Exclusive order total=268.50, tax_total=28.50. Its discounted 15% item had
 *   unit_price=100, subtotal=200, total=207, tax_total=27, discount_total=23,
 *   discount_tax_total=3. Shipping had amount=10, subtotal=10, total=11.50,
 *   tax_total=1.50.
 * - Inclusive order total=265.05, tax_total=28.05. Its discounted 15% item had
 *   unit_price=115, is_tax_inclusive=true, subtotal=200, total=203.55,
 *   tax_total=26.55, discount_total=26.45, discount_tax_total=3.45. Shipping
 *   had amount=11.50, is_tax_inclusive=true, subtotal=10, total=11.50,
 *   tax_total=1.50.
 * - In both modes, row `total` is final tax-inclusive and row `tax_total` is
 *   final collected VAT. `total - tax_total` is the config-agnostic ex-tax
 *   taxable base for item and shipping rows. `subtotal` was ex-tax in this
 *   probe, but the mapper intentionally does not rely on it.
 */

function money(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value);
  }
  return Number(value);
}

function roundSar(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: unknown[]): number {
  return roundSar(values.reduce<number>((acc, value) => acc + money(value), 0));
}

function taxableEx(total: unknown, taxTotal: unknown): number {
  return roundSar(money(total) - money(taxTotal));
}

function assertFinalTotalsTie(label: string, order: any): void {
  const items = order.items ?? [];
  const shippingMethods = order.shipping_methods ?? [];
  const itemTax = sum(items.map((item: any) => item.tax_total));
  const shippingTax = sum(shippingMethods.map((method: any) => method.tax_total));
  const itemTotal = sum(items.map((item: any) => item.total));
  const shippingTotal = sum(shippingMethods.map((method: any) => method.total));
  const taxable = sum([
    ...items.map((item: any) => taxableEx(item.total, item.tax_total)),
    ...shippingMethods.map((method: any) =>
      taxableEx(method.total, method.tax_total),
    ),
  ]);

  assert.equal(
    sum([itemTax, shippingTax]),
    roundSar(money(order.tax_total)),
    `${label}: item/shipping VAT must tie to order.tax_total`,
  );
  assert.equal(
    sum([itemTotal, shippingTotal]),
    roundSar(money(order.total)),
    `${label}: item/shipping totals must tie to order.total`,
  );
  assert.equal(
    sum([taxable, itemTax, shippingTax]),
    roundSar(money(order.total)),
    `${label}: final-total ex-tax base plus VAT must tie to order.total`,
  );
}

async function createAndProbe(
  container: ExecArgs["container"],
  label: string,
  isTaxInclusive: boolean,
) {
  const orderModule = container.resolve(Modules.ORDER) as any;
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(input: {
      entity: string;
      fields: string[];
      filters: Record<string, unknown>;
    }): Promise<{ data: unknown[] }>;
  };
  const suffix = Date.now().toString(36);
  const vatCode = `vat-${ZATCA_VAT.DEFAULT_PERCENT}`;
  const zeroVatCode = `vat-${ZATCA_VAT.ZERO_PERCENT}`;
  const lineDiscountCode = `${label}-line-discount`;

  const order = await orderModule.createOrders({
    currency_code: ZATCA_CURRENCY.SAR_LOWERCASE,
    email: `${label}-${suffix}@example.com`,
    metadata: {
      zatca_tax_semantics_probe: label,
      is_tax_inclusive: isTaxInclusive,
    },
    items: [
      {
        title: `${label} taxable discounted item`,
        quantity: 2,
        unit_price: isTaxInclusive ? 115 : 100,
        is_tax_inclusive: isTaxInclusive,
        tax_lines: [{ code: vatCode, rate: ZATCA_VAT.DEFAULT_PERCENT }],
        adjustments: [
          {
            code: lineDiscountCode,
            amount: isTaxInclusive ? 23 : 20,
            description: `${label} line discount`,
          },
        ],
      },
      {
        title: `${label} zero-rate item`,
        quantity: 1,
        unit_price: 50,
        is_tax_inclusive: isTaxInclusive,
        tax_lines: [{ code: zeroVatCode, rate: ZATCA_VAT.ZERO_PERCENT }],
      },
    ],
    shipping_methods: [
      {
        name: `${label} delivery`,
        amount: isTaxInclusive ? 11.5 : 10,
        is_tax_inclusive: isTaxInclusive,
        tax_lines: [{ code: vatCode, rate: ZATCA_VAT.DEFAULT_PERCENT }],
      },
    ],
  });

  const { data } = await query.graph({
    entity: ZATCA_QUERY_ENTITY.ORDER,
    fields: [...ZATCA_ORIGINAL_INVOICE_ORDER_FIELDS],
    filters: { id: order.id },
  });
  const resolved = data[0];
  if (!resolved) {
    throw new Error(`${label}: query.graph did not return order ${order.id}`);
  }

  assertFinalTotalsTie(label, resolved);
  console.log(`\n=== ${label} (${order.id}) ===`);
  console.log(JSON.stringify(resolved, null, 2));
}

export default async function probeTaxSemantics({ container }: ExecArgs) {
  await createAndProbe(container, "exclusive-tax-region", false);
  await createAndProbe(container, "inclusive-tax-region", true);
}
