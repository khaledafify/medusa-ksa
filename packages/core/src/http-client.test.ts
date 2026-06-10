import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "./http-client.js";
import { KsaError, KsaErrorCodes } from "./errors.js";
import type { HttpRequest } from "./types.js";

/** Build a JSON Response with sane defaults. */
function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/**
 * A fetch stub that returns queued responses in order. Each queue entry is
 * either a `Response` (resolve) or an `Error` (reject — simulates a network
 * failure). Records every URL+init it was called with.
 */
function fakeFetch(queue: (Response | Error)[]): typeof fetch {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("fakeFetch: queue exhausted");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }) as typeof fetch & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

/** No-op sleep so retry tests run instantly and deterministically. */
const noSleep = (): Promise<void> => Promise.resolve();

const baseOpts = {
  baseUrl: "https://api.example.test",
  timeoutMs: 1000,
  sleepImpl: noSleep,
};

describe("HttpClient", () => {
  it("rejects construction without a positive timeout", () => {
    expect(
      () => new HttpClient({ baseUrl: "https://x.test", timeoutMs: 0 }),
    ).toThrowError(KsaError);
  });

  it("parses a successful JSON response", async () => {
    const fetchImpl = fakeFetch([jsonResponse({ ok: true, id: 7 })]);
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    const out = await client.request<{ ok: boolean; id: number }>({
      method: "GET",
      path: "/things/7",
    });

    expect(out).toEqual({ ok: true, id: 7 });
  });

  it("returns undefined for an empty 2xx body", async () => {
    // 200 with an empty body — 204 is a null-body status the Response ctor rejects.
    const fetchImpl = fakeFetch([new Response("", { status: 200 })]);
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    const out = await client.request<undefined>({ method: "GET", path: "/ping" });
    expect(out).toBeUndefined();
  });

  it("throws KsaError on timeout (aborted fetch)", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    const fetchImpl = fakeFetch([abortErr]);
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    const err = (await client
      .request({ method: "GET", path: "/slow" })
      .catch((e: unknown) => e)) as KsaError;
    expect(err).toBeInstanceOf(KsaError);
    expect(err.code).toBe(KsaErrorCodes.HTTP_ERROR);
    expect(err.message).toContain("timed out");
  });

  it("aborts the underlying fetch when the timeout fires", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      // Never resolves on its own; the timeout must abort it.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as typeof fetch;

    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      timeoutMs: 5,
      sleepImpl: noSleep,
      fetchImpl,
    });

    await expect(client.request({ method: "GET", path: "/hang" })).rejects.toBeInstanceOf(
      KsaError,
    );
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("retries a 500 then succeeds", async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({ msg: "boom" }, { status: 500 }),
      jsonResponse({ ok: true }),
    ]);
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      retry: { retries: 3, baseDelayMs: 10 },
    });

    const out = await client.request<{ ok: boolean }>({ method: "GET", path: "/r" });
    expect(out).toEqual({ ok: true });
  });

  it("retries a 429 honoring Retry-After, then succeeds", async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = fakeFetch([
      jsonResponse({}, { status: 429, headers: { "retry-after": "2" } }),
      jsonResponse({ ok: true }),
    ]);
    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      timeoutMs: 1000,
      sleepImpl,
      fetchImpl,
      retry: { retries: 2, baseDelayMs: 10 },
    });

    const out = await client.request<{ ok: boolean }>({ method: "GET", path: "/limited" });
    expect(out).toEqual({ ok: true });
    // Retry-After: 2 seconds → 2000ms, used verbatim instead of jittered backoff.
    expect(sleepImpl).toHaveBeenCalledWith(2000);
  });

  it("does NOT retry a 400", async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({ error: "bad request" }, { status: 400 }),
      jsonResponse({ ok: true }), // must never be consumed
    ]) as typeof fetch & { calls: unknown[] };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      retry: { retries: 3, baseDelayMs: 10 },
    });

    const err = (await client
      .request({ method: "GET", path: "/bad" })
      .catch((e: unknown) => e)) as KsaError;
    expect(err).toBeInstanceOf(KsaError);
    expect(err.code).toBe(KsaErrorCodes.HTTP_ERROR);
    expect(err.message).toContain("400");
    expect((fetchImpl as unknown as { calls: unknown[] }).calls).toHaveLength(1);
  });

  it("throws after exhausting retries on persistent 5xx", async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({}, { status: 503 }),
      jsonResponse({}, { status: 503 }),
      jsonResponse({}, { status: 503 }),
    ]) as typeof fetch & { calls: unknown[] };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      retry: { retries: 2, baseDelayMs: 5 },
    });

    const err = (await client
      .request({ method: "GET", path: "/down" })
      .catch((e: unknown) => e)) as KsaError;
    expect(err).toBeInstanceOf(KsaError);
    expect(err.code).toBe(KsaErrorCodes.HTTP_ERROR);
    expect(err.message).toContain("503");
    // retries: 2 → 3 total attempts.
    expect((fetchImpl as unknown as { calls: unknown[] }).calls).toHaveLength(3);
  });

  it("redacts configured secrets from a thrown error message", async () => {
    const secret = "sk_live_supersecrettoken";
    const fetchImpl = fakeFetch([
      jsonResponse(`{"echo":"${secret}"}`, { status: 500 }),
    ]);
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      redact: [secret],
    });

    const err = await client
      .request({ method: "GET", path: "/leak" })
      .then(() => undefined)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KsaError);
    expect((err as KsaError).message).not.toContain(secret);
    expect((err as KsaError).message).toContain("***");
  });

  it("redacts header secret values from a thrown error message", async () => {
    const token = "Bearer top-secret-header-value";
    const fetchImpl = fakeFetch([
      jsonResponse(`leaked ${token} in body`, { status: 500 }),
    ]);
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      headers: { Authorization: token },
    });

    const err = (await client
      .request({ method: "GET", path: "/h" })
      .catch((e: unknown) => e)) as KsaError;

    expect(err.message).not.toContain(token);
  });

  it("does NOT retry a non-idempotent POST", async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({}, { status: 500 }),
      jsonResponse({ ok: true }), // must never be consumed
    ]) as typeof fetch & { calls: unknown[] };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      retry: { retries: 3, baseDelayMs: 10 },
    });

    const err = (await client
      .request({ method: "POST", path: "/charge", body: { amount: 100 } })
      .catch((e: unknown) => e)) as KsaError;
    expect(err).toBeInstanceOf(KsaError);
    expect(err.code).toBe(KsaErrorCodes.HTTP_ERROR);
    expect(err.message).toContain("500");
    expect((fetchImpl as unknown as { calls: unknown[] }).calls).toHaveLength(1);
  });

  it("retries a POST flagged idempotent", async () => {
    const fetchImpl = fakeFetch([
      jsonResponse({}, { status: 500 }),
      jsonResponse({ ok: true }),
    ]) as typeof fetch & { calls: unknown[] };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      retry: { retries: 3, baseDelayMs: 10 },
    });

    const out = await client.request<{ ok: boolean }>({
      method: "POST",
      path: "/charge",
      body: { amount: 100 },
      idempotent: true,
    });
    expect(out).toEqual({ ok: true });
    expect((fetchImpl as unknown as { calls: unknown[] }).calls).toHaveLength(2);
  });

  it("retries a network error on a safe method then succeeds", async () => {
    const fetchImpl = fakeFetch([
      new TypeError("network down"),
      jsonResponse({ ok: true }),
    ]);
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      retry: { retries: 2, baseDelayMs: 5 },
    });

    const out = await client.request<{ ok: boolean }>({ method: "GET", path: "/flaky" });
    expect(out).toEqual({ ok: true });
  });

  it("serializes an object body as JSON and sets Content-Type", async () => {
    const fetchImpl = fakeFetch([jsonResponse({ ok: true })]) as typeof fetch & {
      calls: { url: string; init?: RequestInit }[];
    };
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    await client.request({ method: "POST", path: "/x", body: { a: 1 } });

    const call = (fetchImpl as unknown as {
      calls: { url: string; init?: RequestInit }[];
    }).calls[0];
    expect(call?.init?.body).toBe(JSON.stringify({ a: 1 }));
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  // --- Constructor validation ----------------------------------------------

  describe("constructor validation", () => {
    it("rejects timeoutMs of 0, negative, NaN, and Infinity", () => {
      for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          () => new HttpClient({ baseUrl: "https://x.test", timeoutMs }),
        ).toThrowError(KsaError);
      }
    });

    it("rejects a non-integer, negative, or infinite retry count", () => {
      for (const retries of [1.5, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
        expect(
          () =>
            new HttpClient({
              baseUrl: "https://x.test",
              timeoutMs: 1000,
              retry: { retries, baseDelayMs: 10 },
            }),
        ).toThrowError(KsaError);
      }
    });

    it("rejects a negative or infinite base delay", () => {
      for (const baseDelayMs of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
        expect(
          () =>
            new HttpClient({
              baseUrl: "https://x.test",
              timeoutMs: 1000,
              retry: { retries: 2, baseDelayMs },
            }),
        ).toThrowError(KsaError);
      }
    });

    it("accepts a valid finite retry policy", () => {
      expect(
        () =>
          new HttpClient({
            baseUrl: "https://x.test",
            timeoutMs: 1000,
            retry: { retries: 0, baseDelayMs: 0 },
          }),
      ).not.toThrow();
    });
  });

  // --- Absolute-URL boundary (SSRF) ----------------------------------------

  it("rejects an absolute URL path by default", async () => {
    const fetchImpl = fakeFetch([jsonResponse({ ok: true })]);
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    const err = (await client
      .request({ method: "GET", path: "https://evil.test/steal" })
      .catch((e: unknown) => e)) as KsaError;

    expect(err).toBeInstanceOf(KsaError);
    expect(err.code).toBe(KsaErrorCodes.INVALID_INPUT);
    // The attacker host must never have been contacted.
    expect((fetchImpl as unknown as { calls: unknown[] }).calls).toHaveLength(0);
  });

  it("allows an absolute URL only when explicitly opted in", async () => {
    const fetchImpl = fakeFetch([jsonResponse({ ok: true })]) as typeof fetch & {
      calls: { url: string }[];
    };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      allowAbsoluteUrls: true,
    });

    await client.request({ method: "GET", path: "https://other.test/ok" });
    expect(
      (fetchImpl as unknown as { calls: { url: string }[] }).calls[0]?.url,
    ).toBe("https://other.test/ok");
  });

  // --- Auth strategies ------------------------------------------------------

  it("sets a Bearer header and redacts both the header value and bare token", async () => {
    const token = "sk_live_bearer_secret_123";
    const fetchImpl = fakeFetch([
      // Body echoes the RAW token (not the full header) to prove substring redaction.
      jsonResponse(`upstream said token=${token} is bad`, { status: 500 }),
    ]) as typeof fetch & { calls: { url: string; init?: RequestInit }[] };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      auth: { type: "bearer", token },
    });

    const err = (await client
      .request({ method: "GET", path: "/secure" })
      .catch((e: unknown) => e)) as KsaError;

    const sentHeaders = (fetchImpl as unknown as {
      calls: { init?: RequestInit }[];
    }).calls[0]?.init?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe(`Bearer ${token}`);
    expect(err.message).not.toContain(token);
    expect(err.message).not.toContain(`Bearer ${token}`);
    expect(err.message).toContain("***");
  });

  it("sets a Basic header and redacts the username and password", async () => {
    const username = "merchant_acct_88";
    const password = "p@ss-w0rd-very-secret";
    const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    const fetchImpl = fakeFetch([
      jsonResponse(`rejected creds ${username} / ${password}`, { status: 401 }),
    ]) as typeof fetch & { calls: { init?: RequestInit }[] };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      auth: { type: "basic", username, password },
    });

    const err = (await client
      .request({ method: "GET", path: "/secure" })
      .catch((e: unknown) => e)) as KsaError;

    const sentHeaders = (fetchImpl as unknown as {
      calls: { init?: RequestInit }[];
    }).calls[0]?.init?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe(`Basic ${encoded}`);
    expect(err.message).not.toContain(username);
    expect(err.message).not.toContain(password);
    expect(err.message).not.toContain(encoded);
  });

  it("sets a custom api-key header and redacts the key value", async () => {
    const apiKey = "key_live_abcdef123456";
    const fetchImpl = fakeFetch([
      jsonResponse(`bad key ${apiKey}`, { status: 403 }),
    ]) as typeof fetch & { calls: { init?: RequestInit }[] };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      auth: { type: "api-key", header: "x-api-key", value: apiKey },
    });

    const err = (await client
      .request({ method: "GET", path: "/secure" })
      .catch((e: unknown) => e)) as KsaError;

    const sentHeaders = (fetchImpl as unknown as {
      calls: { init?: RequestInit }[];
    }).calls[0]?.init?.headers as Record<string, string>;
    expect(sentHeaders["x-api-key"]).toBe(apiKey);
    expect(sentHeaders.Authorization).toBeUndefined();
    expect(err.message).not.toContain(apiKey);
  });

  it("defaults the api-key header to Authorization when none is given", async () => {
    const apiKey = "key_default_header";
    const fetchImpl = fakeFetch([jsonResponse({ ok: true })]) as typeof fetch & {
      calls: { init?: RequestInit }[];
    };
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      auth: { type: "api-key", value: apiKey },
    });

    await client.request({ method: "GET", path: "/secure" });
    const sentHeaders = (fetchImpl as unknown as {
      calls: { init?: RequestInit }[];
    }).calls[0]?.init?.headers as Record<string, string>;
    expect(sentHeaders.Authorization).toBe(apiKey);
  });

  // --- Query serialization --------------------------------------------------

  it("appends query params and drops undefined values", async () => {
    const fetchImpl = fakeFetch([jsonResponse({ ok: true })]) as typeof fetch & {
      calls: { url: string }[];
    };
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    await client.request({
      method: "GET",
      path: "/search",
      query: { q: "shoes", page: 2, inStock: true, color: undefined },
    });

    const url = (fetchImpl as unknown as { calls: { url: string }[] }).calls[0]?.url ?? "";
    expect(url).toContain("/search?");
    expect(url).toContain("q=shoes");
    expect(url).toContain("page=2");
    expect(url).toContain("inStock=true");
    expect(url).not.toContain("color");
  });

  it("merges query params onto a path that already has a query string", async () => {
    const fetchImpl = fakeFetch([jsonResponse({ ok: true })]) as typeof fetch & {
      calls: { url: string }[];
    };
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    await client.request({ method: "GET", path: "/search?existing=1", query: { extra: "2" } });

    const url = (fetchImpl as unknown as { calls: { url: string }[] }).calls[0]?.url ?? "";
    expect(url).toContain("existing=1");
    expect(url).toContain("&extra=2");
  });

  // --- Per-request timeout override ----------------------------------------

  it("honors a per-request timeoutMs override", async () => {
    const fetchImpl = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      // Hang until aborted so the timeout is what ends the call.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as typeof fetch;

    // Client default is large; the per-request override is tiny.
    const client = new HttpClient({
      baseUrl: "https://api.example.test",
      timeoutMs: 60_000,
      sleepImpl: noSleep,
      fetchImpl,
    });

    const err = (await client
      .request({ method: "GET", path: "/slow", timeoutMs: 5 })
      .catch((e: unknown) => e)) as KsaError;

    expect(err).toBeInstanceOf(KsaError);
    // The message reflects the per-request override, not the 60s default.
    expect(err.message).toContain("timed out after 5ms");
  });

  it("rejects an invalid per-request timeoutMs", async () => {
    const fetchImpl = fakeFetch([jsonResponse({ ok: true })]);
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    const err = (await client
      .request({ method: "GET", path: "/x", timeoutMs: -5 })
      .catch((e: unknown) => e)) as KsaError;
    expect(err).toBeInstanceOf(KsaError);
    expect(err.code).toBe(KsaErrorCodes.INVALID_INPUT);
  });

  // --- RegExp redaction -----------------------------------------------------

  it("redacts secrets matched by a RegExp needle", async () => {
    const fetchImpl = fakeFetch([
      jsonResponse(`leak sk_live_DEADBEEF42 here`, { status: 500 }),
    ]);
    const client = new HttpClient({
      ...baseOpts,
      fetchImpl,
      redact: [/sk_live_\w+/],
    });

    const err = (await client
      .request({ method: "GET", path: "/leak" })
      .catch((e: unknown) => e)) as KsaError;

    expect(err.message).not.toContain("sk_live_DEADBEEF42");
    expect(err.message).toContain("***");
  });

  // --- Exported HttpRequest shape ------------------------------------------

  it("accepts the exported HttpRequest shape with all documented fields", async () => {
    const fetchImpl = fakeFetch([jsonResponse({ ok: true })]) as typeof fetch & {
      calls: { url: string; init?: RequestInit }[];
    };
    const client = new HttpClient({ ...baseOpts, fetchImpl });

    // This object is typed as HttpRequest via the request() signature; if the
    // accepted shape and the exported type drifted, this would not compile.
    const req: HttpRequest = {
      method: "POST",
      path: "/orders",
      body: { sku: "x" },
      headers: { "x-trace": "abc" },
      query: { dryRun: true },
      idempotent: true,
      timeoutMs: 2000,
    };
    const out = await client.request<{ ok: boolean }>(req);
    expect(out).toEqual({ ok: true });
  });
});
