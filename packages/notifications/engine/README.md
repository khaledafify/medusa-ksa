# medusa-plugin-notifications

Provider-agnostic order notification engine for Medusa v2. It stores merchant-editable Arabic SMS templates, renders them safely with Handlebars, and creates Medusa `sms` notifications for order lifecycle events.

This package does not send SMS by itself. Delivery is handled by whatever Medusa notification provider is registered for the `sms` channel, such as `medusa-notification-unifonic`.

## Install

```bash
npm install medusa-plugin-notifications medusa-notification-unifonic
```

```ts
// medusa-config.ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  plugins: [
    {
      resolve: "medusa-plugin-notifications",
      options: {},
    },
  ],
  modules: [
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "medusa-notification-unifonic/providers/unifonic",
            id: "unifonic",
            options: {
              channels: ["sms"],
            },
          },
        ],
      },
    },
  ],
})
```

```dotenv
UNIFONIC_APP_SID=your-unifonic-app-sid
UNIFONIC_SENDER_ID=YourBrand
UNIFONIC_BASE_URL=https://el.cloud.unifonic.com

# Optional: enables the admin send-test route to create a live notification.
MEDUSA_NOTIFICATIONS_LIVE_SEND_TEST=1
```

The engine itself has no required secrets. The transport provider owns its own credentials.

## Events

The plugin self-seeds Arabic SMS templates for:

| Event | Template behavior |
|---|---|
| `order.placed` | Order display id and SAR total |
| `shipment.created` | Order display id and tracking number when present |
| `delivery.created` | Delivery confirmation |
| `order.canceled` | Cancellation notice |

When an event fires, the subscriber resolves the stored template, renders the order context, and calls Medusa's Notification module on the `sms` channel. If neither the shipping address nor customer has a phone number, it logs and skips without throwing.

## Template model

Templates are keyed by `(channel, event, locale)` and currently ship with:

| Field | Purpose |
|---|---|
| `channel` | Currently `sms` |
| `event` | One of the seeded order events |
| `locale` | Currently `ar` |
| `body` | Handlebars SMS body |
| `enabled` | Disables a template without deleting it |
| `from` | Optional sender override passed to the notification provider |

Self-seeding is idempotent. Existing rows are never overwritten, so merchant edits survive restarts and migrations.

## Admin editor

The package ships a native Medusa Admin extension at **Settings -> Notifications**. It is the suite's second sanctioned UI after the ZATCA wizard. The editor is REST-backed and supports:

- listing stored templates
- editing the template body
- toggling `enabled`
- sample-order preview
- live send-test, guarded by `MEDUSA_NOTIFICATIONS_LIVE_SEND_TEST`

There is no storefront code.

## Safety

The renderer uses a fixed helper whitelist:

- `formatSar`
- `formatDate`
- `pluralizeAr`

It strips control characters and Unicode bidi override/isolate characters from template bodies and values, sanitizes every interpolated value, disables prototype access, preserves Arabic Unicode, and reports SMS segment metadata. Preview and send-test routes render stored template rows only; they do not compile arbitrary request-provided template bodies.

## Live e2e

The demo store includes an opt-in live e2e gate:

```bash
set -a; . apps/demo-store/.env; set +a
MEDUSA_NOTIFICATIONS_LIVE_E2E=1 pnpm --filter demo-store e2e:notifications
```

Without `MEDUSA_NOTIFICATIONS_LIVE_E2E=1`, `UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID`, and `UNIFONIC_TEST_RECIPIENT`, the script exits cleanly as skipped. When enabled, it creates a demo order, emits `order.placed`, waits for the engine-created `sms` notification, and expects the registered transport to deliver it.

## Deferred channels

ADR-0015 fixes v1 to provider-agnostic order SMS. Email, WhatsApp, push, marketing flows, and storefront UI are out of scope until explicitly planned.
