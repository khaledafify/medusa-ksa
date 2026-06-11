import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { ZATCA_MODULE } from "../../../../modules/zatca";
import type ZatcaModuleService from "../../../../modules/zatca/service";

/**
 * `GET /admin/zatca/status` — the wizard's status banner. Returns the
 * non-secret status view only (ADR-0004: no credential field ever crosses an
 * API route).
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const service: ZatcaModuleService = req.scope.resolve(ZATCA_MODULE);
  res.json(await service.getOnboardingStatus());
}
