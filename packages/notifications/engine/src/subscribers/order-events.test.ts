import type { MedusaContainer, NotificationTypes } from "@medusajs/types";
import type { SubscriberArgs } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { describe, expect, it } from "vitest";

import {
  CHANNEL,
  EVENTS,
  NOTIFICATIONS_MODULE,
  QUERY_ENTITIES,
} from "../modules/notifications/constants.js";
import type { OrderNotificationEventData } from "./helpers/order-notification.js";
import orderCanceledNotificationHandler, {
  config as orderCanceledConfig,
} from "./order-canceled.js";
import orderDeliveredNotificationHandler, {
  config as orderDeliveredConfig,
} from "./order-delivered.js";
import orderPlacedNotificationHandler, {
  config as orderPlacedConfig,
} from "./order-placed.js";
import orderShippedNotificationHandler, {
  config as orderShippedConfig,
} from "./order-shipped.js";

function subscriberArgs(
  container: MedusaContainer,
  eventName: string,
  id: string,
): SubscriberArgs<OrderNotificationEventData> {
  return {
    event: {
      name: eventName,
      data: { id },
    },
    container,
    pluginOptions: {},
  };
}

function makeContainer(
  createNotifications: (
    data: NotificationTypes.CreateNotificationDTO,
  ) => Promise<NotificationTypes.NotificationDTO>,
): MedusaContainer {
  const logger = { info: () => undefined, warn: () => undefined };
  const templateService = {
    resolve: async () => ({
      status: "found" as const,
      template: {
        id: "ntpl_order_event_ar",
        channel: CHANNEL,
        event: EVENTS.ORDER_PLACED,
        locale: "ar",
        enabled: true,
        from: null,
        body: "طلب {{order.display_id}}{{#if fulfillment.tracking_number}} {{fulfillment.tracking_number}}{{/if}}",
      },
    }),
  };
  const query = {
    graph: async <TRecord>(input: { entity: string }) => ({
      data:
        input.entity === QUERY_ENTITIES.FULFILLMENT
          ? ([
              {
                id: "ful_1",
                tracking_number: "TRK123",
                order: { id: "order_1" },
              },
            ] as TRecord[])
          : ([
              {
                id: "order_1",
                display_id: 1001,
                total: 1000,
                customer: { phone: "+966544444444" },
                shipping_address: { phone: "+966500000000" },
              },
            ] as TRecord[]),
    }),
  };
  const values = new Map<unknown, unknown>([
    [ContainerRegistrationKeys.LOGGER, logger],
    [ContainerRegistrationKeys.QUERY, query],
    [Modules.NOTIFICATION, { createNotifications }],
    [NOTIFICATIONS_MODULE, templateService],
  ]);

  return {
    resolve: (key: unknown) => values.get(key),
  } as unknown as MedusaContainer;
}

describe("order notification subscribers", () => {
  it("registers the verified Medusa order lifecycle events", () => {
    expect(orderPlacedConfig.event).toBe(EVENTS.ORDER_PLACED);
    expect(orderShippedConfig.event).toBe(EVENTS.ORDER_SHIPPED);
    expect(orderDeliveredConfig.event).toBe(EVENTS.ORDER_DELIVERED);
    expect(orderCanceledConfig.event).toBe(EVENTS.ORDER_CANCELED);
  });

  it("delegates each auto-loaded event handler to the notification helper", async () => {
    const sentNotifications: NotificationTypes.CreateNotificationDTO[] = [];
    const createNotifications = async (
      data: NotificationTypes.CreateNotificationDTO,
    ) => {
      sentNotifications.push(data);
      return {
        id: `noti_${sentNotifications.length}`,
        to: data.to,
        channel: data.channel,
        template: data.template ?? "",
        data: data.data ?? null,
      } as NotificationTypes.NotificationDTO;
    };
    const container = makeContainer(createNotifications);

    await orderPlacedNotificationHandler(
      subscriberArgs(container, EVENTS.ORDER_PLACED, "order_1"),
    );
    await orderShippedNotificationHandler(
      subscriberArgs(container, EVENTS.ORDER_SHIPPED, "ful_1"),
    );
    await orderDeliveredNotificationHandler(
      subscriberArgs(container, EVENTS.ORDER_DELIVERED, "order_1"),
    );
    await orderCanceledNotificationHandler(
      subscriberArgs(container, EVENTS.ORDER_CANCELED, "order_1"),
    );

    expect(sentNotifications).toHaveLength(4);
    expect(sentNotifications.map((notification) => notification.channel)).toEqual(
      [CHANNEL, CHANNEL, CHANNEL, CHANNEL],
    );
    expect(sentNotifications[1]?.content?.text).toContain("TRK123");
  });
});
