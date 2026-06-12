import { describe, expect, it } from "vitest";

import {
  LOCALE,
  STORE_FIELD,
} from "../../../modules/saudi-address/constants.js";
import {
  StoreSaudiAddressCitiesQuery,
  StoreSaudiAddressResolveBody,
  StoreSaudiAddressSearchQuery,
  StoreSaudiAddressValidateBody,
} from "./validators.js";

describe("Saudi Address Store API validators", () => {
  it("coerces the search limit and keeps the public query contract", () => {
    expect(
      StoreSaudiAddressSearchQuery.parse({
        [STORE_FIELD.QUERY]: "Riyadh",
        [STORE_FIELD.LOCALE]: LOCALE.EN,
        [STORE_FIELD.LIMIT]: "2",
      }),
    ).toEqual({
      [STORE_FIELD.QUERY]: "Riyadh",
      [STORE_FIELD.LOCALE]: LOCALE.EN,
      [STORE_FIELD.LIMIT]: 2,
    });
  });

  it("requires parent geography identifiers for dependent lists", () => {
    expect(() => StoreSaudiAddressCitiesQuery.parse({})).toThrow();
  });

  it("maps validation body fields to service input names", () => {
    expect(
      StoreSaudiAddressValidateBody.parse({
        [STORE_FIELD.CITY_CODE]: "3",
        [STORE_FIELD.DISTRICT_NAME]: "Olaya",
        [STORE_FIELD.LOCALE]: LOCALE.AR,
      }),
    ).toEqual({
      cityCode: "3",
      cityName: undefined,
      districtCode: undefined,
      districtName: "Olaya",
      locale: LOCALE.AR,
    });
  });

  it("maps the short-address resolve body without enabling SPL", () => {
    expect(
      StoreSaudiAddressResolveBody.parse({
        [STORE_FIELD.SHORT_ADDRESS]: "RRRD2929",
      }),
    ).toEqual({
      shortAddress: "RRRD2929",
    });
  });
});
