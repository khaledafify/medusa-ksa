import { CURRENCY } from "../constants";
import type { RenderRecord } from "./engine";

/** Minimal address/customer shape used for notification context mapping. */
export interface NotificationPersonInput {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Minimal fulfillment shape used for shipped-template context mapping. */
export interface NotificationFulfillmentInput {
  tracking_number?: string | null;
  tracking_numbers?: string[] | null;
}

/** Minimal order shape needed to render supported notification templates. */
export interface NotificationOrderInput {
  id: string;
  display_id?: string | number | null;
  total?: number | null;
  currency_code?: string | null;
  created_at?: string | Date | null;
  customer?: NotificationPersonInput | null;
  shipping_address?: NotificationPersonInput | null;
  fulfillments?: NotificationFulfillmentInput[] | null;
}

/** Optional context overrides supplied by a subscriber. */
export interface BuildOrderRenderContextOptions {
  trackingNumber?: string | null;
}

function text(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function firstNonEmpty(...values: (string | null | undefined)[]): string {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? "";
}

function fullName(person: NotificationPersonInput | null | undefined): string {
  return [person?.first_name, person?.last_name]
    .map((value) => text(value).trim())
    .filter((value) => value.length > 0)
    .join(" ");
}

function firstTrackingNumber(
  fulfillments: NotificationFulfillmentInput[] | null | undefined,
): string {
  for (const fulfillment of fulfillments ?? []) {
    const direct = firstNonEmpty(fulfillment.tracking_number);
    if (direct) {
      return direct;
    }
    const [first] = fulfillment.tracking_numbers ?? [];
    const tracking = firstNonEmpty(first);
    if (tracking) {
      return tracking;
    }
  }
  return "";
}

/** Build the pure Handlebars render context for a Medusa order. */
export function buildOrderRenderContext(
  order: NotificationOrderInput,
  options: BuildOrderRenderContextOptions = {},
): RenderRecord {
  const customerName = firstNonEmpty(
    fullName(order.shipping_address),
    fullName(order.customer),
    order.customer?.email,
  );
  const trackingNumber = firstNonEmpty(
    options.trackingNumber,
    firstTrackingNumber(order.fulfillments),
  );

  return {
    order: {
      id: order.id,
      display_id: text(order.display_id ?? order.id),
      total: order.total ?? 0,
      currency_code: order.currency_code ?? CURRENCY.SAR,
      created_at: order.created_at ?? "",
    },
    customer: {
      name: customerName,
      first_name: text(
        order.shipping_address?.first_name ?? order.customer?.first_name,
      ),
      last_name: text(
        order.shipping_address?.last_name ?? order.customer?.last_name,
      ),
      phone: text(order.shipping_address?.phone ?? order.customer?.phone),
      email: text(order.customer?.email),
    },
    fulfillment: {
      tracking_number: trackingNumber,
    },
  };
}
