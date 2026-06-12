import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";

import {
  HTTP_STATUS,
  SPL_RESOLVE_DISABLED_MESSAGE,
  SPL_RESOLVE_STATUS,
  STORE_RESPONSE_KEY,
} from "../../../../modules/saudi-address/constants.js";
import type { StoreSaudiAddressResolveBody } from "../validators.js";

interface StoreSaudiAddressResolveDisabledResponse {
  [STORE_RESPONSE_KEY.RESOLVE]: {
    status: typeof SPL_RESOLVE_STATUS.DISABLED;
    message: typeof SPL_RESOLVE_DISABLED_MESSAGE;
  };
}

/**
 * Reserve the Store API resolve route. S6 replaces this disabled response with
 * the optional SPL adapter once verified and explicitly enabled by API key.
 */
export function POST(
  _req: MedusaStoreRequest<StoreSaudiAddressResolveBody>,
  res: MedusaResponse<StoreSaudiAddressResolveDisabledResponse>,
): void {
  res.status(HTTP_STATUS.NOT_IMPLEMENTED).json({
    [STORE_RESPONSE_KEY.RESOLVE]: {
      status: SPL_RESOLVE_STATUS.DISABLED,
      message: SPL_RESOLVE_DISABLED_MESSAGE,
    },
  });
}
