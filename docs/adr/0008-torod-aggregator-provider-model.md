# Torod surfaces one fulfillment option per courier, with live calculated rates, book-at-fulfillment, and webhook tracking

`medusa-fulfillment-torod` is a **Fulfillment provider** (ADR-0001 — no schema) that models Torod's aggregator as **one Medusa fulfillment option per courier** (SMSA, Aramex, iMile…): the merchant enables the couriers they want as Shipping Options, the **customer chooses the courier** at checkout, `calculatePrice` returns that courier's **live Torod rate** from a single rate-shop call, and `createFulfillment` books that courier. Rates are quoted at checkout; the shipment is **booked at fulfillment** (no carrier cost committed until the merchant fulfills). The **label is retrieved on demand** via Medusa's document method (so instant *and* async-generated labels both work), and **tracking status syncs back webhook-first** (an auto-wired, core-verified route maps Torod status → Medusa `shipped`/`delivered`), with a polling job only if Torod doesn't push.

## Why

- One-option-per-courier is the most Medusa-idiomatic mapping (courier = fulfillment option = admin-configured Shipping Option), gives merchants control over which couriers to offer, and matches Saudi buyers' real courier preferences. A single "best rate" option (rejected) hides courier choice and forces us to define "best."
- Rate-at-checkout / book-at-fulfillment is the correct Medusa lifecycle; on-demand label retrieval decouples "have a tracking number" from "the PDF is ready." Webhook-first tracking reuses the proven Moyasar auto-wired-webhook pattern.

## Consequences

- `calculatePrice` (`POST /courier/partners/list`) computes from cart **weight + `no_of_box` (box count, default 1) + resolved `customer_city_id` + order_total + payment** — Torod's public API takes **no package dimensions** (package templates are dashboard-only; verified in S0). When weight or a resolvable destination city is missing, the option is **unavailable — never a guessed price** — with optional `TOROD_DEFAULT_WEIGHT_KG` / `TOROD_DEFAULT_BOX_COUNT` escape hatches. Flat-rate shipping stays Medusa-native (no provider call).
- **Returns are deferred** (S0 confirmed Torod's public API has no return/RMA creation endpoint — only a reverse details lookup). `createReturnFulfillment` fails fast with a clear NOT_SUPPORTED `KsaError`; returns are README'd as future work.
- All I/O via core `HttpClient`; config is `TOROD_CLIENT_ID` + `TOROD_CLIENT_SECRET` (Torod uses **OAuth client-credentials** — exchange id+secret for a cached short-lived bearer token) env-first via `createLoader`; webhooks verified via core `verifyWebhook`/`verifySecretToken`; `@medusajs/*` peer-only; only `@medusa-ksa/core` intra-repo import. Exact endpoints/fields verified against docs.torod.co (never assumed).
- The individual couriers (`medusa-fulfillment-smsa/aramex/spl/imile`) remain a later fan-out; Torod covers them as one integration first.
