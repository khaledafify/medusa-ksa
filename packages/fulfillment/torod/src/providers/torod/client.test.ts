import { describe, expect, it, vi } from "vitest";

import { KsaError } from "@medusa-ksa/core";

import {
  DEFAULTS,
  TOROD_ENDPOINTS,
  TOROD_HTTP_HEADERS,
  TOROD_HTTP_METHOD,
  TOROD_MEDIA_TYPES,
  TOROD_RESPONSE_FIELDS,
  TOROD_TOKEN,
} from "./constants.js";
import { TorodClient } from "./client.js";

const CLIENT_ID = "client_test_secret";
const CLIENT_SECRET = "client_secret_value";
const BASE_URL = "https://torod.test/en/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { [TOROD_HTTP_HEADERS.CONTENT_TYPE]: TOROD_MEDIA_TYPES.JSON },
  });
}

function tokenResponse(token: string, expiresIn: string | number = "24 Hours") {
  return {
    status: true,
    code: 200,
    message: "Bearer token generated successfully.",
    data: {
      [TOROD_RESPONSE_FIELDS.BEARER_TOKEN]: token,
      [TOROD_RESPONSE_FIELDS.TOKEN_GENERATED_DATE]: "2026-06-12T09:00:00+03:00",
      [TOROD_RESPONSE_FIELDS.EXPIRES_IN]: expiresIn,
    },
  };
}

function tokenResponseWithoutExpiry(token: string) {
  return {
    status: true,
    code: 200,
    message: "Bearer token generated successfully.",
    data: {
      [TOROD_RESPONSE_FIELDS.BEARER_TOKEN]: token,
      [TOROD_RESPONSE_FIELDS.TOKEN_GENERATED_DATE]: "not a date",
    },
  };
}

function makeClient(fetchImpl: typeof fetch, nowMs = 1781233200000): TorodClient {
  return new TorodClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: BASE_URL,
    fetchImpl,
    sleepImpl: () => Promise.resolve(),
    nowImpl: () => nowMs,
  });
}

describe("TorodClient", () => {
  it("fetches a bearer token once and reuses it until expiry", async () => {
    let tokenCallCount = 0;
    const fetchImpl = vi.fn(async (url: unknown) => {
      const path = String(url).replace(BASE_URL, "");
      if (path === TOROD_ENDPOINTS.TOKEN) {
        tokenCallCount += 1;
        return jsonResponse(tokenResponse("tok_cached"));
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);

    await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });
    await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.CITIES });

    expect(tokenCallCount).toBe(1);
  });

  it("attaches the bearer token through core HttpClient auth", async () => {
    let capturedAuthorization: string | undefined;
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
        return jsonResponse(tokenResponse("tok_auth"));
      }
      const headers = init?.headers as Record<string, string>;
      capturedAuthorization = headers[TOROD_HTTP_HEADERS.AUTHORIZATION];
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);

    await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

    expect(capturedAuthorization).toBe(`${TOROD_TOKEN.BEARER_SCHEME} tok_auth`);
  });

  it("uses default client options when optional configuration is omitted", async () => {
    let tokenRequestUrl: string | undefined;
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
        tokenRequestUrl = String(url);
        return jsonResponse(tokenResponse("tok_defaults"));
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = new TorodClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
    });

    await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

    expect(tokenRequestUrl).toBe(`${DEFAULTS.BASE_URL}${TOROD_ENDPOINTS.TOKEN}`);
  });

  it("refreshes the bearer token once on 401 and retries the request", async () => {
    const seenAuthorizations: string[] = [];
    let tokenCallCount = 0;
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
        tokenCallCount += 1;
        return jsonResponse(tokenResponse(tokenCallCount === 1 ? "tok_old" : "tok_new"));
      }
      const headers = init?.headers as Record<string, string>;
      seenAuthorizations.push(headers[TOROD_HTTP_HEADERS.AUTHORIZATION] ?? "");
      return seenAuthorizations.length === 1
        ? jsonResponse({ message: "expired" }, 401)
        : jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);

    await expect(
      client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS }),
    ).resolves.toEqual({ ok: true });

    expect(seenAuthorizations).toEqual([
      `${TOROD_TOKEN.BEARER_SCHEME} tok_old`,
      `${TOROD_TOKEN.BEARER_SCHEME} tok_new`,
    ]);
    expect(tokenCallCount).toBe(2);
  });

  it.each([400, 415, 422])(
    "uses a form-encoded token request when JSON token exchange is rejected with %i",
    async (statusCode) => {
      const tokenRequestContentTypes: (string | undefined)[] = [];
      const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
          const headers = init?.headers as Record<string, string>;
          tokenRequestContentTypes.push(headers[TOROD_HTTP_HEADERS.CONTENT_TYPE]);
          return tokenRequestContentTypes.length === 1
            ? jsonResponse({ message: "unsupported" }, statusCode)
            : jsonResponse(tokenResponse("tok_form"));
        }
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch;

      const client = makeClient(fetchImpl);

      await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

      expect(tokenRequestContentTypes).toEqual([
        TOROD_MEDIA_TYPES.JSON,
        TOROD_MEDIA_TYPES.FORM_URLENCODED,
      ]);
    },
  );

  it("propagates non-content-type token errors without retrying as form data", async () => {
    let tokenCallCount = 0;
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
        tokenCallCount += 1;
        return jsonResponse({ message: "unauthorized" }, 401);
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);

    await expect(
      client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS }),
    ).rejects.toSatisfy((err) => KsaError.isKsaError(err));

    expect(tokenCallCount).toBe(1);
  });

  it("throws a KsaError when Torod rejects a non-token request", async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
        return jsonResponse(tokenResponse("tok_error"));
      }
      return jsonResponse({ message: "bad request" }, 400);
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);

    await expect(
      client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS }),
    ).rejects.toSatisfy((err) => KsaError.isKsaError(err));
  });

  it("does not leak client credentials in token or request errors", async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
        return jsonResponse(
          {
            message: `${CLIENT_ID} ${CLIENT_SECRET}`,
          },
          401,
        );
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    let caught: unknown;

    try {
      await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });
    } catch (err) {
      caught = err;
    }

    expect(KsaError.isKsaError(caught)).toBe(true);
    const message = (caught as KsaError).message;
    expect(message).not.toContain(CLIENT_ID);
    expect(message).not.toContain(CLIENT_SECRET);
  });

  it("rejects a token response without a bearer token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: true,
        code: 200,
        data: {},
      }),
    ) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);

    await expect(
      client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS }),
    ).rejects.toThrow(/bearer token/);
  });

  it("refreshes an expired cached token before sending the next request", async () => {
    let nowMs = Date.parse("2026-06-12T09:00:00+03:00");
    const tokens = ["tok_first", "tok_second"];
    let tokenCallCount = 0;
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
        tokenCallCount += 1;
        return jsonResponse(tokenResponse(tokens.shift() ?? "tok_fallback", 1));
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = new TorodClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      baseUrl: BASE_URL,
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
      nowImpl: () => nowMs,
    });

    await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

    nowMs += 2000;
    await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

    expect(tokenCallCount).toBe(2);
  });

  it.each([
    { expiresIn: "1 Day", elapsedMs: 60 * 60 * 1000, expectedTokenCalls: 1 },
    { expiresIn: "10 minutes", elapsedMs: 11 * 60 * 1000, expectedTokenCalls: 2 },
    { expiresIn: "30", elapsedMs: 31 * 1000, expectedTokenCalls: 2 },
    { expiresIn: "not valid", elapsedMs: 60 * 60 * 1000, expectedTokenCalls: 1 },
  ])(
    "parses token expiry value $expiresIn",
    async ({ expiresIn, elapsedMs, expectedTokenCalls }) => {
      let nowMs = Date.parse("2026-06-12T09:00:00+03:00");
      let tokenCallCount = 0;
      const fetchImpl = vi.fn(async (url: unknown) => {
        if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
          tokenCallCount += 1;
          return jsonResponse(tokenResponse(`tok_${tokenCallCount}`, expiresIn));
        }
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch;

      const client = new TorodClient({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        baseUrl: BASE_URL,
        fetchImpl,
        sleepImpl: () => Promise.resolve(),
        nowImpl: () => nowMs,
      });

      await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

      nowMs += elapsedMs;
      await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

      expect(tokenCallCount).toBe(expectedTokenCalls);
    },
  );

  it("falls back to a 24 hour token cache when generated date and expiry are missing", async () => {
    let nowMs = Date.parse("2026-06-12T09:00:00+03:00");
    let tokenCallCount = 0;
    const fetchImpl = vi.fn(async (url: unknown) => {
      if (String(url).endsWith(TOROD_ENDPOINTS.TOKEN)) {
        tokenCallCount += 1;
        return jsonResponse(tokenResponseWithoutExpiry("tok_default_expiry"));
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = new TorodClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      baseUrl: BASE_URL,
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
      nowImpl: () => nowMs,
    });

    await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

    nowMs += 60 * 60 * 1000;
    await client.request({ method: TOROD_HTTP_METHOD.GET, path: TOROD_ENDPOINTS.COURIERS });

    expect(tokenCallCount).toBe(1);
  });
});
