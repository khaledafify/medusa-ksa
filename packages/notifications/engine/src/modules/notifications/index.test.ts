import { describe, expect, it } from "vitest";

import moduleDefinition, {
  NOTIFICATION_ENGINE_MODULE,
  NotificationTemplateModuleService,
} from "./index.js";
import { NOTIFICATIONS_MODULE } from "./constants.js";

describe("notification engine module registration", () => {
  it("uses the configured Medusa module key", () => {
    expect(NOTIFICATION_ENGINE_MODULE).toBe(NOTIFICATIONS_MODULE);
  });

  it("default-exports a Medusa module definition", () => {
    expect(moduleDefinition).toBeDefined();
    expect(typeof moduleDefinition).toBe("object");
  });

  it("exports the module service", () => {
    expect(NotificationTemplateModuleService).toBeDefined();
  });
});
