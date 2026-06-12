import { describe, expect, it } from "vitest";

import provider, { UnifonicNotificationProviderService } from "./index.js";
import { PROVIDER_ID } from "./constants.js";

describe("Unifonic provider registration", () => {
  it("default-exports a notification ModuleProvider so the documented resolve path works", () => {
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("object");
  });

  it("re-exports the service under the unifonic identifier", () => {
    expect(UnifonicNotificationProviderService.identifier).toBe(PROVIDER_ID);
  });
});
