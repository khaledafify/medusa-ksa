import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";

import {
  EVENTS,
  ORDER_NOTIFICATION_SOURCES,
} from "../modules/notifications/constants";
import {
  handleOrderNotification,
  orderNotificationDependenciesFromContainer,
  type OrderNotificationEventData,
} from "./helpers/order-notification";

/** Handle Medusa shipment creation events with a provider-agnostic SMS notification. */
export default async function orderShippedNotificationHandler({
  event,
  container,
}: SubscriberArgs<OrderNotificationEventData>): Promise<void> {
  await handleOrderNotification({
    dependencies: orderNotificationDependenciesFromContainer(container),
    eventName: EVENTS.ORDER_SHIPPED,
    eventData: event.data,
    source: ORDER_NOTIFICATION_SOURCES.FULFILLMENT_ID,
  });
}

/** Subscriber registration for order shipment notifications. */
export const config: SubscriberConfig = {
  event: EVENTS.ORDER_SHIPPED,
};
