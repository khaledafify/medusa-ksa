import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import { TorodFulfillmentProviderService } from "./service.js";

export * from "./client.js";
export * from "./constants.js";
export * from "./options.js";
export { TorodFulfillmentProviderService } from "./service.js";

/** Fulfillment-module provider registration for Medusa's native Shipping surface. */
export default ModuleProvider(Modules.FULFILLMENT, {
  services: [TorodFulfillmentProviderService],
});
