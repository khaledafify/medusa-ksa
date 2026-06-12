# PRD — `medusa-plugin-notifications` (order-notification engine)

**Status:** ready for implementation · **Owner:** Codex/Cursor · **Design:** locked via grill-with-docs (Opus)
**Authority:** `CLAUDE.md` (§6 — 2nd sanctioned UI) · `docs/adr/0013`,`0014`,`0015` · `packages/core/CONTRACT.md` · `CONTEXT.md` (Notifications) · `packages/zatca/**` (custom-module-plus-UI reference) / `packages/payments/moyasar/**` (quality bar)
**Path:** `packages/notifications/engine` → npm `medusa-plugin-notifications`.

> A Medusa v2 **custom-module plugin**: DB-stored Handlebars templates + auto-loaded order triggers + admin REST API + a native admin editor. **Provider-agnostic** — it renders and creates notifications on the `sms` channel; a registered transport provider (Unifonic/Taqnyat) delivers. **Verify Medusa's plugin/module/subscriber/admin-API/admin-UI APIs, event names, and `CreateNotificationDTO` — never assume.**

---

## 1. Locked design decisions (do not re-litigate)
1. **Provider-agnostic engine (ADR-0015).** Creates `sms` notifications; **never imports a transport provider**. Transports stay thin (ADR-0014).
2. **DB-stored Handlebars templates.** `NotificationTemplate(channel, event, locale, body, enabled, from?)`; **self-seeded Arabic defaults** on install, idempotent + non-destructive (ADR-0013).
3. **Triggers in the plugin.** Auto-loaded subscribers for `order.placed`, the order-shipped event (+ seeded delivered/canceled). Recipient = address phone ?? customer phone ?? **skip + log** (never throw). Idempotency key = `event + order id`.
4. **Edit surface = self-seed + REST API + native admin editor.** The admin editor (Settings → Notifications) is the suite's **2nd sanctioned UI** (after ZATCA). REST-backed so headless consumers need no UI.
5. **SMS-safe engine.** `noEscape` + sanitize every value (strip control/bidi-override chars), whitelisted helpers, length/segment awareness, never compile templates from arbitrary request input.

## 2. Config
Near-empty: register the module/plugin (one config block) + env. The plugin self-migrates + self-seeds. To actually deliver, a `sms` transport provider must be registered (Unifonic) — otherwise notifications are created but undelivered.

## 3. Verify against Medusa docs (never assume)
One plugin shipping module+migrations+service **and** subscribers **and** admin API routes **and** an admin UI extension (auto-loaded); exact event names; `Modules.NOTIFICATION` + Query resolution from `container`; `CreateNotificationDTO` (`template` required?, `content`/`to`/`channel`/`idempotency_key`); the self-seed hook (migration/loader). Findings → `ENGINE-API-NOTES.md` (STOP if they contradict this PRD).

## 4. Slices (each: test-first, gates green before advancing) — see `docs/prompts/notification-engine-codex.md`
- **S0** Ground the platform APIs → `ENGINE-API-NOTES.md`.
- **S1** Scaffold + `NotificationTemplate` model + migration + idempotent self-seed (Arabic defaults).
- **S2** Handlebars render engine (helpers, `noEscape` + sanitize) + pure order→context.
- **S3** Template service: CRUD + `resolve(channel,event,locale)` (locale fallback, enabled/missing → skip).
- **S4** Order subscribers (provider-agnostic): resolve → render → `createNotifications` on `sms`; recipient + idempotency; no transport import.
- **S5** Admin REST API: CRUD + `/preview` (render, no send) + `/send-test` (key-gated live).
- **S6** Native admin editor (Settings → Notifications): list/edit/toggle/preview/send-test.
- **S7** Docs + demo-store install (with Unifonic transport) + key-gated live e2e + changeset + status.

## 5. Guard gates (every slice)
```
pnpm --filter medusa-plugin-notifications build
pnpm --filter medusa-plugin-notifications test
pnpm --filter medusa-plugin-notifications typecheck
pnpm lint                                            # eslint + dependency-cruiser (0) + syncpack
```
**Engine-specific guards:** no transport-provider import (dep-cruiser/grep); engine `noEscape` + sanitize (test); self-seed idempotent + non-destructive (test); subscribers skip+log on no phone (test); idempotency key passed; default bodies only in `seed/defaults.ts`; zero magic strings; admin UI native-only (no storefront); `@medusajs/*` peer-only + only `@medusa-ksa/core` intra-repo import; honest status, clean commits (no AI attribution).

## 6. Definition of Done (v1)
Installing the plugin self-seeds Arabic SMS templates; placing/fulfilling an order in **native admin** renders the right template and creates an `sms` notification (delivered by the registered transport) without double-sending and skipping cleanly when no phone; merchants edit templates via the admin editor / REST API with a live preview + send-test; all four gates green; a key-gated live e2e proves a real order→SMS (or is documented pending creds). Reuses `@medusa-ksa/core`; respects ADR-0013/0014/0015.

## 7. Out of scope (v1)
Email / WhatsApp channels (the model is channel-keyed for later) · DLR/delivery states · scheduled/bulk campaigns · per-customer template variants · any storefront code · cryptocurrency. Deferred items README'd as future work.
