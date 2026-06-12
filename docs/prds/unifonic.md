# PRD — `medusa-notification-unifonic` (Arabic SMS)

**Status:** ready for implementation · **Owner:** Codex/Cursor · **Design:** locked via grill-with-docs (Opus)
**Authority:** `CLAUDE.md` · `docs/adr/0001`,`0002`,`0003`,`0013`,`0014` · `packages/core/CONTRACT.md` · `CONTEXT.md` (Notifications glossary) · `packages/payments/moyasar/**` (quality bar)
**Path:** `packages/notifications/unifonic` → npm `medusa-notification-unifonic`.

> A Medusa v2 **Notification provider** (no schema) for the **`sms` channel**, sending Arabic SMS via Unifonic. The smallest package in the suite — one `send()` method. **Verify Unifonic's endpoint/auth/response against docs.unifonic.com — never assume.**

---

## 1. Locked design decisions (do not re-litigate)

1. **SMS-only thin transport (ADR-0014).** `send()` posts the **already-rendered** `notification.content.text` to Unifonic and returns the **message id**. A `template` without text → a clear `KsaError`. **WhatsApp + templates deferred.**
2. **Synchronous-accept, no DLR (ADR-0014).** `send()` awaits Unifonic's accept and returns `{ id }` (or maps failure to `KsaError`). **No DLR webhook, no webhook route** in v1.
3. **Config:** `UNIFONIC_APP_SID` + `UNIFONIC_SENDER_ID` (both **required**, env-first); sender overridable via `notification.from`; missing sender → `KsaError`. Sender must be Unifonic-registered (documented).
4. **Send safety:** the send POST is **never retried** (no double-SMS); recipients normalized to **international format**; Arabic sent as **Unicode**. Medusa's `idempotency_key` handles dedup.

## 2. Config

`UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID` (both required, env-first via core `createLoader`); optional `UNIFONIC_BASE_URL`. No secret (AppSid) logged or returned.

## 3. Verify against docs.unifonic.com (never assume)

The endpoint generation (classic `POST /rest/SMS/messages` with `AppSid`+`SenderID`+`Body`+`Recipient`, vs NextGen Basic-Auth/JSON) + the success response shape (the **message-id** field) + the exact recipient format + how Unicode/Arabic is flagged.

## 4. Slices (each: test-first, small clean commits, gates green before advancing)

- **S1 — Scaffold + loader + client.** Package (`medusa-notification-unifonic`, `medusa plugin:build`, exports per CLAUDE §10, peer `@medusajs/*`, dep `@medusa-ksa/core: workspace:*`), dual tsconfig + vitest, `.env.example`. `createLoader` (`UNIFONIC_APP_SID` + `UNIFONIC_SENDER_ID` required, fail-fast). `UnifonicClient` over core `HttpClient` (auth per docs; send POST **not retried**).
  *Accept:* boot throws `KsaError` naming the missing var when either is absent; client unit tests (mocked fetch) — auth correct, non-2xx → `KsaError`, **AppSid never in an error message**, send not retried.
- **S2 — Provider `send()`.** `UnifonicNotificationProviderService extends AbstractNotificationProviderService`, `static identifier = "unifonic"`, `static validateOptions`. `send(notification)`: recipient = `notification.to` normalized to international format; body = `notification.content.text`; sender = `notification.from ?? UNIFONIC_SENDER_ID`; POST to Unifonic; return `{ id }` from the response. Map failures via `toMedusaError`.
  *Accept (tests):* a valid SMS returns the provider message id; **Arabic sent as Unicode** (body preserved); **non-international recipient is normalized or rejected clearly**; **`template` without `content.text` → clear `KsaError`**; **missing sender (no default, no `from`) → `KsaError`**; Unifonic error → `KsaError` (no AppSid leak).
- **S3 — Docs + live test + ship.** `packages/notifications/unifonic/README.md` (moyasar template): config, the registered-Sender-ID note, the `sms` channel registration block, deferred items (WhatsApp, templates, DLR). A **key-gated live test** (sends a real sandbox/test SMS only when `UNIFONIC_APP_SID`/`SENDER_ID` + a test recipient are in env; **skips otherwise** so CI stays green). Update root README matrix; `pnpm changeset`.
  *Accept:* README honest; live test skips without creds; status `🚧 Beta` until a live SMS is verified, then `✅ Stable`.

## 5. Guard gates (every slice)

**Green commands (exit 0):**
```
pnpm --filter medusa-notification-unifonic build
pnpm --filter medusa-notification-unifonic test
pnpm --filter medusa-notification-unifonic typecheck
pnpm lint                                            # eslint + dependency-cruiser (0 violations) + syncpack
```

**Notification-specific guards:**
- **No double-send** — the send POST is **not retried** (test).
- **Secret hygiene** — `UNIFONIC_APP_SID` never appears in a log or error (test).
- **Arabic + format** — Unicode body preserved; recipient normalized to international format (tests).
- **Thin transport** — `template` without text → clear error; no template store; no WhatsApp; **no webhook route** (ADR-0014).
- **Architecture** — Notification **provider** (no schema, ADR-0001); registers in the Notification module `providers` array attached to the `sms` channel; all I/O via core `HttpClient`; key env-first + never logged/returned; `@medusajs/*` peer-only; only `@medusa-ksa/core` intra-repo import (dependency-cruiser 0); **no custom UI**; drop-in (ADR-0013).
- **Honesty** — no faked Unifonic fields; status not faked; clean commits, no AI attribution, AI tooling git-ignored.

## 6. Definition of Done (v1)

A store sends an Arabic SMS via Unifonic on the `sms` channel: `send()` posts the rendered text, returns the provider message id, fails fast on a missing sender / bad recipient, and never double-sends; all four gates green; a key-gated live test proves a real SMS (or is documented pending creds). Reuses `@medusa-ksa/core`; respects ADR-0001/0002/0003/0013/0014.

## 7. Out of scope (v1)

WhatsApp channel · template rendering / a template store · DLR webhook + delivery states · bulk/scheduled SMS · any custom UI · cryptocurrency. Deferred items README'd as future work.
