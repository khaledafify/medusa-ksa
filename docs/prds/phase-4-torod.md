# PRD — Phase 4: `medusa-fulfillment-torod` (courier aggregator)

**Status:** ready for implementation · **Owner:** Cursor (implements) · **Design:** locked via grill-with-docs (Opus)
**Authority:** `CLAUDE.md` · `docs/adr/0001`,`0002`,`0003`,`0008`,`0009` · `packages/core/CONTRACT.md` · `CONTEXT.md` (Fulfillment glossary) · `packages/payments/moyasar/**` (reference connector)

> A **Fulfillment provider** (not a module, not a payment provider). One Torod integration exposes many couriers — the highest-leverage shipping move. **Verify every Torod endpoint/field against docs.torod.co — never assume.**

---

## 1. Locked design decisions (do not re-litigate)

1. **One fulfillment option per courier (ADR-0008).** `getFulfillmentOptions` returns one option per Torod courier; the merchant enables the couriers they want as Shipping Options; the **customer chooses the courier**. (Not a single "best-rate" option.)
2. **Live calculated rates.** `calculatePrice` calls Torod's rate API at checkout — inputs: **weight** (summed from cart items), **origin** (stock-location address), **destination** (cart address) — returning the chosen courier's quote from one rate-shop call. Flat-rate stays Medusa-native.
3. **Missing inputs → unavailable, never guessed.** No product weight / unserviceable city ⇒ the option returns no rate. Optional configurable **default weight** escape hatch.
4. **Tracking syncs webhook-first.** An auto-wired, core-verified webhook route maps Torod status → Medusa `shipped`/`delivered`. **Polling job only if** docs.torod.co shows Torod doesn't push webhooks.
5. **Book at fulfillment, label on demand.** `calculatePrice` only quotes; `createFulfillment` (admin fulfills) books → tracking number + Torod shipment ref; the **label PDF is retrieved on demand** via the document method (handles sync/async labels).
6. **Returns in v1 (contingent).** `createReturnFulfillment` books a reverse Torod shipment + on-demand return label, **verified against docs.torod.co**; deferred with a README note only if Torod's return flow is genuinely separate.
7. **Free shipping is a Promotion, not provider code (ADR-0009).** The provider always returns the true rate; the 250 SAR (configurable) free-shipping default is a **seeded Medusa Promotion** in the scaffolder/demo-store + README.

## 2. Config

`TOROD_CLIENT_ID` + `TOROD_CLIENT_SECRET` (**both required**, env-first via core `createLoader`). Torod authenticates with **OAuth client-credentials** — the client exchanges id+secret for a **short-lived bearer token** (cache until expiry, refresh on 401); verify the exact token endpoint + expiry + header against docs.torod.co (S0). Optional: `TOROD_BASE_URL`, `TOROD_DEFAULT_WEIGHT_KG`, `TOROD_DEFAULT_PACKAGE_CM` (default box `LxWxH`, e.g. `10x10x10`), `TOROD_WEBHOOK_SECRET`. **Sandbox vs live is unconfirmed for the provided keys — confirm before any booking (a live booking creates a real shipment).**

**Packaging:** Torod requires **package dimensions (L×W×H)** for rates and labels (hence its saved package templates — Default 10×10×10, RedBox, Omni Lama). `calculatePrice` quotes with the **configurable default package** (`TOROD_DEFAULT_PACKAGE_CM`) + cart weight; `createFulfillment` uses a **package override from fulfillment data** (explicit dims **or** a Torod package-template id passed through) and falls back to the default. The option is **unavailable** when neither weight nor a package can be determined (never guessed).

## 3. Verify against docs.torod.co (never assume)

Auth scheme (**OAuth client-credentials** — token endpoint, expiry, how to attach the bearer); the **rate / rate-shop** endpoint (inputs — incl. **package dimensions** + weight — + per-courier response); how **couriers** are listed; the **package-templates** endpoint (and whether a template id can be referenced at booking); **create shipment / booking** (sync vs async, returned tracking/label, how the package is specified); **label** retrieval; **tracking** (webhook push vs polling endpoint) + event shape + signature/token scheme; **cancel**; **returns**; **serviceable cities** + whether a city **code** (not free text) is required.

## 4. Slices (each: test-first, small clean commits, gates green before advancing)

- **S1 — Scaffold + client.** Package (`medusa-fulfillment-torod`, scripts `medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`), dual tsconfig + vitest (mirror moyasar), `.env.example`. Provider skeleton extending `AbstractFulfillmentProviderService` + `createLoader` (`TOROD_CLIENT_ID + TOROD_CLIENT_SECRET`, fail-fast). `TorodClient` over core `HttpClient`.
  *Accept:* boots fail-fast on missing key; client unit tests (mocked fetch) — auth header, errors→`KsaError`, no key leak.
- **S2 — Options + rates.** `getFulfillmentOptions` (one per courier). `calculatePrice` (live rate-shop; **weight + default package** (`TOROD_DEFAULT_PACKAGE_CM`) / origin / destination; **unavailable on missing inputs**; default-weight + default-package options). `validateFulfillmentData` (serviceability / city-code mapping).
  *Accept:* options list per courier; `calculatePrice` returns the right courier's rate using the default package; **a missing-weight / unserviceable-city test returns unavailable, never a guessed price**.
- **S3 — Book + label + cancel.** `createFulfillment` (book at fulfillment → tracking number + Torod shipment ref in data; **package from fulfillment-data override — explicit dims or a Torod package-template id — else the configured default**). `getFulfillmentDocuments` (on-demand label fetch). `cancelFulfillment` (idempotent; terminal no-op).
  *Accept:* sandbox booking returns tracking; label retrievable on demand; cancel is idempotent.
- **S4 — Tracking webhook.** Auto-wired verified route (core `verifyWebhook`/`verifySecretToken`) → map Torod status → Medusa `shipped`/`delivered`; idempotent under redelivery. (Polling job instead **iff** Torod has no webhooks — confirm in S0/verify.)
  *Accept:* a tracking event flips the fulfillment status; tampered/replayed events rejected; redelivery is a no-op.
- **S5 — Returns.** `createReturnFulfillment` (reverse shipment + on-demand return label), mirroring outbound. If Torod's return API is genuinely separate → defer + README note.
  *Accept:* sandbox return booking returns a reverse tracking/label; or a documented deferral.
- **S6 — Free-shipping default + docs.** Seed a configurable **250 SAR free-shipping Promotion** in `apps/demo-store` (and note it for `create-medusa-ksa-app`); document it. `packages/fulfillment/torod/README.md` (moyasar template): couriers, config, the **provider quotes truth / free shipping = Promotion** note, returns status. Update root README matrix.
  *Accept:* demo-store has the seeded promotion; **a test/grep asserts the provider has no hard-coded free-shipping threshold** (ADR-0009); README honest.
- **S7 — Sandbox e2e + status.** Rate → book → track → (return) against Torod sandbox in `apps/demo-store`; `pnpm changeset`.
  *Accept:* end-to-end in sandbox; status `🚧 Beta` (sandbox) → `✅ Stable` only with the passing e2e.

## 5. Guard gates (every slice)

**Green commands (exit 0):**
```
pnpm --filter medusa-fulfillment-torod build      # medusa plugin:build
pnpm --filter medusa-fulfillment-torod test
pnpm --filter medusa-fulfillment-torod typecheck
pnpm lint                                          # eslint + dependency-cruiser (0 violations) + syncpack
```

**Fulfillment-specific guards:**
- **`calculatePrice` never guesses** — missing weight / unserviceable city ⇒ unavailable (tested), never a fabricated price.
- **Provider quotes truth** — no hard-coded free-shipping/discount threshold in the provider (ADR-0009; asserted by test/grep). Free shipping is the seeded Promotion only.
- **Webhook security** — tracking route verifies via core (`verifyWebhook`/`verifySecretToken`), rejects tampered/replayed, idempotent.
- **Architecture** — it's a **provider** (no schema, ADR-0001); registers in the Fulfillment module's `providers` array; appears in Settings → Shipping with **no custom UI**; all I/O via core `HttpClient`; `@medusajs/*` peer-only; only `@medusa-ksa/core` intra-repo import (dependency-cruiser 0 violations); money as `SarAmount`.
- **Honesty** — couriers/returns claimed only if verified working in sandbox; status not faked; README states deferred items (returns-if-deferred, individual courier packages) as future work. Clean commits, no AI attribution, AI tooling git-ignored.

## 6. Definition of Done (v1)

A SAR region with Torod couriers enabled offers per-courier shipping options with **live rates** at checkout; the merchant books a shipment at fulfillment (real tracking + on-demand label), status syncs back (webhook), returns book a reverse shipment (or are documented-deferred); free shipping over 250 SAR works as a **seeded Promotion** while the provider quotes the true rate; all four gate commands green; sandbox e2e passes. Reuses `@medusa-ksa/core` throughout; respects ADR-0001/0002/0003/0008/0009.

## 7. Out of scope (v1)

Individual courier packages (SMSA/Aramex/SPL/iMile — later fan-out) · a "best-rate" auto-select option · provider-side discounts/free-shipping logic · custom admin UI · cryptocurrency. Deferred items README'd as future work.
