import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";

import {
  STORE_FIELD,
  STORE_RESPONSE_KEY,
} from "../../../../modules/saudi-address/constants.js";
import type {
  SaudiDistrictListItem,
} from "../../../../modules/saudi-address/types.js";
import { resolveSaudiAddressService } from "../helpers.js";
import type { StoreSaudiAddressDistrictsQuery } from "../validators.js";

interface StoreSaudiAddressDistrictsResponse {
  [STORE_RESPONSE_KEY.DISTRICTS]: SaudiDistrictListItem[];
}

/** Return offline Saudi districts for a city, bilingual and locale-sorted. */
export async function GET(
  req: MedusaStoreRequest<unknown, StoreSaudiAddressDistrictsQuery>,
  res: MedusaResponse<StoreSaudiAddressDistrictsResponse>,
): Promise<void> {
  const service = resolveSaudiAddressService(req);
  const districts = await service.districts({
    cityCode: req.validatedQuery[STORE_FIELD.CITY_CODE],
    locale: req.validatedQuery[STORE_FIELD.LOCALE],
  });

  res.json({
    [STORE_RESPONSE_KEY.DISTRICTS]: districts,
  });
}
