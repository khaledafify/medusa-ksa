import { describe, expect, it } from "vitest";
import { MedusaError } from "@medusajs/framework/utils";
import {
  KsaError,
  KsaErrorCodes,
  toMedusaError,
} from "./errors.js";

describe("KsaError", () => {
  it("prefixes the rendered message with the connector tag", () => {
    const err = new KsaError("secret key is missing", { prefix: "moyasar" });
    expect(err.message).toBe("[moyasar] secret key is missing");
  });

  it("leaves the message unprefixed when no prefix is supplied", () => {
    const err = new KsaError("something went wrong");
    expect(err.message).toBe("something went wrong");
    expect(err.prefix).toBeUndefined();
  });

  it("keeps the original message available as rawMessage", () => {
    const err = new KsaError("secret key is missing", { prefix: "moyasar" });
    expect(err.rawMessage).toBe("secret key is missing");
  });

  it("retains the supplied stable code", () => {
    const err = new KsaError("bad options", {
      prefix: "tap",
      code: KsaErrorCodes.INVALID_OPTIONS,
    });
    expect(err.code).toBe(KsaErrorCodes.INVALID_OPTIONS);
  });

  it("defaults the code to 'unexpected' when none is given", () => {
    const err = new KsaError("boom");
    expect(err.code).toBe(KsaErrorCodes.UNEXPECTED);
  });

  it("passes the cause through to the standard Error.cause", () => {
    const root = new Error("network down");
    const err = new KsaError("request failed", {
      prefix: "tabby",
      code: KsaErrorCodes.HTTP_ERROR,
      cause: root,
    });
    expect(err.cause).toBe(root);
  });

  it("does not set a cause when none is provided", () => {
    const err = new KsaError("no cause here");
    expect(err.cause).toBeUndefined();
  });

  it("is an instance of Error and KsaError, and has the right name", () => {
    const err = new KsaError("x");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(KsaError);
    expect(err.name).toBe("KsaError");
  });

  it("recognizes its own instances via the static guard", () => {
    const err = new KsaError("x");
    expect(KsaError.isKsaError(err)).toBe(true);
  });

  it("recognizes a structurally-tagged object via the static guard", () => {
    const lookalike = { __isKsaError: true };
    expect(KsaError.isKsaError(lookalike)).toBe(true);
  });

  it("rejects non-KsaError values via the static guard", () => {
    expect(KsaError.isKsaError(new Error("plain"))).toBe(false);
    expect(KsaError.isKsaError(null)).toBe(false);
    expect(KsaError.isKsaError("string")).toBe(false);
    expect(KsaError.isKsaError(undefined)).toBe(false);
  });
});

describe("toMedusaError", () => {
  it("maps a KsaError to a MedusaError preserving the prefixed message", () => {
    const ksa = new KsaError("secret key is missing", {
      prefix: "moyasar",
      code: KsaErrorCodes.INVALID_OPTIONS,
    });
    const med = toMedusaError(ksa);
    expect(MedusaError.isMedusaError(med)).toBe(true);
    expect(med.message).toBe("[moyasar] secret key is missing");
  });

  it("retains the KsaError code on the MedusaError", () => {
    const ksa = new KsaError("bad", { code: KsaErrorCodes.PROVIDER_ERROR });
    const med = toMedusaError(ksa);
    expect(med.code).toBe(KsaErrorCodes.PROVIDER_ERROR);
  });

  it("maps invalid-options codes to INVALID_DATA", () => {
    const ksa = new KsaError("bad", { code: KsaErrorCodes.INVALID_OPTIONS });
    const med = toMedusaError(ksa);
    expect(med.type).toBe(MedusaError.Types.INVALID_DATA);
  });

  it("maps webhook verification failures to UNAUTHORIZED", () => {
    const ksa = new KsaError("bad sig", {
      code: KsaErrorCodes.WEBHOOK_VERIFICATION_FAILED,
    });
    const med = toMedusaError(ksa);
    expect(med.type).toBe(MedusaError.Types.UNAUTHORIZED);
  });

  it("maps encryption-key problems to INVALID_ARGUMENT", () => {
    const ksa = new KsaError("bad key", {
      code: KsaErrorCodes.INVALID_ENCRYPTION_KEY,
    });
    const med = toMedusaError(ksa);
    expect(med.type).toBe(MedusaError.Types.INVALID_ARGUMENT);
  });

  it("falls back to UNEXPECTED_STATE for an unknown code", () => {
    const ksa = new KsaError("weird", { code: "totally_custom_code" });
    const med = toMedusaError(ksa);
    expect(med.type).toBe(MedusaError.Types.UNEXPECTED_STATE);
  });

  it("chains the KsaError as the cause of the MedusaError", () => {
    const ksa = new KsaError("boom", { code: KsaErrorCodes.HTTP_ERROR });
    const med = toMedusaError(ksa);
    expect((med as { cause?: unknown }).cause).toBe(ksa);
  });

  it("maps a plain Error to an UNEXPECTED_STATE MedusaError", () => {
    const plain = new Error("kaboom");
    const med = toMedusaError(plain);
    expect(MedusaError.isMedusaError(med)).toBe(true);
    expect(med.type).toBe(MedusaError.Types.UNEXPECTED_STATE);
    expect(med.message).toBe("kaboom");
    expect(med.code).toBe(KsaErrorCodes.UNEXPECTED);
    expect((med as { cause?: unknown }).cause).toBe(plain);
  });

  it("returns an existing MedusaError unchanged", () => {
    const original = new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "missing",
      "not_found",
    );
    const med = toMedusaError(original);
    expect(med).toBe(original);
  });

  it("stringifies a non-Error value into an UNEXPECTED_STATE MedusaError", () => {
    const med = toMedusaError("just a string");
    expect(med.type).toBe(MedusaError.Types.UNEXPECTED_STATE);
    expect(med.message).toBe("just a string");
    expect(med.code).toBe(KsaErrorCodes.UNEXPECTED);
  });

  it("handles null/undefined with a generic message", () => {
    expect(toMedusaError(null).message).toBe("Unknown error");
    expect(toMedusaError(undefined).message).toBe("Unknown error");
  });
});
