import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";

import {
  STORE_RESPONSE_KEY,
} from "../../../../modules/saudi-address/constants.js";
import type {
  SaudiAddressValidateResult,
} from "../../../../modules/saudi-address/types.js";
import { resolveSaudiAddressService } from "../helpers.js";
import type { StoreSaudiAddressValidateBody } from "../validators.js";

interface StoreSaudiAddressValidateResponse {
  [STORE_RESPONSE_KEY.VALIDATION]: SaudiAddressValidateResult;
}

/** Structurally validate a Saudi city/district pair from the offline dataset. */
export async function POST(
  req: MedusaStoreRequest<StoreSaudiAddressValidateBody>,
  res: MedusaResponse<StoreSaudiAddressValidateResponse>,
): Promise<void> {
  const service = resolveSaudiAddressService(req);
  const validation = await service.validate(req.validatedBody);

  res.json({
    [STORE_RESPONSE_KEY.VALIDATION]: validation,
  });
}
