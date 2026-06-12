import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils";
import type {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  ValidateFulfillmentDataContext,
} from "@medusajs/framework/types";

import { KsaError, KsaErrorCodes, toMedusaError } from "@medusa-ksa/core";
import type { KsaErrorCode } from "@medusa-ksa/core";

import { TorodClient } from "./client.js";
import {
  DEFAULTS,
  FULFILLMENT_DATA_KEYS,
  MEDUSA_CONTEXT_FIELDS,
  PROVIDER_ID,
  TOROD_ENDPOINTS,
  TOROD_ERROR_MESSAGES,
  TOROD_HTTP_METHOD,
  TOROD_PREFIX,
  TOROD_REQUEST_FIELDS,
  TOROD_RESPONSE_FIELDS,
  courierCodeFromOptionId,
  optionIdForCourier,
} from "./constants.js";
import { resolveTorodOptions } from "./options.js";
import type { TorodOptions } from "./options.js";

interface TorodCourierPartnersResponse {
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
}

interface TorodCitiesResponse {
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
}

interface TorodRatesResponse {
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
}

interface TorodResolvedCity {
  cityId: string;
  cityName: string;
}

type TorodCityContext = Pick<
  CalculateShippingOptionPriceDTO["context"],
  "shipping_address"
>;

/**
 * Medusa v2 Fulfillment provider for the Torod courier aggregator.
 *
 * Courier options come from Torod; rates, booking, cancellation, labels, and
 * returns are filled in by the later ordered tasks from the Phase 4 plan.
 */
export class TorodFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static override identifier = PROVIDER_ID;

  protected readonly options_: TorodOptions;
  protected readonly client_: TorodClient;

  /** Fail-fast boot validation via the shared core option resolver. */
  static validateOptions(options: Record<string, unknown>): void {
    resolveTorodOptions(options);
  }

  constructor(_cradle: Record<string, unknown>, config: Record<string, unknown>) {
    super();

    this.options_ = resolveTorodOptions(config);
    this.client_ = new TorodClient({
      clientId: this.options_.clientId,
      clientSecret: this.options_.clientSecret,
      baseUrl: this.options_.baseUrl,
      timeoutMs: this.options_.timeoutMs,
      retry: this.options_.retry,
    });
  }

  /**
   * Medusa calls this while creating Shipping Options in the native admin.
   */
  override async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    try {
      const response =
        await this.client_.request<TorodCourierPartnersResponse>({
          method: TOROD_HTTP_METHOD.GET,
          path: TOROD_ENDPOINTS.COURIERS,
        });

      return this.courierOptionsFromResponse(response);
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * Shipping option data validation hook.
   *
   * T2.2/T2.4 will require and validate the selected Torod courier data.
   */
  override validateOption(_data: Record<string, unknown>): Promise<boolean> {
    return Promise.resolve(true);
  }

  /**
   * Checkout shipping-method data validation hook.
   *
   * Resolves serviceability and persists Torod city metadata onto fulfillment
   * data so later rate/booking calls do not infer from free-text city names.
   */
  override async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext,
  ): Promise<Record<string, unknown>> {
    try {
      const city = await this.customerCity(data, context);
      return {
        ...data,
        [FULFILLMENT_DATA_KEYS.CITY_CODE]: city.cityId,
        [FULFILLMENT_DATA_KEYS.CITY_NAME]: city.cityName,
      };
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * Medusa calculated-price capability check.
   *
   * Destination serviceability is checked during price calculation until T2.4
   * moves city validation into `validateFulfillmentData`.
   */
  override canCalculate(data: CreateShippingOptionDTO): Promise<boolean> {
    return Promise.resolve(this.courierCodeFromData(data.data ?? {}) !== undefined);
  }

  /**
   * Medusa calculated-price contract.
   *
   * Return type is `CalculatedShippingOptionPrice`; missing required Torod
   * inputs throw instead of fabricating a rate.
   */
  override async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"],
  ): Promise<CalculatedShippingOptionPrice> {
    try {
      const courierCode = this.selectedCourierCode(optionData);
      const rateRequest = await this.rateRequest(optionData, data, context);
      const response = await this.client_.request<TorodRatesResponse>({
        method: TOROD_HTTP_METHOD.POST,
        path: TOROD_ENDPOINTS.RATES,
        body: rateRequest,
      });
      const rate = this.selectedCourierRate(response, courierCode);

      return {
        calculated_amount: rate,
        is_calculated_price_tax_inclusive: false,
      };
    } catch (err) {
      throw toMedusaError(err);
    }
  }

  /**
   * Medusa order-fulfillment booking contract.
   *
   * T3.1 replaces this guard with Torod's two-step booking flow.
   */
  override createFulfillment(
    _data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    _order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>,
  ): Promise<CreateFulfillmentResult> {
    return Promise.reject(
      this.providerError(TOROD_ERROR_MESSAGES.BOOKING_NOT_READY),
    );
  }

  /**
   * Medusa fulfillment-cancel contract.
   *
   * T3.3 replaces this guard with Torod cancellation semantics.
   */
  override cancelFulfillment(
    _data: Record<string, unknown>,
  ): Promise<Record<string, never>> {
    return Promise.reject(
      this.providerError(TOROD_ERROR_MESSAGES.CANCELLATION_NOT_READY),
    );
  }

  /**
   * Medusa fulfillment-documents contract.
   *
   * Later booking work will expose the stored Torod label URL.
   */
  override getFulfillmentDocuments(_data: Record<string, unknown>): Promise<never[]> {
    return Promise.resolve([]);
  }

  /**
   * Medusa return-booking contract.
   *
   * Returns remain deferred because Torod exposes no public return-booking API.
   */
  override createReturnFulfillment(
    _fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    return Promise.reject(
      this.providerError(TOROD_ERROR_MESSAGES.RETURNS_DEFERRED),
    );
  }

  /** Returns documents are unavailable while returns are deferred. */
  override getReturnDocuments(_data: Record<string, unknown>): Promise<never[]> {
    return Promise.resolve([]);
  }

  /** Shipment documents are unavailable until T3.2 stores Torod labels. */
  override getShipmentDocuments(_data: Record<string, unknown>): Promise<never[]> {
    return Promise.resolve([]);
  }

  /** Generic document retrieval is unavailable until T3.2 stores Torod labels. */
  override retrieveDocuments(
    _fulfillmentData: Record<string, unknown>,
    _documentType: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  private courierOptionsFromResponse(
    response: TorodCourierPartnersResponse,
  ): FulfillmentOption[] {
    const couriers = response[TOROD_RESPONSE_FIELDS.DATA];
    if (!Array.isArray(couriers)) {
      throw this.providerError(TOROD_ERROR_MESSAGES.COURIERS_DATA_MALFORMED);
    }

    const seenOptionIds = new Set<string>();
    return couriers.map((courier) => {
      const option = this.courierOption(courier);
      if (seenOptionIds.has(option.id)) {
        throw this.providerError(TOROD_ERROR_MESSAGES.COURIER_ID_DUPLICATE);
      }
      seenOptionIds.add(option.id);
      return option;
    });
  }

  private async rateRequest(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: CalculateShippingOptionPriceDTO["context"],
  ): Promise<Record<string, string | number>> {
    const warehouse = this.warehouseCode(optionData, data, context);
    const weight = this.shipmentWeight(context);
    const orderTotal = this.orderTotal(context);
    const boxCount = this.boxCount(data);
    const payment = this.stringField(data, FULFILLMENT_DATA_KEYS.PAYMENT_METHOD) ??
      DEFAULTS.PAYMENT;
    const shipmentType =
      this.stringField(data, FULFILLMENT_DATA_KEYS.SHIPMENT_TYPE) ??
      DEFAULTS.SHIPMENT_TYPE;
    const customerCityId = await this.customerCityId(data, context);

    return {
      [TOROD_REQUEST_FIELDS.WAREHOUSE]: warehouse,
      [TOROD_REQUEST_FIELDS.CUSTOMER_CITY_ID]: customerCityId,
      [TOROD_REQUEST_FIELDS.PAYMENT]: payment,
      [TOROD_REQUEST_FIELDS.WEIGHT]: weight,
      [TOROD_REQUEST_FIELDS.ORDER_TOTAL]: orderTotal,
      [TOROD_REQUEST_FIELDS.BOX_COUNT]: boxCount,
      [TOROD_REQUEST_FIELDS.SHIPMENT_TYPE]: shipmentType,
      [TOROD_REQUEST_FIELDS.FILTER_BY]: DEFAULTS.RATE_FILTER,
      [TOROD_REQUEST_FIELDS.IS_INSURANCE]: DEFAULTS.INSURANCE,
    };
  }

  private selectedCourierRate(response: TorodRatesResponse, courierCode: string): number {
    const ratesValue = response[TOROD_RESPONSE_FIELDS.DATA];
    if (!Array.isArray(ratesValue)) {
      throw this.providerError(TOROD_ERROR_MESSAGES.RATE_DATA_MALFORMED);
    }

    const rates = ratesValue as unknown[];
    const selectedRate = rates.find((rate) => {
      if (!this.isRecord(rate)) {
        return false;
      }
      return this.stringField(rate, TOROD_RESPONSE_FIELDS.ID) === courierCode;
    });
    if (!this.isRecord(selectedRate)) {
      throw this.providerError(TOROD_ERROR_MESSAGES.RATE_NOT_FOUND);
    }

    const rate = this.positiveNumberField(selectedRate, TOROD_RESPONSE_FIELDS.RATE);
    if (rate === undefined) {
      throw this.providerError(TOROD_ERROR_MESSAGES.RATE_MISSING);
    }
    return rate;
  }

  private async customerCityId(
    data: Record<string, unknown>,
    context: TorodCityContext,
  ): Promise<string> {
    return (await this.customerCity(data, context)).cityId;
  }

  private async customerCity(
    data: Record<string, unknown>,
    context: TorodCityContext,
  ): Promise<TorodResolvedCity> {
    const resolvedCityId = this.stringField(data, FULFILLMENT_DATA_KEYS.CITY_CODE);
    if (resolvedCityId !== undefined) {
      return {
        cityId: resolvedCityId,
        cityName:
          this.stringField(data, FULFILLMENT_DATA_KEYS.CITY_NAME) ??
          this.shippingCity(context),
      };
    }

    const cityName = this.shippingCity(context);
    const response = await this.client_.request<TorodCitiesResponse>({
      method: TOROD_HTTP_METHOD.GET,
      path: TOROD_ENDPOINTS.CITIES,
      query: {
        [TOROD_REQUEST_FIELDS.PAGE]: 1,
      },
    });
    return this.cityFromResponse(response, cityName);
  }

  private cityFromResponse(
    response: TorodCitiesResponse,
    cityName: string,
  ): TorodResolvedCity {
    const citiesValue = response[TOROD_RESPONSE_FIELDS.DATA];
    if (!Array.isArray(citiesValue)) {
      throw this.providerError(TOROD_ERROR_MESSAGES.CITIES_DATA_MALFORMED);
    }

    const normalizedCity = this.normalizeForMatch(cityName);
    const cities = citiesValue as unknown[];
    const city = cities.find((candidate) =>
      this.cityMatches(candidate, normalizedCity),
    );
    if (!this.isRecord(city)) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.CITY_UNRESOLVABLE,
        KsaErrorCodes.INVALID_INPUT,
      );
    }

    const cityId =
      this.stringField(city, TOROD_RESPONSE_FIELDS.CITIES_ID) ??
      this.stringField(city, TOROD_RESPONSE_FIELDS.ID);
    if (cityId === undefined) {
      throw this.providerError(TOROD_ERROR_MESSAGES.CITY_UNRESOLVABLE);
    }
    return {
      cityId,
      cityName:
        this.stringField(city, TOROD_RESPONSE_FIELDS.CITY_NAME) ??
        this.stringField(city, TOROD_RESPONSE_FIELDS.TITLE) ??
        cityName,
    };
  }

  private cityMatches(candidate: unknown, normalizedCity: string): boolean {
    if (!this.isRecord(candidate)) {
      return false;
    }
    return [
      this.stringField(candidate, TOROD_RESPONSE_FIELDS.CITY_NAME),
      this.stringField(candidate, TOROD_RESPONSE_FIELDS.CITY_NAME_AR),
      this.stringField(candidate, TOROD_RESPONSE_FIELDS.TITLE),
      this.stringField(candidate, TOROD_RESPONSE_FIELDS.TITLE_ARABIC),
    ].some((name) => name !== undefined && this.normalizeForMatch(name) === normalizedCity);
  }

  private selectedCourierCode(optionData: Record<string, unknown>): string {
    const courierCode = this.courierCodeFromData(optionData);
    if (courierCode === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.COURIER_OPTION_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return courierCode;
  }

  private courierCodeFromData(data: Record<string, unknown>): string | undefined {
    const direct = this.stringField(
      data,
      FULFILLMENT_DATA_KEYS.TOROD_COURIER_CODE,
    );
    if (direct !== undefined) {
      return direct;
    }

    const optionId = this.stringField(data, TOROD_RESPONSE_FIELDS.ID);
    return optionId === undefined ? undefined : courierCodeFromOptionId(optionId);
  }

  private warehouseCode(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: CalculateShippingOptionPriceDTO["context"],
  ): string {
    const fromData =
      this.stringField(data, FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE) ??
      this.stringField(optionData, FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE);
    if (fromData !== undefined) {
      return fromData;
    }

    const fromLocationMetadata = this.stringField(
      context.from_location?.metadata ?? {},
      FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE,
    );
    if (fromLocationMetadata !== undefined) {
      return fromLocationMetadata;
    }

    const fromAddressMetadata = this.stringField(
      context.from_location?.address?.metadata ?? {},
      FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE,
    );
    if (fromAddressMetadata !== undefined) {
      return fromAddressMetadata;
    }

    throw this.providerError(
      TOROD_ERROR_MESSAGES.WAREHOUSE_MISSING,
      KsaErrorCodes.INVALID_INPUT,
    );
  }

  private shippingCity(context: TorodCityContext): string {
    const city = context.shipping_address?.city;
    if (typeof city !== "string" || city.trim().length === 0) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.CITY_UNRESOLVABLE,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return city;
  }

  private shipmentWeight(context: CalculateShippingOptionPriceDTO["context"]): number {
    let total = 0;
    for (const item of context.items) {
      if (item.requires_shipping === false) {
        continue;
      }
      const quantity = this.positiveNumber(item.quantity);
      const itemWeight =
        this.positiveNumber(item.variant.weight) ?? this.options_.defaultWeightKg;
      if (quantity === undefined || itemWeight === undefined) {
        throw this.providerError(
          TOROD_ERROR_MESSAGES.WEIGHT_MISSING,
          KsaErrorCodes.INVALID_INPUT,
        );
      }
      total += quantity * itemWeight;
    }

    if (total <= 0) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.WEIGHT_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }

    return total;
  }

  private orderTotal(context: CalculateShippingOptionPriceDTO["context"]): number {
    const record = context as Record<string, unknown>;
    const total =
      this.positiveNumber(record[MEDUSA_CONTEXT_FIELDS.TOTAL]) ??
      this.positiveNumber(record[MEDUSA_CONTEXT_FIELDS.SUBTOTAL]);
    if (total === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.ORDER_TOTAL_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return total;
  }

  private boxCount(data: Record<string, unknown>): number {
    return (
      this.positiveNumber(data[FULFILLMENT_DATA_KEYS.BOX_COUNT]) ??
      this.options_.defaultBoxCount
    );
  }

  private courierOption(courier: unknown): FulfillmentOption {
    if (!this.isRecord(courier)) {
      throw this.providerError(TOROD_ERROR_MESSAGES.COURIER_ID_MISSING);
    }

    const courierId = this.stringField(courier, TOROD_RESPONSE_FIELDS.ID);
    if (courierId === undefined) {
      throw this.providerError(TOROD_ERROR_MESSAGES.COURIER_ID_MISSING);
    }

    const courierName =
      this.stringField(courier, TOROD_RESPONSE_FIELDS.TITLE) ?? courierId;
    const courierMethod = this.stringField(courier, TOROD_RESPONSE_FIELDS.METHOD);
    const option: FulfillmentOption = {
      id: optionIdForCourier(courierId),
      name: courierName,
      is_return: false,
      [FULFILLMENT_DATA_KEYS.TOROD_COURIER_CODE]: courierId,
      [FULFILLMENT_DATA_KEYS.TOROD_COURIER_NAME]: courierName,
    };

    if (courierMethod !== undefined) {
      option[FULFILLMENT_DATA_KEYS.TOROD_COURIER_METHOD] = courierMethod;
    }

    return option;
  }

  private stringField(
    record: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private positiveNumberField(
    record: Record<string, unknown>,
    key: string,
  ): number | undefined {
    return this.positiveNumber(record[key]);
  }

  private positiveNumber(value: unknown): number | undefined {
    const numberValue = this.numberValue(value);
    return numberValue !== undefined && numberValue > 0 ? numberValue : undefined;
  }

  private numberValue(value: unknown): number | undefined {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    if ("numeric" in value && typeof value.numeric === "number") {
      return Number.isFinite(value.numeric) ? value.numeric : undefined;
    }
    if ("value" in value) {
      return this.numberValue(value.value);
    }
    const candidate = value as { valueOf?: () => unknown };
    if (typeof candidate.valueOf === "function") {
      const raw = candidate.valueOf();
      return raw === value ? undefined : this.numberValue(raw);
    }
    return undefined;
  }

  private normalizeForMatch(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private providerError(
    message: string,
    code: KsaErrorCode = KsaErrorCodes.PROVIDER_ERROR,
  ): Error {
    return toMedusaError(
      new KsaError(message, {
        prefix: TOROD_PREFIX,
        code,
      }),
    );
  }
}
