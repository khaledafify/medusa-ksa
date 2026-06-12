import { MedusaService } from "@medusajs/framework/utils";

import { DEFAULT_LOCALE } from "./constants";
import NotificationTemplate from "./models/notification-template";
import { seedDefaultNotificationTemplates } from "./seed/seed";
import type {
  NotificationTemplateResolution,
  ResolveNotificationTemplateInput,
  SeedNotificationTemplatesResult,
  NotificationTemplateResolverRepository,
} from "./types";

/**
 * Resolve a notification template from a repository-shaped dependency.
 */
export async function resolveNotificationTemplate(
  repository: NotificationTemplateResolverRepository,
  input: ResolveNotificationTemplateInput,
): Promise<NotificationTemplateResolution> {
  const [exact] = await repository.listNotificationTemplates(
    {
      channel: input.channel,
      event: input.event,
      locale: input.locale,
    },
    { take: 1 },
  );

  if (exact) {
    return exact.enabled
      ? { status: "found", template: exact }
      : { status: "disabled", template: exact };
  }

  if (input.locale !== DEFAULT_LOCALE) {
    return resolveNotificationTemplate(repository, {
      ...input,
      locale: DEFAULT_LOCALE,
    });
  }

  return { status: "missing", template: null };
}

/**
 * Module service for merchant-editable notification templates.
 */
class NotificationTemplateModuleService extends MedusaService({
  NotificationTemplate,
}) {
  /** Seed default templates without overwriting existing rows. */
  async seedDefaultTemplates(): Promise<SeedNotificationTemplatesResult> {
    return seedDefaultNotificationTemplates(this);
  }

  /** Resolve a template by channel, event, and locale. */
  async resolveTemplate(
    input: ResolveNotificationTemplateInput,
  ): Promise<NotificationTemplateResolution> {
    return resolveNotificationTemplate(this, input);
  }
}

export default NotificationTemplateModuleService;
