import { z } from "@medusajs/framework/zod";

import {
  LOCALE,
  SEARCH_LIMIT,
  SHORT_ADDRESS_PATTERN,
  STORE_FIELD,
} from "../../../modules/saudi-address/constants.js";

const localeSchema = z.enum([LOCALE.AR, LOCALE.EN]).optional();
const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const limitSchema = z.coerce
  .number()
  .int()
  .min(SEARCH_LIMIT.MIN)
  .max(SEARCH_LIMIT.MAX)
  .optional();

/** Query contract for `GET /store/saudi-address/regions`. */
export const StoreSaudiAddressRegionsQuery = z.object({
  [STORE_FIELD.LOCALE]: localeSchema,
});

export type StoreSaudiAddressRegionsQuery = z.infer<
  typeof StoreSaudiAddressRegionsQuery
>;

/** Query contract for `GET /store/saudi-address/cities`. */
export const StoreSaudiAddressCitiesQuery = z.object({
  [STORE_FIELD.REGION_CODE]: nonEmptyString,
  [STORE_FIELD.LOCALE]: localeSchema,
});

export type StoreSaudiAddressCitiesQuery = z.infer<
  typeof StoreSaudiAddressCitiesQuery
>;

/** Query contract for `GET /store/saudi-address/districts`. */
export const StoreSaudiAddressDistrictsQuery = z.object({
  [STORE_FIELD.CITY_CODE]: nonEmptyString,
  [STORE_FIELD.LOCALE]: localeSchema,
});

export type StoreSaudiAddressDistrictsQuery = z.infer<
  typeof StoreSaudiAddressDistrictsQuery
>;

/** Query contract for `GET /store/saudi-address/search`. */
export const StoreSaudiAddressSearchQuery = z.object({
  [STORE_FIELD.QUERY]: nonEmptyString,
  [STORE_FIELD.LOCALE]: localeSchema,
  [STORE_FIELD.LIMIT]: limitSchema,
});

export type StoreSaudiAddressSearchQuery = z.infer<
  typeof StoreSaudiAddressSearchQuery
>;

/** Body contract for `POST /store/saudi-address/validate`. */
export const StoreSaudiAddressValidateBody = z
  .object({
    [STORE_FIELD.CITY_CODE]: optionalNonEmptyString,
    [STORE_FIELD.CITY_NAME]: optionalNonEmptyString,
    [STORE_FIELD.DISTRICT_CODE]: optionalNonEmptyString,
    [STORE_FIELD.DISTRICT_NAME]: optionalNonEmptyString,
    [STORE_FIELD.BUILDING_NUMBER]: optionalNonEmptyString,
    [STORE_FIELD.POST_CODE]: optionalNonEmptyString,
    [STORE_FIELD.ADDITIONAL_NUMBER]: optionalNonEmptyString,
    [STORE_FIELD.LOCALE]: localeSchema,
  })
  .transform((body) => ({
    cityCode: body[STORE_FIELD.CITY_CODE],
    cityName: body[STORE_FIELD.CITY_NAME],
    districtCode: body[STORE_FIELD.DISTRICT_CODE],
    districtName: body[STORE_FIELD.DISTRICT_NAME],
    buildingNumber: body[STORE_FIELD.BUILDING_NUMBER],
    postCode: body[STORE_FIELD.POST_CODE],
    additionalNumber: body[STORE_FIELD.ADDITIONAL_NUMBER],
    locale: body[STORE_FIELD.LOCALE],
  }));

export type StoreSaudiAddressValidateBody = z.output<
  typeof StoreSaudiAddressValidateBody
>;

/** Body contract for `POST /store/saudi-address/resolve`. */
export const StoreSaudiAddressResolveBody = z
  .object({
    [STORE_FIELD.SHORT_ADDRESS]: nonEmptyString
      .transform((value) => value.toUpperCase())
      .refine((value) => SHORT_ADDRESS_PATTERN.test(value)),
  })
  .transform((body) => ({
    shortAddress: body[STORE_FIELD.SHORT_ADDRESS],
  }));

export type StoreSaudiAddressResolveBody = z.output<
  typeof StoreSaudiAddressResolveBody
>;
