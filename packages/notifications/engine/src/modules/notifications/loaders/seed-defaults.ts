import type { LoaderOptions } from "@medusajs/types";

import { NOTIFICATIONS_MODULE } from "../constants";
import { seedDefaultNotificationTemplates } from "../seed/seed";
import type { NotificationTemplateSeedRepository } from "../types";

/**
 * Boot-time loader that self-seeds default templates inside the plugin.
 */
export default async function seedDefaultTemplatesLoader({
  container,
}: LoaderOptions): Promise<void> {
  const service =
    container.resolve<NotificationTemplateSeedRepository>(NOTIFICATIONS_MODULE);
  await seedDefaultNotificationTemplates(service);
}
