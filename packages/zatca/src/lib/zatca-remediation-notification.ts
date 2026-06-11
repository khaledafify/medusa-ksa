import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { ZATCA_MODULE } from "../modules/zatca";
import { ZATCA_LIFECYCLE_SOURCE_TYPE } from "../modules/zatca/lib/lifecycle";
import type { GenerateLifecycleDocumentInput } from "../modules/zatca/service";
import type ZatcaModuleService from "../modules/zatca/service";
import type { ReconciliationMismatchError } from "../modules/zatca/lib/tax-base";

const ZATCA_GENERATION_FAILURE_ACTION = {
  REVIEW_ORDER_TAX_TOTALS: "review_order_tax_totals",
} as const;

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

export async function notifyZatcaGenerationFailure(
  container: MedusaContainer,
  input: GenerateLifecycleDocumentInput,
  error: ReconciliationMismatchError,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const sourceType = input.sourceType ?? ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER;
  const sourceId = input.sourceId ?? input.orderId;
  const message =
    `Order ${input.orderId}: ZATCA document ${input.serialNumber} failed ` +
    `reconciliation before signing/reporting. Built total/tax ` +
    `${error.built.taxInclusiveHalalas}/${error.built.taxHalalas}; expected ` +
    `${error.expected.expectedTaxInclusiveHalalas}/${error.expected.expectedTaxHalalas}. ` +
    "The document was not reported and the order was not changed.";

  logger.error(`[zatca] ${message}`);
  try {
    const notification = container.resolve(Modules.NOTIFICATION);
    await notification.createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: {
        title: "ZATCA document failed reconciliation",
        description: message,
        order_id: input.orderId,
        source_type: sourceType,
        source_id: sourceId,
        action: ZATCA_GENERATION_FAILURE_ACTION.REVIEW_ORDER_TAX_TOTALS,
      },
    });
  } catch {
    // The error log above is the fallback when a feed provider is absent.
  }
}
