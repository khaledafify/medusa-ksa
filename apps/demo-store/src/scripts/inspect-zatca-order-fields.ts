import assert from "node:assert/strict"

import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const ORDER_FIELDS = [
  "id",
  "display_id",
  "currency_code",
  "status",
  "total",
  "tax_total",
  "subtotal",
  "discount_total",
  "shipping_total",
  "item_total",
  "summary.*",
  "items.id",
  "items.title",
  "items.quantity",
  "items.unit_price",
  "items.is_tax_inclusive",
  "items.subtotal",
  "items.total",
  "items.tax_total",
  "items.discount_total",
  "items.discount_tax_total",
  "items.tax_lines.rate",
  "items.tax_lines.total",
  "items.tax_lines.subtotal",
  "items.detail.quantity",
  "shipping_methods.id",
  "shipping_methods.amount",
  "shipping_methods.is_tax_inclusive",
  "shipping_methods.subtotal",
  "shipping_methods.total",
  "shipping_methods.tax_total",
  "shipping_methods.discount_total",
  "shipping_methods.discount_tax_total",
  "shipping_methods.tax_lines.rate",
  "shipping_methods.tax_lines.total",
] as const

function money(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  if (typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value)
  }
  return Number(value)
}

function roundMoney(value: unknown): number {
  return Math.round(money(value) * 100) / 100
}

function sum(values: unknown[]): number {
  return roundMoney(values.reduce<number>((acc, value) => acc + money(value), 0))
}

function confirmDerivation(label: string, order: any): void {
  const items = order.items ?? []
  const shippingMethods = order.shipping_methods ?? []
  const itemTax = sum(items.map((item: any) => item.tax_total))
  const shippingTax = sum(shippingMethods.map((method: any) => method.tax_total))
  const itemTotal = sum(items.map((item: any) => item.total))
  const shippingTotal = sum(shippingMethods.map((method: any) => method.total))
  const taxableEx = sum([
    ...items.map((item: any) => money(item.total) - money(item.tax_total)),
    ...shippingMethods.map((method: any) => money(method.total) - money(method.tax_total)),
  ])

  assert.equal(
    sum([itemTax, shippingTax]),
    roundMoney(order.tax_total),
    `${label}: item/shipping tax_total must tie to order.tax_total`,
  )
  assert.equal(
    sum([itemTotal, shippingTotal]),
    roundMoney(order.total),
    `${label}: item/shipping total must tie to order.total`,
  )
  assert.equal(
    sum([taxableEx, itemTax, shippingTax]),
    roundMoney(order.total),
    `${label}: ex-tax derived total plus VAT must tie to order.total`,
  )
}

async function createAndInspect(container: ExecArgs["container"], label: string, input: any) {
  const orderModule = container.resolve(Modules.ORDER) as any
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const order = await orderModule.createOrders({
    currency_code: "sar",
    email: `${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}@example.com`,
    metadata: {
      zatca_field_probe: label,
      created_at: new Date().toISOString(),
    },
    ...input,
  })

  const { data } = await query.graph({
    entity: "order",
    fields: [...ORDER_FIELDS],
    filters: { id: order.id },
  })
  const resolved = data[0]
  if (!resolved) {
    throw new Error(`${label}: query.graph did not return order ${order.id}`)
  }

  confirmDerivation(label, resolved)
  console.log(`\n=== ${label} (${order.id}) ===`)
  console.log(JSON.stringify(resolved, null, 2))
}

export default async function inspectZatcaOrderFields({ container }: ExecArgs) {
  await createAndInspect(container, "line-discount", {
    items: [
      {
        title: "Discounted taxable item",
        quantity: 2,
        unit_price: 100,
        tax_lines: [{ code: "vat-15", rate: 15 }],
        adjustments: [{ code: "line-discount", amount: 20, description: "Line discount" }],
      },
    ],
  })

  await createAndInspect(container, "shipping", {
    items: [
      {
        title: "Shipped taxable item",
        quantity: 1,
        unit_price: 100,
        tax_lines: [{ code: "vat-15", rate: 15 }],
      },
    ],
    shipping_methods: [
      {
        name: "Riyadh delivery",
        amount: 10,
        tax_lines: [{ code: "vat-15", rate: 15 }],
      },
    ],
  })

  await createAndInspect(container, "tax-inclusive", {
    items: [
      {
        title: "Inclusive taxable item",
        quantity: 1,
        unit_price: 115,
        is_tax_inclusive: true,
        tax_lines: [{ code: "vat-15", rate: 15 }],
      },
    ],
  })
}
