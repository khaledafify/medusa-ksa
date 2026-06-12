# Codex Loop Harness — `medusa-plugin-notifications` (order-notification engine)

> For a low-trust executor (Codex). Maximally explicit. **No design decisions, no invention, no faking.** Builds a provider-agnostic order-notification engine: DB-stored Handlebars templates + auto-loaded order triggers + admin REST API + a native admin editor. Run as an autonomous loop until FINAL ACCEPTANCE is all-green. Three gates + a second read per task. A human reviews each slice.

---

## GOAL (paste into Codex's goal/objective)

> Build `medusa-plugin-notifications`, a Medusa v2 **custom-module plugin** (folder `packages/notifications/engine`) in the medusa-ksa monorepo at `/Users/khaledafify/RiderProjects/Medusa`, exactly as specified in `docs/adr/0015`, `docs/adr/0013`, `docs/adr/0014`, `docs/prds/notification-engine.md`, and this runner. It is the **provider-agnostic order-notification engine**: a `NotificationTemplate` model (+ migrations) keyed by `(channel, event, locale)` with a Handlebars `body`/`enabled`/`from`; **self-seeded Arabic SMS defaults** on install (idempotent, never overwriting edits — ADR-0013); a **Handlebars render service** (compile-cache, curated helpers `formatSar`/`formatDate`/Arabic pluralization, **plain-text/SMS-safe**: `noEscape` + sanitize every value, strip control/RTL-override chars, length-aware, no prototype/partial-from-input); **auto-loaded order subscribers** (`order.placed`, the order-shipped event, + seeded delivered/canceled follow-ons) that resolve a template → render with the order context → call `notificationModuleService.createNotifications` on the **`sms` channel** with an idempotency key (`event + order id`) and both the resolved `template` id and the rendered `content.text`; **admin REST API routes** (CRUD + render-preview + send-test); and a **native admin editor** (Settings → Notifications) — the suite's sanctioned **2nd UI** (after ZATCA). It is **provider-agnostic**: it creates `sms` notifications and **never imports a transport provider** — whatever provider is registered for `sms` (Unifonic/Taqnyat) delivers; the transport stays thin (ADR-0014). No phone on the order → the subscriber **skips + logs**, never throws. Reuse `@medusa-ksa/core` for HTTP/errors/config; `@medusajs/*` peer-only; the only intra-repo import is `@medusa-ksa/core`. Verify Medusa's plugin module/model/migration + subscriber + admin-API + admin-UI-extension APIs, the exact event names, and `CreateNotificationDTO` against Medusa docs first — never assume. Produce **clean, fully-typed, well-architected code with zero magic strings** AND tests covering the **entire case matrix** (~100% on engine/render/resolve/subscribers/API; UI smoke-tested) — all **mocked, no Unifonic account needed**; the live send-test is key-gated and **skips**. Run as an autonomous loop, one task at a time; pass three gates each; commit clean (no AI attribution); STOP and report only on a real blocker. A human reviews every slice.

---

## OPERATING RULES
1. **Executor, not designer.** Decisions are in ADR-0013/0014/0015 + the PRD. Do not add channels, events, helpers, models, or UI beyond what's listed.
2. **Verify before coding.** Confirm against Medusa docs (`building-with-medusa` / MedusaDocs / installed `@medusajs/*`): how a **plugin** ships a **module** (model + migrations + service) **and** subscribers **and** admin **API routes** **and** an **admin UI extension** all in one package and is auto-loaded; the **exact event names** (`order.placed`; the shipped/fulfillment event); resolving `Modules.NOTIFICATION` + the Query graph from `container`; the **`CreateNotificationDTO`** shape (`template` required?, `content`, `to`, `channel`, `idempotency_key`); the **self-seed** hook (migration/loader) pattern. If docs contradict the runner → **STOP and report.**
3. **STOP and report** if a gate stays red after 2 attempts, docs contradict the runner, or a task needs a decision. Never work around.
4. **No fabrication** — no fake events/fields/tests; never weaken/delete a test to pass; no stubbed "sent"/"seeded" path; status never faked.
5. **Drop-in (ADR-0013).** Everything inside the package; **self-migrate + self-seed**. Host footprint = npm dep + one config block + env. Never edit the consumer app beyond that.
6. **Provider-agnostic (ADR-0015).** The engine creates notifications on the `sms` channel and **must not import** `medusa-notification-unifonic` or any transport. **Do not modify** the transport providers.
7. Commits clean, imperative, **no `Co-Authored-By` / no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret.

## READ FIRST (don't code until done)
- `docs/adr/0015` (this plugin) · `docs/adr/0013` (drop-in self-seed) · `docs/adr/0014` (transport stays thin)
- `docs/prds/notification-engine.md` · `CONTEXT.md` (Notifications glossary) · `CLAUDE.md` (§6 — this is the 2nd sanctioned UI)
- `packages/core/CONTRACT.md` + `packages/core/src/*.ts`
- `packages/zatca/**` if present (the reference for a custom-module-plus-admin-UI package); else `packages/payments/moyasar/**` for the build/test/quality bar
- `packages/notifications/unifonic/**` (the transport that will deliver — **read, do not import or modify**)

## PREREQUISITE
**None for build/test** — every path is mocked (notification service, Query, DB repo). To actually deliver an SMS end-to-end you need a registered `sms` transport provider (`medusa-notification-unifonic`) + its creds in `apps/demo-store/.env`; the **send-test / live path is key-gated and skips** without them. No Unifonic account or CR needed to build, test, or merge.

## CLEAN ARCHITECTURE — file layout & separation of concerns
```
packages/notifications/engine/                 → medusa-plugin-notifications
└── src/
    ├── modules/notifications/
    │   ├── models/notification-template.ts     # (channel, event, locale) unique; body, enabled, from?
    │   ├── migrations/                          # generated migration(s)
    │   ├── service.ts                           # NotificationTemplateService: CRUD + resolve(channel,event,locale)
    │   ├── seed/defaults.ts                     # Arabic default rows (the ONLY place default bodies live)
    │   ├── seed/seed.ts                          # idempotent self-seed (skip existing, never overwrite edits)
    │   ├── render/engine.ts                      # Handlebars compile-cache + helpers + SMS-safe sanitize
    │   ├── render/context.ts                     # build render context from an order (pure mapping)
    │   ├── constants.ts                          # CHANNEL, EVENTS, LOCALES, TEMPLATE keys, helper names, limits
    │   ├── types.ts
    │   └── index.ts                              # module definition export
    ├── subscribers/
    │   ├── order-placed.ts                       # config.event = EVENTS.ORDER_PLACED
    │   ├── order-shipped.ts
    │   ├── order-delivered.ts                    # seeded; enabled per row
    │   └── order-canceled.ts
    ├── api/admin/notification-templates/         # REST: list/get/create/update/delete + /preview + /send-test
    │   └── ...route.ts + validators
    ├── admin/                                    # native admin UI extension (Settings → Notifications)
    │   └── routes/ (list, edit, preview, send-test)
    └── **/*.test.ts
```
Separation: **model+service** (storage + `resolve`) · **seed** (defaults, idempotent) · **render/engine** (Handlebars + safety) · **render/context** (pure order→context) · **subscribers** (orchestrate: resolve→context→render→createNotifications, or skip+log) · **api** (validated CRUD/preview/send-test) · **admin** (UI over the API). The `createNotifications` call lives only in a subscriber helper; the only place default bodies exist is `seed/defaults.ts`; HTTP (send-test) goes via core `HttpClient`/the notification module, never ad-hoc.

## CLEAN-CODE / QUALITY BAR (every task)
- Small single-responsibility functions; **pure** render-context + helpers; injectable I/O (inject the repo/clock/notification-service in tests) so every case is deterministic offline. No hidden global state.
- **Fully typed** — no `any`/`as any`/`@ts-ignore` in non-test code; typed model + DTOs; JSDoc on every exported symbol; names from `CONTEXT.md`.
- **Zero magic strings** — channel, event names, locales, template keys, helper names, and limits are named exports in `constants.ts`; default bodies only in `seed/defaults.ts`. No inline `"sms"`/`"order.placed"` elsewhere (grep gate).
- **Engine safety** is code, not a comment: `noEscape` + a `sanitize()` that strips control + Unicode bidi-override chars and caps length; helpers are a fixed whitelist; never compile a template from request input outside the validated body field. No dead code, no commented-out code, no TODO in shipped paths.

## NO MAGIC STRINGS — `constants.ts`
`CHANNEL = "sms"`; `EVENTS.ORDER_PLACED|ORDER_SHIPPED|ORDER_DELIVERED|ORDER_CANCELED` (verified Medusa names); `LOCALES.AR` (+ `DEFAULT_LOCALE`); `TEMPLATE_KEY(channel,event,locale)`; `HELPERS.FORMAT_SAR|FORMAT_DATE|PLURALIZE_AR`; `LIMITS.SMS_MAX_LEN` / segment thresholds; `IDEMPOTENCY_PREFIX` + `buildIdempotencyKey(event, orderId)`; API route base `/admin/notification-templates`; error messages. Error codes reuse core `KsaErrorCodes`.

## TEST-CASE MATRIX (each row = at least one required test; this IS the coverage gate — all mocked)
**Render engine**
| # | Case | Expected |
|---|---|---|
| 1 | variables | `{{order.display_id}}` / total / customer name interpolate correctly |
| 2 | conditional / tracking | shipped body with vs without tracking both render (no `undefined`) |
| 3 | helpers | `formatSar` (halalas→SAR string), `formatDate`, Arabic pluralization output correctly |
| 4 | Arabic Unicode | preserved byte-for-byte; no HTML-escaping of `&`/`<` (plain text) |
| 5 | **injection/safety** | a body with control / bidi-override chars or a prototype-access attempt is sanitized/neutralized |
| 6 | missing variable | renders safely (empty/placeholder), never throws |
| 7 | length awareness | over-length body surfaces a segment-count warning (not a hard fail) |

**Template resolution + seed**
| 8 | resolve `(sms, order.placed, ar)` | returns the seeded row |
| 9 | locale fallback | unknown locale falls back to `DEFAULT_LOCALE` |
| 10 | disabled row | `enabled=false` → resolve signals skip |
| 11 | missing row | resolve returns null → caller skips |
| 12 | self-seed idempotent | seeding twice doesn't duplicate; an **edited** row is **not** overwritten |

**Subscribers (provider-agnostic)**
| 13 | `order.placed` fires | one `createNotifications` call, `channel:"sms"`, `to`=order phone, `content.text`=rendered Arabic, `template`=id |
| 14 | shipped event | one `sms` notification with tracking when present |
| 15 | recipient resolution | shipping-address phone → else customer phone → else **skip + log, no call, no throw** |
| 16 | idempotency | `idempotency_key = buildIdempotencyKey(event, orderId)` passed |
| 17 | no transport import | grep/dep-cruiser: engine never imports a `medusa-notification-*` provider |

**Admin API**
| 18 | CRUD | create/list/get/update/delete validated; bad payload → 400, never 500 |
| 19 | preview | `/preview` renders a template against sample order data and returns the text (no send) |
| 20 | send-test | `/send-test` creates a real `sms` notification (mocked service in tests); **key-gated live** variant skips without creds |

**Cross-cutting**
| 21 | no magic strings | channel/event/locale/template/helpers from `constants.ts` (grep) |
| 22 | drop-in | self-migrate + self-seed; boots in `apps/demo-store` with one config block + env |

## EXECUTION LOOP HARNESS (run until finish — do NOT wait for human input between tasks)
Repeat for each task S0 → S7 in order:
1. Implement (tests first, to the Clean-code bar + the matrix rows it covers).
2. Run **Gate A + Gate B + Gate C**.
3. All green → commit clean → **immediately start the next task**. Red → fix; after **2 failed attempts** on the same gate → **STOP and report** the exact failure + what you tried.
4. After each slice, post a one-line status (what, gates, coverage %, matrix rows covered) **and keep going**; push to `main` (SSH) when a slice completes.
Exit only when **FINAL ACCEPTANCE is all true** or a hard **STOP** fires. **Never fake a pass.**

## PER-TASK PROCEDURE (the three gates)
**GATE A — automated (all exit 0):**
```
pnpm --filter medusa-plugin-notifications build
pnpm --filter medusa-plugin-notifications test
pnpm --filter medusa-plugin-notifications typecheck
pnpm lint
```
**GATE B — self-audit (YES to all or STOP):** no magic strings (grep the diff); default bodies only in `seed/defaults.ts`; no `any`/ts-ignore in non-test; engine uses `noEscape` **and** sanitizes (test); **no transport-provider import** (dep-cruiser/grep); `createNotifications` only in the subscriber helper; subscriber **skips+logs** on no phone (test); idempotency key passed; correct event names + `CreateNotificationDTO` (name them); self-seed idempotent + non-destructive (test); the task's **matrix rows each have a test**; dependency-cruiser 0 violations; `@medusajs/*` peer-only + only `@medusa-ksa/core` intra-repo import.
**GATE C — second read:** re-read the diff as a reviewer; confirm the task's Accept + its matrix rows literally hold; re-run Gate A. Commit only when A+B+C are green.

---

# TASKS (in order; each = Procedure A+B+C)

### S0 — Ground the platform APIs ✋ first
- [ ] Verify (docs + installed `@medusajs/*`) that **one plugin** can ship a module (model+migration+service) + subscribers + admin API routes + an admin UI extension, all auto-loaded; the exact event names; resolving `Modules.NOTIFICATION` + Query from `container`; `CreateNotificationDTO` shape; the self-seed hook. Write `packages/notifications/engine/ENGINE-API-NOTES.md`. If anything contradicts the runner → **STOP and report.**

### S1 — Scaffold + model + migration + self-seed
- [ ] Scaffold the package (`medusa-plugin-notifications`, `medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`, dual tsconfig + vitest, `.env.example`). `NotificationTemplate` model + migration; `seed/defaults.ts` (Arabic rows for the 4 events) + idempotent `seed/seed.ts`. *Accept:* **matrix #8, #12, #22** — installs/migrates; seeding is idempotent + non-destructive; boots in demo-store.

### S2 — Render engine + context
- [ ] `render/engine.ts` (Handlebars compile-cache, whitelisted helpers, `noEscape` + `sanitize`) + `render/context.ts` (pure order→context). *Accept:* **matrix #1–#7** — variables/conditionals/helpers/Arabic/injection-safety/missing-var/length all covered.

### S3 — Template service + resolution
- [ ] `service.ts`: CRUD + `resolve(channel,event,locale)` with locale fallback + enabled/missing handling. *Accept:* **matrix #8–#11** — resolve hits the seeded row, falls back on locale, signals skip when disabled/missing.

### S4 — Order subscribers (provider-agnostic)
- [ ] `subscribers/order-*.ts` (`config.event = EVENTS.*`): resolve template → if skip, log+return → build context → render → `createNotifications` on `sms` with `template` id + `content.text` + idempotency key; recipient = address phone ?? customer phone ?? skip+log. *Accept:* **matrix #13–#17** — one `sms` notification per event, recipient/idempotency correct, no phone → skip+log+no-throw, **no transport import**.

### S5 — Admin REST API
- [ ] `api/admin/notification-templates/**`: validated CRUD + `/preview` (render sample) + `/send-test` (create `sms` notification; live variant key-gated). *Accept:* **matrix #18–#20** — CRUD validates (400 not 500), preview renders without sending, send-test routes through the notification module (mocked); live send-test skips without creds.

### S6 — Native admin editor (the 2nd sanctioned UI)
- [ ] Admin UI extension (Settings → Notifications) over the API: list templates, edit body, toggle `enabled`, live render-preview with sample order data, send-test. *Accept:* renders + drives the API (smoke test / component test); no storefront code; documented as the sanctioned 2nd UI.

### S7 — Docs + demo-store install + ship
- [ ] `packages/notifications/engine/README.md` (config, the events, the template/locale model, the admin editor, that it's provider-agnostic + needs an `sms` transport to actually deliver, self-seed note, deferred channels). Install the plugin in `apps/demo-store` (one config block) alongside the Unifonic transport; a **key-gated live e2e** (place order → real SMS) that **skips** without creds. Update root README matrix; `pnpm changeset`. *Accept:* demo-store boots with the plugin; live e2e skips without creds; status `🚧 Beta` until a real order→SMS is verified, then `✅ Stable`.

---

## FINAL ACCEPTANCE (human review — all true)
- [ ] All four Gate-A commands green; `constants.ts` exists; default bodies only in `seed/defaults.ts`; grep finds no inline channel/event/locale/template literals elsewhere; dependency-cruiser 0 violations.
- [ ] **Every row of the TEST-CASE MATRIX (1–22) has a passing test**; ~100% coverage on engine/render/resolve/subscribers/API; admin UI smoke-tested (report the numbers).
- [ ] Engine is SMS-safe (`noEscape` + sanitize, tested); self-seed idempotent + non-destructive (tested); subscribers skip+log on missing phone (tested); idempotency key passed.
- [ ] **Provider-agnostic** — engine never imports a transport provider (dep-cruiser/grep); transport providers unchanged; works on the `sms` channel with whatever provider is registered.
- [ ] Custom-module plugin: self-migrate + self-seed (ADR-0013); `@medusajs/*` peer-only; only `@medusa-ksa/core` intra-repo import; drop-in (one config block + env).
- [ ] Admin UI is native admin only (Settings → Notifications), REST-backed, **no storefront**; recorded as the suite's 2nd sanctioned UI (CLAUDE.md §6).
- [ ] README + status honest; key-gated live e2e skips without creds; changeset present; commits clean (no AI attribution); no AI-tooling/secret committed.
