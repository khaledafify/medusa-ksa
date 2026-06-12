import { model } from "@medusajs/framework/utils";

import { ID_PREFIX, TABLE } from "../constants.js";

/** Saudi district seeded from the GPL geography dependency. */
const SaudiAddressDistrict = model
  .define(TABLE.DISTRICT, {
    id: model.id({ prefix: ID_PREFIX.DISTRICT }).primaryKey(),
    code: model.text(),
    city_code: model.text(),
    region_code: model.text(),
    name_ar: model.text(),
    name_en: model.text(),
    sort_weight: model.number().default(0),
  })
  .indexes([
    { on: ["code"], unique: true },
    { on: ["city_code"] },
    { on: ["region_code"] },
    { on: ["city_code", "sort_weight", "name_en"] },
    { on: ["city_code", "sort_weight", "name_ar"] },
  ]);

export default SaudiAddressDistrict;
