import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { KsaError, KsaErrorCodes } from "./errors.js";
import { decrypt, encrypt, secrets } from "./secrets.js";

/** A valid 32-byte raw key. */
const rawKey = (): Buffer => randomBytes(32);
/** A valid 32-byte key as a base64 string. */
const base64Key = (): string => randomBytes(32).toString("base64");

describe("secrets (AES-256-GCM)", () => {
  it("round-trips plaintext with a raw Buffer key", () => {
    const key = rawKey();
    const plaintext = "moyasar sk_live_super_secret_value";

    const decrypted = decrypt(encrypt(plaintext, key), key);

    expect(decrypted).toBe(plaintext);
  });

  it("round-trips plaintext with a base64 string key", () => {
    const key = base64Key();
    const plaintext = "زاتكا credential — unicode ✓";

    const decrypted = decrypt(encrypt(plaintext, key), key);

    expect(decrypted).toBe(plaintext);
  });

  it("round-trips empty and binary-ish plaintext", () => {
    const key = rawKey();

    expect(decrypt(encrypt("", key), key)).toBe("");

    const tricky = "line1\nline2\t ﻿";
    expect(decrypt(encrypt(tricky, key), key)).toBe(tricky);
  });

  it("produces a fresh iv per call (non-deterministic ciphertext)", () => {
    const key = rawKey();
    const plaintext = "same input";

    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);

    expect(a).not.toBe(b);
  });

  it("never leaks the plaintext into the ciphertext", () => {
    const key = rawKey();
    const plaintext = "TOP_SECRET_NEEDLE_42";

    const payload = encrypt(plaintext, key);

    // Neither the base64 form nor the decoded bytes contain the plaintext.
    expect(payload).not.toContain(plaintext);
    expect(payload).not.toContain(
      Buffer.from(plaintext, "utf8").toString("base64"),
    );
    expect(Buffer.from(payload, "base64").toString("utf8")).not.toContain(
      plaintext,
    );
    expect(Buffer.from(payload, "base64").toString("latin1")).not.toContain(
      plaintext,
    );
  });

  it("fails to decrypt with the wrong key", () => {
    const plaintext = "secret";
    const payload = encrypt(plaintext, rawKey());

    let thrown: unknown;
    try {
      decrypt(payload, rawKey());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(KsaError);
    // The public, contract-level decryption code — never a private string.
    expect((thrown as KsaError).code).toBe(KsaErrorCodes.DECRYPTION_FAILED);
    expect((thrown as KsaError).code).toBe("decryption_failed");
    // wrong-key failures must surface a clear cause for debugging.
    expect((thrown as KsaError).cause).toBeDefined();
  });

  it("throws DECRYPTION_FAILED on tampered ciphertext", () => {
    const key = rawKey();
    const payload = encrypt("secret payload", key);

    // Flip the last byte (inside the ciphertext region) and re-encode.
    const bytes = Buffer.from(payload, "base64");
    const last = bytes.length - 1;
    bytes[last] = bytes[last]! ^ 0xff;
    const tampered = bytes.toString("base64");

    let thrown: unknown;
    try {
      decrypt(tampered, key);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(KsaError);
    expect((thrown as KsaError).code).toBe(KsaErrorCodes.DECRYPTION_FAILED);
  });

  it("throws DECRYPTION_FAILED on a tampered auth tag", () => {
    const key = rawKey();
    const payload = encrypt("secret payload", key);

    const bytes = Buffer.from(payload, "base64");
    // The auth tag lives at bytes [12, 28). Flip a byte inside it.
    bytes[12] = bytes[12]! ^ 0xff;
    const tampered = bytes.toString("base64");

    let thrown: unknown;
    try {
      decrypt(tampered, key);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(KsaError);
    expect((thrown as KsaError).code).toBe(KsaErrorCodes.DECRYPTION_FAILED);
  });

  it("throws DECRYPTION_FAILED on a truncated / malformed payload", () => {
    const key = rawKey();

    let thrown: unknown;
    try {
      decrypt("short", key);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(KsaError);
    // Malformed ciphertext maps to the SAME public code as auth failures, so
    // callers never branch on a private, suite-internal string.
    expect((thrown as KsaError).code).toBe(KsaErrorCodes.DECRYPTION_FAILED);
  });

  it("throws on an invalid raw key length when encrypting", () => {
    const shortKey = randomBytes(16);

    let thrown: unknown;
    try {
      encrypt("secret", shortKey);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(KsaError);
    expect((thrown as KsaError).code).toBe(KsaErrorCodes.INVALID_ENCRYPTION_KEY);
  });

  it("throws on an invalid base64 key length when encrypting", () => {
    // 16 bytes -> base64, decodes to the wrong length.
    const shortBase64 = randomBytes(16).toString("base64");

    expect(() => encrypt("secret", shortBase64)).toThrowError(KsaError);
  });

  it("throws on an invalid key length when decrypting", () => {
    const goodKey = rawKey();
    const payload = encrypt("secret", goodKey);

    let thrown: unknown;
    try {
      decrypt(payload, randomBytes(8));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(KsaError);
    expect((thrown as KsaError).code).toBe(KsaErrorCodes.INVALID_ENCRYPTION_KEY);
  });

  it("exposes a secrets namespace that round-trips via the same primitives", () => {
    expect(typeof secrets.encrypt).toBe("function");
    expect(typeof secrets.decrypt).toBe("function");
    // The namespace must reference the very same functions as the named exports.
    expect(secrets.encrypt).toBe(encrypt);
    expect(secrets.decrypt).toBe(decrypt);

    const key = rawKey();
    const plaintext = "namespace round-trip";
    expect(secrets.decrypt(secrets.encrypt(plaintext, key), key)).toBe(plaintext);
  });

  it("does not echo the key or payload in error messages", () => {
    const plaintext = "secret";
    const payload = encrypt(plaintext, rawKey());
    const wrongKey = rawKey();

    try {
      decrypt(payload, wrongKey);
      expect.unreachable("decrypt should have thrown");
    } catch (err) {
      const message = (err as KsaError).message;
      expect(message).not.toContain(payload);
      expect(message).not.toContain(wrongKey.toString("base64"));
    }
  });
});
