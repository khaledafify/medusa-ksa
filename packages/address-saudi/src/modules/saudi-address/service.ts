import { MedusaService } from "@medusajs/framework/utils";

import SaudiAddressCity from "./models/city.js";
import SaudiAddressDistrict from "./models/district.js";
import SaudiAddressRegion from "./models/region.js";

/**
 * Saudi Address module service. `MedusaService` provides CRUD methods for the
 * seeded geography tables; domain list/search/validation methods are layered
 * on top in later slices.
 */
class SaudiAddressModuleService extends MedusaService({
  SaudiAddressRegion,
  SaudiAddressCity,
  SaudiAddressDistrict,
}) {}

export default SaudiAddressModuleService;
