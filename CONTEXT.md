# Medusa KSA — Shared Glossary

The suite-wide language every package and every agent should use. Package-specific terms live in that package's `CONTEXT.md` (see `CONTEXT-MAP.md`). Keep to terms unique to this project — general programming concepts (timeout, retry) don't belong here.

## Packaging

**Connector**:
A published package that integrates one external service into Medusa (a gateway, courier, or SMS provider).
_Avoid_: plugin (reserve for the npm `medusa-plugin-*` naming only), integration, adapter.

**Provider**:
A connector that maps to a native Medusa provider type (Payment, Fulfillment, Notification) and registers in that module's `providers` array.
_Avoid_: gateway (use only for the external payment service itself), driver.

**Core**:
The `@medusa-ksa/core` package — the shared safety surface every connector depends on.
_Avoid_: common, shared-lib, utils.

## Money

**Halalas**:
The integer minor unit of SAR (1 SAR = 100 halalas). All amounts cross module boundaries as halalas.
_Avoid_: cents, minor units, subunits.

**SAR amount**:
A branded integer value in halalas. Floats are never used for money.
_Avoid_: price (ambiguous), decimal amount.

## ZATCA / e-invoicing

**EGS**:
E-invoicing Generation Solution unit — the cryptographic identity (keys + CSID) onboarded with ZATCA. Modelled as `ZatcaCredential`.
_Avoid_: device, terminal.

**CSID**:
Cryptographic Stamp Identifier — the X.509 certificate ZATCA issues (Compliance CSID, then Production CSID).
_Avoid_: cert (loosely), key.

**ICV**:
Invoice Counter Value — the per-EGS sequential integer, from 1, anchoring the hash chain.
_Avoid_: invoice number, sequence.

**PIH**:
Previous Invoice Hash — SHA-256 of the immediately prior invoice's XML; chains invoices cryptographically.
_Avoid_: prev hash, parent hash.

**Clearance**:
The real-time B2B/Standard flow — submit to ZATCA and await `Cleared` **before** issuing the invoice.
_Avoid_: validation, approval.

**Reporting**:
The within-24h B2C/Simplified flow — issue immediately, report to ZATCA after (deferrable).
_Avoid_: submission, sync.

**Standard invoice** / **Simplified invoice**:
B2B/B2G invoice (buyer VAT + address, goes through Clearance) / B2C invoice (QR-stamped, goes through Reporting).
_Avoid_: tax invoice, receipt.

**Credit note (381)** / **Debit note (383)**:
Post-issuance ZATCA documents for value/VAT decreases or increases. They use the UBL `<Invoice>` root with `InvoiceTypeCode` 381 or 383, positive amounts, a billing reference to the original invoice, and a reason.
_Avoid_: negative invoice, refund invoice, adjustment invoice.

**Lifecycle source**:
The idempotency key for a ZATCA document: `order`, `refund`, `return`, `order_cancel`, or `order_edit` plus the triggering entity id. One order can have one original invoice and many lifecycle notes.
_Avoid_: one-invoice-per-order, order id as the only key.

**Reconciliation invariant**:
The safety rule that a built ZATCA document must match Medusa's computed tax-inclusive total and VAT total before reporting. A mismatch fails closed; a numerically wrong document is never reported.
_Avoid_: best-effort totals, rounding later.

## Payments

**Hosted payment**:
A payment the backend creates server-side that returns a gateway-hosted URL; the storefront redirects the customer there to complete it (entering card/OTP on the gateway's page, not ours). The default flow — needs no client SDK and keeps card data off our systems.
_Avoid_: checkout page, payment link, invoice.

**Source**:
A single-use token the storefront produces (via the gateway's client SDK, e.g. Moyasar.js) representing the customer's payment instrument; the backend creates a payment from it. The optional alternative to a hosted payment.
_Avoid_: token, card, payment method.

**Requires more action**:
The session state when a payment can't complete server-side alone and the customer must be redirected (e.g. a 3-D Secure challenge). The provider surfaces a redirect URL; the final outcome is confirmed by webhook, never by the browser return.
_Avoid_: pending (too generic), redirect.

## Fulfillment

**Courier**:
The actual carrier that physically delivers a shipment (SMSA, Aramex, iMile…). An **aggregator** exposes several couriers through one API; in this suite each courier surfaces as its own fulfillment option.
_Avoid_: carrier (acceptable but prefer courier), shipping company, provider (reserve "provider" for the Medusa provider).

**Rate shopping**:
Querying the aggregator for a shipment's price across couriers so each can be compared/priced live at checkout.
_Avoid_: quote, pricing, estimate.

**Fulfillment option**:
A shippable choice the provider exposes via `getFulfillmentOptions` (here, one per courier) that an admin attaches to a Medusa **Shipping Option**.
_Avoid_: shipping method, service, carrier service.

## Addresses

**National Address (العنوان الوطني)**:
Saudi Arabia's official unified address — building number, street, district, city, postal code, additional number — issued and validated by Saudi Post (SPL). The data couriers need for reliable delivery.
_Avoid_: address (too generic), postal address.

**Short address**:
The memorable 4-letter + 4-digit code (e.g. `RRRD2929`) that resolves to a full National Address. Mandatory in KSA since 1 Jan 2026.
_Avoid_: postal code, zip, address code.

**Address validation status**:
The order-level flag (`valid` | `unvalidated` | `unchecked`) recording whether the shipping address verified against the National Address. Advisory by default — it surfaces bad addresses without blocking the order.
_Avoid_: verified flag, address error.

## Configuration

**Sandbox**:
Test mode, auto-detected from the API key prefix (e.g. `sk_test_`) — never a config flag.
_Avoid_: test mode, dev mode.
