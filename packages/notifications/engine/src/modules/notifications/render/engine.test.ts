import { describe, expect, it } from "vitest";

import { HELPERS, LIMITS, WARNINGS } from "../constants.js";
import { NotificationRenderEngine, sanitizeText } from "./engine.js";

function render(body: string, context = {}) {
  return new NotificationRenderEngine().render({
    templateId: "ntpl_test",
    body,
    context,
  });
}

describe("NotificationRenderEngine", () => {
  it("interpolates variables for order display id, total, and customer name", () => {
    const result = render(
      `طلب {{order.display_id}} باسم {{customer.name}} بقيمة {{${HELPERS.FORMAT_SAR} order.total}}`,
      {
        order: { display_id: 101, total: 12345 },
        customer: { name: "Khaled" },
      },
    );

    expect(result.text).toBe("طلب 101 باسم Khaled بقيمة 123.45 SAR");
  });

  it("renders shipped tracking conditionals with and without tracking", () => {
    const body =
      "تم شحن طلبك {{order.display_id}}{{#if fulfillment.tracking_number}} رقم التتبع {{fulfillment.tracking_number}}{{/if}}";

    expect(
      render(body, {
        order: { display_id: 101 },
        fulfillment: { tracking_number: "TRK123" },
      }).text,
    ).toBe("تم شحن طلبك 101 رقم التتبع TRK123");
    const withoutTracking = render(body, {
      order: { display_id: 101 },
      fulfillment: { tracking_number: "" },
    }).text;
    expect(withoutTracking).toBe("تم شحن طلبك 101");
    expect(withoutTracking).not.toContain("undefined");
  });

  it("supports the fixed helper whitelist", () => {
    const result = render(
      `{{${HELPERS.FORMAT_SAR} total}} {{${HELPERS.FORMAT_DATE} date}} {{${HELPERS.PLURALIZE_AR} count "لا شحنات" "شحنة" "شحنتان" "شحنات" "شحنة" "شحنة"}}`,
      {
        total: 9900,
        date: "2026-06-12T10:15:00.000Z",
        count: 3,
      },
    );

    expect(result.text).toBe("99.00 SAR 2026-06-12 شحنات");
  });

  it("preserves Arabic Unicode and keeps plain-text ampersands and brackets unescaped", () => {
    const text = "رسالة عربية & <اختبار>";

    expect(render(text).text).toBe(text);
  });

  it("strips control and bidi override characters and neutralizes prototype access", () => {
    const result = render(
      "مرحباً {{customer.name}}\u0000\u202e {{__proto__.polluted}} {{constructor.name}}",
      {
        customer: { name: "سارة\u0007\u202e" },
      },
    );

    expect(result.text).toBe("مرحباً سارة  ");
    expect(result.text).not.toContain("polluted");
    expect(result.text).not.toContain("Object");
  });

  it("renders missing variables safely without throwing", () => {
    expect(render("x{{missing.value}}y").text).toBe("xy");
  });

  it("returns a segment warning for over-length SMS bodies", () => {
    const longArabicText = "أ".repeat(LIMITS.UNICODE_SINGLE_SEGMENT + 1);
    const result = render(longArabicText);

    expect(result.text).toBe(longArabicText);
    expect(result.segments.segments).toBe(2);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: WARNINGS.SMS_SEGMENTS,
        segments: expect.objectContaining({ segments: 2 }),
      }),
    ]);
  });

  it("caps sanitized text without throwing", () => {
    expect(sanitizeText("x".repeat(LIMITS.SMS_MAX_LEN + 1))).toHaveLength(
      LIMITS.SMS_MAX_LEN,
    );
  });
});
