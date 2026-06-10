# PRD — Phase 2: `medusa-payment-moyasar` (reference connector)

**Status:** ready for implementation · **Owner:** Cursor (implements) · **Design:** locked via grill-with-docs (Opus)
**Authority:** `CLAUDE.md` · `docs/adr/0001–0005` · `packages/core/CONTRACT.md` · `docs/ROADMAP.md` (Phase 2) · `docs/CONFIGURATION.md`
**Kickoff prompt:** `docs/prompts/phase-2-moyasar.md` (read it first — guardrails + read-list). This PRD is the authoritative task list and acceptance criteria.

> The full rationale for the payment model is **ADR-0005**. This package becomes the **template** every other gateway copies — keep it clean.

---

## 1. Locked design decisions (do not re-litigate)

1. **Dual-mode (hosted-redirect default + optional source).** Default: the backend creates a Moyasar **hosted payment** and returns its URL; the storefront (often a separate custom React app) just **redirects** — no Moyasar.js, no PCI exposure. Optional: if the storefront embeds Moyasar.js and writes a `source` to the session, the backend charges it via `POST /payments`. Both converge on the same `requires_more` + webhook model. **(Amended — see ADR-0005 and Amendment A1 below.)**
2. **3DS → "requires more action".** `authorizePayment` returns a requires-more-action state carrying Moyasar's redirect URL when 3DS is needed (the norm for Mada/Saudi cards).
3. **Webhook is the source of truth.** `payment_paid`/`payment_failed` decide the final outcome; a `GET /payments/:id` verify is the backup. The browser `callback_url` return is **never** trusted to mark paid.
4. **Immediate-capture only.** Moyasar captures on successful `POST /payments`. `capturePayment` is a confirm/no-op. **No `capture` option** on the provider.
5. **Webhook idempotency = idempotent against Medusa payment state.** No dedup table; redelivered `payment_paid` is a no-op. Pure provider, zero schema (ADR-0001).
6. **Config = `MOYASAR_SECRET_KEY` (required)** + **`MOYASAR_PUBLISHABLE_KEY` (optional** — only for the embedded source path; surfaced in session data when present) + optional `MOYASAR_WEBHOOK_SECRET`. The storefront supplies `callback_url` via session data in **both** modes. **(Amended.)**
7. **Methods: card + Mada + Apple Pay + STC Pay** — all via the hosted page (and via source where Moyasar.js supports them). **STC Pay is no longer deferred** (OTP runs on Moyasar's hosted page). **Samsung Pay**: include only if Moyasar actually supports it (verify docs.moyasar.com); if not, leave it out — don't fake a gateway capability. **(Amended.)**

## Amendment A1 — dual-mode hosted redirect (delta over the source-only build)

The provider was first built source-only; these deltas add the hosted-redirect default. Verify the exact Moyasar hosted API against docs.moyasar.com (likely **Invoices** — `POST /invoices` returning a hosted `url` — or a hosted payment form; confirm which, and its fields/`callback_url`/`success_url`).

- **A1.1 — Publishable key optional.** Loosen the loader/options: `MOYASAR_SECRET_KEY` required; **`MOYASAR_PUBLISHABLE_KEY` optional** (surfaced in `initiatePayment` data only when set). The provider must boot on the secret key alone.
- **A1.2 — Add Flow B (hosted payment).** New client method to create a hosted payment (amount halalas, currency, `callback_url`, description, metadata) → returns the hosted `url`. In `authorizePayment`: if the session has **no `source`** → create the hosted payment and return **`requires_more`** with the `url` (do **not** throw "no source"); if it **has** a `source` → current Flow A (`POST /payments`). `callback_url` stays required in both modes; the publishable key is **not** required for Flow B.
- **A1.3 — Methods.** STC Pay + Samsung Pay ride the hosted page — no special backend code. Verify Moyasar supports each; update the README method table (STC Pay → supported via hosted; Samsung Pay → supported only if Moyasar offers it, else omit it honestly).
- **A1.4 — Tests.** Add Flow B unit tests (no-source → hosted payment created, `url` surfaced, status `requires_more`); keep all Flow A + webhook tests green.
- **A1.5 — Docs.** README + `.env.example`: publishable key optional; document both modes (redirect default, embedded optional); refresh the method table.

All guard gates in §6 still apply unchanged.

## 2. Data contract (storefront ↔ backend)

- `initiatePayment` returns session data: `{ status: "pending", publishable_key, amount: <halalas>, currency: "SAR", description? }`.
- Storefront tokenizes (its own Moyasar.js using the surfaced `publishable_key`) → writes back onto the session: **`source`** (token) + **`callback_url`** (its 3DS return route).
- `authorizePayment` reads `source` + `callback_url` from session data.
- The package ships **no storefront code**; it only defines this data shape.

## 3. Lifecycle mapping (verify exact Medusa signatures via MedusaDocs MCP)

| Medusa method | Moyasar behavior |
|---|---|
| `identifier` | `"moyasar"` |
| `initiatePayment` | No API call. Return `pending` session data incl. `publishable_key`, amount (halalas), currency |
| `authorizePayment` | `POST /payments` `{ source, amount, currency, callback_url, description, metadata }`. `paid` → `authorized`; `initiated`+`transaction_url` → `requires_more` (surface URL); `failed` → error |
| `capturePayment` | Confirm via `GET /payments/:id`; return captured. No-op if already captured |
| `getPaymentStatus` | `GET /payments/:id` → map Moyasar status → Medusa status |
| `retrievePayment` | `GET /payments/:id` |
| `refundPayment` | `POST /payments/:id/refund { amount }` (partial + full) |
| `cancelPayment` / `deletePayment` | Per Moyasar capability (likely no-op / void-if-uncaptured — **verify**) |
| `getWebhookActionAndData` | Verify signature (core `verifyWebhook`), map `payment_paid`→captured / `payment_failed`→failed / refunded; idempotent |

## 4. Verify against live sources (never trust memory)

- **Medusa v2 `AbstractPaymentProvider`**: exact required method set + signatures + return shapes + status enum + the `getWebhookActionAndData` contract. **Confirm whether Medusa v2 already exposes a built-in `POST /hooks/payment/{provider}` endpoint** — if so, do **not** ship a custom webhook route; just implement `getWebhookActionAndData`.
- **Moyasar** (docs.moyasar.com): base URL, Basic auth (secret key as username), payment object + status values, `POST /payments` / `GET /payments/:id` / refund endpoints, **3DS `source.transaction_url`**, **webhook payload + signature scheme**, whether any **`manual`/auth-only** flag exists (decision 4 assumes not), and refund partial support.

## 5. Tasks (each is test-first; small clean commit per task)

- **T1 — Scaffold.** `package.json` (name `medusa-payment-moyasar`, scripts `build: medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`), `tsconfig.json` + `tsconfig.build.json` (mirror core's dual setup), `vitest.config.ts`, `.env.example`.
  *Accept:* `pnpm install` resolves core; `pnpm --filter medusa-payment-moyasar typecheck` passes; syncpack versions match root/core.
- **T2 — Options + loader.** `types.ts` options (zod); `createLoader` requires `MOYASAR_SECRET_KEY` + `MOYASAR_PUBLISHABLE_KEY`, optional `MOYASAR_WEBHOOK_SECRET`; `detectSandbox` from secret prefix.
  *Accept:* unit tests — missing secret **or** publishable throws `KsaError` naming the var + where to get it; sandbox detected from `sk_test_`.
- **T3 — MoyasarClient.** `client.ts` on core `HttpClient` (baseUrl `https://api.moyasar.com/v1`, Basic auth, timeout, retry). `createPayment` / `fetchPayment` / `refundPayment`.
  *Accept:* unit tests with injected fake `fetch` — Basic auth header correct, amounts in halalas, non-2xx → `KsaError`, **secret redacted** in error messages, retries only on safe/5xx/429.
- **T4 — Service lifecycle.** `service.ts extends AbstractPaymentProvider`: `identifier`, `initiatePayment`, `authorizePayment` (incl. **3DS → requires_more + transaction_url**), `capturePayment` (confirm/no-op), `getPaymentStatus`, `retrievePayment`. Money via `SarAmount`; failures via `toMedusaError`.
  *Accept:* unit tests for paid path, **3DS path** (`initiated`→requires_more), failed path, status mapping. Method set matches MedusaDocs.
- **T5 — Refund + cancel/delete.** `refundPayment` (partial + full, halalas); `cancelPayment`/`deletePayment` per verified Moyasar capability.
  *Accept:* unit tests; partial refund amount correct.
- **T6 — Webhook.** `getWebhookActionAndData`: `verifyWebhook` with `MOYASAR_WEBHOOK_SECRET`, map events, **idempotent** against payment state. Custom route only if Medusa has no built-in (per §4).
  *Accept:* unit tests — valid sig → correct action, bad/missing sig → rejected, `payment_paid` → captured action, `payment_failed` → failed, **redelivery is a no-op**.
- **T7 — Registration + docs.** `index.ts` ModuleProvider export so `resolve: "medusa-payment-moyasar/providers/moyasar"` works. Update `README.md`: STC Pay → `planned`, remove the `capture` option, document config (`secret`+`publishable`+optional webhook) and the Flow-A/3DS/webhook model; refresh `.env.example`.
  *Accept:* resolve path builds; README is honest (no `capture`, STC Pay not `✅`).
- **T8 — Green gate.** Make all pass from repo root (see §6).
- **T9 — Ship.** `pnpm changeset` (minor); clean commits (no AI attribution); push; set README matrix status `🚧 Beta`; confirm AI tooling not committed.
- **T10 — (Deferred) sandbox e2e.** Only if Moyasar `sk_test_` keys + Postgres + `apps/demo-store` available: register, SAR region, enable in admin, run a sandbox payment + webhook round-trip. If done and green → status may become `✅ Stable`; otherwise stays `🚧 Beta`.

## 6. Guard gates (every task/PR must satisfy)

**Green commands (all exit 0):**
```
pnpm --filter medusa-payment-moyasar build      # medusa plugin:build → .medusa/server
pnpm --filter medusa-payment-moyasar test       # vitest, all cases below
pnpm --filter medusa-payment-moyasar typecheck
pnpm lint                                        # eslint + dependency-cruiser (0 violations) + syncpack
```

**Architectural guards (auto + review):**
- dependency-cruiser shows **0 violations** → proves only `@medusa-ksa/core` is imported and `@medusajs/*` are peer (ADR-0003).
- **No raw `fetch`/axios**, no `process.env` reads, no hand-rolled HMAC, no `* 100` money — all via core (ADR-0002). Grep the diff to confirm.
- It's a **provider**, no custom module/table (ADR-0001).

**Security guards (adversarial pass):**
- No secret/token ever appears in a log line or error message (redaction verified by a test).
- Webhook **rejects** tampered/replayed payloads; final paid state only set by webhook/verify, never the redirect.
- Outbound capture/refund guarded against double-fire (core idempotency); amounts integer halalas end-to-end.

**Honesty / hygiene guards:**
- No faked capability (no `capture` option; STC Pay marked planned). Status not `✅ Stable` without the passing sandbox e2e (T10).
- No storefront code, no custom admin UI shipped in the package.
- Commits clean, imperative, **no `Co-Authored-By` / no AI mention**. `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` never committed.

## 7. Definition of Done

`medusa-payment-moyasar` builds and all unit tests + the four gate commands are green; the provider boots fail-fast with only its documented env vars; card/Mada/Apple Pay authorize (incl. 3DS) and refund are covered by tests; webhook handling is idempotent and signature-verified; uses only core primitives; respects ADR-0001/0002/0003/0005; README + `.env.example` are accurate and honest; a changeset is added; pushed to `main`; README matrix status is `🚧 Beta` (or `✅ Stable` iff T10 passed). The package is clean enough to copy for the next gateway.

## 8. Out of scope (v1)

STC Pay (OTP flow) · manual/authorize-only capture · any storefront code · custom admin UI · saved cards/tokenization · cryptocurrency (never).
