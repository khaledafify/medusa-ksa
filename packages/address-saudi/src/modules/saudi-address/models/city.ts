import { model } from "@medusajs/framework/utils";

import { ID_PREFIX, TABLE } from "../constants.js";

/** Saudi city seeded from the GPL geography dependency. */
const SaudiAddressCity = model
  .define(TABLE.CITY, {
    id: model.id({ prefix: ID_PREFIX.CITY }).primaryKey(),
    code: model.text(),
    region_code: model.text(),
    name_ar: model.text(),
    name_en: model.text(),
    sort_weight: model.number().default(0),
  })
  .indexes([
    { on: ["code"], unique: true },
    { on: ["region_code"] },
    { on: ["region_code", "sort_weight", "name_en"] },
    { on: ["region_code", "sort_weight", "name_ar"] },
  ]);

export default SaudiAddressCity;
