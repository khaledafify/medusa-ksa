import { Module } from "@medusajs/framework/utils";

import { NOTIFICATIONS_MODULE } from "./constants";
import seedDefaultTemplatesLoader from "./loaders/seed-defaults";
import NotificationTemplateModuleService from "./service";

/**
 * Container registration key for the notification engine custom module.
 */
export const NOTIFICATION_ENGINE_MODULE = NOTIFICATIONS_MODULE;

export { default as NotificationTemplateModuleService } from "./service";
export * from "./constants";
export * from "./seed/defaults";
export * from "./seed/seed";
export type * from "./types";

export default Module(NOTIFICATIONS_MODULE, {
  service: NotificationTemplateModuleService,
  loaders: [seedDefaultTemplatesLoader],
});
