# Order-notification engine: a provider-agnostic plugin with DB-stored Handlebars templates + admin editor

Order-lifecycle notifications (which events send a message, in what language, and the message body) are owned by a **dedicated published plugin — `medusa-plugin-notifications`** (folder `packages/notifications/engine`) — **not** by the transport providers and **not** by host-app code. The plugin is a Medusa v2 **custom module** that ships:

1. a **`NotificationTemplate` model** (+ migrations) — rows keyed by `(channel, event, locale)` with a Handlebars `body`, `enabled`, optional `from`;
2. **self-seeded Arabic defaults** on install (ADR-0013 — no app script), idempotent, never overwriting an edited row;
3. a **Handlebars render service** (compile-cache, a curated helper set: `formatSar`, `formatDate`, Arabic pluralization; **plain-text/SMS-safe** — values sanitized, control chars stripped, length-aware, no prototype access);
4. **auto-loaded order subscribers** (`order.placed`, order-shipped, and follow-ons) that resolve a template → render with the order context → call `notificationModuleService.createNotifications` on the **`sms` channel** with an idempotency key;
5. **admin REST API routes** (CRUD + render-preview + send-test) and a **native admin editor** (Settings → Notifications) — the suite's **second sanctioned UI**, after the ZATCA wizard.

It is **provider-agnostic**: it creates notifications on the `sms` channel and **never imports a transport provider** — whichever provider is registered for `sms` (Unifonic now, Taqnyat later) delivers them. The transport providers stay **thin** (ADR-0014 intact): the engine renders; the provider sends.

## Why

- **Reusable drop-in, not copy-paste.** A published plugin makes "order-confirmation SMS out of the box" real for `create-medusa-ksa-app` and any store — install + config, zero app code (Medusa auto-loads a plugin's subscribers / API routes / admin extensions). Host-app wiring (the earlier draft of this ADR) was reference, not a product.
- **Separation of concerns.** *Which* events notify and *what they say* is merchant policy; *auth + POST + message id + retry-safety* is transport. Keeping them in separate packages keeps both reusable and the provider channel-swappable.
- **DB-stored + Handlebars + editor** (user decision, 2026-06-12): merchants change copy (brand voice, Arabic dialect, promo lines, variables like order number / total / tracking) **without a redeploy**, edited in the dashboard. This deliberately adds the **2nd UI exception** to the suite's no-UI rule (CLAUDE.md §6 amended).

## Consequences

- **New flagship-tier package** in the suite (model + migrations + engine + subscribers + API + admin UI) — larger than a transport provider; reflected in CLAUDE.md §3/§6 and the roadmap.
- **Events (verify exact names vs Medusa docs):** v1 seeds + wires `order.placed` (confirmation) and the order-shipped event (shipped + tracking); delivered / canceled seeded as easy follow-ons. Each row is independently `enabled`.
- **Recipient** from the order (shipping-address phone, else customer phone). **No phone → subscriber skips + logs**, never throws. The transport provider normalizes to international format (ADR-0014).
- **Idempotency:** `createNotifications` `idempotency_key` keyed on `event + entity id` — redelivery never double-sends.
- **DTO shape:** subscribers pass the resolved `template` id **and** the rendered `content.text`; the transport provider uses `content.text`. Verify `CreateNotificationDTO` (is `template` required, `content` shape) vs Medusa docs.
- **Engine safety:** SMS bodies are plain text — Handlebars configured `noEscape` but every interpolated value is sanitized (strip control/RTL-override exploits, cap length, count GSM/Unicode segments for a length warning). No filesystem/partials from user input.
- **UI is admin-only**, native extension (Settings → Notifications): list / edit body / toggle `enabled` / live render-preview with sample order data / send-test. Never storefront. The REST API backs it and is independently usable (so the no-UI promise still holds for headless consumers).
- **Self-migrate + self-seed** inside the plugin (ADR-0013); host footprint = npm dep + one config block + env. All paths **mocked-testable** (no Unifonic account); the live send-test is key-gated and skips.
- **Supersedes** the earlier "triggers live in the host app" draft of this ADR — `apps/demo-store` now simply installs the plugin.
