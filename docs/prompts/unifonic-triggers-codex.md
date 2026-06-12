# Codex Loop Harness — Order-lifecycle SMS triggers in `apps/demo-store`

> For a low-trust executor (Codex). Maximally explicit. **No design decisions, no invention, no faking.** Wires the host-app trigger layer so order events fire Arabic SMS through the registered `medusa-notification-unifonic` provider. Native admin only — **no custom UI**. Run as an autonomous loop until FINAL ACCEPTANCE is all-green. Three gates + a second read per task. A human reviews each slice.

---

## GOAL (paste into Codex's goal/objective)

> In the medusa-ksa monorepo at `/Users/khaledafify/RiderProjects/Medusa`, wire the **order-lifecycle SMS trigger layer** in **`apps/demo-store`** so that placing or fulfilling an order through Medusa's **native admin** (or storefront) automatically sends an **Arabic SMS** via the already-registered `medusa-notification-unifonic` provider on the **`sms` channel** — exactly as specified in `docs/adr/0015` + `docs/adr/0014` + `docs/prompts/unifonic-triggers-codex.md`. Implement Medusa **subscribers** (`order.placed` → confirmation, the order-shipped event → shipped+tracking) that resolve the recipient phone from the order, render the Arabic body from **pure template functions**, and call `notificationModuleService.createNotifications` on the `sms` channel with an **idempotency key** (`event + order id`) and both the required `template` id and the rendered `content.text`. **No custom admin UI, no provider changes, no published-package edits** — this is host-app wiring only (ADR-0015). If no phone is on the order, the subscriber **skips and logs**, never throws. Verify the exact Medusa event names + `CreateNotificationDTO` shape against Medusa docs first — never assume. Produce **clean, fully-typed code with zero magic strings** AND tests covering the **entire case matrix** (pure templates + subscriber handlers, all mocked — no Unifonic account needed); a key-gated live run sends a real SMS only with creds and **skips otherwise**. Run as an autonomous loop, one task at a time; pass three gates each; commit clean (no AI attribution); STOP and report only on a real blocker. A human reviews every slice.

---

## OPERATING RULES
1. **Executor, not designer.** Decisions are in ADR-0014 + ADR-0015. Do not add events, channels, templates, or a UI beyond what's listed.
2. **Verify before coding.** Confirm against Medusa docs (`building-with-medusa` / MedusaDocs / installed `@medusajs/*`): the **exact event names** (`order.placed`; the order-shipped/fulfillment-shipped event), the **subscriber signature** + `export const config = { event }`, how to resolve `Modules.NOTIFICATION` + the Query graph from `container`, and the **`CreateNotificationDTO`** shape (is `template` required, the `content`/`to`/`channel`/`idempotency_key` fields). If docs contradict this runner → **STOP and report.**
3. **STOP and report** if a gate stays red after 2 attempts, docs contradict the runner, or a task needs a decision. Never work around.
4. **No fabrication** — no fake events/fields/tests; never weaken/delete a test to pass; no stubbed "sent" path.
5. **Host-app only (ADR-0015).** All code under `apps/demo-store/src`. **Do not** edit `packages/notifications/unifonic`, add an admin widget, or touch the consumer-facing published packages.
6. Commits clean, imperative, **no `Co-Authored-By` / no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret.

## READ FIRST (don't code until done)
- `docs/adr/0014` (Unifonic thin transport) · `docs/adr/0015` (triggers live in host app)
- `docs/prds/unifonic.md` · `CONTEXT.md` (Notifications glossary) · `CLAUDE.md` (§6 no-UI, backend-only)
- `packages/notifications/unifonic/**` (the provider this fires — read its `send()` contract; **do not modify it**)
- The existing `apps/demo-store` layout (config, how the `sms` channel + Unifonic provider are registered, existing subscribers if any)

## PREREQUISITE
The `medusa-notification-unifonic` provider exists and is registered on the `sms` channel in `apps/demo-store` (`docs/prompts/unifonic-codex.md`). If it is **not** yet registered, register it (one `providers:[]` block on the `sms` channel + env) — that is the only config change allowed. **No Unifonic account / CR needed**: every test mocks the notification service; the live SMS run is key-gated and skips.

## CLEAN ARCHITECTURE — file layout & separation of concerns
```
apps/demo-store/src/
├── lib/sms/
│   ├── constants.ts     # CHANNEL="sms", EVENTS (verified names), TEMPLATE_IDS, idempotency-key prefix
│   ├── templates.ts     # PURE Arabic renderers: orderPlaced(order) / orderShipped(order, tracking) → string
│   ├── recipient.ts     # PURE: phone from order (shipping_address.phone ?? customer.phone) | null
│   ├── send-sms.ts      # thin wrapper over notificationModuleService.createNotifications (channel sms + idempotency)
│   └── *.test.ts
└── subscribers/
    ├── sms-order-placed.ts    # config.event = order.placed
    ├── sms-order-shipped.ts   # config.event = <verified shipped event>
    └── *.test.ts
```
Separation: **templates** (pure text) · **recipient** (pure selection) · **send-sms** (the one place that calls `createNotifications`) · **subscribers** (resolve container, fetch the order via Query, orchestrate: recipient → render → send, or skip+log). No data-fetching in templates; no rendering in subscribers; the `createNotifications` call lives only in `send-sms.ts`.

## CLEAN-CODE / QUALITY BAR (every task)
- Small single-responsibility functions; **pure** templates + recipient (no I/O) so every case is deterministic offline. Subscribers take `{ event, container }`; inject nothing global.
- **Fully typed** — no `any`/`as any`/`@ts-ignore`; type the order shape you read; JSDoc on exported helpers; names from `CONTEXT.md`.
- **Zero magic strings** — channel, event names, template ids, and the idempotency-key prefix are named exports in `constants.ts`. No inline `"sms"` / `"order.placed"` anywhere else.
- No dead code, no commented-out code, no TODO in shipped paths. Subscribers **never throw** on a missing phone — they skip + log.

## NO MAGIC STRINGS — `constants.ts`
`CHANNEL = "sms"`; `EVENTS.ORDER_PLACED` + `EVENTS.ORDER_SHIPPED` (the verified Medusa event names); `TEMPLATE_IDS.ORDER_PLACED` + `TEMPLATE_IDS.ORDER_SHIPPED`; `IDEMPOTENCY_PREFIX` + a `buildIdempotencyKey(event, orderId)` helper. Arabic template strings live in `templates.ts` as the only place they appear.

## TEST-CASE MATRIX (each row = at least one required test; this IS the coverage gate — all mocked)
| # | Case | Expected |
|---|---|---|
| 1 | `order.placed` fires | `createNotifications` called **once**, `channel:"sms"`, `to` = order phone, `content.text` = Arabic confirmation |
| 2 | confirmation body | contains the order **display id** + formatted **SAR total**; Arabic; Unicode preserved byte-for-byte |
| 3 | order-shipped event fires | one `sms` notification with the Arabic shipped text + **tracking number** when present |
| 4 | shipped without tracking | renders a valid Arabic shipped message (no `undefined`/empty interpolation) |
| 5 | recipient: shipping-address phone present | used as `to` |
| 6 | recipient: no address phone, customer phone present | customer phone used as `to` |
| 7 | recipient: no phone anywhere | subscriber **skips** — `createNotifications` **not called** — and logs; **does not throw** |
| 8 | idempotency | `createNotifications` receives `idempotency_key = buildIdempotencyKey(event, orderId)` |
| 9 | DTO shape | call includes the required `template` id **and** `content.text` (verified shape) |
| 10 | money formatting | SAR total formatted from the order total (no raw halalas / float noise) |
| 11 | container wiring | handler resolves `Modules.NOTIFICATION` + Query from `container`; tolerates a minimal order payload |
| 12 | no magic strings | channel/event/template come from `constants.ts` (grep gate) |

## EXECUTION LOOP HARNESS (run until finish — do NOT wait for human input between tasks)
Repeat for each task T0 → T4 in order:
1. Implement (tests first, to the Clean-code bar + the matrix rows it covers).
2. Run **Gate A + Gate B + Gate C**.
3. All green → commit clean → **immediately start the next task**. Red → fix; after **2 failed attempts** on the same gate → **STOP and report** the exact failure + what you tried.
4. After each task, post a one-line status (what, gates, coverage %, matrix rows covered) **and keep going**; push to `main` (SSH) when a slice completes.
Exit only when **FINAL ACCEPTANCE is all true** or a hard **STOP** fires. **Never fake a pass.**

## PER-TASK PROCEDURE (the three gates)
**GATE A — automated (all exit 0):**
```
pnpm --filter demo-store build        # or the app's build/typecheck script
pnpm --filter demo-store test
pnpm --filter demo-store typecheck
pnpm lint
```
**GATE B — self-audit (YES to all or STOP):** no magic strings (grep the diff); no `any`/ts-ignore; the `createNotifications` call exists **only** in `send-sms.ts`; templates + recipient are **pure** (no container/I/O); subscriber **skips+logs** on no phone (test); idempotency key passed; correct event names + DTO shape (name them); the task's **matrix rows each have a test**; **no provider/package edits**; **no admin UI added**.
**GATE C — second read:** re-read the diff as a reviewer; confirm the task's Accept + its matrix rows literally hold; re-run Gate A. Commit only when A+B+C are green.

---

# TASKS (in order; each = Procedure A+B+C)

### T0 — Ground the contract ✋ first
- [ ] Verify against Medusa docs + installed `@medusajs/*`: exact event names (`order.placed`; the shipped event), subscriber signature + `config.event`, resolving `Modules.NOTIFICATION` + Query from `container`, and the `CreateNotificationDTO` shape (`template` required?, `content`, `to`, `channel`, `idempotency_key`). Confirm the Unifonic provider + `sms` channel are registered in `apps/demo-store`. Write findings into a short note at the top of `apps/demo-store/src/lib/sms/constants.ts` (or a sibling `SMS-TRIGGERS-NOTES.md`). If anything contradicts this runner → **STOP and report.**

### T1 — Constants + pure templates + recipient
- [ ] `constants.ts` (full contract above) + `templates.ts` (Arabic `orderPlaced` / `orderShipped`) + `recipient.ts` (pure phone selection | null). *Accept:* **matrix #2, #4, #5, #6, #7(pure part), #10, #12** — templates render correct Arabic with interpolation + SAR formatting + Unicode preserved; recipient picks address-phone → customer-phone → null; all literals from `constants.ts`.

### T2 — `send-sms.ts` wrapper
- [ ] The single `createNotifications` caller: takes `{ notificationService, to, templateId, text, event, orderId }`, posts `channel: CHANNEL`, `to`, `template: templateId`, `content: { text }`, `idempotency_key: buildIdempotencyKey(event, orderId)`. *Accept:* **matrix #1(shape), #8, #9** — exactly one call with the right channel, DTO fields, and idempotency key (mocked service).

### T3 — Subscribers
- [ ] `sms-order-placed.ts` + `sms-order-shipped.ts`: resolve `Modules.NOTIFICATION` + Query from `container`, fetch the order (id, display id, total, shipping address phone, customer phone, tracking for shipped), resolve recipient → if null **skip + log** → else render → `send-sms`. `export const config = { event: EVENTS.* }`. *Accept:* **matrix #1, #3, #7, #11** — each subscriber sends exactly one `sms` notification on its event; no phone → no call + log, no throw; tolerates a minimal order payload (mocked container + query in tests).

### T4 — Live test + docs
- [ ] A **key-gated live test**: with `UNIFONIC_APP_SID`/`UNIFONIC_SENDER_ID` + a test recipient in `apps/demo-store/.env`, simulate `order.placed` and assert a real SMS is accepted; **skips otherwise**. Document the trigger layer in `apps/demo-store/README.md` (or a `docs/` note): the wired events, that it's native-admin-only (placing/fulfilling an order fires the SMS — no UI), Arabic templates location, how to add delivered/canceled later, and that build/test need **no Unifonic account**. *Accept:* live test skips without creds (CI green); docs honest.

---

## FINAL ACCEPTANCE (human review — all true)
- [ ] All Gate-A commands green; `constants.ts` holds channel/events/template ids; grep finds no inline `"sms"`/event/template literals elsewhere.
- [ ] **Every row of the TEST-CASE MATRIX (1–12) has a passing test**; templates + recipient are pure; subscriber handlers unit-tested with a mocked container (report coverage).
- [ ] `order.placed` and the shipped event each send exactly one `sms` notification with the Arabic body, recipient, `template` + `content.text`, and idempotency key; **no phone → skip + log, never throw**.
- [ ] **No custom admin UI; no provider/package edits** — host-app wiring only (ADR-0015). The Unifonic provider is unchanged.
- [ ] Fully typed (no `any`/ts-ignore); JSDoc on exported helpers; no dead code; clean architecture (templates/recipient/send-sms/subscribers separated).
- [ ] Key-gated live test skips without creds; demo-store docs honest; commits clean (no AI attribution); no AI-tooling/secret committed.
