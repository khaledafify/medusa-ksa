import { describe, expect, it } from "vitest";

import moduleDefinition, {
  MODULE_NAME,
  SAUDI_ADDRESS_MODULE,
  SaudiAddressModuleService,
} from "./index.js";

describe("Saudi Address module registration", () => {
  it("uses the camelCase Medusa module key", () => {
    expect(MODULE_NAME).toBe("saudiAddress");
    expect(SAUDI_ADDRESS_MODULE).toBe(MODULE_NAME);
  });

  it("default-exports a Medusa module definition", () => {
    expect(moduleDefinition).toBeDefined();
    expect(typeof moduleDefinition).toBe("object");
  });

  it("exports the module service", () => {
    expect(SaudiAddressModuleService).toBeDefined();
  });
});
