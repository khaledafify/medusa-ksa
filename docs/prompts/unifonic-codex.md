# Codex Execution Plan — `medusa-notification-unifonic` (Arabic SMS)

> For a low-trust executor (Codex). Maximally explicit. **No design decisions, no invention, no faking.** Three gates per task; a human reviews each slice. The smallest package in the suite.

---

## GOAL (paste into Codex's goal/objective)

> Implement `medusa-notification-unifonic`, a Medusa v2 **Notification provider** for the **`sms` channel**, sending Arabic SMS via Unifonic, in the medusa-ksa monorepo at `/Users/khaledafify/RiderProjects/Medusa`, exactly as specified in `docs/prds/unifonic.md` and `docs/prompts/unifonic-codex.md`. It is a **thin transport**: `send()` posts the already-rendered `notification.content.text` to Unifonic, awaits the accept, and returns the provider message id (or maps a failure to `KsaError`); a `template` without text → a clear error. **No WhatsApp, no template engine, no DLR webhook** (deferred). Config is `UNIFONIC_APP_SID` + `UNIFONIC_SENDER_ID` (both required, env-first); the sender is overridable via `notification.from`; missing sender → `KsaError`. The send POST is **never retried** (no double-SMS); recipients are normalized to international format; Arabic goes out as Unicode; `UNIFONIC_APP_SID` is never logged or returned. Reuse `@medusa-ksa/core` (HttpClient/createLoader/KsaError/toMedusaError); never reimplement. Follow `packages/payments/moyasar` as the quality bar. Produce clean, fully-typed, quality code with **zero magic strings** AND comprehensive tests targeting ~100% coverage. Verify Unifonic's endpoint/auth/response against docs.unifonic.com first. Work one task at a time in an autonomous loop; pass two gates + a second read each; commit clean (no AI attribution); STOP and report only on a real blocker. A human reviews every slice.

---

## OPERATING RULES
1. **Executor, not designer.** Decisions are in the PRD + ADRs (0001,0002,0003,0013,0014). Do not choose alternatives or "improve."
2. **Verify Unifonic against docs.unifonic.com before coding the call** (classic `POST /rest/SMS/messages` vs NextGen; auth; the message-id response field; recipient format; Unicode flag). **Verify Medusa types** (`AbstractNotificationProviderService`, `ProviderSendNotificationDTO`/`...ResultsDTO`) via `building-with-medusa`/MedusaDocs + installed `@medusajs/*`.
3. **STOP and report** if: a gate stays red after 2 attempts, the Unifonic docs contradict the PRD, or a task needs a decision.
4. **No fabrication** — no fake Unifonic fields/tests/status; no stubbed shipped paths.
5. **Drop-in (ADR-0013):** everything inside the package; host footprint = npm dep + one `providers:[]` block (attached to the `sms` channel) + env. Never edit the consumer app beyond that.
6. Commits clean, imperative, **no `Co-Authored-By`, no AI mention**. Never commit `.claude/ .cursor/ .codex/ .agents/ AGENTS.md .mcp.json node_modules .medusa dist` or any secret.

## READ FIRST
- `docs/prds/unifonic.md` · `docs/adr/0001,0002,0003,0013,0014` · `packages/core/CONTRACT.md` + `packages/core/src/*.ts` · `CLAUDE.md` · `CONTEXT.md` (Notifications glossary) · `packages/payments/moyasar/**` (quality bar)

## PREREQUISITE
None to build/test (mocked). The S3 live test needs `UNIFONIC_APP_SID` + `UNIFONIC_SENDER_ID` + a test recipient in `apps/demo-store/.env`; it **skips** without them.

## NO MAGIC STRINGS — constants contract (`src/providers/unifonic/constants.ts`)
Every literal a named export (grep gate): `PROVIDER_ID = "unifonic"`; `UNIFONIC_PREFIX`; `CHANNEL = "sms"`; `ENV` (`UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID`, `UNIFONIC_BASE_URL?`); `ENDPOINTS` (the SMS send path, from docs); request field names (`AppSid`/`SenderID`/`Body`/`Recipient` or NextGen equivalents); the response message-id field. Errors reuse core `KsaErrorCodes`.

## EXECUTION LOOP (run until finish — don't wait for human input between tasks)
For each task S1 → S3: implement (tests first) → Gate A + Gate B + Gate C → green: commit clean + next; red: fix, 2 attempts then STOP. Post a one-line status (what, gates, coverage %) after each slice and keep going; push to `main` (SSH) per slice. Exit at FINAL ACCEPTANCE or a hard STOP. Never fake a pass.

## STANDARD PER-TASK PROCEDURE
**GATE A (exit 0):** `pnpm --filter medusa-notification-unifonic build && test && typecheck` + `pnpm lint`.
**GATE B (self-audit):** no magic strings; no `any`/ts-ignore in non-test; all HTTP via core `HttpClient`; no `process.env` outside the loader; **AppSid never in logs/errors** (test); send POST **not retried**; correct Medusa provider types; clean code + JSDoc; tests cover success + failure + the named corner; dependency-cruiser 0.
**GATE C (second read):** re-read the diff as a reviewer; confirm the Accept literally holds; re-run Gate A; commit only when A+B+C green.

## CLEAN-CODE BAR
- Small single-responsibility functions; pure, **injectable** I/O (inject fetch so send is deterministically testable); fully typed; JSDoc on exports; names from `CONTEXT.md`; zero magic strings; errors via `KsaError`/`toMedusaError`; no secret leaks; no dead/commented code; no TODO in shipped paths. Match moyasar's style.

---

# TASKS (in order; each = Procedure A+B+C)

- [ ] **S1 — Scaffold + loader + client.** Scaffold `packages/notifications/unifonic` (package.json, dual tsconfig, vitest, `.env.example`); `constants.ts`; `createLoader` (`UNIFONIC_APP_SID` + `UNIFONIC_SENDER_ID` required, fail-fast); `UnifonicClient` over core `HttpClient` (auth per docs; **send POST not retried**). *Accept:* boot throws `KsaError` naming the missing var when either is absent; client tests — auth correct, non-2xx → `KsaError`, **AppSid never leaks**, send not retried.
- [ ] **S2 — Provider `send()`.** `UnifonicNotificationProviderService extends AbstractNotificationProviderService`, `static identifier = PROVIDER_ID`, `static validateOptions`. `send()`: recipient = `notification.to` → international format; body = `notification.content.text`; sender = `notification.from ?? UNIFONIC_SENDER_ID`; POST → return `{ id }`. *Accept (tests):* valid SMS returns the message id; **Arabic Unicode body preserved**; non-international recipient normalized or clearly rejected; **`template` without text → clear `KsaError`**; **missing sender → `KsaError`**; Unifonic error → `KsaError` (no AppSid leak).
- [ ] **S3 — Docs + live test + ship.** `packages/notifications/unifonic/README.md` (moyasar template): config, the registered-Sender-ID note, the `sms`-channel registration block, deferred items (WhatsApp, templates, DLR). A **key-gated live test** that sends a real SMS only with creds + a test recipient in env and **skips otherwise**. Update root README matrix; `pnpm changeset`. *Accept:* README honest; live test skips without creds; status honest (🚧 Beta until a live SMS verified).

---

## FINAL ACCEPTANCE (human review — all true)
- [ ] All four Gate-A commands green; constants.ts exists; grep finds no inline magic strings; dependency-cruiser 0.
- [ ] `send()` returns the message id; Arabic Unicode preserved; recipient normalized; `template`-without-text → error; missing sender → error (tests).
- [ ] Send POST **not retried**; `UNIFONIC_APP_SID` never logged/returned (tests).
- [ ] Notification **provider** (no schema); registers on the `sms` channel; all I/O via core `HttpClient`; no webhook route; no WhatsApp/template store; no custom UI; drop-in.
- [ ] README + status honest; key-gated live test skips without creds; changeset present; commits clean (no AI attribution); no AI-tooling/secret committed.
