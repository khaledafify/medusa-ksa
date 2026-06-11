import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

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

  for (const invoiceId of result.failed) {
    logger.error(
      `[zatca] invoice ${invoiceId} outlived the 24h reporting window — ` +
        `marked failed. Issue a credit note and regenerate; the ICV is consumed.`,
    );
    try {
      const notification = container.resolve(Modules.NOTIFICATION);
      await notification.createNotifications({
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: {
          title: "ZATCA reporting failed",
          description: `Invoice ${invoiceId} could not be reported within the 24h window and was marked failed.`,
        },
      });
    } catch {
      // No feed notification provider installed — the error log above is the
      // loud fallback.
    }
  }
}

export const config = {
  name: "zatca-retry-reporting",
  schedule: "*/10 * * * *",
};
