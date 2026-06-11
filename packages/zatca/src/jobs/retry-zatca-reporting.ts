import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { notifyZatcaRemediation } from "../lib/zatca-remediation-notification";
import { ZATCA_MODULE } from "../modules/zatca";
import type ZatcaModuleService from "../modules/zatca/service";

/**
 * `retry-reporting` scheduled job (S6): drives the deferred reporting engine
 * every 10 minutes. Claims are `SKIP LOCKED`, so overlapping runs (or
 * multiple instances) never double-report. Terminal failures (invoices that
 * outlived the 24h window) raise an admin **feed** notification — loud
 * failure is a feature; the order is never affected.
 */
export default async function retryZatcaReporting(
  container: MedusaContainer,
): Promise<void> {
  const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const result = await service.processPendingZatcaReports();

  const touched =
    result.reported.length + result.rejected.length +
    result.failed.length + result.errored.length;
  if (touched > 0) {
    logger.info(
      `[zatca] retry-reporting: reported=${result.reported.length} ` +
        `rejected=${result.rejected.length} failed=${result.failed.length} ` +
        `errored=${result.errored.length} skipped=${result.skipped.length}`,
    );
  }

  for (const invoiceId of [...result.rejected, ...result.failed]) {
    await notifyZatcaRemediation(container, invoiceId);
  }
}

export const config = {
  name: "zatca-retry-reporting",
  schedule: "*/10 * * * *",
};
