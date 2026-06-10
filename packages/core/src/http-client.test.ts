import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "./http-client.js";
import { KsaError, KsaErrorCodes } from "./errors.js";

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
});
