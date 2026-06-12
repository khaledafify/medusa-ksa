import { model } from "@medusajs/framework/utils";

import { ID_PREFIX, TABLE } from "../constants.js";

/** Cache rows for optional SPL National Address lookups. */
const SaudiAddressCache = model
  .define(TABLE.CACHE, {
    id: model.id({ prefix: ID_PREFIX.CACHE }).primaryKey(),
    cache_key: model.text(),
    query_type: model.text(),
    payload: model.json(),
    expires_at: model.dateTime(),
    stale_expires_at: model.dateTime(),
  })
  .indexes([
    { on: ["cache_key"], unique: true },
    { on: ["query_type"] },
    { on: ["expires_at"] },
    { on: ["stale_expires_at"] },
  ]);

export default SaudiAddressCache;
