# Connectors quote the truth; discounts (incl. free shipping) are a native Medusa Promotions concern

No connector in the suite implements pricing rules, thresholds, or discounts. A fulfillment provider returns the **real carrier rate**; a payment provider charges the **real amount**. Customer-facing reductions — most notably **free shipping over a threshold** (e.g. ≥ 250 SAR) — are expressed as **native Medusa Promotions**, not baked into a connector. `create-medusa-ksa-app` / the demo-store **seed** a configurable free-shipping promotion as a KSA default and the README documents it, but the promotion lives in Medusa's discount layer, not in any provider.

## Why

- **Separation of concerns:** a provider's one job is to quote/charge the truth. A provider that secretly returns `0` for qualifying carts hides the real carrier cost from the merchant's accounting and entangles a promotions concern in transport code.
- **Genuinely dynamic:** a Promotion threshold is admin-editable instantly (change 250 → 300, target specific couriers/regions, run time-boxed campaigns) with no redeploy. A provider-baked threshold is frozen in code.

## Consequences

- `medusa-fulfillment-torod` `calculatePrice` always returns the true Torod rate; the free-shipping default is a seeded Promotion (cart subtotal ≥ 250 SAR), not provider logic.
- This rule is suite-wide: any future "free over X", coupon, or shipping discount is a Promotion, never connector code.
- A guard test/grep asserts the fulfillment provider contains no hard-coded free-shipping threshold.
