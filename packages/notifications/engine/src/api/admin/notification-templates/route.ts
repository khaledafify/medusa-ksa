import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  API_RESPONSE_KEYS,
  CHANNEL,
  LOCALES,
} from "../../../modules/notifications/constants";
import type { CreateNotificationTemplateInput } from "../../../modules/notifications/types";
import {
  parseOrWriteBadRequest,
  resolveNotificationTemplateService,
  toTemplateFilters,
} from "./helpers";
import {
  createNotificationTemplateBodySchema,
  listNotificationTemplatesQuerySchema,
} from "./validators";

/** List notification templates, optionally filtered by channel/event/locale/enabled. */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const query = parseOrWriteBadRequest(
    listNotificationTemplatesQuerySchema,
    req.query ?? {},
    res,
  );
  if (!query) {
    return;
  }

  const service = resolveNotificationTemplateService(req);
  const templates = await service.listNotificationTemplates(
    toTemplateFilters(query),
  );

  res.json({ [API_RESPONSE_KEYS.TEMPLATES]: templates });
}

/** Create a merchant-editable notification template row. */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const body = parseOrWriteBadRequest(
    createNotificationTemplateBodySchema,
    req.body,
    res,
  );
  if (!body) {
    return;
  }

  const service = resolveNotificationTemplateService(req);
  const input = {
    channel: body.channel ?? CHANNEL,
    event: body.event,
    locale: body.locale ?? LOCALES.AR,
    body: body.body,
    enabled: body.enabled ?? true,
    from: body.from ?? null,
  } satisfies CreateNotificationTemplateInput;
  const template = await service.createNotificationTemplates(input);

  res.json({ [API_RESPONSE_KEYS.TEMPLATE]: template });
}
