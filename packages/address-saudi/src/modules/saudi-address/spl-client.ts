import { HttpClient } from "@medusa-ksa/core";

import {
  DEFAULT_NATIONAL_ADDRESS_BASE_URL,
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_MS,
  HTTP_METHOD,
  SHORT_ADDRESS_PATTERN,
  SPL_CACHE_STATE,
  SPL_ENDPOINTS,
  SPL_FIELD,
  SPL_FORMAT,
  SPL_LANGUAGE,
  SPL_RESOLVE_STATUS,
  SPL_RESPONSE_FIELD,
} from "./constants.js";
import type {
  SaudiAddressOfficialVerifyInput,
  SaudiAddressOfficialVerifyResult,
  SaudiAddressResolveInput,
  SaudiAddressResolveSuccessResult,
  SplBilingualField,
  SplClientContract,
  SplResolvedAddress,
} from "./types.js";

/** Constructor options for the optional SPL National Address adapter. */
export interface SplClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  retry?: { retries: number; baseDelayMs: number };
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  source: UnknownRecord | undefined,
  field: string,
): string | undefined {
  const value = source?.[field];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }
  const stringValue = String(value).trim();
  return stringValue === "" ? undefined : stringValue;
}

function booleanField(source: UnknownRecord, field: string): boolean {
  const value = source[field];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }
  return Boolean(value);
}

function numberFromUnknown(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstAddress(response: unknown): UnknownRecord | undefined {
  if (!isRecord(response)) {
    return undefined;
  }
  const addresses = response[SPL_RESPONSE_FIELD.ADDRESSES];
  if (!Array.isArray(addresses)) {
    return undefined;
  }
  const first: unknown = addresses[0];
  return isRecord(first) ? first : undefined;
}

function resultCount(response: unknown): number {
  if (!isRecord(response)) {
    return 0;
  }
  return numberFromUnknown(response[SPL_RESPONSE_FIELD.TOTAL_SEARCH_RESULTS]);
}

function bilingual(
  ar: UnknownRecord | undefined,
  en: UnknownRecord | undefined,
  field: string,
): SplBilingualField | undefined {
  const value = {
    ar: stringField(ar, field),
    en: stringField(en, field),
  };
  if (value.ar === undefined && value.en === undefined) {
    return undefined;
  }
  return value;
}

function firstDefined(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined);
}

function latLongFromObjectField(
  arAddress: UnknownRecord | undefined,
  enAddress: UnknownRecord | undefined,
  index: number,
): string | undefined {
  const field = firstDefined(
    stringField(arAddress, SPL_RESPONSE_FIELD.OBJECT_LAT_LONG),
    stringField(enAddress, SPL_RESPONSE_FIELD.OBJECT_LAT_LONG),
  );
  const parts = field?.split(/\s+/).filter(Boolean);
  return parts?.[index];
}

function normalizeShortAddress(input: SaudiAddressResolveInput | string): string {
  const raw = typeof input === "string" ? input : input.shortAddress;
  return raw.trim().toUpperCase();
}

function normalizeResolvedAddress(
  arAddress: UnknownRecord | undefined,
  enAddress: UnknownRecord | undefined,
): SplResolvedAddress | undefined {
  if (arAddress === undefined && enAddress === undefined) {
    return undefined;
  }
  const address: SplResolvedAddress = {
    address_line_1: bilingual(arAddress, enAddress, SPL_RESPONSE_FIELD.ADDRESS_1),
    address_line_2: bilingual(arAddress, enAddress, SPL_RESPONSE_FIELD.ADDRESS_2),
    building_number: firstDefined(
      stringField(arAddress, SPL_RESPONSE_FIELD.BUILDING_NUMBER),
      stringField(enAddress, SPL_RESPONSE_FIELD.BUILDING_NUMBER),
    ),
    street: bilingual(arAddress, enAddress, SPL_RESPONSE_FIELD.STREET),
    district: bilingual(arAddress, enAddress, SPL_RESPONSE_FIELD.DISTRICT),
    city: bilingual(arAddress, enAddress, SPL_RESPONSE_FIELD.CITY),
    post_code: firstDefined(
      stringField(arAddress, SPL_RESPONSE_FIELD.POST_CODE),
      stringField(enAddress, SPL_RESPONSE_FIELD.POST_CODE),
    ),
    additional_number: firstDefined(
      stringField(arAddress, SPL_RESPONSE_FIELD.ADDITIONAL_NUMBER),
      stringField(enAddress, SPL_RESPONSE_FIELD.ADDITIONAL_NUMBER),
    ),
    region: bilingual(arAddress, enAddress, SPL_RESPONSE_FIELD.REGION_NAME),
    latitude: firstDefined(
      stringField(arAddress, SPL_RESPONSE_FIELD.LATITUDE),
      stringField(enAddress, SPL_RESPONSE_FIELD.LATITUDE),
      latLongFromObjectField(arAddress, enAddress, 2),
    ),
    longitude: firstDefined(
      stringField(arAddress, SPL_RESPONSE_FIELD.LONGITUDE),
      stringField(enAddress, SPL_RESPONSE_FIELD.LONGITUDE),
      latLongFromObjectField(arAddress, enAddress, 1),
    ),
  };

  const hasValue = Object.values(address).some((value) => value !== undefined);
  return hasValue ? address : undefined;
}

function normalizeResolveResponse(
  shortAddress: string,
  arResponse: unknown,
  enResponse: unknown,
): SaudiAddressResolveSuccessResult {
  const found = resultCount(arResponse) > 0 || resultCount(enResponse) > 0;
  const address = normalizeResolvedAddress(
    firstAddress(arResponse),
    firstAddress(enResponse),
  );
  return {
    status: found ? SPL_RESOLVE_STATUS.FOUND : SPL_RESOLVE_STATUS.NOT_FOUND,
    cache_state: SPL_CACHE_STATE.MISS,
    short_address: shortAddress,
    found,
    ...(address === undefined ? {} : { address }),
  };
}

function normalizeVerifyResponse(
  response: unknown,
): SaudiAddressOfficialVerifyResult {
  const record = isRecord(response) ? response : {};
  return {
    verified: booleanField(record, SPL_RESPONSE_FIELD.ADDRESS_FOUND),
    cache_state: SPL_CACHE_STATE.MISS,
  };
}

/** Optional SPL National Address API adapter over the shared core HttpClient. */
export class SplClient implements SplClientContract {
  private readonly http: HttpClient;

  constructor(options: SplClientOptions) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_NATIONAL_ADDRESS_BASE_URL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      auth: { type: "api-key", header: SPL_FIELD.API_KEY, value: options.apiKey },
      retry: options.retry ?? {
        retries: DEFAULT_RETRY.RETRIES,
        baseDelayMs: DEFAULT_RETRY.BASE_DELAY_MS,
      },
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    });
  }

  /** Resolve a Saudi short address using the unversioned SPL endpoint. */
  async resolveShortAddress(
    input: SaudiAddressResolveInput | string,
  ): Promise<SaudiAddressResolveSuccessResult> {
    const shortAddress = normalizeShortAddress(input);
    if (!SHORT_ADDRESS_PATTERN.test(shortAddress)) {
      return {
        status: SPL_RESOLVE_STATUS.NOT_FOUND,
        cache_state: SPL_CACHE_STATE.MISS,
        short_address: shortAddress,
        found: false,
      };
    }

    const [arResponse, enResponse] = await Promise.all([
      this.resolveLanguage(shortAddress, SPL_LANGUAGE.AR),
      this.resolveLanguage(shortAddress, SPL_LANGUAGE.EN),
    ]);

    return normalizeResolveResponse(shortAddress, arResponse, enResponse);
  }

  /** Verify a full National Address tuple through SPL's official verify API. */
  async verifyNationalAddress(
    input: SaudiAddressOfficialVerifyInput,
  ): Promise<SaudiAddressOfficialVerifyResult> {
    const response = await this.http.request<unknown>({
      method: HTTP_METHOD.GET,
      path: SPL_ENDPOINTS.VERIFY,
      query: {
        [SPL_FIELD.FORMAT]: SPL_FORMAT.JSON,
        [SPL_FIELD.LANGUAGE]: SPL_LANGUAGE.EN,
        [SPL_FIELD.BUILDING_NUMBER]: input.buildingNumber,
        [SPL_FIELD.ADDITIONAL_NUMBER]: input.additionalNumber,
        [SPL_FIELD.ZIP_CODE]: input.postCode,
      },
    });

    return normalizeVerifyResponse(response);
  }

  private async resolveLanguage(
    shortAddress: string,
    language: (typeof SPL_LANGUAGE)[keyof typeof SPL_LANGUAGE],
  ): Promise<unknown> {
    return await this.http.request<unknown>({
      method: HTTP_METHOD.GET,
      path: SPL_ENDPOINTS.RESOLVE,
      query: {
        [SPL_FIELD.FORMAT]: SPL_FORMAT.JSON,
        [SPL_FIELD.LANGUAGE]: language,
        [SPL_FIELD.SHORT_ADDRESS]: shortAddress,
      },
    });
  }
}
