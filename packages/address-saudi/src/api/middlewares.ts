import {
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http";

import {
  HTTP_METHOD,
  STORE_ROUTE,
} from "../modules/saudi-address/constants.js";
import {
  StoreSaudiAddressCitiesQuery,
  StoreSaudiAddressDistrictsQuery,
  StoreSaudiAddressRegionsQuery,
  StoreSaudiAddressResolveBody,
  StoreSaudiAddressSearchQuery,
  StoreSaudiAddressValidateBody,
} from "./store/saudi-address/validators.js";

const storeQueryConfig = {
  isList: false,
} as const;

export default defineMiddlewares({
  routes: [
    {
      methods: [HTTP_METHOD.GET],
      matcher: STORE_ROUTE.REGIONS,
      middlewares: [
        validateAndTransformQuery(
          StoreSaudiAddressRegionsQuery,
          storeQueryConfig,
        ),
      ],
    },
    {
      methods: [HTTP_METHOD.GET],
      matcher: STORE_ROUTE.CITIES,
      middlewares: [
        validateAndTransformQuery(
          StoreSaudiAddressCitiesQuery,
          storeQueryConfig,
        ),
      ],
    },
    {
      methods: [HTTP_METHOD.GET],
      matcher: STORE_ROUTE.DISTRICTS,
      middlewares: [
        validateAndTransformQuery(
          StoreSaudiAddressDistrictsQuery,
          storeQueryConfig,
        ),
      ],
    },
    {
      methods: [HTTP_METHOD.GET],
      matcher: STORE_ROUTE.SEARCH,
      middlewares: [
        validateAndTransformQuery(
          StoreSaudiAddressSearchQuery,
          storeQueryConfig,
        ),
      ],
    },
    {
      methods: [HTTP_METHOD.POST],
      matcher: STORE_ROUTE.VALIDATE,
      middlewares: [
        validateAndTransformBody(StoreSaudiAddressValidateBody),
      ],
    },
    {
      methods: [HTTP_METHOD.POST],
      matcher: STORE_ROUTE.RESOLVE,
      middlewares: [
        validateAndTransformBody(StoreSaudiAddressResolveBody),
      ],
    },
  ],
});
