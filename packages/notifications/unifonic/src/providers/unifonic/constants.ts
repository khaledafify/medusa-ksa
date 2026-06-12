/** Stable provider id used in Medusa configuration and error prefixes. */
export const PROVIDER_ID = "unifonic";

/** Connector tag used to prefix every error raised by this package. */
export const UNIFONIC_PREFIX = PROVIDER_ID;

/** The only notification channel supported by v1 (ADR-0014). */
export const CHANNEL = "sms";

/** Empty string constant used where optional provider fields are blank. */
export const EMPTY_STRING = "";

/** Environment variables supported by the env-first loader. */
export const ENV = {
  APP_SID: "UNIFONIC_APP_SID",
  SENDER_ID: "UNIFONIC_SENDER_ID",
  BASE_URL: "UNIFONIC_BASE_URL",
} as const;

/** Classic Unifonic REST API base URL verified in S0. */
export const DEFAULT_BASE_URL = "https://el.cloud.unifonic.com";

/** Classic Unifonic REST API endpoints verified in S0. */
export const ENDPOINTS = {
  SEND: "/rest/SMS/messages",
} as const;

/** Form field names required by the classic SMS endpoint. */
export const REQUEST_FIELDS = {
  APP_SID: "AppSid",
  SENDER_ID: "SenderID",
  BODY: "Body",
  RECIPIENT: "Recipient",
  RESPONSE_TYPE: "responseType",
  BASE_ENCODE: "baseEncode",
  ASYNC: "async",
  MESSAGE_TYPE: "MessageType",
} as const;

/** HTTP header names used by the classic SMS endpoint. */
export const REQUEST_HEADERS = {
  ACCEPT: "Accept",
  CONTENT_TYPE: "Content-Type",
} as const;

/** HTTP methods used by the classic SMS client. */
export const HTTP_METHODS = {
  POST: "POST",
} as const;

/** Fixed form/header values required by the classic SMS endpoint. */
export const REQUEST_VALUES = {
  ACCEPT_JSON: "application/json",
  FORM_CONTENT_TYPE: "application/x-www-form-urlencoded",
  RESPONSE_TYPE_JSON: "JSON",
  BASE_ENCODE_TRUE: "true",
  ASYNC_FALSE: "false",
  MESSAGE_TYPE_UNICODE: "6",
} as const;

/** Field names returned by Unifonic's classic SMS response. */
export const RESPONSE_FIELDS = {
  SUCCESS: "success",
  MESSAGE: "message",
  ERROR_CODE: "errorCode",
  DATA: "data",
  MESSAGE_ID: "MessageID",
} as const;

/** Default transport settings. POST sends remain non-idempotent and unretried. */
export const DEFAULTS = {
  TIMEOUT_MS: 15_000,
  RETRY: {
    retries: 2,
    baseDelayMs: 250,
  },
} as const;

/** Saudi mobile-recipient constants used by the pure normalizer. */
export const RECIPIENTS = {
  INTERNATIONAL_PREFIX: "+",
  COUNTRY_CODE: "966",
  LOCAL_MOBILE_PREFIX: "05",
  NATIONAL_MOBILE_PREFIX: "5",
  MIN_DIGIT: "0",
  MAX_DIGIT: "9",
  LOCAL_DIGIT_COUNT: 10,
  NATIONAL_MOBILE_DIGIT_COUNT: 9,
  INTERNATIONAL_DIGIT_COUNT: 12,
  LOCAL_COUNTRY_CODE_OFFSET: 1,
} as const;

/** Human-readable hints for option validation errors. */
export const OPTION_HINTS = {
  APP_SID:
    "copy it from the Unifonic dashboard application settings and set UNIFONIC_APP_SID",
  SENDER_ID:
    "use a Unifonic-registered Sender ID and set UNIFONIC_SENDER_ID",
} as const;

/** Error strings emitted by the provider. They never contain secrets or PII. */
export const ERROR_MESSAGES = {
  INVALID_RECIPIENT:
    "recipient must be a Saudi mobile number in 05xxxxxxxx, 9665xxxxxxxx, or +9665xxxxxxxx format.",
  MISSING_TEXT:
    "notification.content.text is required; render the SMS body before calling the Unifonic provider.",
  MISSING_SENDER:
    "sender id is required — set UNIFONIC_SENDER_ID or notification.from.",
  UNSUPPORTED_CHANNEL: "Unifonic provider only supports the sms channel.",
  PROVIDER_REJECTED: "Unifonic rejected the SMS request.",
  MISSING_MESSAGE_ID:
    "Unifonic accepted the SMS request without returning a message id.",
  INVALID_RESPONSE_DATA: "Unifonic response data must be an object.",
} as const;

/** Formatting fragments for provider-error messages. */
export const ERROR_FORMAT = {
  DETAIL_SEPARATOR: ": ",
  CODE_OPEN: " (",
  CODE_CLOSE: ")",
} as const;

/** Notification DTO field names used by the Medusa service boundary. */
export const NOTIFICATION_FIELDS = {
  TEXT: "text",
} as const;
