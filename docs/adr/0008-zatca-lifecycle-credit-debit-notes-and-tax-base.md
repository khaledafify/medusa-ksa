# ZATCA v1.1: order-lifecycle credit/debit notes + tax-base correctness

`medusa-plugin-zatca` v1.0 issues exactly one Simplified tax invoice (388) per order and never reacts to refunds, returns, cancellations, or order edits. Its invoice is numerically correct **only** for an order with no discount, no shipping charge, tax-*exclusive* pricing, and a single VAT rate — the golden-sample shape. This ADR locks the design that makes the plugin correct for real KSA B2C orders: it adds **credit (381) / debit (383) notes** for the post-sale lifecycle and fixes the **tax base** (discounts, shipping, tax-inclusive pricing) of the original invoice. Scope stays **B2C Simplified, single EGS, Reporting** (ADR-0006); B2B Clearance and multi-EGS remain future work.

> Verified against Medusa **2.15.5** (`@medusajs/utils` event names, `@medusajs/types` order/payment/return DTOs) and ZATCA sources (XML Implementation Standard v1.2, VAT Implementing Regulations Art. 40/53/54, BR-KSA-56, Fatoora developer community). Full evidence in `docs/prds/phase-4-zatca-lifecycle.md` §4–§5.

## Decisions

1. **Document axis is orthogonal to the profile axis.** Add a `document_type` enum `invoice | credit_note | debit_note` (default `invoice`) to `ZatcaInvoice`, independent of `invoice_type` (`simplified`, the profile). One EGS, one chain, three document kinds. ZATCA uses the **`<Invoice>` root for all three**, distinguished only by `cbc:InvoiceTypeCode` (388/381/383) — never a `<CreditNote>` root. The existing builder already does this.

2. **Lifecycle → document mapping (legally derived).** A value/VAT **decrease** after issuance is a **credit note (381)**; an **increase** is a **debit note (383)**; an already-issued invoice can never be edited or voided (VAT Reg. Art. 40/54).

   | Medusa event (2.15.5) | Condition | Document |
   |---|---|---|
   | `payment.captured` / `order.placed` | first, order not canceled, total > 0 | **invoice 388** |
   | `payment.refunded` | original invoice exists | **credit note 381** (per refund) |
   | `order.return_received` | original invoice exists | **credit note 381** (per return) |
   | `order.canceled` | original invoice **reported** | **credit note 381** (full) |
   | `order.canceled` | no invoice issued yet | **no-op** (nothing owed) |
   | `order-edit.confirmed` | invoice reported, value **down** | **credit note 381** (delta) |
   | `order-edit.confirmed` | invoice reported, value **up** | **debit note 383** (delta) |
   | `order-edit.confirmed` | invoice not yet issued | **no-op** (invoice will reflect edit) |

   Credit/debit-note amounts are **positive**; the type code carries the direction. They are **reported** via the same `/invoices/reporting/single` endpoint as invoices (never cleared), within 24h.

3. **Idempotency is source-keyed, not order-keyed.** v1.0's `unique(order_id)` is wrong once an order owns 1 invoice + N notes. Replace it: add `source_type` (`order | refund | return | order_cancel | order_edit`) and `source_id` (the triggering entity id) and make **`unique(source_type, source_id)`** the idempotency backstop. Keep `unique(icv)` and `unique(uuid)`. The original invoice is keyed `('order', order_id)`; a refund credit note `('refund', refund_id)`; a return credit note `('return', return_id)`. A re-fired event returns the existing row untouched. (Amends ADR-0004's "unique order_id" clause.)

4. **One hash chain across all document types.** Verified: ICV is a single per-EGS counter and PIH is one continuous chain **irrespective of document type**. Every document — invoice, credit note, debit note — is allocated through the **same** per-EGS advisory lock and `generatePendingInvoice` pipeline, consuming the next ICV and chaining PIH off the immediately preceding document. **No separate counter or chain per type.** Rejected/failed documents keep their ICV and still feed the next PIH (the chain stays continuous; ZATCA tracks rejected-document hashes). ICV is consumed at generation and never reused (ADR-0004 unchanged).

5. **The invoice is built from Medusa's computed order graph, with a fail-closed reconciliation invariant.** The taxable base must reflect **discounts, shipping, and tax-inclusive pricing**:
   - **Discount** → document-level `cac:AllowanceCharge` (`ChargeIndicator=false`) + `cbc:AllowanceTotalAmount`, reducing `TaxExclusiveAmount` and the matching `TaxSubtotal` taxable base (BR-CO-13/14/15), per VAT category.
   - **Shipping** → document-level `cac:AllowanceCharge` (`ChargeIndicator=true`) + a new `cbc:ChargeTotalAmount` in `LegalMonetaryTotal`, increasing `TaxExclusiveAmount` and the matching taxable base.
   - **Tax-inclusive pricing** → derive the ex-tax base from Medusa's computed line/shipping totals; never blindly add 15% to `unit_price`.
   - **Reconciliation invariant (the safety net):** the built document's `TaxInclusiveAmount` must equal `order.total` and its `TaxAmount` must equal `order.tax_total` (per-category subtotals must match too). On mismatch the document is **not reported** — it is marked `failed` with a reason and raises an admin notification. A wrong invoice is never silently sent. This invariant makes the tax-base fixes trustworthy even where a Medusa field-semantics edge is missed.

6. **Issuance timing is anchored at the tax point.** `payment_captured` stays the default and is the defensible anchor (receipt of consideration is a VAT tax-point trigger). `order_placed` (un-captured) is the weaker anchor and is documented as such — acceptable only for genuine COD. Issuance is **blocked** for an order already `canceled` and for a zero-total order. Failed/abandoned/cancelled-before-capture orders never fire `payment_captured`, so they correctly produce no document.

7. **Credit/debit notes carry BR-KSA-56 + KSA-10.** `cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID` = the **bare original invoice serial** (e.g. `INV-1042`), and `cbc:InstructionNote` = a human-readable reason. **Bug fix:** the v1.0 builder emits `Invoice Number: {serial}` — strip the literal `Invoice Number: ` prefix; the element must contain the serial only.

8. **Structured line snapshot persisted at issuance.** The original invoice row stores a `lines_snapshot` (JSON of per-line name/qty/net unit price/tax category) so later partial credit notes apportion against what was actually invoiced rather than the mutated live order. A cumulative-credited guard prevents over-crediting an order.

## Consequences

- **New migration** on `zatca_invoice`: add `document_type`, `source_type`, `source_id`, `parent_invoice_id`, `billing_reference`, `reason`, `lines_snapshot`; drop `unique(order_id)`; add `unique(source_type, source_id)` and supporting indexes. Existing rows backfill to `document_type='invoice'`, `source_type='order'`, `source_id=order_id`.
- **New subscribers** for `payment.refunded`, `order.return_received`, `order.canceled`, `order-edit.confirmed`; the existing issue-invoice subscriber gains the tax-base + reconciliation logic and the canceled/zero-total guards.
- **Builder + template change** (discount allowance, shipping charge, `ChargeTotalAmount`, tax-inclusive). The **byte-match gate (ADR-0007) is preserved**: the no-discount/no-shipping path must stay byte-identical to the current golden sample, and **new golden fixtures** (discount, shipping, tax-inclusive, multi-rate, credit-note full/partial) must pass the ZATCA SDK validator offline before any network call.
- **Amends ADR-0006** (credit/debit notes for refunds/returns/cancellations/edits are now **in scope for v1.1**, not deferred) and **ADR-0004** (unique-`order_id` → source-keyed uniqueness; one chain spans document types).
- **README honesty update**: v1.1 supports correct discounts/shipping/tax-inclusive invoices and credit/debit notes; documents the remaining limits (true partial-capture business models, mixed-rate partial *money* refunds not tied to a return, exchanges/claims documents, B2B Clearance, multi-EGS).

See `docs/prds/phase-4-zatca-lifecycle.md` for the implementation slices, test matrix, and guard gates.
