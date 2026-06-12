import type { MedusaContainer, NotificationTypes } from "@medusajs/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import {
  buildIdempotencyKey,
  CHANNEL,
  DEFAULT_LOCALE,
  LOG_MESSAGES,
  NOTIFICATION_CONTENT_FIELDS,
  NOTIFICATIONS_MODULE,
  ORDER_NOTIFICATION_FULFILLMENT_FIELDS,
  ORDER_NOTIFICATION_ORDER_FIELDS,
  ORDER_NOTIFICATION_RESULTS,
  ORDER_NOTIFICATION_SKIP_REASONS,
  ORDER_NOTIFICATION_SOURCES,
  QUERY_ENTITIES,
  QUERY_FILTER_FIELDS,
  TEMPLATE_RESOLUTION_STATUS,
} from "../../modules/notifications/constants";
import { buildOrderRenderContext } from "../../modules/notifications/render/context";
import type {
  NotificationFulfillmentInput,
  NotificationOrderInput,
} from "../../modules/notifications/render/context";
import { NotificationRenderEngine } from "../../modules/notifications/render/engine";
import type NotificationTemplateModuleService from "../../modules/notifications/service";
import type { NotificationEvent } from "../../modules/notifications/types";

/** Event payload shape emitted by Medusa order and fulfillment subscribers. */
export interface OrderNotificationEventData {
  id: string;
}

/** Supported source records for subscriber event ids. */
export type OrderNotificationSource =
  (typeof ORDER_NOTIFICATION_SOURCES)[keyof typeof ORDER_NOTIFICATION_SOURCES];

/** Minimal logger dependency used by notification subscribers. */
export interface OrderNotificationLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** Query graph input shape used by notification subscribers. */
export interface OrderNotificationQueryInput {
  entity: string;
  fields: string[];
  filters: Record<string, unknown>;
}

/** Query graph response shape used by notification subscribers. */
export interface OrderNotificationQueryResult<TRecord> {
  data: TRecord[];
}

/** Query dependency consumed by notification subscribers. */
export interface OrderNotificationQuery {
  graph<TRecord>(
    input: OrderNotificationQueryInput,
  ): Promise<OrderNotificationQueryResult<TRecord>>;
}

/** Notification module subset consumed by the subscriber helper. */
export interface OrderNotificationModule {
  createNotifications(
    data: NotificationTypes.CreateNotificationDTO,
  ): Promise<NotificationTypes.NotificationDTO>;
}

/** Input used by the single helper that calls Medusa's notification module. */
export interface CreateSmsNotificationInput {
  notificationModule: OrderNotificationModule;
  to: string;
  from: string | null;
  templateId: string;
  text: string;
  data: Record<string, unknown>;
  triggerType: string;
  resourceId: string;
  resourceType: string;
  idempotencyKey?: string;
}

/** Dependencies consumed by the subscriber helper. */
export interface OrderNotificationDependencies {
  logger: OrderNotificationLogger;
  notificationModule: OrderNotificationModule;
  query: OrderNotificationQuery;
  renderer: NotificationRenderEngine;
  templateService: Pick<NotificationTemplateModuleService, "resolve">;
}

/** Input for the provider-agnostic order notification subscriber helper. */
export interface HandleOrderNotificationInput {
  dependencies: OrderNotificationDependencies;
  eventName: NotificationEvent;
  eventData: OrderNotificationEventData;
  source: OrderNotificationSource;
}

/** Created subscriber handling result. */
export interface OrderNotificationCreatedResult {
  status: typeof ORDER_NOTIFICATION_RESULTS.CREATED;
  orderId: string;
  idempotencyKey: string;
}

/** Skipped subscriber handling result. */
export interface OrderNotificationSkippedResult {
  status: typeof ORDER_NOTIFICATION_RESULTS.SKIPPED;
  reason: (typeof ORDER_NOTIFICATION_SKIP_REASONS)[keyof typeof ORDER_NOTIFICATION_SKIP_REASONS];
}

/** Subscriber handling result used by tests and self-audits. */
export type OrderNotificationHandleResult =
  | OrderNotificationCreatedResult
  | OrderNotificationSkippedResult;

interface OrderNotificationFulfillment extends NotificationFulfillmentInput {
  id: string;
  order?: { id?: string | null } | null;
}

interface ResolvedOrderForNotification {
  order: NotificationOrderInput | null;
  orderId: string | null;
  trackingNumber: string | null;
}

const FALLBACK_RENDERER = new NotificationRenderEngine();

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? null;
}

function resolveRecipient(order: NotificationOrderInput): string | null {
  return firstNonEmpty(order.shipping_address?.phone, order.customer?.phone);
}

function firstTrackingNumber(
  fulfillment: NotificationFulfillmentInput | null | undefined,
): string | null {
  const [firstTrackingNumberValue] = fulfillment?.tracking_numbers ?? [];
  return firstNonEmpty(
    fulfillment?.tracking_number,
    firstTrackingNumberValue,
  );
}

async function findOrder(
  query: OrderNotificationQuery,
  orderId: string,
): Promise<NotificationOrderInput | null> {
  const { data } = await query.graph<NotificationOrderInput>({
    entity: QUERY_ENTITIES.ORDER,
    fields: [...ORDER_NOTIFICATION_ORDER_FIELDS],
    filters: { [QUERY_FILTER_FIELDS.ID]: orderId },
  });

  return data[0] ?? null;
}

async function findFulfillment(
  query: OrderNotificationQuery,
  fulfillmentId: string,
): Promise<OrderNotificationFulfillment | null> {
  const { data } = await query.graph<OrderNotificationFulfillment>({
    entity: QUERY_ENTITIES.FULFILLMENT,
    fields: [...ORDER_NOTIFICATION_FULFILLMENT_FIELDS],
    filters: { [QUERY_FILTER_FIELDS.ID]: fulfillmentId },
  });

  return data[0] ?? null;
}

async function resolveOrderForNotification(
  input: HandleOrderNotificationInput,
): Promise<ResolvedOrderForNotification> {
  const { dependencies, eventData, source } = input;

  if (source === ORDER_NOTIFICATION_SOURCES.ORDER_ID) {
    const order = await findOrder(dependencies.query, eventData.id);
    return { order, orderId: eventData.id, trackingNumber: null };
  }

  const fulfillment = await findFulfillment(dependencies.query, eventData.id);
  const orderId = fulfillment?.order?.id ?? null;
  if (!orderId) {
    return { order: null, orderId: null, trackingNumber: null };
  }

  const order = await findOrder(dependencies.query, orderId);
  return {
    order,
    orderId,
    trackingNumber: firstTrackingNumber(fulfillment),
  };
}

/** Create one provider-agnostic SMS notification through Medusa's module. */
export async function createSmsNotification(
  input: CreateSmsNotificationInput,
): Promise<NotificationTypes.NotificationDTO> {
  return input.notificationModule.createNotifications({
    to: input.to,
    from: input.from,
    channel: CHANNEL,
    template: input.templateId,
    data: input.data,
    content: {
      [NOTIFICATION_CONTENT_FIELDS.TEXT]: input.text,
    },
    trigger_type: input.triggerType,
    resource_id: input.resourceId,
    resource_type: input.resourceType,
    idempotency_key: input.idempotencyKey,
  });
}

/**
 * Resolve, render, and enqueue one provider-agnostic SMS notification for an
 * order lifecycle event. Missing templates, missing orders, and missing phone
 * numbers are logged and skipped without throwing.
 */
export async function handleOrderNotification(
  input: HandleOrderNotificationInput,
): Promise<OrderNotificationHandleResult> {
  const { dependencies, eventName } = input;
  const resolution = await dependencies.templateService.resolve(
    CHANNEL,
    eventName,
    DEFAULT_LOCALE,
  );

  if (resolution.status !== TEMPLATE_RESOLUTION_STATUS.FOUND) {
    dependencies.logger.warn(
      LOG_MESSAGES.TEMPLATE_SKIPPED(eventName, resolution.status),
    );
    return {
      status: ORDER_NOTIFICATION_RESULTS.SKIPPED,
      reason: ORDER_NOTIFICATION_SKIP_REASONS.TEMPLATE,
    };
  }

  const { order, orderId, trackingNumber } =
    await resolveOrderForNotification(input);
  if (!orderId && input.source === ORDER_NOTIFICATION_SOURCES.FULFILLMENT_ID) {
    dependencies.logger.warn(
      LOG_MESSAGES.FULFILLMENT_ORDER_NOT_FOUND(eventName, input.eventData.id),
    );
    return {
      status: ORDER_NOTIFICATION_RESULTS.SKIPPED,
      reason: ORDER_NOTIFICATION_SKIP_REASONS.FULFILLMENT_ORDER,
    };
  }

  if (!order || !orderId) {
    dependencies.logger.warn(
      LOG_MESSAGES.ORDER_NOT_FOUND(eventName, input.eventData.id),
    );
    return {
      status: ORDER_NOTIFICATION_RESULTS.SKIPPED,
      reason: ORDER_NOTIFICATION_SKIP_REASONS.ORDER,
    };
  }

  const recipient = resolveRecipient(order);
  if (!recipient) {
    dependencies.logger.warn(LOG_MESSAGES.MISSING_RECIPIENT(eventName, orderId));
    return {
      status: ORDER_NOTIFICATION_RESULTS.SKIPPED,
      reason: ORDER_NOTIFICATION_SKIP_REASONS.RECIPIENT,
    };
  }

  const context = buildOrderRenderContext(order, { trackingNumber });
  const rendered = dependencies.renderer.render({
    templateId: resolution.template.id,
    body: resolution.template.body,
    context,
  });
  const idempotencyKey = buildIdempotencyKey(eventName, orderId);
  await createSmsNotification({
    notificationModule: dependencies.notificationModule,
    to: recipient,
    from: resolution.template.from,
    templateId: resolution.template.id,
    text: rendered.text,
    data: context,
    triggerType: eventName,
    resourceId: orderId,
    resourceType: QUERY_ENTITIES.ORDER,
    idempotencyKey,
  });

  dependencies.logger.info(LOG_MESSAGES.NOTIFICATION_CREATED(eventName, orderId));

  return {
    status: ORDER_NOTIFICATION_RESULTS.CREATED,
    orderId,
    idempotencyKey,
  };
}

/** Resolve subscriber dependencies from the Medusa container. */
export function orderNotificationDependenciesFromContainer(
  container: MedusaContainer,
): OrderNotificationDependencies {
  return {
    logger: container.resolve<OrderNotificationLogger>(
      ContainerRegistrationKeys.LOGGER,
    ),
    notificationModule: container.resolve<OrderNotificationModule>(
      Modules.NOTIFICATION,
    ),
    query: container.resolve<OrderNotificationQuery>(
      ContainerRegistrationKeys.QUERY,
    ),
    renderer: FALLBACK_RENDERER,
    templateService: container.resolve<NotificationTemplateModuleService>(
      NOTIFICATIONS_MODULE,
    ),
  };
}
