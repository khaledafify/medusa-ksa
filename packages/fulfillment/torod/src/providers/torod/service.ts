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
  [key: string]: unknown;
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
}

interface TorodCitiesResponse {
  [key: string]: unknown;
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
}

interface TorodRegionsResponse {
  [key: string]: unknown;
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
}

interface TorodRatesResponse {
  [key: string]: unknown;
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
}

interface TorodCreateOrderResponse {
  [key: string]: unknown;
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
  [TOROD_RESPONSE_FIELDS.ORDER_ID]?: unknown;
}

interface TorodShipProcessResponse {
  [key: string]: unknown;
  [TOROD_RESPONSE_FIELDS.DATA]?: unknown;
  [TOROD_RESPONSE_FIELDS.TRACKING_ID]?: unknown;
  [TOROD_RESPONSE_FIELDS.LABEL_URL]?: unknown;
}

interface TorodResolvedCity {
  cityId: string;
  cityName: string;
}

type TorodCityContext = Pick<
  CalculateShippingOptionPriceDTO["context"],
  "shipping_address"
>;

type TorodFulfillmentItem = Partial<Omit<FulfillmentItemDTO, "fulfillment">>;
type TorodOrderLineItem = NonNullable<FulfillmentOrderDTO["items"]>[number];
type TorodOrderAddress = NonNullable<FulfillmentOrderDTO["shipping_address"]>;

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
   * Return type is `CreateFulfillmentResult`; Torod books in two steps:
   * order/create, then ship/process.
   */
  override async createFulfillment(
    data: Record<string, unknown>,
    items: TorodFulfillmentItem[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>,
  ): Promise<CreateFulfillmentResult> {
    try {
      const bookingData = this.bookingData(data, order);
      const requiredOrder = this.requiredOrder(order);
      this.bookingAddress(requiredOrder);
      const shipmentType =
        this.stringField(bookingData, FULFILLMENT_DATA_KEYS.SHIPMENT_TYPE) ??
        DEFAULTS.SHIPMENT_TYPE;
      const warehouse = this.bookingWarehouseCode(bookingData);
      const payment =
        this.stringField(bookingData, FULFILLMENT_DATA_KEYS.PAYMENT_METHOD) ??
        DEFAULTS.PAYMENT;
      const boxCount = this.boxCount(bookingData);
      const courierCode = this.selectedCourierCode(bookingData);
      const createOrderBody = await this.createOrderRequest(
        bookingData,
        items,
        requiredOrder,
      );
      const orderResponse = await this.client_.request<TorodCreateOrderResponse>({
        method: TOROD_HTTP_METHOD.POST,
        path: TOROD_ENDPOINTS.CREATE_ORDER,
        body: createOrderBody,
      });
      const torodOrderId = this.orderIdFromResponse(orderResponse);
      const shipResponse = await this.client_.request<TorodShipProcessResponse>({
        method: TOROD_HTTP_METHOD.POST,
        path: TOROD_ENDPOINTS.SHIP_PROCESS,
        body: {
          [TOROD_REQUEST_FIELDS.ORDER_ID]: torodOrderId,
          [TOROD_REQUEST_FIELDS.WAREHOUSE]: warehouse,
          [TOROD_REQUEST_FIELDS.SHIPMENT_TYPE]: shipmentType,
          [TOROD_REQUEST_FIELDS.COURIER_PARTNER_ID]: courierCode,
          [TOROD_REQUEST_FIELDS.IS_OWN]: DEFAULTS.OWN_CARRIER,
          [TOROD_REQUEST_FIELDS.IS_INSURANCE]: DEFAULTS.INSURANCE,
        },
      });
      const trackingNumber = this.trackingIdFromResponse(shipResponse);
      const labelUrl = this.labelUrlFromResponse(shipResponse);
      const resultData = {
        ...bookingData,
        [FULFILLMENT_DATA_KEYS.TOROD_ORDER_ID]: torodOrderId,
        [FULFILLMENT_DATA_KEYS.TOROD_COURIER_CODE]: courierCode,
        [FULFILLMENT_DATA_KEYS.TRACKING_NUMBER]: trackingNumber,
        [FULFILLMENT_DATA_KEYS.LABEL_URL]: labelUrl,
        [FULFILLMENT_DATA_KEYS.BOX_COUNT]: boxCount,
        [FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE]: warehouse,
        [FULFILLMENT_DATA_KEYS.PAYMENT_METHOD]: payment,
        [FULFILLMENT_DATA_KEYS.SHIPMENT_TYPE]: shipmentType,
      };

      return {
        data: resultData,
        labels: [
          {
            tracking_number: trackingNumber,
            tracking_url: labelUrl,
            label_url: labelUrl,
          },
        ],
      };
    } catch (err) {
      throw toMedusaError(err);
    }
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

  private async createOrderRequest(
    data: Record<string, unknown>,
    items: TorodFulfillmentItem[],
    order: Partial<FulfillmentOrderDTO> | undefined,
  ): Promise<Record<string, string | number>> {
    const requiredOrder = this.requiredOrder(order);
    const address = this.bookingAddress(requiredOrder);
    const city = await this.customerCity(data, {
      shipping_address: address,
    });
    const shipmentType =
      this.stringField(data, FULFILLMENT_DATA_KEYS.SHIPMENT_TYPE) ??
      DEFAULTS.SHIPMENT_TYPE;

    return {
      [TOROD_REQUEST_FIELDS.CUSTOMER_NAME]: this.customerName(address),
      [TOROD_REQUEST_FIELDS.CUSTOMER_EMAIL]: this.customerEmail(requiredOrder),
      [TOROD_REQUEST_FIELDS.CUSTOMER_PHONE]: this.customerPhone(address),
      [TOROD_REQUEST_FIELDS.ITEM_DESCRIPTION]: this.itemDescription(
        items,
        requiredOrder,
      ),
      [TOROD_REQUEST_FIELDS.ORDER_TOTAL]: this.bookingOrderTotal(requiredOrder),
      [TOROD_REQUEST_FIELDS.PAYMENT]:
        this.stringField(data, FULFILLMENT_DATA_KEYS.PAYMENT_METHOD) ??
        DEFAULTS.PAYMENT,
      [TOROD_REQUEST_FIELDS.WEIGHT]: this.bookingShipmentWeight(
        data,
        items,
        requiredOrder,
      ),
      [TOROD_REQUEST_FIELDS.BOX_COUNT]: this.boxCount(data),
      [TOROD_REQUEST_FIELDS.SHIPMENT_TYPE]: shipmentType,
      [TOROD_REQUEST_FIELDS.CITY_ID]: city.cityId,
      [TOROD_REQUEST_FIELDS.ADDRESS]: this.customerAddress(address),
    };
  }

  private bookingData(
    data: Record<string, unknown>,
    order: Partial<FulfillmentOrderDTO> | undefined,
  ): Record<string, unknown> {
    const methodData = this.orderShippingMethodData(order);
    return {
      ...methodData,
      ...data,
    };
  }

  private orderShippingMethodData(
    order: Partial<FulfillmentOrderDTO> | undefined,
  ): Record<string, unknown> {
    const methods = order?.shipping_methods ?? [];
    const matchingMethod = methods.find((method) => {
      const data = method.data;
      return data !== undefined && this.courierCodeFromData(data) !== undefined;
    });
    const fallbackMethod = matchingMethod ?? methods.find((method) => method.data);
    return fallbackMethod?.data ?? {};
  }

  private requiredOrder(
    order: Partial<FulfillmentOrderDTO> | undefined,
  ): Partial<FulfillmentOrderDTO> {
    if (order === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.ORDER_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return order;
  }

  private bookingAddress(order: Partial<FulfillmentOrderDTO>): TorodOrderAddress {
    if (order.shipping_address === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.SHIPPING_ADDRESS_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return order.shipping_address;
  }

  private customerName(address: TorodOrderAddress): string {
    const parts = [
      this.stringFieldFromUnknown(address.first_name),
      this.stringFieldFromUnknown(address.last_name),
    ].filter((part) => part !== undefined);
    const name = parts.join(" ");
    if (name.length > 0) {
      return name;
    }

    const company = this.stringFieldFromUnknown(address.company);
    if (company !== undefined) {
      return company;
    }

    throw this.providerError(
      TOROD_ERROR_MESSAGES.CUSTOMER_NAME_MISSING,
      KsaErrorCodes.INVALID_INPUT,
    );
  }

  private customerEmail(order: Partial<FulfillmentOrderDTO>): string {
    const email = this.stringFieldFromUnknown(order.email);
    if (email === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.CUSTOMER_EMAIL_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return email;
  }

  private customerPhone(address: TorodOrderAddress): string {
    const phone = this.stringFieldFromUnknown(address.phone);
    if (phone === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.CUSTOMER_PHONE_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return phone;
  }

  private customerAddress(address: TorodOrderAddress): string {
    const primary = this.stringFieldFromUnknown(address.address_1);
    if (primary === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.SHIPPING_ADDRESS_LINE_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    const secondary = this.stringFieldFromUnknown(address.address_2);
    return secondary === undefined ? primary : [primary, secondary].join(", ");
  }

  private itemDescription(
    fulfillmentItems: TorodFulfillmentItem[],
    order: Partial<FulfillmentOrderDTO>,
  ): string {
    const titleSource =
      fulfillmentItems.length > 0
        ? fulfillmentItems
        : (order.items ?? []).filter((item) => item.requires_shipping !== false);
    const titles = titleSource
      .map((item) => this.stringFieldFromUnknown(item.title))
      .filter((title) => title !== undefined);
    if (titles.length === 0) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.ORDER_ITEMS_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return titles.join(", ");
  }

  private bookingOrderTotal(order: Partial<FulfillmentOrderDTO>): number {
    const record = order as Record<string, unknown>;
    const total =
      this.positiveNumber(record[MEDUSA_CONTEXT_FIELDS.TOTAL]) ??
      this.positiveNumber(record[MEDUSA_CONTEXT_FIELDS.SUBTOTAL]);
    if (total === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.BOOKING_ORDER_TOTAL_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return total;
  }

  private bookingShipmentWeight(
    data: Record<string, unknown>,
    fulfillmentItems: TorodFulfillmentItem[],
    order: Partial<FulfillmentOrderDTO>,
  ): number {
    const explicitWeight = this.positiveNumber(
      data[FULFILLMENT_DATA_KEYS.SHIPMENT_WEIGHT],
    );
    if (explicitWeight !== undefined) {
      return explicitWeight;
    }

    const items =
      fulfillmentItems.length > 0
        ? fulfillmentItems
        : (order.items ?? []).filter((item) => item.requires_shipping !== false);

    let total = 0;
    for (const item of items) {
      const quantity = this.positiveNumber(item.quantity);
      const itemWeight = this.fulfillmentItemWeight(item, order);
      if (quantity === undefined || itemWeight === undefined) {
        throw this.providerError(
          TOROD_ERROR_MESSAGES.WEIGHT_MISSING,
          KsaErrorCodes.INVALID_INPUT,
        );
      }
      total += quantity * itemWeight;
    }

    return total;
  }

  private fulfillmentItemWeight(
    item: TorodFulfillmentItem | TorodOrderLineItem,
    order: Partial<FulfillmentOrderDTO>,
  ): number | undefined {
    const itemMetadataWeight = this.metadataWeight(
      (item as Record<string, unknown>)[MEDUSA_CONTEXT_FIELDS.METADATA],
    );
    if (itemMetadataWeight !== undefined) {
      return itemMetadataWeight;
    }

    const matchingOrderItem = this.matchingOrderItem(item, order);
    const orderMetadataWeight = this.metadataWeight(matchingOrderItem?.metadata);
    return orderMetadataWeight ?? this.options_.defaultWeightKg;
  }

  private matchingOrderItem(
    item: TorodFulfillmentItem | TorodOrderLineItem,
    order: Partial<FulfillmentOrderDTO>,
  ): TorodOrderLineItem | undefined {
    const lineItemId =
      "line_item_id" in item && typeof item.line_item_id === "string"
        ? item.line_item_id
        : "id" in item && typeof item.id === "string"
          ? item.id
          : undefined;
    if (lineItemId === undefined) {
      return undefined;
    }
    return order.items?.find((orderItem) => orderItem.id === lineItemId);
  }

  private metadataWeight(metadata: unknown): number | undefined {
    if (!this.isRecord(metadata)) {
      return undefined;
    }
    return (
      this.positiveNumber(metadata[MEDUSA_CONTEXT_FIELDS.WEIGHT_KG]) ??
      this.positiveNumber(metadata[MEDUSA_CONTEXT_FIELDS.WEIGHT])
    );
  }

  private bookingWarehouseCode(data: Record<string, unknown>): string {
    const warehouse = this.stringField(data, FULFILLMENT_DATA_KEYS.WAREHOUSE_CODE);
    if (warehouse === undefined) {
      throw this.providerError(
        TOROD_ERROR_MESSAGES.WAREHOUSE_MISSING,
        KsaErrorCodes.INVALID_INPUT,
      );
    }
    return warehouse;
  }

  private orderIdFromResponse(response: TorodCreateOrderResponse): string {
    const orderId =
      this.stringField(response, TOROD_RESPONSE_FIELDS.ORDER_ID) ??
      this.responseDataString(response, TOROD_RESPONSE_FIELDS.ORDER_ID);
    if (orderId === undefined) {
      throw this.providerError(TOROD_ERROR_MESSAGES.TOROD_ORDER_ID_MISSING);
    }
    return orderId;
  }

  private trackingIdFromResponse(response: TorodShipProcessResponse): string {
    const trackingId =
      this.stringField(response, TOROD_RESPONSE_FIELDS.TRACKING_ID) ??
      this.responseDataString(response, TOROD_RESPONSE_FIELDS.TRACKING_ID);
    if (trackingId === undefined) {
      throw this.providerError(TOROD_ERROR_MESSAGES.TRACKING_ID_MISSING);
    }
    return trackingId;
  }

  private labelUrlFromResponse(response: TorodShipProcessResponse): string {
    const labelUrl =
      this.stringField(response, TOROD_RESPONSE_FIELDS.LABEL_URL) ??
      this.responseDataString(response, TOROD_RESPONSE_FIELDS.LABEL_URL);
    if (labelUrl === undefined) {
      throw this.providerError(TOROD_ERROR_MESSAGES.LABEL_URL_MISSING);
    }
    return labelUrl;
  }

  private responseDataString(
    response: { [TOROD_RESPONSE_FIELDS.DATA]?: unknown },
    field: string,
  ): string | undefined {
    const data = response[TOROD_RESPONSE_FIELDS.DATA];
    return this.isRecord(data) ? this.stringField(data, field) : undefined;
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
    const regionIds = await this.regionIds();
    for (const regionId of regionIds) {
      const response = await this.client_.request<TorodCitiesResponse>({
        method: TOROD_HTTP_METHOD.GET,
        path: TOROD_ENDPOINTS.CITIES,
        query: {
          [TOROD_REQUEST_FIELDS.REGION_ID]: regionId,
          [TOROD_REQUEST_FIELDS.PAGE]: 1,
        },
      });
      const city = this.cityFromResponse(response, cityName);
      if (city !== undefined) {
        return city;
      }
    }

    throw this.providerError(
      TOROD_ERROR_MESSAGES.CITY_UNRESOLVABLE,
      KsaErrorCodes.INVALID_INPUT,
    );
  }

  private async regionIds(): Promise<string[]> {
    const response = await this.client_.request<TorodRegionsResponse>({
      method: TOROD_HTTP_METHOD.GET,
      path: TOROD_ENDPOINTS.REGIONS,
      query: {
        [TOROD_REQUEST_FIELDS.COUNTRY_ID]: DEFAULTS.COUNTRY_ID,
        [TOROD_REQUEST_FIELDS.PAGE]: 1,
      },
    });
    const regions = response[TOROD_RESPONSE_FIELDS.DATA];
    if (!Array.isArray(regions)) {
      throw this.providerError(TOROD_ERROR_MESSAGES.REGIONS_DATA_MALFORMED);
    }

    return regions.map((region) => {
      if (!this.isRecord(region)) {
        throw this.providerError(TOROD_ERROR_MESSAGES.REGION_ID_MISSING);
      }
      const regionId =
        this.stringField(region, TOROD_RESPONSE_FIELDS.REGION_ID) ??
        this.stringField(region, TOROD_RESPONSE_FIELDS.ID);
      if (regionId === undefined) {
        throw this.providerError(TOROD_ERROR_MESSAGES.REGION_ID_MISSING);
      }
      return regionId;
    });
  }

  private cityFromResponse(
    response: TorodCitiesResponse,
    cityName: string,
  ): TorodResolvedCity | undefined {
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
      return undefined;
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
    return this.stringFieldFromUnknown(record[key]);
  }

  private stringFieldFromUnknown(value: unknown): string | undefined {
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
