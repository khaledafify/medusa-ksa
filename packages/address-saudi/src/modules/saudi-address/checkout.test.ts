import { describe, expect, it, vi } from "vitest";

import {
  ADDRESS_METADATA_KEY,
  ADDRESS_STATUS,
  CART_FIELD,
  LOCALE,
  ORDER_METADATA_KEY,
  SHIPPING_ADDRESS_FIELD,
  STRICT_CHECKOUT_VALIDATION_MESSAGE,
  VALIDATION_REASON,
} from "./constants.js";
import {
  validateSaudiAddressForCheckout,
  validationInputFromShippingAddress,
  type SaudiAddressCartModule,
  type SaudiAddressCheckoutCart,
  type SaudiAddressCheckoutService,
} from "./checkout.js";

function checkoutService(
  strict: boolean,
  status: typeof ADDRESS_STATUS.VALID | typeof ADDRESS_STATUS.UNVALIDATED,
): SaudiAddressCheckoutService {
  return {
    isStrict: () => strict,
    validate: vi.fn(async () => ({
      status,
      reason:
        status === ADDRESS_STATUS.UNVALIDATED
          ? VALIDATION_REASON.DISTRICT_CITY_MISMATCH
          : undefined,
    })),
  };
}

function failingService(strict: boolean): SaudiAddressCheckoutService {
  return {
    isStrict: () => strict,
    validate: vi.fn(async () => {
      throw new Error("SPL unavailable");
    }),
  };
}

function cartModule(): SaudiAddressCartModule {
  return {
    updateCarts: vi.fn(async () => []),
  };
}

function cart(metadata: Record<string, unknown> = {}): SaudiAddressCheckoutCart {
  return {
    [CART_FIELD.ID]: "cart_123",
    [CART_FIELD.METADATA]: metadata,
    [CART_FIELD.SHIPPING_ADDRESS]: {
      [SHIPPING_ADDRESS_FIELD.CITY]: "Riyadh",
      [SHIPPING_ADDRESS_FIELD.PROVINCE]: "Olaya",
    },
  };
}

describe("Saudi Address checkout validation", () => {
  it("maps Medusa shipping fields and optional metadata codes to validation input", () => {
    expect(
      validationInputFromShippingAddress({
        [SHIPPING_ADDRESS_FIELD.CITY]: " Riyadh ",
        [SHIPPING_ADDRESS_FIELD.PROVINCE]: " Olaya ",
        [SHIPPING_ADDRESS_FIELD.METADATA]: {
          [ADDRESS_METADATA_KEY.CITY_CODE]: "3",
          [ADDRESS_METADATA_KEY.DISTRICT_CODE]: "101",
          [ADDRESS_METADATA_KEY.BUILDING_NUMBER]: "8228",
          [ADDRESS_METADATA_KEY.POST_CODE]: "12643",
          [ADDRESS_METADATA_KEY.ADDITIONAL_NUMBER]: "2121",
        },
      }),
    ).toEqual({
      cityCode: "3",
      districtCode: "101",
      buildingNumber: "8228",
      postCode: "12643",
      additionalNumber: "2121",
      cityName: "Riyadh",
      districtName: "Olaya",
    });
  });

  it("warn mode flags an unvalidated address and allows checkout", async () => {
    const completingCart = cart({ channel: "store" });
    const module = cartModule();

    await expect(
      validateSaudiAddressForCheckout({
        cart: completingCart,
        service: checkoutService(false, ADDRESS_STATUS.UNVALIDATED),
        cartModule: module,
      }),
    ).resolves.toBe(ADDRESS_STATUS.UNVALIDATED);

    expect(module.updateCarts).toHaveBeenCalledWith([
      {
        [CART_FIELD.ID]: "cart_123",
        [CART_FIELD.METADATA]: {
          channel: "store",
          [ORDER_METADATA_KEY]: ADDRESS_STATUS.UNVALIDATED,
        },
      },
    ]);
    expect(completingCart[CART_FIELD.METADATA]?.[ORDER_METADATA_KEY]).toBe(
      ADDRESS_STATUS.UNVALIDATED,
    );
  });

  it("strict mode blocks a genuinely invalid structural result", async () => {
    const module = cartModule();

    await expect(
      validateSaudiAddressForCheckout({
        cart: cart(),
        service: checkoutService(true, ADDRESS_STATUS.UNVALIDATED),
        cartModule: module,
      }),
    ).rejects.toThrow(STRICT_CHECKOUT_VALIDATION_MESSAGE);

    expect(module.updateCarts).not.toHaveBeenCalled();
  });

  it("strict mode still flags and allows an upstream outage", async () => {
    const completingCart = cart();
    const module = cartModule();

    await expect(
      validateSaudiAddressForCheckout({
        cart: completingCart,
        service: failingService(true),
        cartModule: module,
      }),
    ).resolves.toBe(ADDRESS_STATUS.UNCHECKED);

    expect(module.updateCarts).toHaveBeenCalledWith([
      {
        [CART_FIELD.ID]: "cart_123",
        [CART_FIELD.METADATA]: {
          [ORDER_METADATA_KEY]: ADDRESS_STATUS.UNCHECKED,
        },
      },
    ]);
  });

  it("writes valid status in strict mode for a consistent address", async () => {
    const completingCart = cart({ locale: LOCALE.EN });
    const module = cartModule();

    await expect(
      validateSaudiAddressForCheckout({
        cart: completingCart,
        service: checkoutService(true, ADDRESS_STATUS.VALID),
        cartModule: module,
      }),
    ).resolves.toBe(ADDRESS_STATUS.VALID);

    expect(module.updateCarts).toHaveBeenCalledWith([
      {
        [CART_FIELD.ID]: "cart_123",
        [CART_FIELD.METADATA]: {
          locale: LOCALE.EN,
          [ORDER_METADATA_KEY]: ADDRESS_STATUS.VALID,
        },
      },
    ]);
  });
});
