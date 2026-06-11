import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { ZATCA_MODULE } from "../../../../../modules/zatca";
import type ZatcaModuleService from "../../../../../modules/zatca/service";

/**
 * `POST /admin/zatca/invoices/retry` — the wizard's "retry failed" action.
 * Re-attempts every terminally `failed` invoice; returns ids per outcome.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const service: ZatcaModuleService = req.scope.resolve(ZATCA_MODULE);
  res.json(await service.retryFailedZatcaInvoices());
}
