import { Modules } from "@medusajs/framework/utils";
import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import { completeCartWorkflow } from "@medusajs/medusa/core-flows";

import {
  SAUDI_ADDRESS_MODULE,
  type SaudiAddressModuleService,
} from "../modules/saudi-address/index.js";
import {
  validateSaudiAddressForCheckout,
  type SaudiAddressCartModule,
  type SaudiAddressCheckoutCart,
} from "../modules/saudi-address/checkout.js";

interface CompleteCartValidateHookInput {
  cart: SaudiAddressCheckoutCart;
}

/**
 * Complete-cart hook handler. It writes the validation status onto cart
 * metadata before Medusa maps cart metadata into the new order.
 */
export async function handleSaudiAddressCompleteCartValidate(
  input: CompleteCartValidateHookInput,
  context: Pick<StepExecutionContext, "container">,
): Promise<void> {
  const service: SaudiAddressModuleService = context.container.resolve(
    SAUDI_ADDRESS_MODULE,
  );
  const cartModule: SaudiAddressCartModule = context.container.resolve(
    Modules.CART,
  );

  await validateSaudiAddressForCheckout({
    cart: input.cart,
    service,
    cartModule,
  });
}

export const saudiAddressCompleteCartValidationHook =
  completeCartWorkflow.hooks.validate(handleSaudiAddressCompleteCartValidate);
