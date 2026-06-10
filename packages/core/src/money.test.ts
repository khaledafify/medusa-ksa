import { describe, expect, it } from "vitest";
import { KsaError } from "./errors.js";
import {
  assertSar,
  halalasToSar,
  sarToHalalas,
  type SarAmount,
} from "./money.js";

describe("sarToHalalas", () => {
  it("converts whole and simple decimal SAR to integer halalas", () => {
    expect(sarToHalalas(0)).toBe(0);
    expect(sarToHalalas(1)).toBe(100);
    expect(sarToHalalas(49.99)).toBe(4999);
    expect(sarToHalalas(0.01)).toBe(1);
    expect(sarToHalalas(10.5)).toBe(1050);
  });

  it("rounds the classic 1.005 floating-point vector half-up to 101", () => {
    // 1.005 * 100 === 100.49999999999999 in IEEE-754; naive Math.round gives 100.
    expect(sarToHalalas(1.005)).toBe(101);
    expect(sarToHalalas(2.005)).toBe(201);
  });

  it("rounds half-up generally", () => {
    expect(sarToHalalas(0.125)).toBe(13); // 12.5 halalas -> 13
    expect(sarToHalalas(0.124)).toBe(12);
  });

  it("returns 0 for 0 without error", () => {
    const result = sarToHalalas(0);
    expect(result).toBe(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("handles large values as integer halalas", () => {
    expect(sarToHalalas(1_000_000)).toBe(100_000_000);
    expect(sarToHalalas(9_999_999.99)).toBe(999_999_999);
  });

  it("always produces an integer", () => {
    for (const sar of [0, 0.01, 1.005, 49.99, 123.456, 1_000_000]) {
      expect(Number.isInteger(sarToHalalas(sar))).toBe(true);
    }
  });

  it("rejects NaN via KsaError", () => {
    expect(() => sarToHalalas(Number.NaN)).toThrow(KsaError);
    try {
      sarToHalalas(Number.NaN);
    } catch (err) {
      expect((err as KsaError).code).toBe("invalid_amount");
    }
  });

  it("rejects Infinity and -Infinity via KsaError", () => {
    expect(() => sarToHalalas(Number.POSITIVE_INFINITY)).toThrow(KsaError);
    expect(() => sarToHalalas(Number.NEGATIVE_INFINITY)).toThrow(KsaError);
  });

  it("rejects negative amounts via KsaError", () => {
    expect(() => sarToHalalas(-0.01)).toThrow(KsaError);
    expect(() => sarToHalalas(-100)).toThrow(KsaError);
    try {
      sarToHalalas(-5);
    } catch (err) {
      expect((err as KsaError).code).toBe("invalid_amount");
    }
  });

  it("rejects SAR amounts that convert beyond the safe integer range", () => {
    // MAX_SAFE_INTEGER halalas is the largest exactly-representable amount; one
    // SAR past it rounds to an unsafe integer and must be refused.
    const justTooBig = Number.MAX_SAFE_INTEGER / 100 + 1;
    expect(() => sarToHalalas(justTooBig)).toThrow(KsaError);
    try {
      sarToHalalas(justTooBig);
    } catch (err) {
      expect((err as KsaError).code).toBe("invalid_amount");
    }
  });

  it("accepts a large amount that still lands on a safe integer", () => {
    // ~9.007e13 SAR scales to ~9.007e15 halalas, just under MAX_SAFE_INTEGER —
    // proving the guard is inclusive on the safe side, not blanket-rejecting big values.
    const safeSar = 90_071_992_547_409;
    const result = sarToHalalas(safeSar);
    expect(Number.isSafeInteger(result)).toBe(true);
    expect(result).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it("only ever returns safe integers", () => {
    for (const sar of [0, 0.01, 1.005, 49.99, 123.456, 1_000_000, 9_999_999.99]) {
      expect(Number.isSafeInteger(sarToHalalas(sar))).toBe(true);
    }
  });
});

describe("halalasToSar", () => {
  it("divides halalas by 100", () => {
    expect(halalasToSar(4999 as SarAmount)).toBe(49.99);
    expect(halalasToSar(0 as SarAmount)).toBe(0);
    expect(halalasToSar(100 as SarAmount)).toBe(1);
    expect(halalasToSar(1 as SarAmount)).toBe(0.01);
  });

  it("round-trips with sarToHalalas for representable values", () => {
    for (const sar of [0, 1, 49.99, 1234.56]) {
      expect(halalasToSar(sarToHalalas(sar))).toBeCloseTo(sar, 10);
    }
  });
});

describe("assertSar", () => {
  it("accepts SAR in any case", () => {
    expect(() => assertSar("SAR")).not.toThrow();
    expect(() => assertSar("sar")).not.toThrow();
    expect(() => assertSar("Sar")).not.toThrow();
  });

  it("rejects any other currency via KsaError", () => {
    expect(() => assertSar("USD")).toThrow(KsaError);
    expect(() => assertSar("")).toThrow(KsaError);
    expect(() => assertSar("SARR")).toThrow(KsaError);
    try {
      assertSar("USD");
    } catch (err) {
      expect((err as KsaError).code).toBe("invalid_currency");
    }
  });
});
