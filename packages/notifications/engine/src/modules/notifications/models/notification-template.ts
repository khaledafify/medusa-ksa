import { model } from "@medusajs/framework/utils";

import { CHANNEL, EVENTS, LOCALES, TABLES } from "../constants";

/**
 * Merchant-editable notification template keyed by channel, event, and locale.
 */
const NotificationTemplate = model
  .define(TABLES.NOTIFICATION_TEMPLATE, {
    id: model.id({ prefix: "ntpl" }).primaryKey(),
    channel: model.enum([CHANNEL]).default(CHANNEL),
    event: model.enum(Object.values(EVENTS)),
    locale: model.enum(Object.values(LOCALES)).default(LOCALES.AR),
    body: model.text(),
    enabled: model.boolean().default(true),
    from: model.text().nullable(),
  })
  .indexes([
    { on: ["channel", "event", "locale"], unique: true },
    { on: ["event"] },
    { on: ["enabled"] },
  ]);

export default NotificationTemplate;
