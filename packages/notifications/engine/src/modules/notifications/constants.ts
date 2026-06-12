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

/** Currency labels emitted by SMS helpers. */
export const CURRENCY = {
  SAR: "SAR",
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

/** Render warnings surfaced to API responses and tests. */
export const WARNINGS = {
  SMS_SEGMENTS: "sms.segment_count",
} as const;

/** Template resolution statuses returned by the module service. */
export const TEMPLATE_RESOLUTION_STATUS = {
  FOUND: "found",
  DISABLED: "disabled",
  MISSING: "missing",
} as const;

/** Notification content fields sent to Medusa's notification module. */
export const NOTIFICATION_CONTENT_FIELDS = {
  TEXT: "text",
} as const;

/** Admin API base route for template management. */
export const API_ROUTE_BASE = "/admin/notification-templates" as const;

/** HTTP statuses used by the admin API routes. */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
} as const;

/** JSON envelope keys returned by admin API routes. */
export const API_RESPONSE_KEYS = {
  ERROR: "error",
  NOTIFICATION: "notification",
  PREVIEW: "preview",
  REASON: "reason",
  STATUS: "status",
  TEMPLATE: "template",
  TEMPLATES: "templates",
} as const;

/** Trigger labels used for admin-created test notifications. */
export const API_TRIGGER_TYPES = {
  SEND_TEST: "notification.send_test",
} as const;

/** Send-test response statuses. */
export const SEND_TEST_STATUS = {
  SENT: "sent",
  SKIPPED: "skipped",
} as const;

/** Send-test skip reasons. */
export const SEND_TEST_SKIP_REASONS = {
  LIVE_DISABLED: "live_send_test_disabled",
} as const;

/** Env vars used only to gate live send-test execution. */
export const SEND_TEST_ENV = {
  LIVE_ENABLED: "MEDUSA_NOTIFICATIONS_LIVE_SEND_TEST",
} as const;

/** Boolean env values accepted by route-level live-send gating. */
export const ENV_VALUES = {
  ONE: "1",
  TRUE: "true",
} as const;

/** Deterministic sample order used by preview and send-test routes. */
export const SAMPLE_ORDER = {
  ID: "order_preview",
  DISPLAY_ID: 1001,
  TOTAL: 12345,
  CREATED_AT: "2026-06-12T00:00:00.000Z",
  CUSTOMER_FIRST_NAME: "Khaled",
  CUSTOMER_LAST_NAME: "Afify",
  CUSTOMER_PHONE: "+966544444444",
  CUSTOMER_EMAIL: "customer@example.com",
  SHIPPING_FIRST_NAME: "سارة",
  SHIPPING_LAST_NAME: "العلي",
  SHIPPING_PHONE: "+966500000000",
  TRACKING_NUMBER: "TRK123",
} as const;

/** Template table names owned by this module. */
export const TABLES = {
  NOTIFICATION_TEMPLATE: "notification_template",
} as const;

/** Container registration key for the custom module. */
export const NOTIFICATIONS_MODULE = "notifications" as const;

/** Query graph entities used by subscribers. */
export const QUERY_ENTITIES = {
  ORDER: "order",
  FULFILLMENT: "fulfillment",
} as const;

/** Query filter field names used by subscribers. */
export const QUERY_FILTER_FIELDS = {
  ID: "id",
} as const;

/** Subscriber source type for events that carry an order id directly. */
export const ORDER_NOTIFICATION_SOURCES = {
  ORDER_ID: "order_id",
  FULFILLMENT_ID: "fulfillment_id",
} as const;

/** Subscriber handling statuses returned for tests and audits. */
export const ORDER_NOTIFICATION_RESULTS = {
  CREATED: "created",
  SKIPPED: "skipped",
} as const;

/** Subscriber skip reasons returned for tests and audits. */
export const ORDER_NOTIFICATION_SKIP_REASONS = {
  TEMPLATE: "template",
  ORDER: "order",
  FULFILLMENT_ORDER: "fulfillment_order",
  RECIPIENT: "recipient",
} as const;

/** Order fields needed to render all seeded notification templates. */
export const ORDER_NOTIFICATION_ORDER_FIELDS = [
  "id",
  "display_id",
  "total",
  "currency_code",
  "created_at",
  "customer.first_name",
  "customer.last_name",
  "customer.phone",
  "customer.email",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.phone",
  "shipping_address.email",
  "fulfillments.tracking_number",
  "fulfillments.tracking_numbers",
] as const;

/** Fulfillment fields needed to resolve shipped events back to an order. */
export const ORDER_NOTIFICATION_FULFILLMENT_FIELDS = [
  "id",
  "tracking_number",
  "tracking_numbers",
  "order.id",
] as const;

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
  INVALID_REQUEST: "Notification API request is invalid.",
  EMPTY_UPDATE: "At least one editable template field must be provided.",
  LIVE_SEND_TEST_DISABLED: "Live send-test is disabled.",
} as const;

/** Subscriber log message builders. */
export const LOG_MESSAGES = {
  TEMPLATE_SKIPPED: (event: string, status: string) =>
    `[notifications] ${event} template ${status}; skipped.`,
  ORDER_NOT_FOUND: (event: string, orderId: string) =>
    `[notifications] ${event} order ${orderId} was not found; skipped.`,
  FULFILLMENT_ORDER_NOT_FOUND: (event: string, fulfillmentId: string) =>
    `[notifications] ${event} fulfillment ${fulfillmentId} has no linked order; skipped.`,
  MISSING_RECIPIENT: (event: string, orderId: string) =>
    `[notifications] ${event} order ${orderId} has no recipient phone; skipped.`,
  NOTIFICATION_CREATED: (event: string, orderId: string) =>
    `[notifications] ${event} order ${orderId} notification created.`,
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
