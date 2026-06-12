import { describe, expect, it, vi } from "vitest";

import { CHANNEL, EVENTS, LOCALES, TEMPLATE_KEY } from "../constants.js";
import type {
  CreateNotificationTemplateInput,
  NotificationTemplateDTO,
  NotificationTemplateFilters,
  NotificationTemplateSeedRepository,
} from "../types.js";
import { DEFAULT_NOTIFICATION_TEMPLATES } from "./defaults.js";
import { seedDefaultNotificationTemplates } from "./seed.js";

function persisted(
  input: CreateNotificationTemplateInput,
  id: string,
): NotificationTemplateDTO {
  return {
    id,
    channel: input.channel,
    event: input.event,
    locale: input.locale,
    body: input.body,
    enabled: input.enabled,
    from: input.from ?? null,
  };
}

function makeRepository(): {
  rows: Map<string, NotificationTemplateDTO>;
  repository: NotificationTemplateSeedRepository;
} {
  const rows = new Map<string, NotificationTemplateDTO>();
  const listNotificationTemplates = vi.fn(
    async (filters: NotificationTemplateFilters) => {
      const row = rows.get(
        TEMPLATE_KEY(filters.channel, filters.event, filters.locale),
      );
      return row ? [row] : [];
    },
  );
  const createNotificationTemplates = vi.fn(
    async (template: CreateNotificationTemplateInput) => {
      const row = persisted(template, `ntpl_${rows.size + 1}`);
      rows.set(TEMPLATE_KEY(row.channel, row.event, row.locale), row);
      return row;
    },
  );

  return {
    rows,
    repository: {
      listNotificationTemplates,
      createNotificationTemplates,
    },
  };
}

describe("seedDefaultNotificationTemplates", () => {
  it("creates missing defaults and returns their template keys", async () => {
    const { rows, repository } = makeRepository();

    const result = await seedDefaultNotificationTemplates(repository);

    expect(rows.size).toBe(DEFAULT_NOTIFICATION_TEMPLATES.length);
    expect(result.created).toEqual(
      DEFAULT_NOTIFICATION_TEMPLATES.map((template) =>
        TEMPLATE_KEY(template.channel, template.event, template.locale),
      ),
    );
    expect(result.skipped).toEqual([]);
  });

  it("is idempotent and never overwrites an edited row", async () => {
    const { rows, repository } = makeRepository();
    await seedDefaultNotificationTemplates(repository);
    const key = TEMPLATE_KEY(CHANNEL, EVENTS.ORDER_PLACED, LOCALES.AR);
    const existing = rows.get(key);
    expect(existing).toBeDefined();
    rows.set(key, {
      ...existing,
      body: "merchant edited body",
    } as NotificationTemplateDTO);

    const second = await seedDefaultNotificationTemplates(repository);

    expect(rows.size).toBe(DEFAULT_NOTIFICATION_TEMPLATES.length);
    expect(rows.get(key)?.body).toBe("merchant edited body");
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(
      DEFAULT_NOTIFICATION_TEMPLATES.map((template) =>
        TEMPLATE_KEY(template.channel, template.event, template.locale),
      ),
    );
  });
});
