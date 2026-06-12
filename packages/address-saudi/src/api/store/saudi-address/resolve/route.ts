import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";

import {
  HTTP_STATUS,
  SPL_RESOLVE_STATUS,
  STORE_RESPONSE_KEY,
} from "../../../../modules/saudi-address/constants.js";
import type { SaudiAddressResolveResult } from "../../../../modules/saudi-address/types.js";
import { resolveSaudiAddressService } from "../helpers.js";
import type { StoreSaudiAddressResolveBody } from "../validators.js";

interface StoreSaudiAddressResolveResponse {
  [STORE_RESPONSE_KEY.RESOLVE]: SaudiAddressResolveResult;
}

/** Resolve a Saudi short address when the optional SPL adapter is enabled. */
export async function POST(
  req: MedusaStoreRequest<StoreSaudiAddressResolveBody>,
  res: MedusaResponse<StoreSaudiAddressResolveResponse>,
): Promise<void> {
  const service = resolveSaudiAddressService(req);
  const resolve = await service.resolveShortAddress(req.validatedBody);
  if (resolve.status === SPL_RESOLVE_STATUS.DISABLED) {
    res.status(HTTP_STATUS.NOT_IMPLEMENTED);
  }
  res.json({
    [STORE_RESPONSE_KEY.RESOLVE]: resolve,
  });
}
