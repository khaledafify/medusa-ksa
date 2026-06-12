export const PROVIDER_ID = "torod";
export const TOROD_PREFIX = PROVIDER_ID;

export const ENV = {
  CLIENT_ID: "TOROD_CLIENT_ID",
  CLIENT_SECRET: "TOROD_CLIENT_SECRET",
  BASE_URL: "TOROD_BASE_URL",
  DEFAULT_WEIGHT_KG: "TOROD_DEFAULT_WEIGHT_KG",
  DEFAULT_BOX_COUNT: "TOROD_DEFAULT_BOX_COUNT",
  WEBHOOK_SECRET: "TOROD_WEBHOOK_SECRET",
} as const;

export const TOROD_BASE_URLS = {
  SANDBOX: "https://demo.stage.torod.co/en/api",
  LIVE: "https://torod.co/en/api",
} as const;

export const TOROD_ENDPOINTS = {
  TOKEN: "/token",
  COURIERS: "/get-all/courier/partners",
  RATES: "/courier/partners/list",
  ORDER_COURIERS: "/courier/partners",
  COUNTRIES: "/get-all/countries",
  REGIONS: "/get-all/regions",
  REGIONS_ACCESS: "/regions-access",
  CITIES: "/get-all/cities",
  CITIES_ACCESS: "/cities-access",
  DISTRICTS: "/get-all/districts",
  LATLONG_DETAILS: "/get-latlong-details",
  ADDRESS_DETAILS: "/get-address-details",
  ADDRESS_LIST: "/address/list",
  CREATE_ADDRESS: "/create/address",
  UPDATE_ADDRESS: "/update/address/:addressId",
  ADDRESS_WISE_CARRIERS: "/address/wise/carriers",
  ORDER_LIST: "/order/list",
  CREATE_ORDER: "/order/create",
  UPDATE_ORDER: "/order/update",
  ORDER_DETAILS: "/order/details",
  SHIP_PROCESS: "/order/ship/process",
  TRACK: "/order/track",
  SHIPMENTS_LIST: "/shipments/list",
  SHIPMENT_DETAILS: "/shipment/details",
  DETAILS: "/details",
  CANCEL: "/shipments/cancel",
} as const;

export const TOROD_HTTP_HEADERS = {
  ACCEPT: "Accept",
  AUTHORIZATION: "Authorization",
  CONTENT_TYPE: "Content-Type",
} as const;

export const TOROD_HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

export const TOROD_HTTP_ERROR_MARKERS = {
  BAD_REQUEST: "responded 400",
  UNAUTHORIZED: "responded 401",
  UNSUPPORTED_MEDIA_TYPE: "responded 415",
  UNPROCESSABLE_ENTITY: "responded 422",
} as const;

export const TOROD_MEDIA_TYPES = {
  JSON: "application/json",
  FORM_DATA: "multipart/form-data",
  FORM_URLENCODED: "application/x-www-form-urlencoded",
} as const;

export const TOROD_TOKEN = {
  PATH: TOROD_ENDPOINTS.TOKEN,
  AUTHORIZATION_HEADER: TOROD_HTTP_HEADERS.AUTHORIZATION,
  BEARER_SCHEME: "Bearer",
  RESPONSE_TOKEN_FIELD: "bearer_token",
  GENERATED_DATE_FIELD: "token_generated_date",
  EXPIRES_IN_FIELD: "expires_in",
  FALLBACK_EXPIRES_IN_HOURS: 24,
} as const;

export const TOROD_REQUEST_FIELDS = {
  CLIENT_ID: "client_id",
  CLIENT_SECRET: "client_secret",
  PAGE: "page",
  COUNTRY_ID: "country_id",
  REGION_ID: "region_id",
  CITIES_ID: "cities_id",
  LATITUDE: "latitude",
  LONGITUDE: "longitude",
  DOCUMENTED_LONGITUDE_TYPO: "lognditude",
  ADDRESS: "address",
  ADDRESS_ID: "address_id",
  CARRIER_ID: "carrier_id",
  WAREHOUSE: "warehouse",
  CUSTOMER_CITY_ID: "customer_city_id",
  PAYMENT: "payment",
  WEIGHT: "weight",
  ORDER_TOTAL: "order_total",
  BOX_COUNT: "no_of_box",
  SHIPMENT_TYPE: "type",
  FILTER_BY: "filter_by",
  IS_INSURANCE: "is_insurance",
  ORDER_ID: "order_id",
  CUSTOMER_NAME: "name",
  CUSTOMER_EMAIL: "email",
  CUSTOMER_PHONE: "phone_number",
  ITEM_DESCRIPTION: "item_description",
  DISTRICT_ID: "district_id",
  LOCATE_ADDRESS: "locate_address",
  CITY_ID: "city_id",
  COURIER_PARTNER_ID: "courier_partner_id",
  IS_OWN: "is_own",
  TRACKING_ID: "tracking_id",
  TRACKING_OR_ORDER_ID: "tracking_or_order_id",
  SHIPPING_TYPE: "shipping_type",
} as const;

export const TOROD_RESPONSE_FIELDS = {
  DATA: "data",
  STATUS: "status",
  CODE: "code",
  MESSAGE: "message",
  BEARER_TOKEN: TOROD_TOKEN.RESPONSE_TOKEN_FIELD,
  TOKEN_GENERATED_DATE: TOROD_TOKEN.GENERATED_DATE_FIELD,
  EXPIRES_IN: TOROD_TOKEN.EXPIRES_IN_FIELD,
  ID: "id",
  TITLE: "title",
  TITLE_ARABIC: "title_arabic",
  METHOD: "method",
  RATE: "rate",
  COD_FEE: "cod_fee",
  IS_OWN: "is_own",
  ORDER_ID: TOROD_REQUEST_FIELDS.ORDER_ID,
  TRACKING_ID: TOROD_REQUEST_FIELDS.TRACKING_ID,
  LABEL_URL: "aws_label",
  CITY_NAME: "city_name",
  CITY_NAME_AR: "city_name_ar",
  CITIES_ID: TOROD_REQUEST_FIELDS.CITIES_ID,
  CITY_DATA: "city_data",
  DETAILS: "details",
} as const;

export const TOROD_PAYMENT = {
  COD: "COD",
  PREPAID: "Prepaid",
  BANK: "Bank",
} as const;

export const TOROD_RATE_FILTER = {
  CHEAPEST: "cheapest",
  FASTEST: "fastest",
} as const;

export const TOROD_SHIPMENT_TYPE = {
  NORMAL: "normal",
  COLD: "Cold",
  QUICK: "Quick",
} as const;

export const TOROD_ORDER_ADDRESS_TYPE = {
  NORMAL: "normal",
  LATLONG: "latlong",
  ADDRESS: "address",
  ADDRESS_CITY: "address_city",
} as const;

export const TOROD_SHIPPING_TYPE = {
  STRAIGHT: "straight",
  REVERSE: "reverse",
} as const;

export const TOROD_INSURANCE = {
  DISABLED: 0,
  ENABLED: 1,
} as const;

export const TOROD_OWN_CARRIER = {
  DISABLED: 0,
  ENABLED: 1,
} as const;

export const DEFAULTS = {
  BASE_URL: TOROD_BASE_URLS.SANDBOX,
  BOX_COUNT: 1,
  TIMEOUT_MS: 15_000,
  RETRY: {
    RETRIES: 2,
    BASE_DELAY_MS: 250,
  },
  PAYMENT: TOROD_PAYMENT.PREPAID,
  SHIPMENT_TYPE: TOROD_SHIPMENT_TYPE.NORMAL,
  ORDER_ADDRESS_TYPE: TOROD_ORDER_ADDRESS_TYPE.ADDRESS_CITY,
  RATE_FILTER: TOROD_RATE_FILTER.CHEAPEST,
  INSURANCE: TOROD_INSURANCE.DISABLED,
  OWN_CARRIER: TOROD_OWN_CARRIER.DISABLED,
} as const;

export const FULFILLMENT_DATA_KEYS = {
  TOROD_ORDER_ID: "torodOrderId",
  TOROD_SHIPMENT_ID: "torodShipmentId",
  TOROD_COURIER_CODE: "torodCourierCode",
  TOROD_COURIER_NAME: "torodCourierName",
  TOROD_COURIER_METHOD: "torodCourierMethod",
  TRACKING_NUMBER: "trackingNumber",
  LABEL_URL: "labelUrl",
  CITY_CODE: "cityCode",
  CITY_NAME: "cityName",
  BOX_COUNT: "boxCount",
  WAREHOUSE_CODE: "warehouseCode",
  PAYMENT_METHOD: "paymentMethod",
  SHIPMENT_TYPE: "shipmentType",
  RATE: "rate",
  COD_FEE: "codFee",
  IS_OWN: "isOwn",
} as const;

export const TOROD_WEBHOOK_FIELDS = {
  ORDER_ID: TOROD_REQUEST_FIELDS.ORDER_ID,
  TRACKING_ID: TOROD_REQUEST_FIELDS.TRACKING_ID,
  STATUS: TOROD_RESPONSE_FIELDS.STATUS,
  DATE_TIME: "date_time",
  DESCRIPTION: "description",
  TOROD_DESCRIPTION: "torod_description",
  TOROD_DESCRIPTION_AR: "torod_description_ar",
} as const;

export const TOROD_WEBHOOK_EVENTS = {
  ORDER_STATUS_UPDATED: "torod.order_status_updated",
} as const;

export const TOROD_STATUS = {
  PENDING: "Pending",
  CANCELLED: "Cancelled",
  CREATED: "Created",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  RTO: "RTO",
} as const;

export const MEDUSA_FULFILLMENT_STATUS = {
  PENDING: "pending",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  CANCELED: "canceled",
  FAILED: "failed",
  RETURNED: "returned",
} as const;

export const TOROD_STATUS_TO_MEDUSA = {
  [TOROD_STATUS.PENDING]: MEDUSA_FULFILLMENT_STATUS.PENDING,
  [TOROD_STATUS.CREATED]: MEDUSA_FULFILLMENT_STATUS.SHIPPED,
  [TOROD_STATUS.SHIPPED]: MEDUSA_FULFILLMENT_STATUS.SHIPPED,
  [TOROD_STATUS.DELIVERED]: MEDUSA_FULFILLMENT_STATUS.DELIVERED,
  [TOROD_STATUS.CANCELLED]: MEDUSA_FULFILLMENT_STATUS.CANCELED,
  [TOROD_STATUS.FAILED]: MEDUSA_FULFILLMENT_STATUS.FAILED,
  [TOROD_STATUS.RTO]: MEDUSA_FULFILLMENT_STATUS.RETURNED,
} as const satisfies Record<
  (typeof TOROD_STATUS)[keyof typeof TOROD_STATUS],
  (typeof MEDUSA_FULFILLMENT_STATUS)[keyof typeof MEDUSA_FULFILLMENT_STATUS]
>;

export const TOROD_TERMINAL_STATUSES = [
  TOROD_STATUS.CANCELLED,
  TOROD_STATUS.DELIVERED,
  TOROD_STATUS.FAILED,
  TOROD_STATUS.RTO,
] as const;

export const OPTION_ID = {
  PREFIX: PROVIDER_ID,
  SEPARATOR: ":",
} as const;

export function optionIdForCourier(courierCode: string): string {
  return `${OPTION_ID.PREFIX}${OPTION_ID.SEPARATOR}${encodeURIComponent(
    courierCode,
  )}`;
}

export function courierCodeFromOptionId(id: string): string | undefined {
  const prefix = `${OPTION_ID.PREFIX}${OPTION_ID.SEPARATOR}`;
  if (!id.startsWith(prefix)) {
    return undefined;
  }
  const encoded = id.slice(prefix.length);
  if (encoded.length === 0) {
    return undefined;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}
