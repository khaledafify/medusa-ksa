import { idempotencyKey } from "@medusa-ksa/core";

/** Medusa channel used by the provider-agnostic engine. */
export const CHANNEL = "sms" as const;

/** Medusa order lifecycle events used by seeded notification templates. */
export const EVENTS = {
  ORDER_PLACED: "order.placed",
  ORDER_SHIPPED: "shipment.created",
  ORDER_DELIVERED: "delivery.created",
  ORDER_CANCELED: "order.canceled",
} as const;

/** Supported template locales. */
export const LOCALES = {
  AR: "ar",
} as const;

/** Default locale for template resolution fallback. */
export const DEFAULT_LOCALE = LOCALES.AR;

/** Handlebars helper names supported by the renderer. */
export const HELPERS = {
  FORMAT_SAR: "formatSar",
  FORMAT_DATE: "formatDate",
  PLURALIZE_AR: "pluralizeAr",
} as const;

/** SMS safety and segment thresholds. */
export const LIMITS = {
  SMS_MAX_LEN: 670,
  GSM_SINGLE_SEGMENT: 160,
  GSM_MULTI_SEGMENT: 153,
  UNICODE_SINGLE_SEGMENT: 70,
  UNICODE_MULTI_SEGMENT: 67,
} as const;

/** Admin API base route for template management. */
export const API_ROUTE_BASE = "/admin/notification-templates" as const;

/** Template table names owned by this module. */
export const TABLES = {
  NOTIFICATION_TEMPLATE: "notification_template",
} as const;

/** Container registration key for the custom module. */
export const NOTIFICATIONS_MODULE = "notifications" as const;

/** Prefix used to derive notification idempotency keys. */
export const IDEMPOTENCY_PREFIX = "medusa-plugin-notifications" as const;

/** Stable separator used for template and idempotency key seeds. */
export const KEY_SEPARATOR = ":" as const;

/** Error messages used by the notification engine. */
export const ERROR_MESSAGES = {
  TEMPLATE_NOT_FOUND: "Notification template was not found.",
  TEMPLATE_DISABLED: "Notification template is disabled.",
  MISSING_RECIPIENT: "Notification recipient phone was not found.",
  INVALID_TEMPLATE_BODY: "Notification template body is invalid.",
} as const;

/** Build a deterministic template identity key. */
export function TEMPLATE_KEY(
  channel: string,
  event: string,
  locale: string,
): string {
  return [channel, event, locale].join(KEY_SEPARATOR);
}

/** Build the Medusa notification idempotency key for an order event. */
export function buildIdempotencyKey(event: string, orderId: string): string {
  return idempotencyKey(
    [IDEMPOTENCY_PREFIX, event, orderId].join(KEY_SEPARATOR),
  );
}
