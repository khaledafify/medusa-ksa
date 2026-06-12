import type { z } from "zod";

import type { KsaNotificationOptions } from "@medusa-ksa/core";

import type { unifonicOptionsSchema } from "./options.js";
import { RESPONSE_FIELDS } from "./constants.js";

/** Validated Unifonic provider options used at runtime. */
export type UnifonicOptions = z.infer<typeof unifonicOptionsSchema> &
  KsaNotificationOptions;

/** Retry policy accepted by the core HttpClient wrapper. */
export interface UnifonicRetryOptions {
  /** Number of retry attempts for idempotent requests only. */
  retries: number;
  /** Initial retry backoff in milliseconds. */
  baseDelayMs: number;
}

/** Constructor options for {@link UnifonicClient}. */
export interface UnifonicClientOptions {
  /** Override the API base URL, primarily for tests or a trusted proxy. */
  baseUrl?: string;
  /** Outbound request timeout in milliseconds. */
  timeoutMs?: number;
  /** Retry policy for safe/idempotent calls; SMS POSTs are never retried. */
  retry?: UnifonicRetryOptions;
  /** Injectable fetch implementation for deterministic tests. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep implementation for deterministic retry tests. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** Canonical SMS request accepted by {@link UnifonicClient.sendSms}. */
export interface UnifonicSendInput {
  /** Unifonic AppSid secret. */
  appSid: string;
  /** Registered Sender ID used as the SMS originator. */
  senderId: string;
  /** Already-rendered SMS text body. */
  body: string;
  /** Canonical international recipient, for example `+966501234567`. */
  recipient: string;
}

/** Result returned by {@link UnifonicClient.sendSms}. */
export interface UnifonicSendResult {
  /** Provider message id returned from `data.MessageID`. */
  id: string;
}

/** Raw data object inside Unifonic's classic SMS response. */
export type UnifonicResponseData = {
  [RESPONSE_FIELDS.MESSAGE_ID]?: string | number;
  [key: string]: unknown;
};

/** Raw body returned by Unifonic's classic SMS endpoint. */
export type UnifonicSendResponse = {
  [RESPONSE_FIELDS.SUCCESS]?: boolean;
  [RESPONSE_FIELDS.MESSAGE]?: string;
  [RESPONSE_FIELDS.ERROR_CODE]?: string;
  [RESPONSE_FIELDS.DATA]?: UnifonicResponseData | Record<string, unknown>;
};
