import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import { MoyasarProviderService } from "./service.js";

export * from "./types.js";
export { MoyasarClient } from "./client.js";
export { MoyasarProviderService, paymentIdForSession } from "./service.js";

/**
 * Payment-module provider registration. In `medusa-config.ts`:
 *
 * ```ts
 * {
 *   resolve: "@medusajs/payment",
 *   options: {
 *     providers: [
 *       { resolve: "medusa-payment-moyasar/providers/moyasar", id: "moyasar" },
 *     ],
 *   },
 * }
 * ```
 */
export default ModuleProvider(Modules.PAYMENT, {
  services: [MoyasarProviderService],
});
