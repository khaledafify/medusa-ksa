import { describe, expect, it } from "vitest";

import provider, { MoyasarProviderService } from "./index.js";

describe("provider registration", () => {
  it("default-exports a payment ModuleProvider so the documented resolve path works", () => {
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("object");
  });

  it("re-exports the service under the moyasar identifier", () => {
    expect(MoyasarProviderService.identifier).toBe("moyasar");
  });
});
