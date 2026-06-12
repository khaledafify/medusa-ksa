# Codex Loop Harness — `medusa-notification-unifonic` (Arabic SMS)

> For a low-trust executor (Codex). Maximally explicit. **No design decisions, no invention, no faking.** Run as an autonomous loop until FINAL ACCEPTANCE is all-green. Three gates + a second read per task. A human reviews each slice.

---

## GOAL (paste into Codex's goal/objective)

> Implement `medusa-notification-unifonic`, a Medusa v2 **Notification provider** for the **`sms` channel**, sending Arabic SMS via Unifonic, in the medusa-ksa monorepo at `/Users/khaledafify/RiderProjects/Medusa`, exactly as specified in `docs/prds/unifonic.md` and `docs/prompts/unifonic-codex.md`. It is a **thin transport**: `send()` posts the already-rendered `notification.content.text` to Unifonic, awaits the accept, returns the provider message id (or maps a failure to `KsaError`); a `template` without text → a clear error. **No WhatsApp, no template engine, no DLR webhook** (deferred). Config: `UNIFONIC_APP_SID` + `UNIFONIC_SENDER_ID` (both required, env-first); sender overridable via `notification.from`; missing sender → `KsaError`. The send POST is **never retried** (no double-SMS); recipients normalized to international format; Arabic as Unicode; `UNIFONIC_APP_SID` never logged or returned. Reuse `@medusa-ksa/core` for all HTTP/config/errors; never reimplement. Follow `packages/payments/moyasar` as the quality bar. Produce **clean, fully-typed, well-architected code with zero magic strings** AND tests covering the **entire case matrix** (~100% coverage) — all mocked, **no live account/CR needed**. Verify Unifonic's endpoint/auth/response against docs.unifonic.com first. Run as an autonomous loop, one task at a time; pass three gates each; commit clean (no AI attribution); STOP and report only on a real blocker. A human reviews every slice.

---

## OPERATING RULES
1. **Executor, not designer.** Decisions are in the PRD + ADRs (0001,0002,0003,0013,0014). Do not choose alternatives, add scope, or "improve."
2. **Verify before coding a call.** Confirm Unifonic's endpoint/auth/response against **docs.unifonic.com** (classic `POST /rest/SMS/messages` with `AppSid`/`SenderID`/`Body`/`Recipient`, vs NextGen Basic-Auth/JSON; the success **message-id** field; recipient format; Unicode flag). Confirm Medusa's `AbstractNotificationProviderService` + `ProviderSendNotificationDTO`/`...ResultsDTO` via `building-with-medusa`/MedusaDocs + installed `@medusajs/*`.
3. **STOP and report** if: a gate stays red after 2 attempts, the docs contradict the PRD, or a task needs a decision. Never work around.
4. **No fabrication** — no fake fields/tests/status; no stubbed shipped paths; never weaken/delete a test to pass.
5. **Drop-in (ADR-0013).** Everything inside the package; host footprint = npm dep + one `providers:[]` block on the `sms` channel + env. Never edit the consumer app beyond that.
6. Commits clean, imperative, **no `Co-Authored-By` / no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret.

## READ FIRST (don't code until done)
- `docs/prds/unifonic.md` · `docs/adr/0001,0002,0003,0013,0014`
- `packages/core/CONTRACT.md` + `packages/core/src/*.ts`
- `CLAUDE.md` · `CONTEXT.md` (Notifications glossary)
- `packages/payments/moyasar/**` (quality bar — copy its structure, dual tsconfig, vitest, core usage, test rigor)

## PREREQUISITE
**None.** The whole package builds + tests **mocked** with no Unifonic account and no commercial registration. The optional S3 live test needs `UNIFONIC_APP_SID`+`UNIFONIC_SENDER_ID`+a test recipient in `apps/demo-store/.env` and **skips** without them — it never blocks the build/CI.

## CLEAN ARCHITECTURE — file layout & separation of concerns
```
packages/notifications/unifonic/
├── package.json · tsconfig.json · tsconfig.build.json · vitest.config.ts · .env.example · README.md
└── src/providers/unifonic/
    ├── constants.ts      # all literals (below). No string literal for these anywhere else.
    ├── types.ts          # UnifonicOptions, UnifonicSendRequest/Response, internal SendInput
    ├── options.ts        # zod schema + createLoader wiring (env-first, fail-fast)
    ├── recipient.ts      # pure: normalize a phone to international (+9665…) or throw
    ├── client.ts         # UnifonicClient over core HttpClient: sendSms(req) → {id}; send NOT retried
    ├── service.ts        # UnifonicNotificationProviderService extends AbstractNotificationProviderService
    ├── index.ts          # ModuleProvider export so resolve "…/providers/unifonic" works
    └── *.test.ts         # co-located, behaviour-first
```
Separation: **options** (config) · **recipient** (pure normalization) · **client** (transport over core HttpClient) · **service** (Medusa contract + mapping). Each is independently unit-testable. `service.send` orchestrates: validate → normalize recipient → resolve sender → client.sendSms → map result/error. No business logic in the client; no HTTP in the service.

## CLEAN-CODE / QUALITY BAR (every task)
- Small, single-responsibility functions; pure helpers; **injectable I/O** (inject `fetch` into the client so every case is deterministic, offline). No hidden global state.
- **Fully typed** — no `any`/`as any`/`@ts-ignore` in non-test code; typed public surface; JSDoc on every exported symbol; names from `CONTEXT.md`.
- **Zero magic strings** — the constants contract. Errors via `KsaError`/`toMedusaError`; **no secret in any message/log**. No dead code, no commented-out code, no TODO in shipped paths. Match moyasar exactly.

## NO MAGIC STRINGS — `constants.ts`
Every literal a named export (grep gate enforces): `PROVIDER_ID = "unifonic"`; `UNIFONIC_PREFIX`; `CHANNEL = "sms"`; `ENV` (`UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID`, `UNIFONIC_BASE_URL?`); `DEFAULT_BASE_URL`; `ENDPOINTS.SEND` (from docs); `REQUEST_FIELDS` (`AppSid`/`SenderID`/`Body`/`Recipient` or NextGen names); `RESPONSE_FIELDS` (the message-id path + success flag); `DEFAULTS.TIMEOUT_MS`; error messages. Error codes reuse core `KsaErrorCodes`.

## TEST-CASE MATRIX (each row = at least one required test; this IS the coverage gate — all mocked)
| # | Case | Expected |
|---|---|---|
| 1 | valid SMS, default sender | POST issued once; returns the provider **message id** |
| 2 | valid SMS, per-message `notification.from` | uses `from` as `SenderID` (overrides default) |
| 3 | **Arabic Unicode** body | body sent **byte-for-byte** (no mangling/escaping) |
| 4 | recipient `05xxxxxxxx` / `9665…` / `+9665…` | normalized to international (`+9665…`) before send |
| 5 | unparseable/empty recipient | clear `KsaError` (INVALID_INPUT); **no POST** |
| 6 | `template` set but **no `content.text`** | clear `KsaError`; **no POST** |
| 7 | no sender (no default, no `from`) | clear `KsaError`; **no POST** (guarded at boot too) |
| 8 | Unifonic 4xx (e.g. invalid AppSid) | mapped to `KsaError`; **AppSid NOT in the message** |
| 9 | Unifonic 5xx / network error | mapped to `KsaError`; surfaced (not swallowed) |
| 10 | Unifonic returns non-success body | `KsaError` (PROVIDER_ERROR), not a fake success |
| 11 | **retry behaviour** | the send POST is issued **exactly once** even on 5xx (never retried) |
| 12 | boot: missing `UNIFONIC_APP_SID` or `UNIFONIC_SENDER_ID` | `createLoader` throws `KsaError` naming the missing var |
| 13 | secret hygiene | assert `UNIFONIC_APP_SID` never appears in any thrown message |
| 14 | `static validateOptions` | throws on invalid options (mirrors loader) |

## EXECUTION LOOP HARNESS (run until finish — do NOT wait for human input between tasks)
Repeat for each task S0 → S3.2 in order:
1. Implement the task (tests first, to the Clean-code bar + the matrix rows it covers).
2. Run **Gate A + Gate B + Gate C**.
3. All green → commit clean → **immediately start the next task**. Red → fix; after **2 failed attempts** on the same gate → **STOP and report** the exact failure + what you tried.
4. After each **slice**, post a one-line status (what, gate results, coverage %, matrix rows covered) **and keep going**; push to `main` (SSH) when a slice completes.
Exit only when **FINAL ACCEPTANCE is all true** or a hard **STOP** fires. **Never fake a pass to keep the loop moving.**

## PER-TASK PROCEDURE (the three gates)
**GATE A — automated (all exit 0):**
```
pnpm --filter medusa-notification-unifonic build
pnpm --filter medusa-notification-unifonic test
pnpm --filter medusa-notification-unifonic typecheck
pnpm lint
```
**GATE B — self-audit (YES to all or STOP):** no magic strings (grep the diff); no `any`/ts-ignore in non-test; all HTTP via core `HttpClient`; no `process.env` outside `options.ts`; **AppSid never in logs/errors** (test); send POST **not retried**; correct Medusa provider/DTO types (name them); clean code + JSDoc; the task's **matrix rows each have a test**; dependency-cruiser 0 violations.
**GATE C — second read:** re-read the diff as a reviewer; confirm the task's Accept + its matrix rows literally hold; re-run Gate A. Commit only when A+B+C are green.

---

# TASKS (in order; each = Procedure A+B+C)

### S0 — Ground the API ✋ first
- [ ] **T0.1** Read docs.unifonic.com; write `packages/notifications/unifonic/UNIFONIC-API-NOTES.md` — the chosen endpoint generation + path, auth scheme, request field names, the **success message-id** field, recipient format, and the Unicode flag. If it contradicts the PRD → **STOP and report.**

### S1 — Scaffold, constants, options, recipient, client
- [ ] **T1.1** Scaffold `packages/notifications/unifonic` (package.json `medusa-notification-unifonic`, dual tsconfig, vitest, `.env.example`). *Accept:* install resolves core; typecheck; syncpack consistent.
- [ ] **T1.2** `constants.ts` (full contract) + `types.ts`. *Accept:* every later file imports literals from `constants.ts`; no target literal inline.
- [ ] **T1.3** `options.ts`: zod schema + `createLoader` (`UNIFONIC_APP_SID` + `UNIFONIC_SENDER_ID` required, `UNIFONIC_BASE_URL` optional, env-first). *Accept:* **matrix #12** — boot throws `KsaError` naming the missing var when either is absent; valid config passes.
- [ ] **T1.4** `recipient.ts` (pure normalizer to international format). *Accept:* **matrix #4, #5** — `05…`/`9665…`/`+9665…` → `+9665…`; empty/garbage → `KsaError`.
- [ ] **T1.5** `client.ts` (`UnifonicClient` over core `HttpClient`; `sendSms(req)`; **send POST not retried**; auth per notes). *Accept:* **matrix #8, #9, #11, #13** — auth correct, non-2xx → `KsaError`, AppSid never leaks, POST issued exactly once (no retry).

### S2 — Provider service / `send()`
- [ ] **T2.1** `service.ts` — `UnifonicNotificationProviderService extends AbstractNotificationProviderService`, `static identifier = PROVIDER_ID`, `static validateOptions`. *Accept:* **matrix #14**; registers + boots in `apps/demo-store` on the `sms` channel (drop-in: one `providers:[]` block + env, nothing else).
- [ ] **T2.2** `send(notification)` orchestration: validate → normalize recipient → resolve sender (`from ?? default`) → `client.sendSms` → return `{ id }`; failures via `toMedusaError`. *Accept:* **matrix #1, #2, #3, #6, #7, #10** — message id returned; `from` overrides sender; Arabic preserved; `template`-without-text → error; missing sender → error; non-success body → `KsaError`.
- [ ] **T2.3** `index.ts` ModuleProvider export so `resolve: "medusa-notification-unifonic/providers/unifonic"` works. *Accept:* the resolve path builds; the provider is selectable as an `sms` provider.

### S3 — Docs + live test + ship
- [ ] **T3.1** `README.md` (moyasar template): config, the **registered-Sender-ID / CR-required** note for live KSA SMS, the `sms`-channel registration block, deferred items (WhatsApp, templates, DLR). Update root README matrix. *Accept:* README honest; documents that build/test needs **no account/CR**, only live SMS does.
- [ ] **T3.2** A **key-gated live test** (sends a real SMS only with creds + a test recipient in env; **skips otherwise**). `pnpm changeset` (minor). *Accept:* live test **skips** without creds (CI green); status `🚧 Beta` until a live SMS is verified.

---

## FINAL ACCEPTANCE (human review — all true)
- [ ] All four Gate-A commands green; `constants.ts` exists; grep finds no inline magic strings; dependency-cruiser 0 violations.
- [ ] **Every row of the TEST-CASE MATRIX (1–14) has a passing test**; coverage ~100% on the provider's own source (report the numbers).
- [ ] Send POST **not retried**; `UNIFONIC_APP_SID` never logged/returned (tests).
- [ ] Clean architecture respected (options/recipient/client/service separation); no `any`/ts-ignore; JSDoc on exports; no dead code.
- [ ] Notification **provider** (no schema); registers on the `sms` channel; all I/O via core `HttpClient`; **no webhook route**, no WhatsApp, no template store, **no custom UI**; drop-in (one config block + env).
- [ ] README + status honest; key-gated live test skips without creds; changeset present; commits clean (no AI attribution); no AI-tooling/secret committed.
