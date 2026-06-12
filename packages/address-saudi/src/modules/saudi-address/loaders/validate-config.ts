import { createLoader } from "@medusa-ksa/core";

import { MODULE_PREFIX } from "../constants.js";
import {
  SAUDI_ADDRESS_ENV_MAP,
  saudiAddressOptionsSchema,
} from "../types.js";

/**
 * Fail-fast module loader. The SPL key is optional, so a dataset-only install
 * boots with no National Address credentials.
 */
export default createLoader(saudiAddressOptionsSchema, {
  prefix: MODULE_PREFIX,
  envMap: SAUDI_ADDRESS_ENV_MAP,
});
