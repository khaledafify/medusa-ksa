import { describe, expect, it, vi } from "vitest";

import { CHANNEL, EVENTS, LOCALES } from "./constants.js";
import type {
  NotificationTemplateDTO,
  NotificationTemplateFilters,
  NotificationTemplateResolverRepository,
} from "./types.js";
import { resolveNotificationTemplate } from "./service.js";

const seededPlacedTemplate: NotificationTemplateDTO = {
  id: "ntpl_seeded_order_placed_ar",
  channel: CHANNEL,
  event: EVENTS.ORDER_PLACED,
  locale: LOCALES.AR,
  body: "seeded body",
  enabled: true,
  from: null,
};

describe("resolveNotificationTemplate", () => {
  it("returns the seeded sms order.placed Arabic row", async () => {
    const repository: NotificationTemplateResolverRepository = {
      listNotificationTemplates: vi.fn(
        async (
          filters: NotificationTemplateFilters,
        ): Promise<NotificationTemplateDTO[]> =>
          filters.channel === CHANNEL &&
          filters.event === EVENTS.ORDER_PLACED &&
          filters.locale === LOCALES.AR
            ? [seededPlacedTemplate]
            : [],
      ),
    };

    await expect(
      resolveNotificationTemplate(repository, {
        channel: CHANNEL,
        event: EVENTS.ORDER_PLACED,
        locale: LOCALES.AR,
      }),
    ).resolves.toEqual({
      status: "found",
      template: seededPlacedTemplate,
    });
  });
});
