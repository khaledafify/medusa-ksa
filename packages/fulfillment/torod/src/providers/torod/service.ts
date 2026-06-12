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

import { TorodClient } from "./client.js";
import {
  PROVIDER_ID,
  TOROD_ERROR_MESSAGES,
  TOROD_PREFIX,
} from "./constants.js";
import { resolveTorodOptions } from "./options.js";
import type { TorodOptions } from "./options.js";

/**
 * Medusa v2 Fulfillment provider for the Torod courier aggregator.
 *
 * T2.1 wires the provider into Medusa's native Fulfillment module. Courier
 * options, live rates, booking, cancellation, labels, and returns are filled in
 * by the later ordered tasks from the Phase 4 plan.
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
   *
   * T2.2 replaces the empty skeleton with one option per Torod courier.
   */
  override getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return Promise.resolve([]);
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
   * T2.4 will resolve serviceability and persist Torod city metadata here.
   */
  override validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: ValidateFulfillmentDataContext,
  ): Promise<Record<string, unknown>> {
    return Promise.resolve(data);
  }

  /**
   * Medusa calculated-price capability check.
   *
   * T2.3 enables live rating once courier options and serviceability exist.
   */
  override canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * Medusa calculated-price contract.
   *
   * Return type is `CalculatedShippingOptionPrice`; until T2.3 implements live
   * rate shopping, this fails closed instead of fabricating a rate.
   */
  override calculatePrice(
    _optionData: CalculateShippingOptionPriceDTO["optionData"],
    _data: CalculateShippingOptionPriceDTO["data"],
    _context: CalculateShippingOptionPriceDTO["context"],
  ): Promise<CalculatedShippingOptionPrice> {
    return Promise.reject(this.notReady(TOROD_ERROR_MESSAGES.RATES_NOT_READY));
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
    return Promise.reject(this.notReady(TOROD_ERROR_MESSAGES.BOOKING_NOT_READY));
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
      this.notReady(TOROD_ERROR_MESSAGES.CANCELLATION_NOT_READY),
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
    return Promise.reject(this.notReady(TOROD_ERROR_MESSAGES.RETURNS_DEFERRED));
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

  private notReady(message: string): Error {
    return toMedusaError(
      new KsaError(message, {
        prefix: TOROD_PREFIX,
        code: KsaErrorCodes.PROVIDER_ERROR,
      }),
    );
  }
}
