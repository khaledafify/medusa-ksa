# ZATCA v1 ships B2C (Simplified + Reporting) on a single EGS; B2B and multi-EGS are future work

`medusa-plugin-zatca` v1 implements **only the B2C path**: **Simplified** tax invoices submitted via **Reporting** (issue immediately with a signed QR, report to ZATCA within the 24h window), for a **single EGS** (one onboarded cryptographic identity, one global ICV chain). **Standard invoices + Clearance (B2B/B2G)** and **multiple EGS units** (per-branch/register chains with per-order EGS selection) are explicitly deferred to later slices and documented as future work in the package README.

## Why

- **B2C is the overwhelming majority of e-commerce volume** and the simpler, non-blocking flow (no synchronous government call in the order path). Shipping it first delivers compliant invoicing to nearly every store quickly.
- Dropping B2B removes buyer-VAT routing, the synchronous Clearance call, and the `pending_clearance`/compensation machinery from v1. Dropping multi-EGS collapses "globally ordered per EGS" into one clean sequence and makes onboarding a single status (`not_onboarded → compliance → production`).
- The two deferred features are **additive**, not rework: the hash-chain, signing, QR, onboarding, and reporting engine built for B2C single-EGS are exactly what B2B/multi-EGS extend.

## Consequences

- Routing is trivial in v1: every captured order → Simplified/Reporting. No buyer-VAT field is read (when B2B lands, present-but-malformed VAT must error, never silently downgrade — recorded for that slice).
- `ZatcaCredential` is effectively a singleton; the ICV chain is one sequence.
- The README must state, honestly, that B2B Clearance and multi-EGS are planned, not shipped — never imply full coverage (CLAUDE.md §11).
