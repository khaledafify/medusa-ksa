import { MedusaService } from "@medusajs/framework/utils";

import ZatcaCredential from "./models/zatca-credential.js";
import ZatcaInvoice from "./models/zatca-invoice.js";

/**
 * Main module service. `MedusaService` auto-generates the CRUD surface for
 * both models (createZatcaInvoices, listZatcaCredentials, …).
 *
 * Orchestration (hash chain, signing, reporting) lives in the dedicated
 * services under ./services and in workflows — this class stays thin
 * (CRUD + credential encryption), per the module → workflow layering.
 */
class ZatcaModuleService extends MedusaService({
  ZatcaCredential,
  ZatcaInvoice,
}) {}

export default ZatcaModuleService;
