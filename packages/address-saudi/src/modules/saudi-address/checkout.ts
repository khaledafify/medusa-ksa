import {
  KsaError,
  KsaErrorCodes,
  toMedusaError,
} from "@medusa-ksa/core";

import {
  ADDRESS_METADATA_KEY,
  ADDRESS_STATUS,
  CART_FIELD,
  MODULE_PREFIX,
  ORDER_METADATA_KEY,
  SHIPPING_ADDRESS_FIELD,
  STRICT_CHECKOUT_VALIDATION_MESSAGE,
} from "./constants.js";
import type {
  AddressValidationStatus,
  SaudiAddressValidateInput,
  SaudiAddressValidateResult,
} from "./types.js";

type CheckoutStatus = AddressValidationStatus;

export interface SaudiAddressCheckoutShippingAddress {
  [SHIPPING_ADDRESS_FIELD.CITY]?: string | null;
  [SHIPPING_ADDRESS_FIELD.PROVINCE]?: string | null;
  [SHIPPING_ADDRESS_FIELD.METADATA]?: Record<string, unknown> | null;
}

export interface SaudiAddressCheckoutCart {
  [CART_FIELD.ID]: string;
  [CART_FIELD.METADATA]?: Record<string, unknown> | null;
  [CART_FIELD.SHIPPING_ADDRESS]?: SaudiAddressCheckoutShippingAddress | null;
}

export interface SaudiAddressCheckoutService {
  validate: (
    input: SaudiAddressValidateInput,
  ) => Promise<SaudiAddressValidateResult>;
  isStrict: () => boolean;
}

export interface SaudiAddressCartUpdate {
  [CART_FIELD.ID]: string;
  [CART_FIELD.METADATA]: Record<string, unknown>;
}

export interface SaudiAddressCartModule {
  updateCarts: (input: SaudiAddressCartUpdate[]) => Promise<unknown>;
}

export interface SaudiAddressCheckoutInput {
  cart: SaudiAddressCheckoutCart;
  service: SaudiAddressCheckoutService;
  cartModule: SaudiAddressCartModule;
}

function nonBlank(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function stringMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  return nonBlank(metadata?.[key]);
}

/** Convert Medusa shipping-address fields into structural validation input. */
export function validationInputFromShippingAddress(
  address: SaudiAddressCheckoutShippingAddress | null | undefined,
): SaudiAddressValidateInput | undefined {
  if (!address) {
    return undefined;
  }

  const metadata = address[SHIPPING_ADDRESS_FIELD.METADATA];
  return {
    cityCode: stringMetadata(metadata, ADDRESS_METADATA_KEY.CITY_CODE),
    districtCode: stringMetadata(
      metadata,
      ADDRESS_METADATA_KEY.DISTRICT_CODE,
    ),
    cityName: nonBlank(address[SHIPPING_ADDRESS_FIELD.CITY]),
    districtName: nonBlank(address[SHIPPING_ADDRESS_FIELD.PROVINCE]),
  };
}

function statusMetadata(
  metadata: Record<string, unknown> | null | undefined,
  status: CheckoutStatus,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    [ORDER_METADATA_KEY]: status,
  };
}

async function writeStatusToCart(
  cartModule: SaudiAddressCartModule,
  cart: SaudiAddressCheckoutCart,
  status: CheckoutStatus,
): Promise<void> {
  const metadata = statusMetadata(cart[CART_FIELD.METADATA], status);
  cart[CART_FIELD.METADATA] = metadata;
  await cartModule.updateCarts([
    {
      [CART_FIELD.ID]: cart[CART_FIELD.ID],
      [CART_FIELD.METADATA]: metadata,
    },
  ]);
}

async function resolveCheckoutStatus(
  cart: SaudiAddressCheckoutCart,
  service: SaudiAddressCheckoutService,
): Promise<CheckoutStatus> {
  const validationInput = validationInputFromShippingAddress(
    cart[CART_FIELD.SHIPPING_ADDRESS],
  );
  if (validationInput === undefined) {
    return ADDRESS_STATUS.UNCHECKED;
  }

  try {
    const validation = await service.validate(validationInput);
    return validation.status;
  } catch {
    return ADDRESS_STATUS.UNCHECKED;
  }
}

function strictInvalidAddressError(): Error {
  return toMedusaError(
    new KsaError(STRICT_CHECKOUT_VALIDATION_MESSAGE, {
      prefix: MODULE_PREFIX,
      code: KsaErrorCodes.INVALID_INPUT,
    }),
  );
}

/**
 * Validate a completing cart's shipping address and persist the advisory flag.
 *
 * The complete-cart workflow copies cart metadata into the order payload, so
 * the hook writes the status to cart metadata before order creation.
 */
export async function validateSaudiAddressForCheckout(
  input: SaudiAddressCheckoutInput,
): Promise<CheckoutStatus> {
  const status = await resolveCheckoutStatus(input.cart, input.service);
  if (input.service.isStrict() && status === ADDRESS_STATUS.UNVALIDATED) {
    throw strictInvalidAddressError();
  }

  await writeStatusToCart(input.cartModule, input.cart, status);
  return status;
}
