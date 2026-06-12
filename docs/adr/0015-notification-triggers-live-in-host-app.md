# Notification triggers (event → SMS) live in the host app, not the provider

The **event → SMS mapping** and the **Arabic message templates** live in the **host Medusa app** (`apps/demo-store`, later `create-medusa-ksa-app`), implemented as **subscribers** that render the Arabic text and call `notificationModuleService.createNotifications(...)` on the **`sms` channel**. The `medusa-notification-unifonic` provider stays a **pure transport** (ADR-0014): it sends the text it's handed and never decides *which* events send SMS or *what they say*. **Native admin only — no custom UI:** placing or fulfilling an order through Medusa's existing admin (or storefront) is what fires the SMS.

## Why

- **Separation of concerns.** *Which* lifecycle events warrant an SMS, the *wording*, and the *locale* are merchant/business policy. The *transport* (auth, POST, message id, retry safety) is the provider's job. Mixing them would make the provider un-reusable and bake one store's policy into a published package.
- **Backend-only + no-UI (CLAUDE.md §6).** A notification provider has **no admin configuration surface** in Medusa — there is nothing to "enable in admin." The only thing missing to make SMS real is the trigger layer, and that is host-app wiring (subscribers), not a custom admin widget. The sole sanctioned UI in the suite remains the ZATCA wizard.
- **Reuse of the rendered-text model.** Medusa's notification module records that a notification was *sent*; the provider awaits the accept and returns the message id (ADR-0014). The caller renders the Arabic body, so templates belong with the caller — the host app.

## Consequences

- `apps/demo-store` owns: the **subscribers** (`src/subscribers/sms-*.ts`), the **Arabic SMS templates** (pure renderers under `src/lib/sms/`), recipient resolution, and their tests. `create-medusa-ksa-app` later ships the same as a sensible default set.
- **Events (verify exact names against Medusa docs — never assume):** v1 = `order.placed` (confirmation) and the order-shipped event (shipped + tracking). Delivered / canceled are documented as easy follow-ons.
- **Recipient** comes from the order (shipping-address phone, else customer phone). **No phone → the subscriber skips and logs**, never throws. The provider normalizes the number to international format (ADR-0014) — the subscriber passes it as-is.
- **Idempotency:** the subscriber passes `createNotifications`' `idempotency_key` keyed on `event + entity id` so event redelivery never double-sends.
- **DTO shape:** the subscriber passes both the required `template` identifier **and** the already-rendered `content.text`; the Unifonic provider uses `content.text` (a `template` with no text → a clear `KsaError`, ADR-0014). Verify the exact `CreateNotificationDTO` (is `template` required, the `content` shape) against Medusa docs.
- All wiring is **mocked-testable** (resolve a fake notification service + query in tests); a key-gated live run sends a real SMS only with Unifonic creds and **skips** otherwise (CI stays green). No admin UI, no provider changes.
