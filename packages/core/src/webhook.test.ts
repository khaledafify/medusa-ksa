import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifySecretToken, verifyWebhook } from "./webhook.js";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ id: "evt_123", type: "payment.captured" });

function sign(body: string | Buffer, secret = SECRET, encoding: "hex" | "base64" = "hex"): string {
  return createHmac("sha256", secret).update(body).digest(encoding);
}

describe("verifyWebhook", () => {
  it("returns true for a valid hex signature", () => {
    expect(verifyWebhook(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("returns true for a valid base64 signature", () => {
    expect(verifyWebhook(BODY, sign(BODY, SECRET, "base64"), SECRET)).toBe(true);
  });

  it("verifies a Buffer body identically to a string body", () => {
    const buf = Buffer.from(BODY, "utf8");
    expect(verifyWebhook(buf, sign(buf), SECRET)).toBe(true);
  });

  it("returns false for a tampered body", () => {
    const sig = sign(BODY);
    const tamperedBody = JSON.stringify({ id: "evt_123", type: "payment.refunded" });
    expect(verifyWebhook(tamperedBody, sig, SECRET)).toBe(false);
  });

  it("returns false for a tampered signature of the same length", () => {
    const sig = sign(BODY);
    // Flip the last hex character so the length stays identical.
    const lastChar = sig.slice(-1);
    const swapped = lastChar === "0" ? "1" : "0";
    const tamperedSig = sig.slice(0, -1) + swapped;
    expect(verifyWebhook(BODY, tamperedSig, SECRET)).toBe(false);
  });

  it("returns false on a length mismatch without throwing", () => {
    expect(() => verifyWebhook(BODY, "deadbeef", SECRET)).not.toThrow();
    expect(verifyWebhook(BODY, "deadbeef", SECRET)).toBe(false);
  });

  it("returns false for the wrong secret", () => {
    expect(verifyWebhook(BODY, sign(BODY, "other_secret"), SECRET)).toBe(false);
  });

  it("returns false for an empty signature", () => {
    expect(verifyWebhook(BODY, "", SECRET)).toBe(false);
  });

  it("returns false for an empty secret", () => {
    expect(verifyWebhook(BODY, sign(BODY), "")).toBe(false);
  });

  describe("replay protection", () => {
    const now = 1_700_000_000;
    const toleranceSec = 300;

    /** Sign the Stripe-style bound payload `${timestamp}.${body}`. */
    function signBound(timestamp: number, body: string | Buffer, secret = SECRET): string {
      return sign(`${timestamp}.${typeof body === "string" ? body : body.toString("utf8")}`, secret);
    }

    it("verifies a timestamp-bound signature within tolerance", () => {
      const timestamp = now - 100;
      const sig = signBound(timestamp, BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, { timestamp, toleranceSec, now })
      ).toBe(true);
    });

    it("verifies at exactly the tolerance boundary", () => {
      const timestamp = now - toleranceSec;
      const sig = signBound(timestamp, BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, { timestamp, toleranceSec, now })
      ).toBe(true);
    });

    it("rejects a timestamp older than the tolerance", () => {
      const timestamp = now - (toleranceSec + 1);
      const sig = signBound(timestamp, BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, { timestamp, toleranceSec, now })
      ).toBe(false);
    });

    it("rejects a far-future timestamp outside tolerance", () => {
      const timestamp = now + (toleranceSec + 1);
      const sig = signBound(timestamp, BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, { timestamp, toleranceSec, now })
      ).toBe(false);
    });

    it("rejects a stale request even when the bound signature is itself valid", () => {
      const timestamp = now - 10_000;
      const sig = signBound(timestamp, BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, { timestamp, toleranceSec, now })
      ).toBe(false);
    });

    // --- Misconfiguration guard ---------------------------------------------

    it("returns false when toleranceSec is supplied without a timestamp", () => {
      // The signature itself is valid; replay protection was requested but can
      // never be enforced, so we fail closed instead of silently skipping it.
      const sig = sign(BODY);
      expect(verifyWebhook(BODY, sig, SECRET, { toleranceSec, now })).toBe(false);
    });

    // --- Timestamp binding ---------------------------------------------------

    it("only verifies when the timestamp is part of the signed payload", () => {
      const timestamp = now - 50;
      // A signature over the body ALONE must not verify once a timestamp is in
      // play — the timestamp is bound into the HMAC input.
      const bodyOnlySig = sign(BODY);
      expect(
        verifyWebhook(BODY, bodyOnlySig, SECRET, { timestamp, toleranceSec, now })
      ).toBe(false);

      // The correctly-bound signature verifies.
      const boundSig = signBound(timestamp, BODY);
      expect(
        verifyWebhook(BODY, boundSig, SECRET, { timestamp, toleranceSec, now })
      ).toBe(true);
    });

    it("rejects an old body+signature replayed under a fresh timestamp", () => {
      const oldTimestamp = now - 10; // originally within tolerance
      const capturedSig = signBound(oldTimestamp, BODY);

      // Original delivery verifies.
      expect(
        verifyWebhook(BODY, capturedSig, SECRET, {
          timestamp: oldTimestamp,
          toleranceSec,
          now,
        })
      ).toBe(true);

      // Attacker re-sends the SAME body + SAME signature but swaps in a fresh
      // timestamp to beat the freshness window. Because the timestamp is bound,
      // the recomputed HMAC no longer matches the captured signature.
      const freshTimestamp = now; // well inside tolerance
      expect(
        verifyWebhook(BODY, capturedSig, SECRET, {
          timestamp: freshTimestamp,
          toleranceSec,
          now,
        })
      ).toBe(false);
    });

    it("rejects an old body+signature replayed under a fresh timestamp (Buffer body)", () => {
      const buf = Buffer.from(BODY, "utf8");
      const oldTimestamp = now - 10;
      const capturedSig = signBound(oldTimestamp, buf);

      expect(
        verifyWebhook(buf, capturedSig, SECRET, {
          timestamp: oldTimestamp,
          toleranceSec,
          now,
        })
      ).toBe(true);
      expect(
        verifyWebhook(buf, capturedSig, SECRET, {
          timestamp: now,
          toleranceSec,
          now,
        })
      ).toBe(false);
    });

    it("supports a provider-specific signedPayload override", () => {
      // Some gateways sign `${body}|${timestamp}` instead of the Stripe scheme.
      const timestamp = now - 5;
      const providerPayload = `${BODY}|${timestamp}`;
      const sig = sign(providerPayload);

      expect(
        verifyWebhook(BODY, sig, SECRET, {
          timestamp,
          toleranceSec,
          now,
          signedPayload: providerPayload,
        })
      ).toBe(true);

      // Replaying the same signature under a fresh timestamp fails the window
      // even though the body is unchanged.
      expect(
        verifyWebhook(BODY, sig, SECRET, {
          timestamp: now - 10_000,
          toleranceSec,
          now,
          signedPayload: providerPayload,
        })
      ).toBe(false);
    });

    it("never throws on a length-mismatched signature under replay options", () => {
      const timestamp = now - 1;
      expect(() =>
        verifyWebhook(BODY, "deadbeef", SECRET, { timestamp, toleranceSec, now })
      ).not.toThrow();
      expect(
        verifyWebhook(BODY, "deadbeef", SECRET, { timestamp, toleranceSec, now })
      ).toBe(false);
    });
  });
});

describe("verifySecretToken", () => {
  const TOKEN = "whtok_test_token";

  it("returns true when the received token matches the expected token", () => {
    expect(verifySecretToken(TOKEN, TOKEN)).toBe(true);
  });

  it("returns false for a wrong token", () => {
    expect(verifySecretToken("whtok_wrong", TOKEN)).toBe(false);
  });

  it("returns false for a token of a different length without throwing", () => {
    expect(() => verifySecretToken("short", TOKEN)).not.toThrow();
    expect(verifySecretToken("short", TOKEN)).toBe(false);
  });

  it("returns false when the received token is missing or not a string", () => {
    expect(verifySecretToken(undefined, TOKEN)).toBe(false);
    expect(verifySecretToken(null, TOKEN)).toBe(false);
    expect(verifySecretToken(42, TOKEN)).toBe(false);
    expect(verifySecretToken("", TOKEN)).toBe(false);
  });

  it("fails closed when the expected token is empty", () => {
    // An unconfigured secret must never verify anything, even "" === "".
    expect(verifySecretToken("", "")).toBe(false);
    expect(verifySecretToken("anything", "")).toBe(false);
  });
});
