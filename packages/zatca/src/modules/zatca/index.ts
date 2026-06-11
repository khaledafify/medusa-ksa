import { Module } from "@medusajs/framework/utils";

import ZatcaModuleService from "./service.js";

/**
 * Container registration key. camelCase — dashes break Medusa's module
 * resolution.
 */
export const ZATCA_MODULE = "zatca";

export { default as ZatcaModuleService } from "./service.js";
export * from "./types.js";

export default Module(ZATCA_MODULE, {
  service: ZatcaModuleService,
});
