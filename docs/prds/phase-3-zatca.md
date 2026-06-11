# PRD — Phase 3: `medusa-plugin-zatca` (flagship, B2C v1)

**Status:** ready for implementation · **Owner:** Cursor (implements) · **Design:** locked via grill-with-docs (Opus)
**Authority:** `CLAUDE.md` · `packages/zatca/SPEC.md` · `docs/adr/0001`,`0002`,`0003`,`0004`,`0006`,`0007` · `packages/core/CONTRACT.md` · `CONTEXT.md` (ZATCA glossary)

> ZATCA is the flagship. It is a **custom module** (not a provider), it signs **legal tax documents**, and the highest-risk parts (signing/QR canonicalization, hash-chain concurrency) reject silently when wrong. **Verify every external detail against the ZATCA Developer Portal / Validation SDK — never trust memory.** Build and certify in **sandbox → simulation** before production.

---

## 1. Locked design decisions (do not re-litigate)

1. **Scope = B2C only (ADR-0006).** Simplified invoices via **Reporting** (issue now + signed QR, report within 24h). **Single EGS.** B2B/Standard/Clearance and multi-EGS are **future work, stated in the README** — never implied as shipped.
2. **Hash chain (ADR-0004 amended).** ICV (sequential per EGS) + PIH (SHA-256 of prior invoice) allocated under a **per-EGS Postgres advisory lock** (or `SELECT … FOR UPDATE` on a chain-head row). The lock wraps **allocate → build → hash → sign → persist**; ZATCA **submission is outside the lock**. **ICV consumed at generation** (rejection → credit note, never reuse).
3. **Trigger = `payment_captured`** by default (configurable `order_placed` for COD/auth-only). **Idempotent: one `ZatcaInvoice` per order** — a re-fired event never mints a second.
4. **Signing/QR (ADR-0007).** Adapt a proven open-source ZATCA implementation; **validate every output offline against the ZATCA SDK golden samples before any network call.** Never hand-roll from the PDF. Honor the source license.
5. **Deferred reporting engine.** `retry-reporting` job **claims** invoices with `SELECT … FOR UPDATE SKIP LOCKED` (exactly-once across instances) → exponential backoff in the 24h window → success `reported` (incl. "reported with warnings"); terminal failure → status `failed`, surfaced in the wizard **and** an **admin notification** — **the order is never affected.**
6. **Onboarding backend-first.** `onboard-egs` workflow + admin API routes do the whole handshake (CSR → OTP → Compliance CSID → compliance checks → Production CSID), testable headlessly. The **admin wizard is the final slice** on top.
7. **Credential security (ADR-0004).** `ZatcaCredential` stores `private_key` + CSIDs **encrypted at rest** (core `secrets`, AES-256-GCM, key from **`ZATCA_ENCRYPTION_KEY`**, length-validated, **fail-fast at boot**). **Never logged, never returned from any API route** — the wizard sees **status only**. `ZatcaInvoice` ↔ Order via a **Module Link** (ADR-0001).

## 2. Config (non-secret bootstrap only)

```ts
options: {
  environment: process.env.ZATCA_ENV ?? "sandbox",   // sandbox | simulation | production
  encryptionKey: process.env.ZATCA_ENCRYPTION_KEY,    // required, 32-byte, validated at boot
  trigger: process.env.ZATCA_TRIGGER ?? "payment_captured", // | "order_placed"
}
```
Everything else (keys, CSID, cert, org details) is **generated and stored encrypted** through onboarding — not in env.

## 3. Data models (SPEC §3)

- **`ZatcaCredential`** (the EGS, singleton in v1): `environment`, `vat_number`, `egs_serial_number`, `org_name/address/crn`, `private_key` 🔒, `csr`, `compliance_csid` 🔒, `production_csid` 🔒, `certificate`, `status` (`not_onboarded|compliance|production`). All 🔒 fields encrypted via core `secrets`.
- **`ZatcaInvoice`** (per order, Module Link → Order): `order_id` (link), `invoice_type` (`simplified` in v1), `uuid`, `icv`, `pih`, `invoice_hash`, `xml` (signed UBL, **stored in DB** as text in v1), `qr_code`, `status` (`pending|reported|rejected|failed`), `zatca_response` (json), `submitted_at/reported_at`, `attempts`.

## 4. Verify against the source (never trust memory)

ZATCA Developer Portal / Validation SDK + an existing open-source library: exact endpoint URLs per environment (sandbox/simulation/production), Compliance/Production CSID APIs, the Reporting API + its accepted/warning/rejected responses, the **UBL 2.1 Simplified** shape, **XAdES-BES/ECDSA canonicalization**, the **9-tag TLV QR byte layout (tags 6/7/8 from the signed hash)**, and the compliance-check sample document set required to obtain a Production CSID for Simplified docs.

## 5. Slices (each: test-first, small clean commits, gates green before advancing)

> Mirrors SPEC §8, trimmed to B2C single-EGS. Earlier slices are usable/testable without the later ones.

- **S1 — Module skeleton.** Models (`ZatcaInvoice`, `ZatcaCredential`) + service + module wiring + Module Link to Order + fail-fast loader (`ZATCA_ENCRYPTION_KEY` length-validated, `ZATCA_ENV`) + migrations (`db:generate`/`db:migrate`).
  *Accept:* module loads; boot fails fast on missing/short encryption key; migrations apply; link queryable via `query.graph()`.
- **S2 — `xml-builder` + `hash-chain`.** Simplified UBL 2.1 builder; per-EGS advisory-lock allocation of ICV/PIH; SHA-256 invoice hash. **Offline-validated** against ZATCA SDK samples.
  *Accept:* generated XML byte-matches golden samples; **concurrency test** — N parallel generations produce strictly sequential ICVs and correct PIH links, zero duplicates/stale.
- **S3 — `signer` + `qr`.** XAdES-BES/ECDSA stamp; TLV 9-tag QR (tags 6/7/8 from the signed hash). Adapted from a proven lib; **offline-validated** against golden samples.
  *Accept:* signature + QR byte-match known-good samples; licensing recorded.
- **S4 — `fatoora-client` + onboarding.** Client (core `HttpClient`, per-environment base URL) + `onboard-egs` workflow + admin API routes (org details → CSR → OTP → Compliance CSID → compliance checks → Production CSID). Credentials encrypted on write.
  *Accept:* full onboarding succeeds in **sandbox**; credentials provably encrypted at rest; no secret in any log or API response (test asserts).
- **S5 — `report-invoice` + subscriber.** `payment_captured` subscriber → build → sign → QR → persist `ZatcaInvoice` → enqueue reporting; report-invoice workflow reports to sandbox. Idempotent one-per-order.
  *Accept:* a captured order produces a signed, QR-stamped Simplified invoice reported in sandbox; re-firing the event creates no second invoice.
- **S6 — `retry-reporting` job.** Scheduled job: `SKIP LOCKED` claim → exponential backoff in 24h window → `reported` / `failed`; terminal failure emits an admin notification.
  *Accept:* exactly-once under concurrent job runs (test); failed invoices surface + notify; never mutate the order.
- **S7 — Admin wizard (the one UI).** Native admin route Settings → ZATCA: status banner, onboarding wizard on the S4 routes, dashboard (cleared/reported/failed counts + retry-failed). Skill: `building-admin-dashboard-customizations`.
  *Accept:* a merchant can onboard end-to-end via the wizard; the wizard shows **status only**, never secrets.
- **S8 — Simulation certification → production readiness.** Re-run the pipeline against the **simulation** environment; document the path to production.
  *Accept:* simulation invoices accepted; README documents go-live steps.

## 6. Guard gates (every slice)

**Green commands (exit 0):**
```
pnpm --filter medusa-plugin-zatca build      # medusa plugin:build
pnpm --filter medusa-plugin-zatca test
pnpm --filter medusa-plugin-zatca typecheck
pnpm lint                                     # eslint + dependency-cruiser (0 violations) + syncpack
```

**ZATCA-specific guards (the ones that matter most):**
- **Offline sample-match before any network** — XML/signature/QR byte-match the ZATCA SDK golden samples (S2/S3).
- **Hash-chain integrity under concurrency** — a test runs parallel generations and asserts strictly sequential ICVs + correct PIH links, zero duplicates/stale (the #1 correctness risk).
- **Credential security** — secrets encrypted at rest; a test asserts **no secret appears in any log line or API-route response**; boot fails fast on a missing/short `ZATCA_ENCRYPTION_KEY`.
- **Exactly-once reporting** — concurrent `retry-reporting` runs never double-report (claim-to-process test).
- **Architecture** — it's a **custom module** (ADR-0001), not a provider; `ZatcaInvoice`↔Order via Module Link (no FK); all I/O via core `HttpClient`; `@medusajs/*` peer-only; only `@medusa-ksa/core` intra-repo import (dependency-cruiser 0 violations).
- **Honesty** — README states B2B Clearance + multi-EGS are future work; status `📋 Planned` → `🚧 Beta` only after sandbox; `✅ Stable` only after simulation certification (CLAUDE.md §11). No secret in commits; AI tooling git-ignored.

## 7. Definition of Done (v1)

A captured B2C order produces a **signed, QR-stamped Simplified invoice**, hash-chained correctly under concurrency, **reported to ZATCA sandbox** (and certified in simulation); onboarding works end-to-end via backend routes and the admin wizard; credentials are encrypted and never exposed; the deferred reporting engine is exactly-once with loud failure alerting; all four gate commands green; README honest about B2C-only scope. The module is the compliance moat — correctness over speed, always.

## 8. Out of scope (v1)

B2B **Standard + Clearance** · **multi-EGS** (branches/registers) · buyer-VAT routing · credit/debit notes (beyond what onboarding compliance requires) · custom UI beyond the onboarding wizard · cryptocurrency (never). All deferred items are README'd as future work.
