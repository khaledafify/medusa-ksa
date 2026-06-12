import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { validateOptions, KsaError, KsaErrorCodes } from "@medusa-ksa/core";
import { z } from "zod";

import {
  API_RESPONSE_KEYS,
  CURRENCY,
  ENV_VALUES,
  ERROR_MESSAGES,
  HTTP_STATUS,
  NOTIFICATIONS_MODULE,
  SAMPLE_ORDER,
  SEND_TEST_ENV,
} from "../../../modules/notifications/constants";
import { buildOrderRenderContext } from "../../../modules/notifications/render/context";
import type { NotificationOrderInput } from "../../../modules/notifications/render/context";
import { NotificationRenderEngine } from "../../../modules/notifications/render/engine";
import type {
  CreateNotificationTemplateInput,
  NotificationTemplateDTO,
  NotificationTemplateFilters,
  UpdateNotificationTemplateInput,
} from "../../../modules/notifications/types";
import type { ListNotificationTemplatesQuery } from "./validators";

type RawListNotificationTemplatesQuery = Omit<
  ListNotificationTemplatesQuery,
  "enabled"
> & {
  enabled?: boolean | "true" | "false";
};

/** JSON error shape returned by admin API routes. */
export interface NotificationTemplateApiErrorResponse {
  [API_RESPONSE_KEYS.ERROR]: {
    code: string;
    message: string;
  };
}

/** Module service subset consumed by notification template API routes. */
export interface NotificationTemplateApiService {
  listNotificationTemplates(
    filters?: Partial<NotificationTemplateFilters>,
  ): Promise<NotificationTemplateDTO[]>;
  createNotificationTemplates(
    data: CreateNotificationTemplateInput,
  ): Promise<NotificationTemplateDTO>;
  retrieveNotificationTemplate(
    id: string,
  ): Promise<NotificationTemplateDTO | null>;
  updateNotificationTemplates(data: {
    selector: { id: string };
    data: UpdateNotificationTemplateInput;
  }): Promise<NotificationTemplateDTO[]>;
  deleteNotificationTemplates(id: string): Promise<void>;
}

/** Rendered preview response shape returned by preview and send-test helpers. */
export interface NotificationTemplatePreview {
  template_id: string;
  text: string;
  segments: ReturnType<NotificationRenderEngine["render"]>["segments"];
  warnings: ReturnType<NotificationRenderEngine["render"]>["warnings"];
}

/** Resolve the notification-template module service from an admin request. */
export function resolveNotificationTemplateService(
  req: Pick<MedusaRequest, "scope">,
): NotificationTemplateApiService {
  return req.scope.resolve(NOTIFICATIONS_MODULE);
}

/** Convert a parsed list query to service filters. */
export function toTemplateFilters(
  query: RawListNotificationTemplatesQuery,
): Partial<NotificationTemplateFilters> {
  const enabled =
    query.enabled === "true"
      ? true
      : query.enabled === "false"
        ? false
        : query.enabled;
  return Object.fromEntries(
    Object.entries({ ...query, enabled }).filter(
      ([, value]) => value !== undefined,
    ),
  );
}

/** Parse route input and write a 400 response on validation failure. */
export function parseOrWriteBadRequest<T>(
  schema: z.ZodType<T>,
  value: unknown,
  res: MedusaResponse,
): T | null {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  writeApiError(
    res,
    HTTP_STATUS.BAD_REQUEST,
    new KsaError(formatValidationMessage(result.error), {
      prefix: NOTIFICATIONS_MODULE,
      code: KsaErrorCodes.INVALID_INPUT,
      cause: result.error,
    }),
  );
  return null;
}

/** Write a normalized API error response. */
export function writeApiError(
  res: MedusaResponse,
  status: number,
  error: KsaError,
): void {
  res.status(status).json({
    [API_RESPONSE_KEYS.ERROR]: {
      code: error.code,
      message: error.message,
    },
  } satisfies NotificationTemplateApiErrorResponse);
}

/** Build the deterministic sample order used for previews and test sends. */
export function buildTemplateSampleOrder(
  input: Partial<NotificationOrderInput> = {},
): NotificationOrderInput {
  return {
    id: input.id ?? SAMPLE_ORDER.ID,
    display_id: input.display_id ?? SAMPLE_ORDER.DISPLAY_ID,
    total: input.total ?? SAMPLE_ORDER.TOTAL,
    currency_code: input.currency_code ?? CURRENCY.SAR,
    created_at: input.created_at ?? SAMPLE_ORDER.CREATED_AT,
    customer: {
      first_name:
        input.customer?.first_name ?? SAMPLE_ORDER.CUSTOMER_FIRST_NAME,
      last_name: input.customer?.last_name ?? SAMPLE_ORDER.CUSTOMER_LAST_NAME,
      phone: input.customer?.phone ?? SAMPLE_ORDER.CUSTOMER_PHONE,
      email: input.customer?.email ?? SAMPLE_ORDER.CUSTOMER_EMAIL,
    },
    shipping_address: {
      first_name:
        input.shipping_address?.first_name ?? SAMPLE_ORDER.SHIPPING_FIRST_NAME,
      last_name:
        input.shipping_address?.last_name ?? SAMPLE_ORDER.SHIPPING_LAST_NAME,
      phone: input.shipping_address?.phone ?? SAMPLE_ORDER.SHIPPING_PHONE,
      email: input.shipping_address?.email ?? SAMPLE_ORDER.CUSTOMER_EMAIL,
    },
    fulfillments: input.fulfillments ?? [
      { tracking_number: SAMPLE_ORDER.TRACKING_NUMBER },
    ],
  };
}

/** Render a stored template body against a sample order. */
export function renderStoredTemplatePreview(
  template: NotificationTemplateDTO,
  order: Partial<NotificationOrderInput> | undefined,
  renderer = new NotificationRenderEngine(),
): {
  context: Record<string, unknown>;
  preview: NotificationTemplatePreview;
} {
  const context = buildOrderRenderContext(buildTemplateSampleOrder(order));
  const rendered = renderer.render({
    templateId: template.id,
    body: template.body,
    context,
  });

  return {
    context,
    preview: {
      template_id: template.id,
      text: rendered.text,
      segments: rendered.segments,
      warnings: rendered.warnings,
    },
  };
}

/** Return true only when the explicit live send-test gate is enabled. */
export function isLiveSendTestEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const parsed = validateOptions(
    z.object({ enabled: z.string().optional() }),
    {},
    env,
    {
      prefix: NOTIFICATIONS_MODULE,
      envMap: { enabled: SEND_TEST_ENV.LIVE_ENABLED },
    },
  );
  const value = parsed.enabled?.toLowerCase();
  return value === ENV_VALUES.ONE || value === ENV_VALUES.TRUE;
}

/** Build a not-found error for a missing template id. */
export function templateNotFoundError(): KsaError {
  return new KsaError(ERROR_MESSAGES.TEMPLATE_NOT_FOUND, {
    prefix: NOTIFICATIONS_MODULE,
    code: KsaErrorCodes.INVALID_INPUT,
  });
}

function formatValidationMessage(error: z.ZodError): string {
  const issues = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  return `${ERROR_MESSAGES.INVALID_REQUEST} ${issues}`;
}
