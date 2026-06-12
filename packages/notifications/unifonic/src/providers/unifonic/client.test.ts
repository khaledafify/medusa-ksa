import { describe, expect, it, vi } from "vitest";

import { KsaError } from "@medusa-ksa/core";

import {
  DEFAULT_BASE_URL,
  ENDPOINTS,
  REQUEST_FIELDS,
  REQUEST_VALUES,
} from "./constants.js";
import { UnifonicClient } from "./client.js";
import type { UnifonicSendInput } from "./types.js";

const APP_SID = "app_secret_123";

const SEND_INPUT: UnifonicSendInput = {
  appSid: APP_SID,
  senderId: "MedusaKSA",
  body: "مرحبا من مدوسة",
  recipient: "+966501234567",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(
  fetchImpl: typeof fetch,
  retry?: { retries: number; baseDelayMs: number },
): UnifonicClient {
  return new UnifonicClient({
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: 1_000,
    retry,
    fetchImpl,
    sleepImpl: () => Promise.resolve(),
  });
}

function successBody(messageId: string | number): unknown {
  return {
    success: true,
    message: "",
    errorCode: "ER-00",
    data: {
      MessageID: messageId,
      Status: "Sent",
    },
  };
}

describe("UnifonicClient", () => {
  it("POSTs one form-encoded SMS request and returns the provider message id", async () => {
    let captured:
      | { url: string; method: string | undefined; headers: Headers; body: string }
      | undefined;
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      captured = {
        url: String(url),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: String(init?.body),
      };
      return jsonResponse(successBody(42000348806924));
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    const result = await client.sendSms(SEND_INPUT);

    expect(result).toEqual({ id: "42000348806924" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(captured?.url).toBe(`${DEFAULT_BASE_URL}${ENDPOINTS.SEND}`);
    expect(captured?.method).toBe("POST");
    expect(captured?.headers.get("Accept")).toBe(REQUEST_VALUES.ACCEPT_JSON);
    expect(captured?.headers.get("Content-Type")).toBe(
      REQUEST_VALUES.FORM_CONTENT_TYPE,
    );

    const body = new URLSearchParams(captured?.body);
    expect(body.get(REQUEST_FIELDS.APP_SID)).toBe(APP_SID);
    expect(body.get(REQUEST_FIELDS.SENDER_ID)).toBe(SEND_INPUT.senderId);
    expect(body.get(REQUEST_FIELDS.BODY)).toBe(SEND_INPUT.body);
    expect(body.get(REQUEST_FIELDS.RECIPIENT)).toBe("966501234567");
    expect(body.get(REQUEST_FIELDS.RESPONSE_TYPE)).toBe(
      REQUEST_VALUES.RESPONSE_TYPE_JSON,
    );
    expect(body.get(REQUEST_FIELDS.BASE_ENCODE)).toBe(
      REQUEST_VALUES.BASE_ENCODE_TRUE,
    );
    expect(body.get(REQUEST_FIELDS.ASYNC)).toBe(REQUEST_VALUES.ASYNC_FALSE);
    expect(body.get(REQUEST_FIELDS.MESSAGE_TYPE)).toBe(
      REQUEST_VALUES.MESSAGE_TYPE_UNICODE,
    );
  });

  it("maps Unifonic 4xx responses to KsaError without leaking AppSid", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        {
          success: false,
          message: `Authentication failed for ${APP_SID}`,
          errorCode: "ER-01",
          data: {},
        },
        401,
      )) as typeof fetch;

    const client = makeClient(fetchImpl);
    await expect(client.sendSms(SEND_INPUT)).rejects.toSatisfy((err) => {
      expect(KsaError.isKsaError(err)).toBe(true);
      expect((err as KsaError).message).not.toContain(APP_SID);
      expect((err as KsaError).message).toContain("***");
      return true;
    });
  });

  it("maps network errors to KsaError without swallowing the failure", async () => {
    const fetchImpl = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;

    const client = makeClient(fetchImpl);
    await expect(client.sendSms(SEND_INPUT)).rejects.toSatisfy((err) => {
      expect(KsaError.isKsaError(err)).toBe(true);
      expect((err as KsaError).message).toContain("socket hang up");
      return true;
    });
  });

  it("throws PROVIDER_ERROR when Unifonic returns success false", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        success: false,
        message: "Dest num is too short",
        errorCode: "ER-04",
        data: {},
      })) as typeof fetch;

    const client = makeClient(fetchImpl);
    await expect(client.sendSms(SEND_INPUT)).rejects.toSatisfy((err) => {
      expect(KsaError.isKsaError(err)).toBe(true);
      expect((err as KsaError).code).toBe("provider_error");
      return true;
    });
  });

  it("throws PROVIDER_ERROR instead of faking success when the message id is missing", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        success: true,
        message: "",
        errorCode: "ER-00",
        data: {},
      })) as typeof fetch;

    const client = makeClient(fetchImpl);
    await expect(client.sendSms(SEND_INPUT)).rejects.toSatisfy((err) => {
      expect(KsaError.isKsaError(err)).toBe(true);
      expect((err as KsaError).code).toBe("provider_error");
      return true;
    });
  });

  it("never retries the send POST, even on 5xx", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ success: false }, 500);
    }) as typeof fetch;

    const client = makeClient(fetchImpl, { retries: 3, baseDelayMs: 0 });
    await expect(client.sendSms(SEND_INPUT)).rejects.toSatisfy((err) =>
      KsaError.isKsaError(err),
    );

    expect(calls).toBe(1);
  });
});
