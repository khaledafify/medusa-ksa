import { Module } from "@medusajs/framework/utils";

import validateConfigLoader from "./loaders/validate-config";
import ZatcaModuleService from "./service";

/**
 * Container registration key. camelCase — dashes break Medusa's module
 * resolution.
 */
export const ZATCA_MODULE = "zatca";

export { default as ZatcaModuleService } from "./service";
export * from "./types";

export default Module(ZATCA_MODULE, {
  service: ZatcaModuleService,
  loaders: [validateConfigLoader],
});
