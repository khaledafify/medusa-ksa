import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

import {
  API_RESPONSE_KEYS,
  API_TRIGGER_TYPES,
  ERROR_MESSAGES,
  HTTP_STATUS,
  SEND_TEST_SKIP_REASONS,
  SEND_TEST_STATUS,
  TABLES,
} from "../../../../modules/notifications/constants";
import {
  createSmsNotification,
  type OrderNotificationModule,
} from "../../../../subscribers/helpers/order-notification";
import {
  isLiveSendTestEnabled,
  parseOrWriteBadRequest,
  renderStoredTemplatePreview,
  resolveNotificationTemplateService,
  templateNotFoundError,
  writeApiError,
} from "../helpers";
import { sendTestNotificationTemplateBodySchema } from "../validators";

/** Create one SMS test notification from a stored template row. */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const body = parseOrWriteBadRequest(
    sendTestNotificationTemplateBodySchema,
    req.body,
    res,
  );
  if (!body) {
    return;
  }

  if (body.live && !isLiveSendTestEnabled()) {
    res.json({
      [API_RESPONSE_KEYS.STATUS]: SEND_TEST_STATUS.SKIPPED,
      [API_RESPONSE_KEYS.REASON]: SEND_TEST_SKIP_REASONS.LIVE_DISABLED,
      [API_RESPONSE_KEYS.ERROR]: {
        code: SEND_TEST_SKIP_REASONS.LIVE_DISABLED,
        message: ERROR_MESSAGES.LIVE_SEND_TEST_DISABLED,
      },
    });
    return;
  }

  const service = resolveNotificationTemplateService(req);
  const template = await service.retrieveNotificationTemplate(body.id);
  if (!template) {
    writeApiError(res, HTTP_STATUS.NOT_FOUND, templateNotFoundError());
    return;
  }

  const { context, preview } = renderStoredTemplatePreview(template, body.order);
  const notificationModule =
    req.scope.resolve<OrderNotificationModule>(Modules.NOTIFICATION);
  const notification = await createSmsNotification({
    notificationModule,
    to: body.to,
    from: template.from,
    templateId: template.id,
    text: preview.text,
    data: context,
    triggerType: API_TRIGGER_TYPES.SEND_TEST,
    resourceId: template.id,
    resourceType: TABLES.NOTIFICATION_TEMPLATE,
  });

  res.json({
    [API_RESPONSE_KEYS.STATUS]: SEND_TEST_STATUS.SENT,
    [API_RESPONSE_KEYS.PREVIEW]: preview,
    [API_RESPONSE_KEYS.NOTIFICATION]: notification,
  });
}
