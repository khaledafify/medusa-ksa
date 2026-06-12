# Saudi address validation is advisory by default and never blocks an order on an upstream outage

The `saudi-address` checkout hook defaults to **warn/flag**: it validates the shipping address and writes a status (`valid | unvalidated | unchecked`) to **order metadata** for the merchant to review, but **allows the order**. A **`strict` mode is opt-in** for stores that must refuse undeliverable addresses. In **all** modes, an SPL **outage with no cache never blocks** — the order is flagged-and-allowed, never rejected.

## Why

- Address validation should **raise data quality and surface bad addresses**, not become a silent revenue-killer. SPL **false-negatives** (a valid address it doesn't recognize) and SPL **downtime** must not lose sales — blocking on an upstream that's down most of the time would halt all orders.
- The stored flag is what makes warn-mode useful: the merchant sees exactly which orders need an address fix **before** handing them to a courier (Torod).

## Consequences

- The hook writes `order.metadata.saudi_address_status`; it throws (blocks) only when `strict` is set **and** SPL is reachable and returns invalid. It never throws on outage.
- Strictness is a single documented option; the default is `warn`.
- Surfacing is backend-only: a server-side cart-completion workflow hook + the `/store` validate/resolve/search endpoints. No storefront code, no custom UI (the flag rides native order metadata).
