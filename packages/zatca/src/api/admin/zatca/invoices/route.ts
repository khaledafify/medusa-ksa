import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { ZATCA_MODULE } from "../../../../modules/zatca";
import type ZatcaModuleService from "../../../../modules/zatca/service";

/**
 * `GET /admin/zatca/invoices` — the wizard dashboard: invoice counts by
 * status. Counts only; never invoice XML or any credential field.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const service: ZatcaModuleService = req.scope.resolve(ZATCA_MODULE);
  res.json(await service.getZatcaInvoiceSummary());
}
