import { afterEach, describe, expect, it, vi } from "vitest";

import { sdk } from "./client";
import {
  listNotificationTemplates,
  previewNotificationTemplate,
  sendTestNotification,
  updateNotificationTemplate,
} from "./notification-template-client";

describe("notification template admin client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists templates through the admin REST API", async () => {
    const fetchSpy = vi
      .spyOn(sdk.client, "fetch")
      .mockResolvedValueOnce({ templates: [] });

    await expect(listNotificationTemplates()).resolves.toEqual({
      templates: [],
    });
    expect(fetchSpy).toHaveBeenCalledWith("/admin/notification-templates");
  });

  it("updates stored template rows through the admin REST API", async () => {
    const template = {
      id: "ntpl_123",
      channel: "sms",
      event: "order.placed",
      locale: "ar",
      body: "مرحبا",
      enabled: true,
      from: null,
    };
    const fetchSpy = vi
      .spyOn(sdk.client, "fetch")
      .mockResolvedValueOnce({ template });

    await expect(
      updateNotificationTemplate(template.id, {
        body: template.body,
        enabled: template.enabled,
        from: template.from,
      }),
    ).resolves.toEqual({ template });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/admin/notification-templates/ntpl_123",
      {
        method: "POST",
        body: {
          body: "مرحبا",
          enabled: true,
          from: null,
        },
      },
    );
  });

  it("drives preview and send-test endpoints with stored template ids", async () => {
    const fetchSpy = vi
      .spyOn(sdk.client, "fetch")
      .mockResolvedValueOnce({
        preview: {
          template_id: "ntpl_123",
          text: "تم استلام طلبك",
          segments: {
            encoding: "unicode",
            length: 14,
            perSegment: 70,
            segments: 1,
          },
          warnings: [],
        },
      })
      .mockResolvedValueOnce({ status: "skipped", reason: "live_send_test_disabled" });

    await previewNotificationTemplate("ntpl_123");
    await sendTestNotification({
      id: "ntpl_123",
      to: "+966500000000",
      live: true,
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/admin/notification-templates/preview",
      {
        method: "POST",
        body: { id: "ntpl_123" },
      },
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/admin/notification-templates/send-test",
      {
        method: "POST",
        body: {
          id: "ntpl_123",
          to: "+966500000000",
          live: true,
        },
      },
    );
  });
});
