import { describe, expect, it } from "vitest";

import * as providerModule from "./index.js";

describe("provider scaffold", () => {
  it("has an importable provider entrypoint for the documented resolve path", () => {
    expect(providerModule).toBeDefined();
  });
});
