import { sdk } from "./client";

const ADMIN_ROUTES = {
  TEMPLATES: "/admin/notification-templates",
  PREVIEW: "/admin/notification-templates/preview",
  SEND_TEST: "/admin/notification-templates/send-test",
} as const;

const RESPONSE_KEYS = {
  TEMPLATES: "templates",
  TEMPLATE: "template",
  PREVIEW: "preview",
  STATUS: "status",
  REASON: "reason",
} as const;

/** Notification template row returned by the admin REST API. */
export interface NotificationTemplate {
  id: string;
  channel: string;
  event: string;
  locale: string;
  body: string;
  enabled: boolean;
  from: string | null;
}

/** SMS segment analysis returned by preview endpoints. */
export interface SmsSegmentAnalysis {
  encoding: "gsm" | "unicode";
  length: number;
  segments: number;
  perSegment: number;
}

/** Non-fatal render warning returned by preview endpoints. */
export interface NotificationRenderWarning {
  code: string;
  message: string;
  segments: SmsSegmentAnalysis;
}

/** Rendered template preview returned by preview and send-test endpoints. */
export interface NotificationTemplatePreview {
  template_id: string;
  text: string;
  segments: SmsSegmentAnalysis;
  warnings: NotificationRenderWarning[];
}

/** List response returned by the template admin API. */
export interface NotificationTemplatesResponse {
  [RESPONSE_KEYS.TEMPLATES]: NotificationTemplate[];
}

/** Single-template response returned by create/update/get API operations. */
export interface NotificationTemplateResponse {
  [RESPONSE_KEYS.TEMPLATE]: NotificationTemplate;
}

/** Preview response returned by the stored-template preview API. */
export interface NotificationTemplatePreviewResponse {
  [RESPONSE_KEYS.PREVIEW]: NotificationTemplatePreview;
}

/** Send-test response returned by the template admin API. */
export interface SendTestResponse {
  [RESPONSE_KEYS.STATUS]: string;
  [RESPONSE_KEYS.REASON]?: string;
  [RESPONSE_KEYS.PREVIEW]?: NotificationTemplatePreview;
}

/** Editable template fields accepted by the update API. */
export interface UpdateNotificationTemplatePayload {
  body: string;
  enabled: boolean;
  from: string | null;
}

/** Send-test payload accepted by the admin UI. */
export interface SendTestPayload {
  id: string;
  to: string;
  live: boolean;
}

/** Fetch notification templates for the native admin editor. */
export function listNotificationTemplates(): Promise<NotificationTemplatesResponse> {
  return sdk.client.fetch<NotificationTemplatesResponse>(
    ADMIN_ROUTES.TEMPLATES,
  );
}

/** Update a stored notification template row. */
export function updateNotificationTemplate(
  id: string,
  body: UpdateNotificationTemplatePayload,
): Promise<NotificationTemplateResponse> {
  return sdk.client.fetch<NotificationTemplateResponse>(
    `${ADMIN_ROUTES.TEMPLATES}/${id}`,
    {
      method: "POST",
      body,
    },
  );
}

/** Render a stored notification template against sample order data. */
export function previewNotificationTemplate(
  id: string,
): Promise<NotificationTemplatePreviewResponse> {
  return sdk.client.fetch<NotificationTemplatePreviewResponse>(
    ADMIN_ROUTES.PREVIEW,
    {
      method: "POST",
      body: { id },
    },
  );
}

/** Create a test SMS notification from a stored template row. */
export function sendTestNotification(
  body: SendTestPayload,
): Promise<SendTestResponse> {
  return sdk.client.fetch<SendTestResponse>(ADMIN_ROUTES.SEND_TEST, {
    method: "POST",
    body,
  });
}
