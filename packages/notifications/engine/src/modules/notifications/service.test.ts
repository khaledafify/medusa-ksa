import { describe, expect, it, vi } from "vitest";

import { CHANNEL, DEFAULT_LOCALE, EVENTS, LOCALES, TEMPLATE_KEY } from "./constants.js";
import type {
  NotificationTemplateDTO,
  NotificationTemplateFilters,
  NotificationTemplateResolverRepository,
} from "./types.js";
import { resolveNotificationTemplate } from "./service.js";

function template(
  input: Partial<NotificationTemplateDTO> = {},
): NotificationTemplateDTO {
  return {
    id: input.id ?? "ntpl_seeded_order_placed_ar",
    channel: input.channel ?? CHANNEL,
    event: input.event ?? EVENTS.ORDER_PLACED,
    locale: input.locale ?? LOCALES.AR,
    body: input.body ?? "seeded body",
    enabled: input.enabled ?? true,
    from: input.from ?? null,
  };
}

function makeRepository(
  templates: NotificationTemplateDTO[],
): NotificationTemplateResolverRepository & {
  listNotificationTemplates: ReturnType<typeof vi.fn>;
} {
  const rows = new Map(
    templates.map((row) => [
      TEMPLATE_KEY(row.channel, row.event, row.locale),
      row,
    ]),
  );
  const listNotificationTemplates = vi.fn(
    async (
      filters: NotificationTemplateFilters,
    ): Promise<NotificationTemplateDTO[]> => {
      const row = rows.get(
        TEMPLATE_KEY(filters.channel, filters.event, filters.locale),
      );
      return row ? [row] : [];
    },
  );
  return { listNotificationTemplates };
}

describe("resolveNotificationTemplate", () => {
  it("returns the seeded sms order.placed Arabic row", async () => {
    const seededPlacedTemplate = template();
    const repository = makeRepository([seededPlacedTemplate]);

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

  it("falls back to the default locale for an unknown locale", async () => {
    const seededPlacedTemplate = template({
      id: "ntpl_seeded_order_placed_default",
      locale: DEFAULT_LOCALE,
    });
    const repository = makeRepository([seededPlacedTemplate]);

    await expect(
      resolveNotificationTemplate(repository, {
        channel: CHANNEL,
        event: EVENTS.ORDER_PLACED,
        locale: "en",
      }),
    ).resolves.toEqual({
      status: "found",
      template: seededPlacedTemplate,
    });
    expect(repository.listNotificationTemplates).toHaveBeenNthCalledWith(
      1,
      {
        channel: CHANNEL,
        event: EVENTS.ORDER_PLACED,
        locale: "en",
      },
      { take: 1 },
    );
    expect(repository.listNotificationTemplates).toHaveBeenNthCalledWith(
      2,
      {
        channel: CHANNEL,
        event: EVENTS.ORDER_PLACED,
        locale: DEFAULT_LOCALE,
      },
      { take: 1 },
    );
  });

  it("signals skip when the resolved row is disabled", async () => {
    const disabledTemplate = template({ enabled: false });
    const repository = makeRepository([disabledTemplate]);

    await expect(
      resolveNotificationTemplate(repository, {
        channel: CHANNEL,
        event: EVENTS.ORDER_PLACED,
        locale: LOCALES.AR,
      }),
    ).resolves.toEqual({
      status: "disabled",
      template: disabledTemplate,
    });
  });

  it("returns missing when no exact or fallback row exists", async () => {
    const repository = makeRepository([]);

    await expect(
      resolveNotificationTemplate(repository, {
        channel: CHANNEL,
        event: EVENTS.ORDER_PLACED,
        locale: "en",
      }),
    ).resolves.toEqual({
      status: "missing",
      template: null,
    });
  });
});
