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
        [STORE_FIELD.BUILDING_NUMBER]: "8228",
        [STORE_FIELD.POST_CODE]: "12643",
        [STORE_FIELD.ADDITIONAL_NUMBER]: "2121",
        [STORE_FIELD.LOCALE]: LOCALE.AR,
      }),
    ).toEqual({
      cityCode: "3",
      cityName: undefined,
      districtCode: undefined,
      districtName: "Olaya",
      buildingNumber: "8228",
      postCode: "12643",
      additionalNumber: "2121",
      locale: LOCALE.AR,
    });
  });

  it("normalizes the short-address resolve body", () => {
    expect(
      StoreSaudiAddressResolveBody.parse({
        [STORE_FIELD.SHORT_ADDRESS]: "rrrd2929",
      }),
    ).toEqual({
      shortAddress: "RRRD2929",
    });
  });

  it("rejects malformed short-address values", () => {
    expect(() =>
      StoreSaudiAddressResolveBody.parse({
        [STORE_FIELD.SHORT_ADDRESS]: "bad",
      }),
    ).toThrow();
  });
});
