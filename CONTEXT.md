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

## Configuration

**Sandbox**:
Test mode, auto-detected from the API key prefix (e.g. `sk_test_`) — never a config flag.
_Avoid_: test mode, dev mode.
