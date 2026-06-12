import { describe, expect, it } from "vitest";
import { Modules } from "@medusajs/framework/utils";

import provider, { TorodFulfillmentProviderService } from "./index.js";
import { PROVIDER_ID } from "./constants.js";

describe("provider registration", () => {
  it("default-exports a fulfillment ModuleProvider for the documented resolve path", () => {
    expect(provider).toBeDefined();
    expect(provider.module).toBe(Modules.FULFILLMENT);
    expect(provider.services).toContain(TorodFulfillmentProviderService);
  });

  it("re-exports the service under the torod identifier", () => {
    expect(TorodFulfillmentProviderService.identifier).toBe(PROVIDER_ID);
  });
});
