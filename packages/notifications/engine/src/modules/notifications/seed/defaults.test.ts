import { describe, expect, it } from "vitest";

import { CHANNEL, EVENTS, LOCALES } from "../constants.js";
import { DEFAULT_NOTIFICATION_TEMPLATES } from "./defaults.js";

describe("default notification templates", () => {
  it("seeds one Arabic sms row for each supported event", () => {
    expect(DEFAULT_NOTIFICATION_TEMPLATES).toHaveLength(
      Object.values(EVENTS).length,
    );
    expect(
      DEFAULT_NOTIFICATION_TEMPLATES.map((template) => ({
        channel: template.channel,
        event: template.event,
        locale: template.locale,
      })),
    ).toEqual(
      Object.values(EVENTS).map((event) => ({
        channel: CHANNEL,
        event,
        locale: LOCALES.AR,
      })),
    );
  });

  it("keeps shipped and follow-on templates available from self-seed defaults", () => {
    expect(
      DEFAULT_NOTIFICATION_TEMPLATES.some(
        (template) => template.event === EVENTS.ORDER_SHIPPED,
      ),
    ).toBe(true);
    expect(
      DEFAULT_NOTIFICATION_TEMPLATES.some(
        (template) => template.event === EVENTS.ORDER_DELIVERED,
      ),
    ).toBe(true);
    expect(
      DEFAULT_NOTIFICATION_TEMPLATES.some(
        (template) => template.event === EVENTS.ORDER_CANCELED,
      ),
    ).toBe(true);
  });
});
