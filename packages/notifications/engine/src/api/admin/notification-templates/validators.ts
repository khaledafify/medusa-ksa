import { z } from "zod";

import {
  CHANNEL,
  ERROR_MESSAGES,
  EVENTS,
  LOCALES,
} from "../../../modules/notifications/constants";

const nonEmptyString = z.string().trim().min(1);
const nullableText = z.union([
  z.string().trim().min(1),
  z.literal("").transform(() => null),
  z.null(),
]);
const notificationEventSchema = z.enum([
  EVENTS.ORDER_PLACED,
  EVENTS.ORDER_SHIPPED,
  EVENTS.ORDER_DELIVERED,
  EVENTS.ORDER_CANCELED,
]);
const notificationLocaleSchema = z.literal(LOCALES.AR);

const booleanQueryValue = z.union([
  z.boolean(),
  z.literal("true").transform(() => true),
  z.literal("false").transform(() => false),
]);

const personSchema = z
  .object({
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  })
  .strict();

const fulfillmentSchema = z
  .object({
    tracking_number: z.string().nullable().optional(),
    tracking_numbers: z.array(z.string()).nullable().optional(),
  })
  .strict();

/** Query schema for listing notification templates. */
export const listNotificationTemplatesQuerySchema = z
  .object({
    channel: z.literal(CHANNEL).optional(),
    event: notificationEventSchema.optional(),
    locale: notificationLocaleSchema.optional(),
    enabled: booleanQueryValue.optional(),
  })
  .strict();

/** Body schema for creating notification templates. */
export const createNotificationTemplateBodySchema = z
  .object({
    channel: z.literal(CHANNEL).default(CHANNEL),
    event: notificationEventSchema,
    locale: notificationLocaleSchema.default(LOCALES.AR),
    body: nonEmptyString,
    enabled: z.boolean().default(true),
    from: nullableText.default(null),
  })
  .strict();

/** Body schema for updating editable notification template fields. */
export const updateNotificationTemplateBodySchema = z
  .object({
    body: nonEmptyString.optional(),
    enabled: z.boolean().optional(),
    from: nullableText.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: ERROR_MESSAGES.EMPTY_UPDATE,
  });

/** Param schema for routes that target a single template row. */
export const notificationTemplateParamsSchema = z
  .object({
    id: nonEmptyString,
  })
  .strict();

/** Optional sample order schema accepted by preview and send-test. */
export const notificationTemplateSampleOrderSchema = z
  .object({
    id: z.string().optional(),
    display_id: z.union([z.string(), z.number()]).nullable().optional(),
    total: z.number().nonnegative().optional(),
    currency_code: z.string().nullable().optional(),
    created_at: z.union([z.string(), z.date()]).nullable().optional(),
    customer: personSchema.nullable().optional(),
    shipping_address: personSchema.nullable().optional(),
    fulfillments: z.array(fulfillmentSchema).nullable().optional(),
  })
  .strict();

/** Body schema for rendering a stored template preview. */
export const previewNotificationTemplateBodySchema = z
  .object({
    id: nonEmptyString,
    order: notificationTemplateSampleOrderSchema.optional(),
  })
  .strict();

/** Body schema for sending a stored template test notification. */
export const sendTestNotificationTemplateBodySchema = z
  .object({
    id: nonEmptyString,
    to: nonEmptyString,
    order: notificationTemplateSampleOrderSchema.optional(),
    live: z.boolean().default(false),
  })
  .strict();

/** Parsed list-query input. */
export type ListNotificationTemplatesQuery = z.infer<
  typeof listNotificationTemplatesQuerySchema
>;

/** Parsed create-template input. */
export type CreateNotificationTemplateBody = z.infer<
  typeof createNotificationTemplateBodySchema
>;

/** Parsed update-template input. */
export type UpdateNotificationTemplateBody = z.infer<
  typeof updateNotificationTemplateBodySchema
>;

/** Parsed route params for a template id. */
export type NotificationTemplateParams = z.infer<
  typeof notificationTemplateParamsSchema
>;

/** Parsed preview body. */
export type PreviewNotificationTemplateBody = z.infer<
  typeof previewNotificationTemplateBodySchema
>;

/** Parsed send-test body. */
export type SendTestNotificationTemplateBody = z.infer<
  typeof sendTestNotificationTemplateBodySchema
>;
