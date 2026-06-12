import type { MedusaStoreRequest } from "@medusajs/framework/http";

import {
  SAUDI_ADDRESS_MODULE,
  type SaudiAddressModuleService,
} from "../../../modules/saudi-address/index.js";

/** Resolve the Saudi Address module service from a Store API request scope. */
export function resolveSaudiAddressService(
  req: Pick<MedusaStoreRequest, "scope">,
): SaudiAddressModuleService {
  return req.scope.resolve(SAUDI_ADDRESS_MODULE);
}
