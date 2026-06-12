import { model } from "@medusajs/framework/utils";

import { ID_PREFIX, TABLE } from "../constants.js";

/** Saudi region seeded from the GPL geography dependency. */
const SaudiAddressRegion = model
  .define(TABLE.REGION, {
    id: model.id({ prefix: ID_PREFIX.REGION }).primaryKey(),
    code: model.text(),
    name_ar: model.text(),
    name_en: model.text(),
    sort_weight: model.number().default(0),
    capital_city_code: model.text().nullable(),
    population: model.number().nullable(),
  })
  .indexes([
    { on: ["code"], unique: true },
    { on: ["sort_weight", "name_en"] },
    { on: ["sort_weight", "name_ar"] },
  ]);

export default SaudiAddressRegion;
