import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  API_RESPONSE_KEYS,
  HTTP_STATUS,
} from "../../../../modules/notifications/constants";
import {
  parseOrWriteBadRequest,
  renderStoredTemplatePreview,
  resolveNotificationTemplateService,
  templateNotFoundError,
  writeApiError,
} from "../helpers";
import { previewNotificationTemplateBodySchema } from "../validators";

/** Render a stored template against sample order data without sending. */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const body = parseOrWriteBadRequest(
    previewNotificationTemplateBodySchema,
    req.body,
    res,
  );
  if (!body) {
    return;
  }

  const service = resolveNotificationTemplateService(req);
  const template = await service.retrieveNotificationTemplate(body.id);
  if (!template) {
    writeApiError(res, HTTP_STATUS.NOT_FOUND, templateNotFoundError());
    return;
  }

  const { preview } = renderStoredTemplatePreview(template, body.order);

  res.json({ [API_RESPONSE_KEYS.PREVIEW]: preview });
}
