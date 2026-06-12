import { describe, expect, it, vi } from "vitest";

import { KsaError } from "@medusa-ksa/core";

import {
  DEFAULT_NATIONAL_ADDRESS_BASE_URL,
  SPL_CACHE_STATE,
  SPL_ENDPOINTS,
  SPL_FIELD,
  SPL_FORMAT,
  SPL_LANGUAGE,
} from "./constants.js";
import { SplClient } from "./spl-client.js";

const API_KEY = "spl_secret_key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SplClient", () => {
  it("resolves a short address through the verified unversioned SPL endpoint", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers[SPL_FIELD.API_KEY]).toBe(API_KEY);
      const english = String(url).includes(
        `${SPL_FIELD.LANGUAGE}=${SPL_LANGUAGE.EN}`,
      );

      return jsonResponse({
        totalSearchResults: "1",
        success: true,
        Addresses: [
          {
            Address1: english
              ? "8228 King Abdulaziz Road - Al Amal"
              : "8228 طريق الملك عبدالعزيز - العمل",
            Address2: english ? "Riyadh 12643 - 2121" : "الرياض 12643 - 2121",
            BuildingNumber: "8228",
            Street: english ? "King Abdulaziz Road" : "طريق الملك عبدالعزيز",
            District: english ? "Al Amal" : "العمل",
            City: english ? "Riyadh" : "الرياض",
            PostCode: "12643",
            AdditionalNumber: "2121",
            RegionName: english ? "Riyadh" : "الرياض",
          },
        ],
      });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = new SplClient({
      apiKey: API_KEY,
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
    });

    const result = await client.resolveShortAddress("RRRD2929");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${DEFAULT_NATIONAL_ADDRESS_BASE_URL}${SPL_ENDPOINTS.RESOLVE}?${SPL_FIELD.FORMAT}=${SPL_FORMAT.JSON}&${SPL_FIELD.LANGUAGE}=${SPL_LANGUAGE.AR}&${SPL_FIELD.SHORT_ADDRESS}=RRRD2929`,
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `${SPL_FIELD.LANGUAGE}=${SPL_LANGUAGE.EN}`,
    );
    expect(result).toMatchObject({
      found: true,
      short_address: "RRRD2929",
      address: {
        building_number: "8228",
        post_code: "12643",
        additional_number: "2121",
        city: { ar: "الرياض", en: "Riyadh" },
      },
    });
  });

  it("officially verifies building number, post code, and additional number", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      jsonResponse({
        addressfound: true,
        success: true,
        statusdescription: null,
      }),
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = new SplClient({
      apiKey: API_KEY,
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
    });

    const result = await client.verifyNationalAddress({
      buildingNumber: "8228",
      postCode: "12643",
      additionalNumber: "2121",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${DEFAULT_NATIONAL_ADDRESS_BASE_URL}${SPL_ENDPOINTS.VERIFY}?${SPL_FIELD.FORMAT}=${SPL_FORMAT.JSON}&${SPL_FIELD.LANGUAGE}=${SPL_LANGUAGE.EN}&${SPL_FIELD.BUILDING_NUMBER}=8228&${SPL_FIELD.ADDITIONAL_NUMBER}=2121&${SPL_FIELD.ZIP_CODE}=12643`,
    );
    expect(result).toEqual({
      verified: true,
      cache_state: SPL_CACHE_STATE.MISS,
    });
  });

  it("redacts the API key from upstream failures", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      jsonResponse(
        {
          message: `Access denied for ${API_KEY}`,
        },
        401,
      ),
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = new SplClient({
      apiKey: API_KEY,
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
    });

    await expect(
      client.verifyNationalAddress({
        buildingNumber: "8228",
        postCode: "12643",
        additionalNumber: "2121",
      }),
    ).rejects.toThrow(KsaError);

    await expect(
      client.verifyNationalAddress({
        buildingNumber: "8228",
        postCode: "12643",
        additionalNumber: "2121",
      }),
    ).rejects.not.toThrow(API_KEY);
  });
});
