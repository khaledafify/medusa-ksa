import { describe, expect, it } from "vitest";

import {
  HTTP_METHOD,
  STORE_ROUTE,
} from "../../../modules/saudi-address/constants.js";
import middlewareConfig from "../../middlewares.js";

describe("Saudi Address Store API middlewares", () => {
  it("registers every Store API route with validation middleware", () => {
    expect(middlewareConfig.routes).toEqual([
      expect.objectContaining({
        methods: [HTTP_METHOD.GET],
        matcher: STORE_ROUTE.REGIONS,
        middlewares: [expect.any(Function)],
      }),
      expect.objectContaining({
        methods: [HTTP_METHOD.GET],
        matcher: STORE_ROUTE.CITIES,
        middlewares: [expect.any(Function)],
      }),
      expect.objectContaining({
        methods: [HTTP_METHOD.GET],
        matcher: STORE_ROUTE.DISTRICTS,
        middlewares: [expect.any(Function)],
      }),
      expect.objectContaining({
        methods: [HTTP_METHOD.GET],
        matcher: STORE_ROUTE.SEARCH,
        middlewares: [expect.any(Function)],
      }),
      expect.objectContaining({
        methods: [HTTP_METHOD.POST],
        matcher: STORE_ROUTE.VALIDATE,
        middlewares: [expect.any(Function)],
      }),
      expect.objectContaining({
        methods: [HTTP_METHOD.POST],
        matcher: STORE_ROUTE.RESOLVE,
        middlewares: [expect.any(Function)],
      }),
    ]);
  });
});
