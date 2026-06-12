import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { NotificationTypes } from "@medusajs/types";
import { describe, expect, it, vi } from "vitest";

import {
  buildIdempotencyKey,
  CHANNEL,
  EVENTS,
  ORDER_NOTIFICATION_RESULTS,
  ORDER_NOTIFICATION_SKIP_REASONS,
  ORDER_NOTIFICATION_SOURCES,
  QUERY_ENTITIES,
  TEMPLATE_RESOLUTION_STATUS,
} from "../../modules/notifications/constants.js";
import type { NotificationOrderInput } from "../../modules/notifications/render/context.js";
import { NotificationRenderEngine } from "../../modules/notifications/render/engine.js";
import type { NotificationTemplateDTO } from "../../modules/notifications/types.js";
import {
  handleOrderNotification,
  type OrderNotificationDependencies,
  type OrderNotificationModule,
  type OrderNotificationQuery,
} from "./order-notification.js";

interface TestFulfillment {
  id: string;
  tracking_number?: string | null;
  tracking_numbers?: string[] | null;
  order?: { id?: string | null } | null;
}

function template(
  input: Partial<NotificationTemplateDTO> = {},
): NotificationTemplateDTO {
  return {
    id: input.id ?? "ntpl_order_placed_ar",
    channel: input.channel ?? CHANNEL,
    event: input.event ?? EVENTS.ORDER_PLACED,
    locale: input.locale ?? "ar",
    body:
      input.body ??
      "تم استلام طلبك رقم {{order.display_id}} بإجمالي {{formatSar order.total}}.",
    enabled: input.enabled ?? true,
    from: input.from ?? null,
  };
}

function order(input: Partial<NotificationOrderInput> = {}): NotificationOrderInput {
  return {
    id: input.id ?? "order_1",
    display_id: input.display_id ?? 1001,
    total: input.total ?? 12345,
    currency_code: input.currency_code ?? "sar",
    created_at: input.created_at ?? "2026-06-12T00:00:00.000Z",
    customer: input.customer ?? {
      first_name: "Khaled",
      last_name: "Afify",
      phone: "+966555555555",
      email: "customer@example.com",
    },
    shipping_address: input.shipping_address ?? {
      first_name: "سارة",
      last_name: "العلي",
      phone: "+966500000000",
    },
    fulfillments: input.fulfillments ?? [],
  };
}

function makeDependencies(input: {
  resolutionTemplate?: NotificationTemplateDTO;
  resolutionStatus?: typeof TEMPLATE_RESOLUTION_STATUS.FOUND | typeof TEMPLATE_RESOLUTION_STATUS.DISABLED | typeof TEMPLATE_RESOLUTION_STATUS.MISSING;
  orders?: Record<string, NotificationOrderInput>;
  fulfillments?: Record<string, TestFulfillment>;
}) {
  const orders = input.orders ?? { order_1: order() };
  const fulfillments = input.fulfillments ?? {};
  const resolutionStatus = input.resolutionStatus ?? TEMPLATE_RESOLUTION_STATUS.FOUND;
  const resolution =
    resolutionStatus === TEMPLATE_RESOLUTION_STATUS.MISSING
      ? { status: TEMPLATE_RESOLUTION_STATUS.MISSING, template: null }
      : {
          status: resolutionStatus,
          template: input.resolutionTemplate ?? template(),
        };
  const resolve = vi.fn(async () => resolution);
  const createNotifications = vi.fn<OrderNotificationModule["createNotifications"]>(
    async (data) =>
      ({
        id: "noti_1",
        to: data.to,
        channel: data.channel,
        template: data.template ?? "",
        data: data.data ?? null,
      }) as NotificationTypes.NotificationDTO,
  );
  const info = vi.fn<(message: string) => void>();
  const warn = vi.fn<(message: string) => void>();
  const graph: OrderNotificationQuery["graph"] = async <TRecord>(queryInput: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
  }) => {
    const id = String(queryInput.filters.id);
    const records =
      queryInput.entity === QUERY_ENTITIES.ORDER
        ? [orders[id]].filter(Boolean)
        : [fulfillments[id]].filter(Boolean);
    return { data: records as TRecord[] };
  };
  const dependencies: OrderNotificationDependencies = {
    logger: {
      info,
      warn,
    },
    notificationModule: { createNotifications },
    query: { graph },
    renderer: new NotificationRenderEngine(),
    templateService: { resolve },
  };

  return { dependencies, createNotifications, info, resolve, warn };
}

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionSourceFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("handleOrderNotification", () => {
  it("creates one sms notification for order.placed with rendered Arabic text and the resolved template id", async () => {
    const notificationTemplate = template({
      id: "ntpl_order_placed_ar",
      body:
        "تم استلام طلبك رقم {{order.display_id}} بإجمالي {{formatSar order.total}}.",
    });
    const { dependencies, createNotifications } = makeDependencies({
      resolutionTemplate: notificationTemplate,
      orders: { order_1: order() },
    });

    await expect(
      handleOrderNotification({
        dependencies,
        eventName: EVENTS.ORDER_PLACED,
        eventData: { id: "order_1" },
        source: ORDER_NOTIFICATION_SOURCES.ORDER_ID,
      }),
    ).resolves.toEqual({
      status: ORDER_NOTIFICATION_RESULTS.CREATED,
      orderId: "order_1",
      idempotencyKey: buildIdempotencyKey(EVENTS.ORDER_PLACED, "order_1"),
    });

    expect(createNotifications).toHaveBeenCalledTimes(1);
    expect(createNotifications).toHaveBeenCalledWith({
      to: "+966500000000",
      from: null,
      channel: CHANNEL,
      template: notificationTemplate.id,
      data: expect.objectContaining({
        order: expect.objectContaining({ display_id: "1001" }),
      }),
      content: {
        text: "تم استلام طلبك رقم 1001 بإجمالي 123.45 SAR.",
      },
      trigger_type: EVENTS.ORDER_PLACED,
      resource_id: "order_1",
      resource_type: QUERY_ENTITIES.ORDER,
      idempotency_key: buildIdempotencyKey(EVENTS.ORDER_PLACED, "order_1"),
    });
  });

  it("renders shipped notifications with the fulfillment tracking number and order id idempotency", async () => {
    const notificationTemplate = template({
      id: "ntpl_order_shipped_ar",
      event: EVENTS.ORDER_SHIPPED,
      body:
        "تم شحن طلبك رقم {{order.display_id}}{{#if fulfillment.tracking_number}}. رقم التتبع {{fulfillment.tracking_number}}{{/if}}.",
    });
    const { dependencies, createNotifications } = makeDependencies({
      resolutionTemplate: notificationTemplate,
      orders: { order_1: order() },
      fulfillments: {
        ful_1: {
          id: "ful_1",
          tracking_number: "TRK123",
          order: { id: "order_1" },
        },
      },
    });

    const result = await handleOrderNotification({
      dependencies,
      eventName: EVENTS.ORDER_SHIPPED,
      eventData: { id: "ful_1" },
      source: ORDER_NOTIFICATION_SOURCES.FULFILLMENT_ID,
    });

    expect(result).toEqual({
      status: ORDER_NOTIFICATION_RESULTS.CREATED,
      orderId: "order_1",
      idempotencyKey: buildIdempotencyKey(EVENTS.ORDER_SHIPPED, "order_1"),
    });
    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          text: "تم شحن طلبك رقم 1001. رقم التتبع TRK123.",
        },
        idempotency_key: buildIdempotencyKey(EVENTS.ORDER_SHIPPED, "order_1"),
      }),
    );
  });

  it("falls back to the customer phone when the shipping address has no phone", async () => {
    const { dependencies, createNotifications } = makeDependencies({
      orders: {
        order_1: order({
          shipping_address: { first_name: "سارة", phone: null },
          customer: { phone: "+966544444444", email: "buyer@example.com" },
        }),
      },
    });

    await handleOrderNotification({
      dependencies,
      eventName: EVENTS.ORDER_PLACED,
      eventData: { id: "order_1" },
      source: ORDER_NOTIFICATION_SOURCES.ORDER_ID,
    });

    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+966544444444" }),
    );
  });

  it("skips and logs without throwing when the order has no recipient phone", async () => {
    const { dependencies, createNotifications, warn } = makeDependencies({
      orders: {
        order_1: order({
          shipping_address: { phone: null },
          customer: { phone: null, email: "buyer@example.com" },
        }),
      },
    });

    await expect(
      handleOrderNotification({
        dependencies,
        eventName: EVENTS.ORDER_PLACED,
        eventData: { id: "order_1" },
        source: ORDER_NOTIFICATION_SOURCES.ORDER_ID,
      }),
    ).resolves.toEqual({
      status: ORDER_NOTIFICATION_RESULTS.SKIPPED,
      reason: ORDER_NOTIFICATION_SKIP_REASONS.RECIPIENT,
    });

    expect(createNotifications).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no recipient phone"),
    );
  });

  it("skips and logs when the resolved template is disabled", async () => {
    const { dependencies, createNotifications, warn } = makeDependencies({
      resolutionStatus: TEMPLATE_RESOLUTION_STATUS.DISABLED,
    });

    await expect(
      handleOrderNotification({
        dependencies,
        eventName: EVENTS.ORDER_PLACED,
        eventData: { id: "order_1" },
        source: ORDER_NOTIFICATION_SOURCES.ORDER_ID,
      }),
    ).resolves.toEqual({
      status: ORDER_NOTIFICATION_RESULTS.SKIPPED,
      reason: ORDER_NOTIFICATION_SKIP_REASONS.TEMPLATE,
    });

    expect(createNotifications).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(TEMPLATE_RESOLUTION_STATUS.DISABLED),
    );
  });

  it("skips and logs when an order event references a missing order", async () => {
    const { dependencies, createNotifications, warn } = makeDependencies({
      orders: {},
    });

    await expect(
      handleOrderNotification({
        dependencies,
        eventName: EVENTS.ORDER_PLACED,
        eventData: { id: "order_missing" },
        source: ORDER_NOTIFICATION_SOURCES.ORDER_ID,
      }),
    ).resolves.toEqual({
      status: ORDER_NOTIFICATION_RESULTS.SKIPPED,
      reason: ORDER_NOTIFICATION_SKIP_REASONS.ORDER,
    });

    expect(createNotifications).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("skips and logs when a fulfillment event has no linked order", async () => {
    const { dependencies, createNotifications, warn } = makeDependencies({
      fulfillments: { ful_1: { id: "ful_1", order: null } },
    });

    await expect(
      handleOrderNotification({
        dependencies,
        eventName: EVENTS.ORDER_SHIPPED,
        eventData: { id: "ful_1" },
        source: ORDER_NOTIFICATION_SOURCES.FULFILLMENT_ID,
      }),
    ).resolves.toEqual({
      status: ORDER_NOTIFICATION_RESULTS.SKIPPED,
      reason: ORDER_NOTIFICATION_SKIP_REASONS.FULFILLMENT_ORDER,
    });

    expect(createNotifications).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("has no linked order"),
    );
  });

  it("does not import notification transport providers from production source", () => {
    const srcRoot = join(__dirname, "..", "..");
    const source = productionSourceFiles(srcRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/medusa-notification-/u);
    expect(source).not.toMatch(/unifonic/u);
    expect(source).not.toMatch(/taqnyat/u);
  });
});
