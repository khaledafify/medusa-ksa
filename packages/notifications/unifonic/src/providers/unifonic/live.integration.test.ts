import { describe, expect, it } from "vitest";

import { CHANNEL } from "./constants.js";
import { UnifonicNotificationProviderService } from "./service.js";

const APP_SID = process.env.UNIFONIC_APP_SID;
const SENDER_ID = process.env.UNIFONIC_SENDER_ID;
const BASE_URL = process.env.UNIFONIC_BASE_URL;
const TEST_RECIPIENT = process.env.UNIFONIC_TEST_RECIPIENT;

const describeIfConfigured =
  APP_SID && SENDER_ID && TEST_RECIPIENT ? describe : describe.skip;

describeIfConfigured("Unifonic live SMS", () => {
  it("sends a real SMS only when live credentials are present", async () => {
    if (!APP_SID || !SENDER_ID || !TEST_RECIPIENT) {
      throw new Error("UNIFONIC live test credentials are missing");
    }

    const service = new UnifonicNotificationProviderService(
      {},
      {
        appSid: APP_SID,
        senderId: SENDER_ID,
        ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
      },
    );

    const result = await service.send({
      to: TEST_RECIPIENT,
      channel: CHANNEL,
      template: "live-unifonic-sms",
      content: {
        text: `Medusa KSA Unifonic live test ${new Date().toISOString()}`,
      },
    });

    expect(result.id).toMatch(/\S/);
  });
});
