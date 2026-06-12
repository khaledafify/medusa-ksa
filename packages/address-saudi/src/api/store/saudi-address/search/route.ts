import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";

import {
  STORE_FIELD,
  STORE_RESPONSE_KEY,
} from "../../../../modules/saudi-address/constants.js";
import type {
  SaudiAddressSearchResult,
} from "../../../../modules/saudi-address/types.js";
import { resolveSaudiAddressService } from "../helpers.js";
import type { StoreSaudiAddressSearchQuery } from "../validators.js";

interface StoreSaudiAddressSearchResponse {
  [STORE_RESPONSE_KEY.RESULTS]: SaudiAddressSearchResult[];
}

/** Search the offline Saudi address geography dataset. */
export async function GET(
  req: MedusaStoreRequest<unknown, StoreSaudiAddressSearchQuery>,
  res: MedusaResponse<StoreSaudiAddressSearchResponse>,
): Promise<void> {
  const service = resolveSaudiAddressService(req);
  const results = await service.search({
    query: req.validatedQuery[STORE_FIELD.QUERY],
    limit: req.validatedQuery[STORE_FIELD.LIMIT],
    locale: req.validatedQuery[STORE_FIELD.LOCALE],
  });

  res.json({
    [STORE_RESPONSE_KEY.RESULTS]: results,
  });
}
