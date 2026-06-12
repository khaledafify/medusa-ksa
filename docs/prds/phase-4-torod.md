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
6. **Returns deferred (S0-confirmed).** Torod's public API has **no return-booking endpoint** (only a reverse details lookup); `createReturnFulfillment` fails fast `NOT_SUPPORTED` and returns are README'd as future work (ADR-0008).
7. **Free shipping is a Promotion, not provider code (ADR-0009).** The provider always returns the true rate; the 250 SAR (configurable) free-shipping default is a **seeded Medusa Promotion** in the scaffolder/demo-store + README.

## 2. Config

`TOROD_CLIENT_ID` + `TOROD_CLIENT_SECRET` (**both required**, env-first via core `createLoader`). Torod authenticates with **OAuth client-credentials** — the client exchanges id+secret for a **short-lived bearer token** (cache until expiry, refresh on 401); verify the exact token endpoint + expiry + header against docs.torod.co (S0). Optional: `TOROD_BASE_URL`, `TOROD_DEFAULT_WEIGHT_KG`, `TOROD_DEFAULT_BOX_COUNT` (default `1`), `TOROD_WEBHOOK_SECRET`. Base URLs (from S0): **sandbox** `https://demo.stage.torod.co/en/api`, **live** `https://torod.co/en/api`. **Confirm the provided keys are sandbox before any booking (a live booking creates a real shipment).**

**Packaging (corrected after S0 — see `packages/fulfillment/torod/TOROD-API-NOTES.md`):** Torod's **public API does NOT take package dimensions or package-template ids** — package templates are a **dashboard-only** convenience. Rates/orders take **`weight` + `no_of_box`** (number of boxes). So `calculatePrice` and `createFulfillment` use a **box count** (`no_of_box`, default `1`, optionally overridable via fulfillment data), **not** dimensions. The option is **unavailable** when `weight` or a resolvable destination city id is missing (never guessed).

## 3. Verified API (S0 complete — `packages/fulfillment/torod/TOROD-API-NOTES.md` is the source of truth)

S0 mapped the public Torod API. Key facts the implementation must follow:
- **Auth:** `POST /token` with `client_id`+`client_secret` → bearer token; attach `Authorization: Bearer …`.
- **Couriers:** `GET /get-all/courier/partners` (ids/titles). **Rates:** `POST /courier/partners/list` (`warehouse`, `customer_city_id`, `payment`, `weight`, `order_total`, `no_of_box`, `type`, `filter_by`) — **no order created**.
- **Cities:** resolve a Medusa city → Torod `customer_city_id` via `/get-all/cities` (serviceability = the city resolves; never infer from free text).
- **Booking (two-step):** `POST /order/create` → `order_id`; then `POST order/ship/process` (`order_id`, `warehouse`, `type`, `courier_partner_id`) → returns `tracking_id` + **`aws_label` URL**.
- **Label:** the `aws_label` URL from the response — **no separate label endpoint.** Store it, expose on demand.
- **Tracking:** webhook-first — payload `{order_id, tracking_id, status, …}`, statuses `Pending|Cancelled|Created|Shipped|Delivered|Failed|RTO`, verified by a **shared secret in the `Authorization` header** (not HMAC). Fallback poll: `order/track`.
- **Cancel:** `POST /shipments/cancel` (`tracking_or_order_id`), only while ready-for-pickup.
- **Returns:** **no return-booking endpoint exists** → deferred (see S5).
- Normalize doc paths with missing leading slashes; verify the `/order/details` GET-with-body and token content-type (JSON vs multipart) in sandbox.

## 4. Slices (each: test-first, small clean commits, gates green before advancing)

- **S1 — Scaffold + client.** Package (`medusa-fulfillment-torod`, scripts `medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`), dual tsconfig + vitest (mirror moyasar), `.env.example`. Provider skeleton extending `AbstractFulfillmentProviderService` + `createLoader` (`TOROD_CLIENT_ID + TOROD_CLIENT_SECRET`, fail-fast). `TorodClient` over core `HttpClient`.
  *Accept:* boots fail-fast on missing key; client unit tests (mocked fetch) — auth header, errors→`KsaError`, no key leak.
- **S2 — Options + rates.** `getFulfillmentOptions` (one per courier from `/get-all/courier/partners`). `calculatePrice` via `/courier/partners/list` — inputs **`weight` + `customer_city_id` + `no_of_box` (default 1) + `order_total` + `payment`** from the cart/stock-location; **no dimensions**. `validateFulfillmentData` resolves the destination city → `customer_city_id`.
  *Accept:* one option per courier; `calculatePrice` returns the right courier's `rate`; **missing weight or unresolvable city ⇒ unavailable, never a guessed price**.
- **S3 — Book + label + cancel.** `createFulfillment` two-step: `POST /order/create` → `order_id`, then `order/ship/process` with `courier_partner_id` → store `tracking_id` + **`aws_label` URL** on fulfillment data; box count from fulfillment-data override else `TOROD_DEFAULT_BOX_COUNT`. `getFulfillmentDocuments` returns the **stored `aws_label` URL** (no separate label endpoint). `cancelFulfillment` → `/shipments/cancel` (ready-for-pickup only; terminal = idempotent no-op).
  *Accept:* sandbox booking returns tracking + a label URL; document method returns the label URL; cancel is idempotent.
- **S4 — Tracking webhook.** Auto-wired verified route (core `verifyWebhook`/`verifySecretToken`) → map Torod status → Medusa `shipped`/`delivered`; idempotent under redelivery. (Polling job instead **iff** Torod has no webhooks — confirm in S0/verify.)
  *Accept:* a tracking event flips the fulfillment status; tampered/replayed events rejected; redelivery is a no-op.
- **S5 — Returns (DEFERRED — S0 confirmed no return-booking endpoint).** Torod's public API has **no return/RMA creation** endpoint (only a reverse *details* lookup). Implement `createReturnFulfillment` to throw a clear `KsaError` (NOT_SUPPORTED) naming the limitation, and **document returns as future work** in the README. Do **not** fake/stub a reverse booking.
  *Accept:* `createReturnFulfillment` fails fast with a clear "not supported by Torod's public API" message; README lists returns as future work.
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
