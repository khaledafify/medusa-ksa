import { Module } from "@medusajs/framework/utils";

import { MODULE_NAME } from "./constants.js";
import validateConfigLoader from "./loaders/validate-config.js";
import SaudiAddressModuleService from "./service.js";

export { MODULE_NAME as SAUDI_ADDRESS_MODULE } from "./constants.js";
export { default as SaudiAddressModuleService } from "./service.js";
export * from "./constants.js";
export * from "./data.js";
export * from "./seed-sql.js";
export * from "./types.js";

export default Module(MODULE_NAME, {
  service: SaudiAddressModuleService,
  loaders: [validateConfigLoader],
});
