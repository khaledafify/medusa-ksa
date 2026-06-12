import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";

import {
  STORE_FIELD,
  STORE_RESPONSE_KEY,
} from "../../../../modules/saudi-address/constants.js";
import type {
  SaudiCityListItem,
} from "../../../../modules/saudi-address/types.js";
import { resolveSaudiAddressService } from "../helpers.js";
import type { StoreSaudiAddressCitiesQuery } from "../validators.js";

interface StoreSaudiAddressCitiesResponse {
  [STORE_RESPONSE_KEY.CITIES]: SaudiCityListItem[];
}

/** Return offline Saudi cities for a region, bilingual and locale-sorted. */
export async function GET(
  req: MedusaStoreRequest<unknown, StoreSaudiAddressCitiesQuery>,
  res: MedusaResponse<StoreSaudiAddressCitiesResponse>,
): Promise<void> {
  const service = resolveSaudiAddressService(req);
  const cities = await service.cities({
    regionCode: req.validatedQuery[STORE_FIELD.REGION_CODE],
    locale: req.validatedQuery[STORE_FIELD.LOCALE],
  });

  res.json({
    [STORE_RESPONSE_KEY.CITIES]: cities,
  });
}
