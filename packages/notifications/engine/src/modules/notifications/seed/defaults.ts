import { CHANNEL, EVENTS, LOCALES } from "../constants";
import type { CreateNotificationTemplateInput } from "../types";

/**
 * Arabic SMS defaults for the supported order lifecycle events.
 *
 * Default bodies live only in this file by design. Merchants can edit the
 * seeded rows later without being overwritten by future boot-time seeding.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES = [
  {
    channel: CHANNEL,
    event: EVENTS.ORDER_PLACED,
    locale: LOCALES.AR,
    enabled: true,
    from: null,
    body: "تم استلام طلبك رقم {{order.display_id}} بإجمالي {{formatSar order.total}}. شكراً لاختيارك لنا.",
  },
  {
    channel: CHANNEL,
    event: EVENTS.ORDER_SHIPPED,
    locale: LOCALES.AR,
    enabled: true,
    from: null,
    body: "تم شحن طلبك رقم {{order.display_id}}{{#if fulfillment.tracking_number}}. رقم التتبع {{fulfillment.tracking_number}}{{/if}}.",
  },
  {
    channel: CHANNEL,
    event: EVENTS.ORDER_DELIVERED,
    locale: LOCALES.AR,
    enabled: false,
    from: null,
    body: "تم تسليم طلبك رقم {{order.display_id}}. نتمنى لك تجربة سعيدة.",
  },
  {
    channel: CHANNEL,
    event: EVENTS.ORDER_CANCELED,
    locale: LOCALES.AR,
    enabled: false,
    from: null,
    body: "تم إلغاء طلبك رقم {{order.display_id}}. إذا احتجت مساعدة، يرجى التواصل معنا.",
  },
] as const satisfies readonly CreateNotificationTemplateInput[];
