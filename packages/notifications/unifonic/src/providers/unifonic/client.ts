import {
  HttpClient,
  KsaError,
  KsaErrorCodes,
  redactSecrets,
} from "@medusa-ksa/core";

import {
  DEFAULTS,
  DEFAULT_BASE_URL,
  EMPTY_STRING,
  ENDPOINTS,
  ERROR_FORMAT,
  ERROR_MESSAGES,
  HTTP_METHODS,
  RECIPIENTS,
  REQUEST_FIELDS,
  REQUEST_HEADERS,
  REQUEST_VALUES,
  RESPONSE_FIELDS,
  UNIFONIC_PREFIX,
} from "./constants.js";
import type {
  UnifonicClientOptions,
  UnifonicResponseData,
  UnifonicSendInput,
  UnifonicSendResponse,
  UnifonicSendResult,
} from "./types.js";

/** Thin Unifonic SMS API wrapper over the core HttpClient. */
export class UnifonicClient {
  private readonly options: Required<
    Pick<UnifonicClientOptions, "baseUrl" | "timeoutMs" | "retry">
  > &
    Pick<UnifonicClientOptions, "fetchImpl" | "sleepImpl">;

  constructor(options: UnifonicClientOptions = {}) {
    this.options = {
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: options.timeoutMs ?? DEFAULTS.TIMEOUT_MS,
      retry: options.retry ?? DEFAULTS.RETRY,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    };
  }

  /**
   * Send one SMS through Unifonic's classic REST endpoint.
   *
   * The request is a non-idempotent POST and is deliberately not marked
   * retryable, so core HttpClient issues it exactly once even when a retry
   * policy is configured.
   */
  async sendSms(input: UnifonicSendInput): Promise<UnifonicSendResult> {
    const response = await this.http(input.appSid).request<UnifonicSendResponse>(
      {
        method: HTTP_METHODS.POST,
        path: ENDPOINTS.SEND,
        headers: {
          [REQUEST_HEADERS.ACCEPT]: REQUEST_VALUES.ACCEPT_JSON,
          [REQUEST_HEADERS.CONTENT_TYPE]: REQUEST_VALUES.FORM_CONTENT_TYPE,
        },
        body: this.toFormBody(input),
      },
    );

    return this.parseSendResponse(response, input.appSid);
  }

  /** Build a core HttpClient whose redaction list includes the request AppSid. */
  private http(appSid: string): HttpClient {
    return new HttpClient({
      baseUrl: this.options.baseUrl,
      timeoutMs: this.options.timeoutMs,
      retry: this.options.retry,
      fetchImpl: this.options.fetchImpl,
      sleepImpl: this.options.sleepImpl,
      redact: [appSid],
    });
  }

  /** Convert canonical send input to Unifonic's form-encoded wire shape. */
  private toFormBody(input: UnifonicSendInput): string {
    const params = new URLSearchParams();
    params.set(REQUEST_FIELDS.APP_SID, input.appSid);
    params.set(REQUEST_FIELDS.SENDER_ID, input.senderId);
    params.set(REQUEST_FIELDS.BODY, input.body);
    params.set(REQUEST_FIELDS.RECIPIENT, this.toWireRecipient(input.recipient));
    params.set(REQUEST_FIELDS.RESPONSE_TYPE, REQUEST_VALUES.RESPONSE_TYPE_JSON);
    params.set(REQUEST_FIELDS.BASE_ENCODE, REQUEST_VALUES.BASE_ENCODE_TRUE);
    params.set(REQUEST_FIELDS.ASYNC, REQUEST_VALUES.ASYNC_FALSE);
    params.set(REQUEST_FIELDS.MESSAGE_TYPE, REQUEST_VALUES.MESSAGE_TYPE_UNICODE);
    return params.toString();
  }

  /** Convert `+9665...` to Unifonic's documented digits-only `9665...`. */
  private toWireRecipient(recipient: string): string {
    return recipient.startsWith(RECIPIENTS.INTERNATIONAL_PREFIX)
      ? recipient.slice(RECIPIENTS.INTERNATIONAL_PREFIX.length)
      : recipient;
  }

  /** Parse Unifonic's classic response and fail closed on any non-success body. */
  private parseSendResponse(
    response: UnifonicSendResponse,
    appSid: string,
  ): UnifonicSendResult {
    if (response[RESPONSE_FIELDS.SUCCESS] !== true) {
      throw new KsaError(this.providerErrorMessage(response, appSid), {
        prefix: UNIFONIC_PREFIX,
        code: KsaErrorCodes.PROVIDER_ERROR,
      });
    }

    const data = response[RESPONSE_FIELDS.DATA];
    if (!this.isResponseData(data)) {
      throw new KsaError(ERROR_MESSAGES.INVALID_RESPONSE_DATA, {
        prefix: UNIFONIC_PREFIX,
        code: KsaErrorCodes.PROVIDER_ERROR,
      });
    }

    const messageId = data[RESPONSE_FIELDS.MESSAGE_ID];
    if (
      (typeof messageId !== "string" && typeof messageId !== "number") ||
      String(messageId) === EMPTY_STRING
    ) {
      throw new KsaError(ERROR_MESSAGES.MISSING_MESSAGE_ID, {
        prefix: UNIFONIC_PREFIX,
        code: KsaErrorCodes.PROVIDER_ERROR,
      });
    }

    return { id: String(messageId) };
  }

  /** Type guard for Unifonic's response data object. */
  private isResponseData(value: unknown): value is UnifonicResponseData {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /** Format provider rejection text while redacting the AppSid. */
  private providerErrorMessage(
    response: UnifonicSendResponse,
    appSid: string,
  ): string {
    const message = response[RESPONSE_FIELDS.MESSAGE];
    const errorCode = response[RESPONSE_FIELDS.ERROR_CODE];
    const detail =
      typeof message === "string" && message !== EMPTY_STRING
        ? `${ERROR_FORMAT.DETAIL_SEPARATOR}${message}`
        : EMPTY_STRING;
    const code =
      typeof errorCode === "string" && errorCode !== EMPTY_STRING
        ? `${ERROR_FORMAT.CODE_OPEN}${errorCode}${ERROR_FORMAT.CODE_CLOSE}`
        : EMPTY_STRING;

    return redactSecrets(
      `${ERROR_MESSAGES.PROVIDER_REJECTED}${detail}${code}`,
      [appSid],
    );
  }
}
