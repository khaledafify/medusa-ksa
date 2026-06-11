import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { ZATCA_MODULE } from "../modules/zatca";

interface ContainerLike {
  resolve<T = unknown>(key: string): T;
}

function linkedZatcaInvoiceIds(
  value: { id: string } | { id: string }[] | null | undefined,
): Set<string> {
  if (!value) return new Set();
  return new Set((Array.isArray(value) ? value : [value]).map((row) => row.id));
}

export async function ensureZatcaInvoiceOrderLink(
  container: ContainerLike,
  orderId: string,
  invoiceId: string,
): Promise<void> {
  const query = container.resolve<{
    graph(input: {
      entity: string;
      fields: string[];
      filters: Record<string, unknown>;
    }): Promise<{ data: unknown[] }>;
  }>(ContainerRegistrationKeys.QUERY);

  const { data: linked } = await query.graph({
    entity: "order",
    fields: ["id", "zatca_invoices.id"],
    filters: { id: orderId },
  });
  const existingLink = linked[0] as
    | { zatca_invoices?: { id: string } | { id: string }[] | null }
    | undefined;
  if (linkedZatcaInvoiceIds(existingLink?.zatca_invoices).has(invoiceId)) {
    return;
  }

  const link = container.resolve<{
    create(input: Record<string, Record<string, string>>): Promise<void>;
  }>(ContainerRegistrationKeys.LINK);
  await link.create({
    [ZATCA_MODULE]: { zatca_invoice_id: invoiceId },
    [Modules.ORDER]: { order_id: orderId },
  });
}
