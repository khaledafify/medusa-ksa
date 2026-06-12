# `medusa-notification-unifonic` v1: SMS-only thin transport, synchronous-accept, no DLR webhook

`medusa-notification-unifonic` is a Medusa v2 **Notification provider** registered for the **`sms` channel only**. Its single `send()` posts the **already-rendered** message text (`notification.content.text`) to Unifonic's SMS API, **awaits the accept**, and returns the provider **message id** (or maps a failure to a `KsaError`). It is a **thin transport**: no template engine (the caller renders the Arabic text; a `template` arriving without text → a clear error), **no WhatsApp**, and **no delivery-report (DLR) webhook** in v1 (so no webhook route at all). The send POST is **never retried** — a retried SMS double-charges and double-delivers.

## Why

- SMS is Unifonic's simple, proven API. **WhatsApp** drags in Business approval + registered templates — a separate later slice.
- Medusa's notification module records that a notification was **sent** (the `send` result), not a per-message delivery lifecycle — so awaiting the accept + returning the message id is full traceability without a webhook + status store.
- A provider **transports** the message it's handed; rendering/templating is the caller's concern.

## Consequences

- **Config:** `UNIFONIC_APP_SID` + `UNIFONIC_SENDER_ID` (both **required**, env-first via core `createLoader`); the sender is overridable per message via `notification.from`; if neither yields a sender → a clear `KsaError`. The sender must be a **Unifonic-registered Sender ID** (documented).
- Recipients are normalized to **international format** (`+9665…`); Arabic is sent as **Unicode** (UCS-2).
- All I/O via core `HttpClient`; the `send` POST is **not** marked idempotent (core retries only safe verbs); Medusa's notification `idempotency_key` already dedupes — the provider needs no extra idempotency layer.
- **Deferred (README future work):** the WhatsApp channel, template rendering, and the DLR webhook + delivery states.
- Exact Unifonic endpoint generation (classic `POST /rest/SMS/messages` vs NextGen) + auth + the message-id response field are verified against docs.unifonic.com at build time.
