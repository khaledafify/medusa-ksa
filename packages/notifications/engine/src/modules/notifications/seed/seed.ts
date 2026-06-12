import { TEMPLATE_KEY } from "../constants";
import type {
  CreateNotificationTemplateInput,
  NotificationTemplateSeedRepository,
  SeedNotificationTemplatesResult,
} from "../types";
import { DEFAULT_NOTIFICATION_TEMPLATES } from "./defaults";

/**
 * Idempotently seed the default notification templates.
 *
 * Existing rows are skipped by identity and never updated, preserving merchant
 * edits across app restarts and package upgrades.
 */
export async function seedDefaultNotificationTemplates(
  repository: NotificationTemplateSeedRepository,
  defaults: readonly CreateNotificationTemplateInput[] = DEFAULT_NOTIFICATION_TEMPLATES,
): Promise<SeedNotificationTemplatesResult> {
  const missing: CreateNotificationTemplateInput[] = [];
  const skipped: string[] = [];

  for (const template of defaults) {
    const [existing] = await repository.listNotificationTemplates(
      {
        channel: template.channel,
        event: template.event,
        locale: template.locale,
      },
      { take: 1 },
    );
    const key = TEMPLATE_KEY(template.channel, template.event, template.locale);
    if (existing) {
      skipped.push(key);
      continue;
    }
    missing.push(template);
  }

  for (const template of missing) {
    await repository.createNotificationTemplates(template);
  }

  return {
    created: missing.map((template) =>
      TEMPLATE_KEY(template.channel, template.event, template.locale),
    ),
    skipped,
  };
}
