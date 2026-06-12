# PRD — Phase 4: `medusa-plugin-zatca` order-lifecycle correctness (v1.1, B2C)

**Status:** ready for implementation · **Owner:** Codex (implements) · **Design:** locked via gap analysis + source verification (Opus)
**Authority:** `CLAUDE.md` / `AGENTS.md` · `packages/zatca/SPEC.md` · `docs/adr/0001`,`0004`,`0006`,`0007`,`0008` · `docs/prds/phase-3-zatca.md` · `packages/core/CONTRACT.md` · `CONTEXT.md` (ZATCA glossary)

> This phase makes the flagship correct for **real** B2C orders. v1.0 issues one Simplified invoice (388) per order and ignores every post-sale event; its invoice is numerically correct only for the golden-sample shape (no discount, no shipping, tax-exclusive, single rate). v1.1 (a) fixes the **tax base** of the original invoice and (b) adds **credit (381) / debit (383) notes** for refunds, returns, cancellations, and edits. Scope stays **B2C Simplified · single EGS · Reporting** (ADR-0006). **Correctness over speed — these are legal tax documents that reject silently when wrong. Verify every external detail; never trust memory. Validate offline against the ZATCA SDK before any network call.**

---

## 0. Why (the findings this closes)

From the lifecycle gap analysis (all code claims confirmed against the repo; legal rules confirmed against ZATCA sources):

- **P0 — refunds/returns/cancellations emit no credit note.** Saudi law requires a reported **credit note (381)** for any value/VAT decrease on an issued invoice (VAT Reg. Art. 40/54). Today there is no subscriber for `payment.refunded`, `order.return_received`, `order.canceled`, or `order-edit.confirmed`.
- **P0 — discounts/promotions dropped from the tax base.** Line = `quantity × unit_price` (`xml-builder.ts:164`); template hardcodes allowances to `0.00` (`templates/simplified-invoice.ts:9,17`).
- **P0 — shipping omitted.** Only `order.items` become lines (`subscribers/zatca-issue-invoice.ts:101-114`); invoice total < amount paid; shipping VAT under-reported.
- **P0 — tax-inclusive pricing inflates VAT.** `is_tax_inclusive` never read; VAT always added on top (`xml-builder.ts:164-169`).
- **P1 — no data model for a second document per order** (`unique(order_id)`, `invoice_type` enum `["simplified"]` only).
- **Bug — billing reference** emits `Invoice Number: {serial}` instead of the bare serial (`xml-builder.ts:246-252`).
- **P2 — partial/multiple captures, fractional/zero quantities, no order-state guard.**

v1.0 is **sandbox/demo-safe only**. This PRD makes it production-safe for mainstream B2C orders.

---

## 1. Locked design decisions (do not re-litigate — see ADR-0008)

1. **Document axis** `document_type` ∈ `invoice | credit_note | debit_note` (default `invoice`), orthogonal to `invoice_type` (`simplified`). All three use the `<Invoice>` root + `cbc:InvoiceTypeCode` 388/381/383. **Amounts are always positive**; the type code carries credit/debit direction.
2. **Lifecycle → document** mapping is the table in ADR-0008 §2 (refund/return/cancel/edit-down → **381**; edit-up → **383**; pre-issuance events → no-op). Notes are **reported** (`/invoices/reporting/single`), within 24h, never cleared.
3. **Idempotency** = `unique(source_type, source_id)`. Drop `unique(order_id)`. Keep `unique(icv)`, `unique(uuid)`. A re-fired event returns the existing row.
4. **One hash chain across all document types** through the existing per-EGS advisory lock + `generatePendingInvoice`. No new counter/chain. ICV consumed at generation; rejected docs keep their ICV and still feed the next PIH.
5. **Tax base** is derived from Medusa's computed order graph: discount → document `AllowanceCharge` (`ChargeIndicator=false`); shipping → document `AllowanceCharge` (`ChargeIndicator=true`) + new `cbc:ChargeTotalAmount`; tax-inclusive → ex-tax derivation. **Reconciliation invariant fails closed** (built total must equal `order.total`, built VAT must equal `order.tax_total`, else mark `failed` + notify, never report).
6. **Issuance timing** anchored at `payment_captured` (default, defensible tax point); `order_placed` documented as weaker (COD only). Block issuance for already-`canceled` orders and zero-total orders.
7. **Billing reference** = bare original serial (strip the `Invoice Number: ` prefix). **Reason** = free-text `cbc:InstructionNote` (KSA-10); no structured reason code required.
8. **Byte-match gate preserved** (ADR-0007): the no-discount/no-shipping path stays byte-identical to the current golden sample; new fixtures pass the ZATCA SDK validator offline.

---

## 2. Config (no new required options)

No new env/options. `environment`, `encryptionKey`, `trigger` unchanged (`packages/zatca/src/modules/zatca/types.ts`). All four lifecycle subscribers are always active; whether a document is produced is decided by event + order state, not config. (Optional future toggle `lifecycleNotes: true|false` is **out of scope** for v1.1 — notes are a legal requirement, on by default.)

---

## 3. Data model changes (Slice S1)

### `ZatcaInvoice` — add fields (`packages/zatca/src/modules/zatca/models/zatca-invoice.ts`)

| Field | Type | Notes |
|---|---|---|
| `document_type` | enum `invoice \| credit_note \| debit_note` default `invoice` | the document kind (NEW axis) |
| `source_type` | enum `order \| refund \| return \| order_cancel \| order_edit` default `order` | what triggered this document |
| `source_id` | text | the triggering entity id (order_id / refund_id / return_id / edit-change id) |
| `parent_invoice_id` | text nullable | `ZatcaInvoice.id` of the original 388 a note references |
| `billing_reference` | text nullable | original invoice **serial** (BR-KSA-56); null for invoices |
| `reason` | text nullable | KSA-10 instruction note; null for invoices |
| `lines_snapshot` | json nullable | structured lines used to build the doc (name, qty, net unit halalas, vatPercent, category) — for later apportionment & audit |

### Indexes

- **Remove** `unique(order_id)`. Keep a **non-unique** index on `order_id`.
- **Add** `unique(source_type, source_id)` — the new idempotency backstop.
- Keep `unique(icv)`, `unique(uuid)`, index `status`.
- Add index `parent_invoice_id`, and `(status, document_type)`.

### Migration

- `db:generate` → `db:migrate`. **Backfill** existing rows in the same migration: `document_type='invoice'`, `source_type='order'`, `source_id=order_id`, `lines_snapshot=null`. (Do this before adding the `unique(source_type, source_id)` constraint so existing rows don't collide.)

**S1 Accept:** migration applies on a populated DB; existing invoice rows backfilled and still satisfy the new unique constraint; an order can hold one `invoice` row plus multiple `credit_note` rows; `query.graph({entity:"order", fields:["zatca_invoice.*"]})` still resolves; gates green.

---

## 4. Event resolution (verified Medusa 2.15.5 — use these field paths)

Event payloads (`@medusajs/utils/dist/core-flows/events.js`):

| Event | Payload |
|---|---|
| `payment.captured` / `payment.refunded` | `{ id }` (payment id) |
| `order.canceled` | `{ id }` (order id) |
| `order.return_received` | `{ order_id, return_id }` |
| `order-edit.confirmed` | `{ order_id, actions }` |

**`payment.refunded` → order + refunds** (the payload has no amount; enumerate refunds):
```ts
query.graph({ entity: "payment",
  fields: ["id", "refunds.id", "refunds.amount", "refunds.created_at",
           "payment_collection.order.id"],
  filters: { id: event.data.id } })
// orderId = payment_collection.order.id; create a credit note for each refund.id
// that has no existing ZatcaInvoice row keyed ('refund', refund_id).
```

**`order.return_received` → returned lines:**
```ts
query.graph({ entity: "return",
  fields: ["id", "order_id", "items.item_id", "items.quantity", "items.received_quantity"],
  filters: { id: event.data.return_id } })
// credit the received_quantity (fallback to quantity) per item_id at the original line's VAT rate.
```

**Original-invoice tax base (extend the issue-invoice subscriber query):**
```ts
query.graph({ entity: "order",
  fields: [
    "id","display_id","currency_code","status",
    "total","tax_total","subtotal","discount_total","shipping_total","item_total",
    "summary.*",
    "items.id","items.title","items.quantity","items.unit_price","items.is_tax_inclusive",
    "items.subtotal","items.total","items.tax_total","items.discount_total","items.discount_tax_total",
    "items.tax_lines.rate","items.tax_lines.total","items.tax_lines.subtotal","items.detail.quantity",
    "shipping_methods.id","shipping_methods.amount","shipping_methods.is_tax_inclusive",
    "shipping_methods.subtotal","shipping_methods.total","shipping_methods.tax_total",
    "shipping_methods.discount_total","shipping_methods.discount_tax_total",
    "shipping_methods.tax_lines.rate","shipping_methods.tax_lines.total",
  ],
  filters: { id: orderId } })
```

> **Field-semantics caveat (must be empirically confirmed before coding S2).** Medusa `BigNumber` money fields and the exact meaning of line `subtotal` vs `total` vs `tax_total` under `is_tax_inclusive` are subtle. Before building the tax-base math, run a demo-store script that creates orders with (a) a line discount, (b) shipping, (c) tax-inclusive pricing, and **log** the resolved fields, so the derivation below is confirmed against real values — not assumed. The **reconciliation invariant (§5)** is the backstop if any edge is mis-derived.

---

## 5. Tax-base algorithm (Slice S2 — the correctness core)

Build every monetary value in **integer halalas** (CONTRACT.md §Money), never float. Per VAT **category (rate)**, not per arbitrary line.

1. **Per item line:** taxable_ex (post-discount, ex-tax) and line_vat are taken from Medusa's computed totals so inclusive/exclusive is handled by Medusa:
   - `line_vat = round(item.tax_total)` (the VAT Medusa will collect for the line, post-discount).
   - `taxable_ex = round(item.total) − line_vat` (item.total is the final tax-inclusive line amount; subtracting VAT yields the ex-tax post-discount base — config-agnostic).
   - `rate = item.tax_lines[0].rate ?? 15`; category `S` if rate>0 else `O`/`Z` per ZATCA.
2. **Shipping** (each `shipping_method`): same derivation (`ship_vat = round(sm.tax_total)`, `ship_taxable_ex = round(sm.total) − ship_vat`).
3. **Represent in UBL (Strategy B — ZATCA-idiomatic):**
   - Invoice **lines** keep `PriceAmount` = original net unit price and `LineExtensionAmount` = original net × qty (pre-discount).
   - A **document-level discount** is one `cac:AllowanceCharge ChargeIndicator=false` per VAT category, `Amount` = that category's `discount_total`, summed into `cbc:AllowanceTotalAmount`.
   - **Shipping** is one `cac:AllowanceCharge ChargeIndicator=true`, `Amount` = `ship_taxable_ex`, summed into a new `cbc:ChargeTotalAmount`.
   - Per category: `TaxableAmount = Σ line nets + Σ shipping charges − Σ discounts` (that category); `TaxAmount = round(TaxableAmount × rate)`.
   - `TaxExclusiveAmount = Σ LineExtension − AllowanceTotalAmount + ChargeTotalAmount` (BR-CO-13); `TaxInclusiveAmount = TaxExclusiveAmount + Σ TaxAmount` (BR-CO-15); `PayableAmount = TaxInclusiveAmount`.
   - **UBL child order in any `AllowanceCharge`:** `ChargeIndicator` → (`AllowanceChargeReasonCode`?) → `AllowanceChargeReason` → `Amount` → `TaxCategory`. Mis-ordering `AllowanceChargeReasonCode` triggers an XSD error.
4. **Reconciliation invariant (fail closed):** after build, assert
   - `built.taxInclusiveHalalas === sarToHalalas(order.total)`
   - `built.taxHalalas === sarToHalalas(order.tax_total)`
   - per-category taxable/VAT sums tie out.
   On any mismatch: **do not report**. Persist the row as `failed` with `zatca_response = { error: "reconciliation_mismatch", expected, built }` and raise the admin notification. Never send a wrong invoice.
5. **Backward compatibility:** when `discount_total == 0` and there is no shipping, the emitted XML must be **byte-identical** to the current golden sample (keep `AllowanceTotalAmount`/`PrepaidAmount` `0.00`; emit `ChargeTotalAmount` **only** when shipping > 0; keep the existing zero-discount `AllowanceCharge` block). The existing byte-match test must still pass unchanged.
6. **Edge handling:** fractional/weight quantities (don't throw — render UBL quantity with its decimals); a 100%-discounted line (net 0, valid); skip non-SAR (existing) and zero-total orders; skip orders whose `status == "canceled"` at capture time.
7. **Billing-reference bug fix:** in the builder, `cac:BillingReference/.../cbc:ID` must be the bare serial (remove `Invoice Number: `).

**S2 Accept:** existing golden byte-match unchanged; **new** SDK-validated fixtures for {line discount, shipping, tax-inclusive, multi-rate} pass offline ZATCA validation; reconciliation invariant unit test (a deliberately mismatched build is rejected, not reported); an integration order with discount **and** shipping yields an invoice whose `TaxInclusiveAmount == order.total` and `TaxAmount == order.tax_total`; fractional-qty and zero-price-line cases produce a valid invoice (no throw).

---

## 6. Slices (each: test-first, small clean commits, gates green before advancing)

> Earlier slices are usable without later ones. S1→S3 are prerequisites; S4–S7 are independent lifecycle handlers; S8–S9 finish remediation + honesty.

- **S1 — Data model + migration + idempotency keys.** §3. New fields/indexes; drop `unique(order_id)`; add `unique(source_type, source_id)`; backfill.
  *Accept:* §3.

- **S2 — Original-invoice tax-base correctness + billing-ref fix.** §5. Extend the order query; extend builder + template (discount allowance, shipping charge, `ChargeTotalAmount`, tax-inclusive); reconciliation invariant; new golden fixtures.
  *Accept:* §5.

- **S3 — Generalize the generation pipeline for any document type.** Extend `generatePendingInvoice` / `generateInvoiceForOrder` / `PendingZatcaInvoiceRecord` / `reportInvoiceWorkflow` to carry `document_type`, `billingReference`, `reason`, `source_type`, `source_id`, `parent_invoice_id`, `lines_snapshot`. Existence check keyed on `(source_type, source_id)`. All documents allocate through the **same** chain lock. Add a service method e.g. `generateLifecycleDocument(input)` and reuse `buildSimplifiedInvoiceXml` (381/383 via `invoiceTypeCode`), `signInvoice`, `generateQr`, `reportZatcaInvoice`, `processPendingZatcaReports`.
  *Accept:* a credit note and an invoice for the **same** order both persist and link to the order; **concurrency test** — N parallel mixed generations (invoices + notes) produce strictly sequential ICVs, correct PIH links, zero duplicates/stale; idempotent on source key (re-fire creates no second row); a note's `parent_invoice_id` and `billing_reference` resolve to the original.

- **S4 — Refund → credit note (381).** Subscriber on `payment.refunded`. Resolve payment→`refunds`+`order_id` (§4). For each `refund.id` without a row keyed `('refund', refund_id)`: build a 381 referencing the original invoice serial, reason `"Refund"`. **Full refund** → credit the whole original; **partial single-rate** → one line at the order VAT rate for the refunded net; **partial multi-rate** → proportional lines per category. Guard: skip if no original invoice exists (nothing owed yet). Over-credit guard: Σ credited ≤ original total.
  *Accept:* full refund → full-value credit note reported in sandbox; partial → partial; two refunds on one payment → two credit notes (distinct ICVs); re-fired `payment.refunded` → no duplicate; refund before any invoice → no-op; demo-store e2e asserts a `credit_note` row + reporting status.

- **S5 — Return → credit note (381).** Subscriber on `order.return_received`. Resolve return items (`received_quantity`, fallback `quantity`) → per-line credit at the **original** lines' VAT rates, reason from the return. Idempotent on `('return', return_id)`.
  *Accept:* partial return → line-accurate credit note (correct qty/category); full return → full credit; re-fire → no duplicate; e2e.

- **S6 — Cancellation → credit note (381).** Subscriber on `order.canceled`. If a **reported** original invoice exists → full credit note, reason `"Order cancelled"`. If no invoice issued → no-op. Idempotent on `('order_cancel', order_id)`.
  *Accept:* cancel after a reported invoice → full credit note; cancel before issuance → no-op; re-fire → no duplicate.

- **S7 — Order edit → credit/debit note (delta).** Subscriber on `order-edit.confirmed`. If the original invoice is reported: recompute the order's correct totals, diff vs the invoiced totals; **decrease** → 381 for the delta, **increase** → 383 for the delta. If no invoice issued yet → no-op (the eventual invoice reflects the edit). Idempotent on `('order_edit', editOrChangeId)`.
  *Accept:* edit reducing value → credit note for the delta; edit increasing value → debit note (383) for the delta; pre-issuance edit → no-op.

- **S8 — Rejection/failure remediation.** On a ZATCA `rejected` or window-`failed` document, raise a clear admin notification with the remediation path, and expose an admin "issue corrective credit note" action (wizard/dashboard) for a reported-then-rejected case. Document that the rejected document keeps its ICV (chain stays continuous). Keep modest — auto-correction beyond notification is optional.
  *Accept:* a rejected/failed document raises an admin notification naming the order and the action; chain-continuity test (rejected row still feeds the next PIH); no order is ever mutated.

- **S9 — Honesty, dashboard, docs.** Update `packages/zatca/README.md` (scope now: correct discounts/shipping/tax-inclusive invoices + credit/debit notes for refunds/returns/cancellations/edits; list remaining limits — true partial-capture business models, mixed-rate partial *money* refunds not tied to a return, exchanges/claims documents, B2B Clearance, multi-EGS). Extend the admin dashboard counts to include credit/debit notes. Update `CONTEXT.md` glossary. `pnpm changeset`.
  *Accept:* README accurate and honest; dashboard shows note counts; gates green; status stays 🚧 Beta until simulation re-certification.

---

## 7. Guard gates (every slice)

**Green commands (exit 0):**
```
pnpm --filter medusa-plugin-zatca build      # medusa plugin:build
pnpm --filter medusa-plugin-zatca test
pnpm --filter medusa-plugin-zatca typecheck
pnpm lint                                     # eslint + dependency-cruiser (0 violations) + syncpack
```

**ZATCA-specific guards (the ones that matter most):**
- **Offline SDK validation before any network** — every fixture (invoice base, +discount, +shipping, tax-inclusive, multi-rate, credit-note full/partial, debit-note) byte/schema/BR-validates against the ZATCA SDK; the **base no-discount/no-shipping invoice stays byte-identical** to the current golden sample (existing test unchanged).
- **Reconciliation invariant** — a build whose total ≠ `order.total` (or VAT ≠ `order.tax_total`) is marked `failed` and **never reported** (test asserts both the pass and the fail path).
- **Hash-chain integrity across document types** — parallel mixed generations (invoices + credit/debit notes) yield strictly sequential ICVs + correct PIH links, zero duplicates/stale (extends the phase-3 concurrency test).
- **Exactly-once per lifecycle event** — re-firing `payment.refunded` / `order.return_received` / `order.canceled` / `order-edit.confirmed` creates no duplicate document (unique `(source_type, source_id)` test).
- **Credit/debit-note shape** — `<Invoice>` root + correct `InvoiceTypeCode` (381/383), `ProfileID reporting:1.0`, `cac:BillingReference/cbc:ID` = **bare** original serial (no `Invoice Number: `), `cbc:InstructionNote` present, **positive** amounts, reported via `/invoices/reporting/single`.
- **Credential security unchanged** — no secret in any log/API response; boot still fails fast on a bad `ZATCA_ENCRYPTION_KEY`.
- **Architecture** — still a custom module (ADR-0001); notes link to the order via the existing Module Link; all I/O via core `HttpClient`; only `@medusa-ksa/core` intra-repo import (dependency-cruiser 0 violations).
- **Honesty** — README states exactly what is and isn't supported; no faked "Stable"; no secret in commits; no AI attribution in commits.

---

## 8. Test matrix (verification guardrails — implement test-first)

> Locations follow the existing convention: unit/integration tests beside the code under `packages/zatca/src/...*.test.ts` (Vitest); Postgres-backed tests gated by a test `DATABASE_URL` (see README "Testing"); live sandbox e2e as `apps/demo-store/src/scripts/*.ts`.

**Unit (pure, no DB/network):**
- `xml-builder.test.ts` — (a) base invoice byte-matches current golden (unchanged); (b) line-discount produces document `AllowanceCharge false` + correct `AllowanceTotalAmount` + reduced `TaxExclusiveAmount`/`TaxSubtotal`; (c) shipping produces `AllowanceCharge true` + `ChargeTotalAmount` + increased exclusive/taxable; (d) multi-rate groups into correct `TaxSubtotal`s; (e) credit note 381 with **bare** serial billing ref + instruction note + positive totals; (f) debit note 383; (g) reconciliation helper rejects a mismatched build.
- tax-base mapper unit — given a mocked order graph (inclusive and exclusive variants, with/without discount/shipping), the derived per-category `taxable_ex`/`vat` tie to `order.total`/`order.tax_total`.
- idempotency-key derivation — `(source_type, source_id)` for each event type is stable and collision-free.
- partial-refund modeling — single-rate → one line; mixed-rate → proportional per-category lines that satisfy `taxable × rate = vat`.

**Integration (Postgres):**
- chain concurrency across types — N parallel invoices + credit notes → strictly sequential ICVs, correct PIH, zero dup/stale.
- idempotency — re-fired event (each of the four) → exactly one document row.
- one-invoice-many-notes — an order with 1 invoice + 2 credit notes persists and resolves via the Module Link; `unique(source_type, source_id)` enforced.
- reconciliation fail path — a forced mismatch persists `failed`, raises the notification, does **not** call the reporting client.

**Offline ZATCA SDK validation (no network):**
- new fixtures for {+discount, +shipping, tax-inclusive, multi-rate, credit-note full, credit-note partial, debit-note} each pass the SDK validator; record provenance in `test/fixtures/sdk/README.md`.

**Live sandbox e2e (`apps/demo-store/src/scripts/`):**
- extend `e2e-paid-refund.ts` (or add `e2e-zatca-lifecycle.ts`) to: capture → assert invoice reported; **partial refund** → assert a `credit_note` reported; **full refund** (second order) → assert full credit note; **return received** → assert line-accurate credit note; **cancel after invoice** → assert full credit note. Each asserts the `zatca_invoice` row's `document_type`, `billing_reference`, ICV ordering, and reporting status against the sandbox.

---

## 9. Corner-case matrix (every scenario → expected behavior)

| Scenario | Expected document | Idempotency key | Notes |
|---|---|---|---|
| Capture, normal order | invoice 388 | `(order, order_id)` | reconciliation must hold |
| Order with promotion/discount | invoice 388 with `AllowanceCharge false` | `(order, order_id)` | total == captured |
| Order with shipping | invoice 388 with shipping charge + `ChargeTotalAmount` | `(order, order_id)` | shipping VAT included |
| Tax-inclusive store | invoice 388, ex-tax derived | `(order, order_id)` | VAT not double-counted |
| Multi VAT rate | invoice 388, multiple `TaxSubtotal`s | `(order, order_id)` | per-category reconcile |
| Full refund | credit note 381 (full) | `(refund, refund_id)` | reason "Refund" |
| Partial refund (single rate) | credit note 381 (one line @ rate) | `(refund, refund_id)` | over-credit guard |
| Partial refund (mixed rate) | credit note 381 (proportional per category) | `(refund, refund_id)` | else route via return |
| Multiple refunds on one payment | one credit note **per** refund | per `refund_id` | distinct ICVs |
| Return received (partial) | credit note 381 (returned qty @ original rate) | `(return, return_id)` | line-accurate |
| Return received (full) | credit note 381 (full) | `(return, return_id)` | |
| Cancel **after** reported invoice | credit note 381 (full) | `(order_cancel, order_id)` | reason "Order cancelled" |
| Cancel **before** any invoice | no-op | — | nothing owed to ZATCA |
| Order edit down (post-issuance) | credit note 381 (delta) | `(order_edit, editId)` | |
| Order edit up (post-issuance) | debit note 383 (delta) | `(order_edit, editId)` | only legitimate 383 |
| Order edit before issuance | no-op | — | invoice reflects edit |
| Failed/abandoned payment | no document | — | `payment.captured` never fires |
| Authorized, not captured (`payment_captured` trigger) | no document until capture | — | correct tax point |
| `order_placed` trigger, un-captured | invoice 388 (weaker anchor) | `(order, order_id)` | documented; COD only |
| First of several partial captures | invoice 388 (full order) once | `(order, order_id)` | true partial-capture biz model = future work |
| Re-fired event (any) | existing row returned | by source key | no duplicate |
| ZATCA 4xx rejection | row `rejected` + admin notify (S8) | — | ICV consumed; chain intact |
| 24h window expiry | row `failed` + admin notify | — | corrective credit note path |
| Reconciliation mismatch | row `failed` + notify, **not reported** | — | never send a wrong doc |
| Non-SAR order | skip | — | existing guard |

---

## 10. Out of scope (v1.1) — document as future work in README

- **B2B Standard + Clearance**, **multi-EGS** (ADR-0006 — still deferred).
- **Exchanges / claims** (`order.exchange_created`, `order.claim_created`) — these mix a return + a new shipment; document generation for them is **future work** (the refund/return legs are partly covered via their own refund/return events).
- **True partial-capture business models** (an order intentionally never fully captured) — v1.1 issues the full-order invoice on first capture.
- **Mixed-rate partial *money* refunds not tied to a return** — require the return path or manual handling; proportional split is best-effort.
- **Multi-currency** — SAR only.
- **Automatic re-issue after rejection** beyond the S8 notification + admin action.
- Cryptocurrency (never).

---

## 11. Definition of Done (v1.1)

- The original Simplified invoice is **tax-correct** for orders with discounts, shipping, tax-inclusive pricing, and mixed VAT rates — proven by the reconciliation invariant (`TaxInclusiveAmount == order.total`, `TaxAmount == order.tax_total`) and SDK-validated fixtures, with the base case byte-identical to the golden sample.
- Refunds, returns, cancellations, and post-issuance edits produce correctly-chained, signed, QR-stamped, **reported** credit/debit notes carrying the BR-KSA-56 billing reference and KSA-10 reason, **idempotent** per source event.
- One hash chain spans all document types under the existing per-EGS lock; concurrency and exactly-once tests pass.
- A wrong document is **never reported** (reconciliation fail-closed); rejected/failed documents raise loud admin notifications; the order is never affected.
- All four gate commands green; dependency-cruiser 0 violations; credential security intact; **README honest** about what is and isn't supported. Status remains 🚧 Beta until simulation re-certification of the full lifecycle.
