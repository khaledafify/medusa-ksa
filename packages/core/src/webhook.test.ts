import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyWebhook } from "./webhook.js";

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

    it("returns true when the timestamp is within tolerance", () => {
      const sig = sign(BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, {
          timestamp: now - 100,
          toleranceSec,
          now,
        })
      ).toBe(true);
    });

    it("returns true at exactly the tolerance boundary", () => {
      const sig = sign(BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, {
          timestamp: now - toleranceSec,
          toleranceSec,
          now,
        })
      ).toBe(true);
    });

    it("returns false when the timestamp is older than the tolerance", () => {
      const sig = sign(BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, {
          timestamp: now - (toleranceSec + 1),
          toleranceSec,
          now,
        })
      ).toBe(false);
    });

    it("returns false for a far-future timestamp outside tolerance", () => {
      const sig = sign(BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, {
          timestamp: now + (toleranceSec + 1),
          toleranceSec,
          now,
        })
      ).toBe(false);
    });

    it("rejects a stale request even when the signature itself is valid", () => {
      const sig = sign(BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, {
          timestamp: now - 10_000,
          toleranceSec,
          now,
        })
      ).toBe(false);
    });

    it("ignores the timestamp when toleranceSec is omitted", () => {
      const sig = sign(BODY);
      expect(
        verifyWebhook(BODY, sig, SECRET, {
          timestamp: now - 10_000,
          now,
        })
      ).toBe(true);
    });
  });
});
