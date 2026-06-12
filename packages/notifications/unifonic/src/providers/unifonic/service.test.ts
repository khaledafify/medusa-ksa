import { describe, expect, it, vi } from "vitest";

import { MedusaError } from "@medusajs/framework/utils";

import { KsaError, KsaErrorCodes } from "@medusa-ksa/core";

import { CHANNEL, PROVIDER_ID } from "./constants.js";
import { UnifonicNotificationProviderService } from "./service.js";
import type { UnifonicClient } from "./client.js";
import type { UnifonicSendInput } from "./types.js";

const APP_SID = "app_secret_service";

const OPTIONS = {
  appSid: APP_SID,
  senderId: "DefaultSender",
};

function makeService(
  client: Partial<Pick<UnifonicClient, "sendSms">>,
): UnifonicNotificationProviderService {
  const service = new UnifonicNotificationProviderService({}, OPTIONS);
  Reflect.set(service, "client_", client);
  return service;
}

function notification(
  overrides: Partial<Parameters<UnifonicNotificationProviderService["send"]>[0]> = {},
): Parameters<UnifonicNotificationProviderService["send"]>[0] {
  return {
    to: "0501234567",
    channel: CHANNEL,
    template: "order-placed",
    content: { text: "مرحبا من مدوسة" },
    ...overrides,
  };
}

describe("UnifonicNotificationProviderService options", () => {
  it("registers under the unifonic identifier", () => {
    expect(UnifonicNotificationProviderService.identifier).toBe(PROVIDER_ID);
  });

  it("static validateOptions accepts valid options", () => {
    expect(() =>
      UnifonicNotificationProviderService.validateOptions(OPTIONS),
    ).not.toThrow();
  });

  it("static validateOptions throws on invalid options", () => {
    expect(() =>
      UnifonicNotificationProviderService.validateOptions({ senderId: "Sender" }),
    ).toThrowError(ENV_APP_SID_PATTERN);
  });
});

describe("UnifonicNotificationProviderService.send", () => {
  it("sends a valid SMS with the default sender and returns the message id", async () => {
    const sendSms = vi.fn(async (_input: UnifonicSendInput) => ({
      id: "42000348806924",
    }));
    const service = makeService({ sendSms });

    const result = await service.send(notification());

    expect(result).toEqual({ id: "42000348806924" });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith({
      appSid: APP_SID,
      senderId: OPTIONS.senderId,
      body: "مرحبا من مدوسة",
      recipient: "+966501234567",
    });
  });

  it("uses notification.from as the SenderID override", async () => {
    const sendSms = vi.fn(async (_input: UnifonicSendInput) => ({ id: "msg_1" }));
    const service = makeService({ sendSms });

    await service.send(notification({ from: "OverrideSender" }));

    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: "OverrideSender" }),
    );
  });

  it("preserves Arabic Unicode body byte-for-byte", async () => {
    const arabicBody = "تم استلام طلبك رقم ١٢٣";
    const sendSms = vi.fn(async (_input: UnifonicSendInput) => ({ id: "msg_1" }));
    const service = makeService({ sendSms });

    await service.send(notification({ content: { text: arabicBody } }));

    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ body: arabicBody }),
    );
  });

  it("rejects a template notification without content.text and does not POST", async () => {
    const sendSms = vi.fn(async (_input: UnifonicSendInput) => ({ id: "msg_1" }));
    const service = makeService({ sendSms });

    await expect(service.send(notification({ content: null }))).rejects.toSatisfy(
      (err) =>
        MedusaError.isMedusaError(err) &&
        (err as Error).message.includes("content.text"),
    );

    expect(sendSms).not.toHaveBeenCalled();
  });

  it("rejects an unparseable recipient and does not POST", async () => {
    const sendSms = vi.fn(async (_input: UnifonicSendInput) => ({ id: "msg_1" }));
    const service = makeService({ sendSms });

    await expect(service.send(notification({ to: "12345" }))).rejects.toSatisfy(
      (err) =>
        MedusaError.isMedusaError(err) &&
        (err as Error).message.includes("recipient"),
    );

    expect(sendSms).not.toHaveBeenCalled();
  });

  it("rejects a missing sender and does not POST", async () => {
    const sendSms = vi.fn(async (_input: UnifonicSendInput) => ({ id: "msg_1" }));
    const service = makeService({ sendSms });
    Reflect.set(service, "options_", { ...OPTIONS, senderId: "" });

    await expect(service.send(notification())).rejects.toSatisfy(
      (err) =>
        MedusaError.isMedusaError(err) &&
        (err as Error).message.includes("sender"),
    );

    expect(sendSms).not.toHaveBeenCalled();
  });

  it("maps a Unifonic non-success body to a Medusa error without leaking AppSid", async () => {
    const sendSms = vi.fn(async (_input: UnifonicSendInput) => {
      throw new KsaError(`Unifonic rejected ${APP_SID}`, {
        prefix: PROVIDER_ID,
        code: KsaErrorCodes.PROVIDER_ERROR,
      });
    });
    const service = makeService({ sendSms });

    await expect(service.send(notification())).rejects.toSatisfy((err) => {
      expect(MedusaError.isMedusaError(err)).toBe(true);
      expect((err as Error).message).not.toContain(APP_SID);
      return true;
    });
  });
});

const ENV_APP_SID_PATTERN = /UNIFONIC_APP_SID/;
