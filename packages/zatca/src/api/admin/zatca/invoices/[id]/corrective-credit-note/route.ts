import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { ZATCA_MODULE } from "../../../../../../modules/zatca";
import type ZatcaModuleService from "../../../../../../modules/zatca/service";

/**
 * Admin action exposed for S8 remediation. It returns the safe, non-mutating
 * action payload; automatic note creation stays intentionally manual until
 * the merchant reviews ZATCA's rejection reason.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const service: ZatcaModuleService = req.scope.resolve(ZATCA_MODULE);
  const { id } = req.params as { id: string };
  res.json(await service.getCorrectiveCreditNoteAction(id));
}
