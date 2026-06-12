import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { NotificationTypes } from "@medusajs/types";
import { describe, expect, it, vi } from "vitest";

import {
  API_RESPONSE_KEYS,
  CHANNEL,
  EVENTS,
  HTTP_STATUS,
  NOTIFICATIONS_MODULE,
  SEND_TEST_ENV,
  SEND_TEST_SKIP_REASONS,
  SEND_TEST_STATUS,
} from "../../../modules/notifications/constants.js";
import type { NotificationTemplateDTO } from "../../../modules/notifications/types.js";
import { DELETE, GET as getTemplate, POST as updateTemplate } from "./[id]/route.js";
import { toTemplateFilters } from "./helpers.js";
import { POST as previewTemplate } from "./preview/route.js";
import { GET as listTemplates, POST as createTemplate } from "./route.js";
import { POST as sendTestTemplate } from "./send-test/route.js";

interface CapturedResponse<Body> {
  payload?: Body;
  statusCode?: number;
  json(payload: Body): CapturedResponse<Body>;
  status(code: number): CapturedResponse<Body>;
}

interface FakeNotificationTemplateService {
  listNotificationTemplates: ReturnType<typeof vi.fn>;
  createNotificationTemplates: ReturnType<typeof vi.fn>;
  retrieveNotificationTemplate: ReturnType<typeof vi.fn>;
  updateNotificationTemplates: ReturnType<typeof vi.fn>;
  deleteNotificationTemplates: ReturnType<typeof vi.fn>;
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

function makeResponse<Body = unknown>(): MedusaResponse<Body> &
  CapturedResponse<Body> {
  const response: CapturedResponse<Body> = {
    json(payload) {
      response.payload = payload;
      return response;
    },
    status(code) {
      response.statusCode = code;
      return response;
    },
  };

  return response as MedusaResponse<Body> & CapturedResponse<Body>;
}

function makeService(): FakeNotificationTemplateService {
  return {
    listNotificationTemplates: vi.fn(),
    createNotificationTemplates: vi.fn(),
    retrieveNotificationTemplate: vi.fn(),
    updateNotificationTemplates: vi.fn(),
    deleteNotificationTemplates: vi.fn(),
  };
}

function makeNotificationModule() {
  return {
    createNotifications: vi.fn(
      async (data: NotificationTypes.CreateNotificationDTO) =>
        ({
          id: "noti_test",
          to: data.to,
          from: data.from,
          channel: data.channel,
          template: data.template ?? "",
          data: data.data ?? null,
          provider_id: "np_sms",
          provider: {
            id: "np_sms",
            handle: "sms",
            name: "SMS",
            channels: [CHANNEL],
          },
          created_at: new Date("2026-06-12T00:00:00.000Z"),
          status: "success",
        }) satisfies NotificationTypes.NotificationDTO,
    ),
  };
}

function makeRequest(input: {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  service: FakeNotificationTemplateService;
  notificationModule?: ReturnType<typeof makeNotificationModule>;
}): MedusaRequest {
  const notificationModule = input.notificationModule ?? makeNotificationModule();
  return {
    body: input.body,
    params: input.params ?? {},
    query: input.query ?? {},
    scope: {
      resolve: vi.fn((key: string) =>
        key === NOTIFICATIONS_MODULE ? input.service : notificationModule,
      ),
    },
  } as unknown as MedusaRequest;
}

describe("Notification Template Admin API CRUD routes", () => {
  it("creates, lists, gets, updates, and deletes templates through the module service", async () => {
    const service = makeService();
    const created = template({ id: "ntpl_created" });
    const updated = template({ id: "ntpl_created", enabled: false });
    service.createNotificationTemplates.mockResolvedValue(created);
    service.listNotificationTemplates.mockResolvedValue([created]);
    service.retrieveNotificationTemplate.mockResolvedValue(created);
    service.updateNotificationTemplates.mockResolvedValue([updated]);
    service.deleteNotificationTemplates.mockResolvedValue(undefined);

    const createResponse = makeResponse();
    await createTemplate(
      makeRequest({
        service,
        body: {
          event: EVENTS.ORDER_PLACED,
          body: created.body,
        },
      }),
      createResponse,
    );

    expect(service.createNotificationTemplates).toHaveBeenCalledWith({
      channel: CHANNEL,
      event: EVENTS.ORDER_PLACED,
      locale: "ar",
      body: created.body,
      enabled: true,
      from: null,
    });
    expect(createResponse.payload).toEqual({
      [API_RESPONSE_KEYS.TEMPLATE]: created,
    });

    const listResponse = makeResponse();
    await listTemplates(
      makeRequest({
        service,
        query: { event: EVENTS.ORDER_PLACED, enabled: "true" },
      }),
      listResponse,
    );

    expect(service.listNotificationTemplates).toHaveBeenCalledWith({
      event: EVENTS.ORDER_PLACED,
      enabled: true,
    });
    expect(listResponse.payload).toEqual({
      [API_RESPONSE_KEYS.TEMPLATES]: [created],
    });

    const getResponse = makeResponse();
    await getTemplate(
      makeRequest({ service, params: { id: created.id } }),
      getResponse,
    );
    expect(service.retrieveNotificationTemplate).toHaveBeenCalledWith(created.id);
    expect(getResponse.payload).toEqual({
      [API_RESPONSE_KEYS.TEMPLATE]: created,
    });

    const updateResponse = makeResponse();
    await updateTemplate(
      makeRequest({
        service,
        params: { id: created.id },
        body: { enabled: false },
      }),
      updateResponse,
    );
    expect(service.updateNotificationTemplates).toHaveBeenCalledWith({
      selector: { id: created.id },
      data: { enabled: false },
    });
    expect(updateResponse.payload).toEqual({
      [API_RESPONSE_KEYS.TEMPLATE]: updated,
    });

    const deleteResponse = makeResponse();
    await DELETE(
      makeRequest({ service, params: { id: created.id } }),
      deleteResponse,
    );
    expect(service.deleteNotificationTemplates).toHaveBeenCalledWith(created.id);
    expect(deleteResponse.payload).toEqual({
      [API_RESPONSE_KEYS.TEMPLATE]: { id: created.id },
    });
  });

  it("returns 400 for bad payloads instead of throwing a 500", async () => {
    const service = makeService();
    const response = makeResponse();

    await createTemplate(
      makeRequest({
        service,
        body: { event: EVENTS.ORDER_PLACED, body: "" },
      }),
      response,
    );

    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(response.payload).toEqual({
      [API_RESPONSE_KEYS.ERROR]: expect.objectContaining({
        code: "invalid_input",
        message: expect.stringContaining("invalid"),
      }),
    });
    expect(service.createNotificationTemplates).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid list filters and delete params", async () => {
    const service = makeService();
    const listResponse = makeResponse();

    await listTemplates(
      makeRequest({
        service,
        query: { enabled: "maybe" },
      }),
      listResponse,
    );

    expect(listResponse.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    const deleteResponse = makeResponse();
    await DELETE(
      makeRequest({ service, params: { id: "" } }),
      deleteResponse,
    );

    expect(deleteResponse.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(service.deleteNotificationTemplates).not.toHaveBeenCalled();
  });

  it("returns 404 for missing template reads and updates", async () => {
    const service = makeService();
    service.retrieveNotificationTemplate.mockResolvedValue(null);
    service.updateNotificationTemplates.mockResolvedValue([]);

    const getResponse = makeResponse();
    await getTemplate(
      makeRequest({ service, params: { id: "ntpl_missing" } }),
      getResponse,
    );
    expect(getResponse.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    expect(getResponse.payload).toEqual({
      [API_RESPONSE_KEYS.ERROR]: expect.objectContaining({
        message: expect.stringContaining("not found"),
      }),
    });

    const updateResponse = makeResponse();
    await updateTemplate(
      makeRequest({
        service,
        params: { id: "ntpl_missing" },
        body: { enabled: false },
      }),
      updateResponse,
    );
    expect(updateResponse.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    expect(updateResponse.payload).toEqual({
      [API_RESPONSE_KEYS.ERROR]: expect.objectContaining({
        message: expect.stringContaining("not found"),
      }),
    });
  });

  it("returns 400 for an empty update body", async () => {
    const service = makeService();
    const response = makeResponse();

    await updateTemplate(
      makeRequest({
        service,
        params: { id: "ntpl_order_placed_ar" },
        body: {},
      }),
      response,
    );

    expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(service.updateNotificationTemplates).not.toHaveBeenCalled();
  });

  it("normalizes raw list filter booleans defensively", () => {
    expect(toTemplateFilters({ enabled: "true" })).toEqual({ enabled: true });
    expect(toTemplateFilters({ enabled: "false" })).toEqual({ enabled: false });
  });
});

describe("Notification Template Admin API preview and send-test routes", () => {
  it("renders preview text from a stored template without creating a notification", async () => {
    const service = makeService();
    const notificationModule = makeNotificationModule();
    const storedTemplate = template();
    service.retrieveNotificationTemplate.mockResolvedValue(storedTemplate);
    const response = makeResponse();

    await previewTemplate(
      makeRequest({
        service,
        notificationModule,
        body: { id: storedTemplate.id },
      }),
      response,
    );

    expect(response.payload).toEqual({
      [API_RESPONSE_KEYS.PREVIEW]: expect.objectContaining({
        template_id: storedTemplate.id,
        text: "تم استلام طلبك رقم 1001 بإجمالي 123.45 SAR.",
      }),
    });
    expect(notificationModule.createNotifications).not.toHaveBeenCalled();
  });

  it("returns 400 or 404 for invalid preview requests", async () => {
    const service = makeService();
    const badResponse = makeResponse();

    await previewTemplate(
      makeRequest({
        service,
        body: {},
      }),
      badResponse,
    );

    expect(badResponse.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    service.retrieveNotificationTemplate.mockResolvedValue(null);
    const missingResponse = makeResponse();
    await previewTemplate(
      makeRequest({
        service,
        body: { id: "ntpl_missing" },
      }),
      missingResponse,
    );

    expect(missingResponse.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it("creates one sms notification for send-test with rendered content text", async () => {
    const service = makeService();
    const notificationModule = makeNotificationModule();
    const storedTemplate = template();
    service.retrieveNotificationTemplate.mockResolvedValue(storedTemplate);
    const response = makeResponse();

    await sendTestTemplate(
      makeRequest({
        service,
        notificationModule,
        body: { id: storedTemplate.id, to: "+966500000000" },
      }),
      response,
    );

    expect(notificationModule.createNotifications).toHaveBeenCalledWith({
      to: "+966500000000",
      from: null,
      channel: CHANNEL,
      template: storedTemplate.id,
      data: expect.any(Object),
      content: {
        text: "تم استلام طلبك رقم 1001 بإجمالي 123.45 SAR.",
      },
      trigger_type: "notification.send_test",
      resource_id: storedTemplate.id,
      resource_type: "notification_template",
    });
    expect(response.payload).toEqual({
      [API_RESPONSE_KEYS.STATUS]: SEND_TEST_STATUS.SENT,
      [API_RESPONSE_KEYS.PREVIEW]: expect.objectContaining({
        text: "تم استلام طلبك رقم 1001 بإجمالي 123.45 SAR.",
      }),
      [API_RESPONSE_KEYS.NOTIFICATION]: expect.objectContaining({
        id: "noti_test",
      }),
    });
  });

  it("returns 400 or 404 for invalid send-test requests", async () => {
    const service = makeService();
    const notificationModule = makeNotificationModule();
    const badResponse = makeResponse();

    await sendTestTemplate(
      makeRequest({
        service,
        notificationModule,
        body: { id: "ntpl_order_placed_ar" },
      }),
      badResponse,
    );

    expect(badResponse.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(notificationModule.createNotifications).not.toHaveBeenCalled();

    service.retrieveNotificationTemplate.mockResolvedValue(null);
    const missingResponse = makeResponse();
    await sendTestTemplate(
      makeRequest({
        service,
        notificationModule,
        body: { id: "ntpl_missing", to: "+966500000000" },
      }),
      missingResponse,
    );

    expect(missingResponse.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    expect(notificationModule.createNotifications).not.toHaveBeenCalled();
  });

  it("skips the live send-test variant without the explicit env gate", async () => {
    const previousGate = process.env[SEND_TEST_ENV.LIVE_ENABLED];
    delete process.env[SEND_TEST_ENV.LIVE_ENABLED];
    try {
      const service = makeService();
      const notificationModule = makeNotificationModule();
      const response = makeResponse();

      await sendTestTemplate(
        makeRequest({
          service,
          notificationModule,
          body: {
            id: "ntpl_order_placed_ar",
            to: "+966500000000",
            live: true,
          },
        }),
        response,
      );

      expect(notificationModule.createNotifications).not.toHaveBeenCalled();
      expect(response.payload).toEqual({
        [API_RESPONSE_KEYS.STATUS]: SEND_TEST_STATUS.SKIPPED,
        [API_RESPONSE_KEYS.REASON]: SEND_TEST_SKIP_REASONS.LIVE_DISABLED,
        [API_RESPONSE_KEYS.ERROR]: expect.objectContaining({
          code: SEND_TEST_SKIP_REASONS.LIVE_DISABLED,
        }),
      });
    } finally {
      if (previousGate === undefined) {
        delete process.env[SEND_TEST_ENV.LIVE_ENABLED];
      } else {
        process.env[SEND_TEST_ENV.LIVE_ENABLED] = previousGate;
      }
    }
  });
});
