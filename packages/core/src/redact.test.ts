import { describe, expect, it } from "vitest";

import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("replaces a single secret occurrence with ***", () => {
    expect(redactSecrets("token=sk_live_abc123", ["sk_live_abc123"])).toBe(
      "token=***",
    );
  });

  it("replaces every occurrence of a repeated secret", () => {
    expect(
      redactSecrets("key sk_live_x then again sk_live_x end", ["sk_live_x"]),
    ).toBe("key *** then again *** end");
  });

  it("redacts multiple distinct secrets in the same string", () => {
    const out = redactSecrets(
      "auth=sk_live_abc webhook=whsec_def payload=ok",
      ["sk_live_abc", "whsec_def"],
    );
    expect(out).toBe("auth=*** webhook=*** payload=ok");
    expect(out).not.toContain("sk_live_abc");
    expect(out).not.toContain("whsec_def");
  });

  it("ignores undefined and empty-string secrets", () => {
    const out = redactSecrets("nothing-to-hide here", [
      undefined,
      "",
      undefined,
    ]);
    expect(out).toBe("nothing-to-hide here");
  });

  it("masks real secrets while skipping undefined/empty entries in the same list", () => {
    expect(
      redactSecrets("a=secret123 b=keep", [undefined, "secret123", ""]),
    ).toBe("a=*** b=keep");
  });

  it("redacts a secret that appears as a partial substring of a larger token", () => {
    // The secret is embedded inside a longer surrounding string; it must still
    // be masked wherever it occurs.
    expect(redactSecrets("prefix_SECRET_suffix", ["SECRET"])).toBe(
      "prefix_***_suffix",
    );
  });

  it("treats secrets literally, not as regex patterns", () => {
    const secret = "a.b+c(d)$e?";
    const out = redactSecrets(`value=${secret} other=axbxc`, [secret]);
    expect(out).toBe("value=*** other=axbxc");
    // The regex-special secret must not accidentally match 'axbxc'.
    expect(out).toContain("axbxc");
  });

  it("fully masks an overlapping secret that contains another secret", () => {
    // 'sk_live_abc' contains 'abc'; longest-first ordering must mask the full
    // secret rather than leaving 'sk_live_***'.
    const out = redactSecrets("token=sk_live_abc", ["abc", "sk_live_abc"]);
    expect(out).toBe("token=***");
    expect(out).not.toContain("sk_live_");
  });

  it("returns the input unchanged when no secrets are provided", () => {
    expect(redactSecrets("plain text", [])).toBe("plain text");
  });

  it("leaves no secret fragment behind after redaction", () => {
    const secrets = ["sk_test_DEADBEEF", "bearer-TOKEN-99"];
    const out = redactSecrets(
      "Authorization: bearer-TOKEN-99; key=sk_test_DEADBEEF",
      secrets,
    );
    for (const s of secrets) {
      expect(out).not.toContain(s);
    }
    expect(out).toBe("Authorization: ***; key=***");
  });
});
