import { describe, expect, it } from "vitest";

import { detectSandbox } from "./sandbox.js";

describe("detectSandbox", () => {
  describe("test-mode keys", () => {
    it("detects the canonical sk_test_ prefix", () => {
      expect(detectSandbox("sk_test_51HxyzABC")).toBe(true);
    });

    it("detects a pk_test_ publishable prefix", () => {
      expect(detectSandbox("pk_test_abc123")).toBe(true);
    });

    it("detects a _test_ segment in the middle of a key", () => {
      expect(detectSandbox("moyasar_test_secret_xyz")).toBe(true);
    });

    it("detects a bare leading test_ segment", () => {
      expect(detectSandbox("test_abc123")).toBe(true);
    });

    it("detects a trailing _test segment", () => {
      expect(detectSandbox("merchant_key_test")).toBe(true);
    });

    it("is case-insensitive about the test marker", () => {
      expect(detectSandbox("sk_TEST_abc")).toBe(true);
      expect(detectSandbox("SK_Test_abc")).toBe(true);
    });

    it("ignores surrounding whitespace", () => {
      expect(detectSandbox("  sk_test_abc  ")).toBe(true);
    });
  });

  describe("live-mode keys", () => {
    it("treats the canonical sk_live_ prefix as live", () => {
      expect(detectSandbox("sk_live_51HxyzABC")).toBe(false);
    });

    it("treats a pk_live_ publishable prefix as live", () => {
      expect(detectSandbox("pk_live_abc123")).toBe(false);
    });

    it("treats a key with no mode marker as live", () => {
      expect(detectSandbox("sk_abc123")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("does not misread 'test' embedded in a longer word as sandbox", () => {
      // No underscore delimiters around `test` — must not match.
      expect(detectSandbox("contestant_42")).toBe(false);
      expect(detectSandbox("sk_latest_abc")).toBe(false);
      expect(detectSandbox("testing_key")).toBe(false);
    });

    it("treats an empty string as live, not sandbox", () => {
      expect(detectSandbox("")).toBe(false);
    });

    it("treats whitespace-only input as live, not sandbox", () => {
      expect(detectSandbox("   ")).toBe(false);
    });

    it("matches a key that is exactly 'test'", () => {
      expect(detectSandbox("test")).toBe(true);
    });

    it("treats a non-string input defensively as live", () => {
      // Guards a callsite that hands an undefined env var through untyped.
      expect(detectSandbox(undefined as unknown as string)).toBe(false);
      expect(detectSandbox(null as unknown as string)).toBe(false);
    });
  });
});
