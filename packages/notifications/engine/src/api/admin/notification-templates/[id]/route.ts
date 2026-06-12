import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  API_RESPONSE_KEYS,
  HTTP_STATUS,
} from "../../../../modules/notifications/constants";
import {
  parseOrWriteBadRequest,
  resolveNotificationTemplateService,
  templateNotFoundError,
  writeApiError,
} from "../helpers";
import {
  notificationTemplateParamsSchema,
  updateNotificationTemplateBodySchema,
} from "../validators";

/** Retrieve a single notification template by id. */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const params = parseOrWriteBadRequest(
    notificationTemplateParamsSchema,
    req.params,
    res,
  );
  if (!params) {
    return;
  }

  const service = resolveNotificationTemplateService(req);
  const template = await service.retrieveNotificationTemplate(params.id);
  if (!template) {
    writeApiError(res, HTTP_STATUS.NOT_FOUND, templateNotFoundError());
    return;
  }

  res.json({ [API_RESPONSE_KEYS.TEMPLATE]: template });
}

/** Update editable fields on a notification template. */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const params = parseOrWriteBadRequest(
    notificationTemplateParamsSchema,
    req.params,
    res,
  );
  const body = parseOrWriteBadRequest(
    updateNotificationTemplateBodySchema,
    req.body,
    res,
  );
  if (!params || !body) {
    return;
  }

  const service = resolveNotificationTemplateService(req);
  const [template] = await service.updateNotificationTemplates({
    selector: { id: params.id },
    data: body,
  });
  if (!template) {
    writeApiError(res, HTTP_STATUS.NOT_FOUND, templateNotFoundError());
    return;
  }

  res.json({ [API_RESPONSE_KEYS.TEMPLATE]: template });
}

/** Delete a notification template by id. */
export async function DELETE(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const params = parseOrWriteBadRequest(
    notificationTemplateParamsSchema,
    req.params,
    res,
  );
  if (!params) {
    return;
  }

  const service = resolveNotificationTemplateService(req);
  await service.deleteNotificationTemplates(params.id);

  res.json({ [API_RESPONSE_KEYS.TEMPLATE]: { id: params.id } });
}
