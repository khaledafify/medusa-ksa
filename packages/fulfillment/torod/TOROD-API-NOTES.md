# Torod API Notes

Source check date: 2026-06-12

Sources:
- `https://docs.torod.co/` public Stoplight workspace
- `https://stoplight.io/api/v1/projects/torod/Torod/nodes/Torod-Merchant.yaml`
- `https://stoplight.io/api/v1/projects/torod/torod-references/nodes/Torod-Merchant.yaml`
- `https://stoplight.io/api/v1/projects/torod/Torod/nodes/docs/Merchant%20API/Demo%20Environment/Webhook-Instruction.md`
- `https://help.torod.co/en/docs/adding-package-sizes/`
- Public Postman collection linked from the docs home: `https://www.postman.com/torod-team/workspace/torod-merchant-api/request/19185564-9f24d765-9c40-407f-bab1-ee0ddf556856`

## Base URLs

Torod documents these API environments:

| Environment | Base URL |
| --- | --- |
| Sandbox | `https://demo.stage.torod.co/en/api` |
| Live | `https://torod.co/en/api` |

The OpenAPI `servers` entry currently points at sandbox only, while the API description documents both sandbox and live.

## Authentication

Outbound API calls use a two-step bearer-token flow:

1. Call `POST /token`.
2. Send subsequent requests with `Authorization: Bearer {ACCESS_TOKEN}`.

`POST /token` accepts:

| Content type | Required fields |
| --- | --- |
| `multipart/form-data` in the newer guidance project | `client_id`, `client_secret` |
| `application/json` in the reference project | `client_id`, `client_secret` |

Implementation note: support JSON for the token request first if Torod accepts it in sandbox, because core `HttpClient` is JSON-oriented. If sandbox rejects JSON, use a local `FormData` body through `HttpClient` without bypassing core HTTP transport.

The provider config must therefore use `TOROD_CLIENT_ID` and `TOROD_CLIENT_SECRET`, matching the Phase 4 PRD/prompt.

## Webhooks

Torod documents webhook order updates. The payload is:

```json
{
  "order_id": "{Order Id}",
  "tracking_id": "{Courier Tracking No}",
  "status": "{Torod Order Status}",
  "date_time": "{Order Status Update Date Time}",
  "description": "{Courier Status Description}",
  "torod_description": "{Torod Status Description in English}",
  "torod_description_ar": "{Torod Status Description in Arabic}"
}
```

Torod says webhook data can be cross-verified with the "Client Secret Key" passed in the `Authorization` header. This is a shared-secret header check, not an HMAC signature.

Documented webhook statuses:

| Status |
| --- |
| `Pending` |
| `Cancelled` |
| `Created` |
| `Shipped` |
| `Delivered` |
| `Failed` |
| `RTO` |

Conclusion: use webhook-first tracking. Polling is only a fallback for manual refresh or webhook outage handling.

## Endpoint Inventory

The newer `Torod Guidance` OpenAPI file has 26 paths. The older `Torod References` file has 21 paths. The implementation should use the newer guidance paths when the endpoint exists there, and keep compatibility notes for the older reference aliases.

### Auth

| Method | Path | Request fields | Notes |
| --- | --- | --- | --- |
| `POST` | `/token` | `client_id`, `client_secret` | Returns bearer token fields including `token` and `token_generated_date`. |

### Geography and Address Resolution

| Method | Path | Request fields | Notes |
| --- | --- | --- | --- |
| `GET` | `/get-all/countries?page=1` | `page` query | Older reference path: `/countries`. |
| `GET` | `/get-all/regions?country_id=1` | `country_id`, `page` query | Older reference path: `/regions`. |
| `GET` | `/regions-access` | none | Present only in newer guidance docs. |
| `GET` | `/get-all/cities?region_id=1` | `region_id`, `page` query | Older reference path: `/cities`. |
| `GET` | `/cities-access` | none | Present only in newer guidance docs. |
| `GET` | `/get-all/districts?cities_id=3` | `cities_id` query | Older reference path: `/districts`. |
| `POST` | `/get-latlong-details` | `latitude`, `lognditude` | Field is spelled `lognditude` in docs. |
| `POST` | `/get-address-details` | `address` | Newer guidance requires `address`; older reference omits the request body. |

### Warehouses / Pickup Addresses

Torod calls pickup locations "addresses" or "warehouses" in different endpoints.

| Method | Path | Request fields | Notes |
| --- | --- | --- | --- |
| `GET` | `/address/list` | `page` query | Lists merchant pickup addresses. |
| `POST` | `create/address` | `warehouse_name`, `warehouse`, `contact_name`, `phone_number`, `email`, `type`; optional `zip_code`, `district_id`, `locate_address`, `latitude`, `longitude` | Docs omit the leading slash in the path. |
| `POST` | `/update/address/{Address_ID}` | path `Address_ID`; body same as create address | Updates pickup address. |
| `POST` | `/address/wise/carriers` | `address_id`, `carrier_id` | Enables/disables a carrier for a pickup address. |

### Couriers and Rates

| Method | Path | Request fields | Notes |
| --- | --- | --- | --- |
| `GET` | `/get-all/courier/partners` | none | Lists courier partners. Response fields include `id`, `title`, `title_arabic`, `method`, `carrier_logo`, `approximate_delivery_time`, `approximate_delivery_time_arabic`, `pickup_status`. |
| `POST` | `/courier/partners/list` | `warehouse`, `customer_city_id`, `payment`, `weight`, `order_total`, `no_of_box`, `type`, `filter_by`; optional `is_insurance` | Rate shopping without creating an order. Response includes `rate`, `cod_fee`, `type`, `is_own`. This matches ADR-0008/ADR-0009. |
| `POST` | `courier/partners` | `order_id`, `warehouse`, `type`, `filter_by`; optional `is_insurance` | Rate shopping for an existing Torod order. Docs omit the leading slash in the path. |

Documented rate fields:

| Field | Meaning |
| --- | --- |
| `id` | Torod courier partner id |
| `title` | Courier display name |
| `method` | Courier method code/name |
| `rate` | Shipping charge in SAR units as an integer in examples |
| `cod_fee` | Cash-on-delivery fee |
| `type` | Shipment type, examples use `normal` |
| `is_own` | Integer flag |

Implementation note: `calculatePrice` should call `/courier/partners/list`, not create a Torod order. If required inputs such as `weight` or a resolvable destination city id are missing, return unavailable instead of guessing.

### Package Dimensions and Templates

The public OpenAPI files do not document package dimensions (`length`, `width`, `height`, `LxWxH`, etc.) on the rate, order-create, or ship-process endpoints. They also do not document a package-template list/retrieve endpoint or a package-template id field for booking.

Torod's official Help Center documents package templates in the dashboard UI under Settings -> Package, including "New Template" and setting a default template for labels. It does not document an API endpoint or request field for selecting a package template when creating or processing shipments.

This conflicts with the Phase 4 PRD/prompt requirement that Torod package dimensions and package-template ids be used for rates and labels, and that `constants.ts` include a package-template endpoint. Do not invent these fields or endpoints. Verify them through Torod sandbox/private docs, or update the PRD before implementing T1.2+.

### Orders

| Method | Path | Request fields | Notes |
| --- | --- | --- | --- |
| `GET` | `/order/list` | `page` query | Lists Torod orders. |
| `POST` | `/order/create` | `name`, `email`, `phone_number`, `item_description`, `order_total`, `payment`, `weight`, `no_of_box`, `type`; optional `district_id`, `locate_address`, `latitude`, `longitude`, `address`, `city_id` | Creates an unassigned Torod order. |
| `POST` | `/order/update` | `order_id`, plus the same required customer/order fields as create | Updates a Torod order. |
| `GET` | `/order/details` | body fields `order_id`, optional `shipping_type` | Present only in newer guidance docs. The docs declare a GET with multipart form body; verify in sandbox before implementation. |

Order response fields include `order_id`, `status`, `payment`, `total`, `total_string`, `item_description`, `no_of_box`, `weight`, `created_at`, `customer_data`, `product_data`, `delivery_address`, `tracking_id`, and `aws_label`.

### Shipments, Labels, Tracking, Cancel

| Method | Path | Request fields | Notes |
| --- | --- | --- | --- |
| `GET` | `/shipments/list` | `page` query | Lists shipments. |
| `POST` | `order/ship/process` | `order_id`, `warehouse`, `type`, `courier_partner_id`; optional `is_own`, `is_insurance` | Converts an unassigned order into a shipment. Docs omit the leading slash in the path. Response includes `tracking_id` and `aws_label`. |
| `POST` | `order/track` | `tracking_id` | Tracks shipment. Docs omit the leading slash in the path. Response schema has `shipment_status`, `current_status`, `estimated_delivery_date`, `tracking_data`, `aws_label`. |
| `POST` | `/shipment/details` | `tracking_id` | Present only in newer guidance docs. |
| `POST` | `/details` | `tracking_id`, optional `shipping_type` | Newer guidance summary says "Get Single Shipment Details"; field description says tracking id or order id. `shipping_type` may be `reverse` or `straight`, but this is still a details endpoint, not reverse-shipment creation. |
| `POST` | `/shipments/cancel` | `tracking_or_order_id` | Docs call this "Shipment / Order Cancel & Refund". Notes say orders can only be cancelled when status is ready for pickup. |

Label handling: Torod returns `aws_label`, with examples such as `https://demo.stage.torod.co/en/downloadLabel/4026`. There is no separate label endpoint in the public OpenAPI files.

### Returns

No return/RMA endpoint is present in either public OpenAPI file. The only related endpoints are `/details`, which can retrieve details with `shipping_type=reverse`, and `/shipments/cancel`, documented as cancel/refund, not return creation. Phase 4 should keep returns explicitly unsupported/deferred until Torod publishes a return endpoint or confirms return handling through another API.

## PRD Cross-Check

| PRD point | Docs result |
| --- | --- |
| Fulfillment provider, no schema/module | Compatible. Torod exposes external order/shipment APIs only. |
| One option per courier | Compatible. Courier ids/titles are available through `/get-all/courier/partners`; rates through `/courier/partners/list`. |
| Live calculated rates | Compatible. `/courier/partners/list` gets rates without creating an order. |
| Missing weight or unserviceable city returns unavailable | Compatible. Rate endpoint requires `weight` and `customer_city_id`. |
| Package dimensions and templates | Conflict. Public docs do not expose package dimension fields or package-template endpoints, but the PRD/prompt require them. |
| Book shipment at fulfillment time | Compatible for order and courier assignment. `/order/create` creates a Torod order; `order/ship/process` assigns the courier and returns tracking/label. Package data is unresolved. |
| Label on demand | Partially compatible. Docs return `aws_label`; no separate label endpoint is documented. Store label URL from shipment/order responses and expose it on demand. |
| Webhook-first tracking | Compatible. Webhook payload and statuses are documented. |
| Polling fallback if no webhook | Not needed for primary tracking, but `order/track`, `/shipment/details`, and `/shipments/list` support fallback polling/manual refresh. |
| Returns v1 if supported | Not supported in public docs. Defer and document unsupported returns. |

## Implementation Notes

- Normalize documented paths with missing leading slashes before sending requests.
- Keep every endpoint path, status, payment value, shipment type, metadata key, and env var in `src/providers/torod/constants.ts`.
- Do not hard-code courier ids from examples. Courier ids must come from Torod API responses.
- Default shipment type should be `normal` only if the loader documents and validates that default.
- Payment examples use `Prepaid`; COD appears in docs through `cod_fee` and pricing depends on payment method. Map Medusa payment state to Torod payment constants explicitly.
- City serviceability depends on resolving Torod `cities_id`; do not infer serviceability from free-text city names after `/cities-access` / `/get-all/cities` lookup fails.
- Webhook verification should use core `verifySecretToken` or `verifyWebhook` only if core supports the exact header-token scheme. The shared secret must never be logged.
