import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import { UnifonicNotificationProviderService } from "./service.js";

export * from "./constants.js";
export * from "./options.js";
export * from "./recipient.js";
export type * from "./types.js";
export { UnifonicClient } from "./client.js";
export { UnifonicNotificationProviderService } from "./service.js";

/** Notification-module provider registration for the Unifonic SMS provider. */
export default ModuleProvider(Modules.NOTIFICATION, {
  services: [UnifonicNotificationProviderService],
});
