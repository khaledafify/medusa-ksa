import { MedusaService } from "@medusajs/framework/utils";

import { DEFAULT_LOCALE, TEMPLATE_RESOLUTION_STATUS } from "./constants";
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
      ? { status: TEMPLATE_RESOLUTION_STATUS.FOUND, template: exact }
      : { status: TEMPLATE_RESOLUTION_STATUS.DISABLED, template: exact };
  }

  if (input.locale !== DEFAULT_LOCALE) {
    return resolveNotificationTemplate(repository, {
      ...input,
      locale: DEFAULT_LOCALE,
    });
  }

  return { status: TEMPLATE_RESOLUTION_STATUS.MISSING, template: null };
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
  async resolve(
    channel: string,
    event: string,
    locale: string,
  ): Promise<NotificationTemplateResolution> {
    return resolveNotificationTemplate(this, { channel, event, locale });
  }

  /** Resolve a template from a structured input object. */
  async resolveTemplate(
    input: ResolveNotificationTemplateInput,
  ): Promise<NotificationTemplateResolution> {
    return this.resolve(input.channel, input.event, input.locale);
  }
}

export default NotificationTemplateModuleService;
