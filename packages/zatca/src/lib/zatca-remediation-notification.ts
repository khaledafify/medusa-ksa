import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { ZATCA_MODULE } from "../modules/zatca";
import type ZatcaModuleService from "../modules/zatca/service";

export async function notifyZatcaRemediation(
  container: MedusaContainer,
  invoiceId: string,
): Promise<void> {
  const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  let notice: Awaited<ReturnType<ZatcaModuleService["getZatcaRemediationNotice"]>>;
  try {
    notice = await service.getZatcaRemediationNotice(invoiceId);
  } catch (error) {
    logger.error(`[zatca] invoice ${invoiceId} needs attention: ${String(error)}`);
    return;
  }

  logger.error(`[zatca] ${notice.message}`);
  try {
    const notification = container.resolve(Modules.NOTIFICATION);
    await notification.createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: {
        title: "ZATCA document needs attention",
        description: notice.message,
        invoice_id: notice.invoice_id,
        order_id: notice.order_id,
        action: notice.action,
        action_label: notice.action_label,
      },
    });
  } catch {
    // The error log above is the fallback when a feed provider is absent.
  }
}
