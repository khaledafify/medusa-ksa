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

/** Handle Medusa order placement events with a provider-agnostic SMS notification. */
export default async function orderPlacedNotificationHandler({
  event,
  container,
}: SubscriberArgs<OrderNotificationEventData>): Promise<void> {
  await handleOrderNotification({
    dependencies: orderNotificationDependenciesFromContainer(container),
    eventName: EVENTS.ORDER_PLACED,
    eventData: event.data,
    source: ORDER_NOTIFICATION_SOURCES.ORDER_ID,
  });
}

/** Subscriber registration for order placement notifications. */
export const config: SubscriberConfig = {
  event: EVENTS.ORDER_PLACED,
};
