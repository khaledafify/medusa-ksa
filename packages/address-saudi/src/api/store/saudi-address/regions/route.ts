import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";

import {
  STORE_FIELD,
  STORE_RESPONSE_KEY,
} from "../../../../modules/saudi-address/constants.js";
import type {
  SaudiRegionListItem,
} from "../../../../modules/saudi-address/types.js";
import { resolveSaudiAddressService } from "../helpers.js";
import type { StoreSaudiAddressRegionsQuery } from "../validators.js";

interface StoreSaudiAddressRegionsResponse {
  [STORE_RESPONSE_KEY.REGIONS]: SaudiRegionListItem[];
}

/** Return offline Saudi regions, bilingual and Riyadh-first. */
export async function GET(
  req: MedusaStoreRequest<unknown, StoreSaudiAddressRegionsQuery>,
  res: MedusaResponse<StoreSaudiAddressRegionsResponse>,
): Promise<void> {
  const service = resolveSaudiAddressService(req);
  const regions = await service.regions({
    locale: req.validatedQuery[STORE_FIELD.LOCALE],
  });

  res.json({
    [STORE_RESPONSE_KEY.REGIONS]: regions,
  });
}
