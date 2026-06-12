import { describe, expect, it, vi } from "vitest";

import { NOTIFICATIONS_MODULE } from "../constants.js";
import type {
  CreateNotificationTemplateInput,
  NotificationTemplateDTO,
  NotificationTemplateFilters,
  NotificationTemplateSeedRepository,
} from "../types.js";
import seedDefaultTemplatesLoader from "./seed-defaults.js";

describe("seedDefaultTemplatesLoader", () => {
  it("resolves the module service and seeds defaults", async () => {
    const createNotificationTemplates = vi.fn(
      async (
        template: CreateNotificationTemplateInput,
      ): Promise<NotificationTemplateDTO> => ({
        id: "ntpl_1",
        channel: template.channel,
        event: template.event,
        locale: template.locale,
        body: template.body,
        enabled: template.enabled,
        from: template.from ?? null,
      }),
    );
    const repository: NotificationTemplateSeedRepository = {
      listNotificationTemplates: vi.fn(
        async (_filters: NotificationTemplateFilters): Promise<
          NotificationTemplateDTO[]
        > => [],
      ),
      createNotificationTemplates,
    };
    const resolve = vi.fn(() => repository);

    await seedDefaultTemplatesLoader({
      container: { resolve },
    } as unknown as Parameters<typeof seedDefaultTemplatesLoader>[0]);

    expect(resolve).toHaveBeenCalledWith(NOTIFICATIONS_MODULE);
    expect(createNotificationTemplates).toHaveBeenCalledTimes(4);
  });
});
