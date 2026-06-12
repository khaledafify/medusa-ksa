# medusa-notification-unifonic

Unifonic SMS notification provider for Medusa v2, built for Saudi stores that
need Arabic SMS on Medusa's native `sms` notification channel.

This package is a thin transport: Medusa sends an already-rendered
`notification.content.text`, the provider posts that text to Unifonic, and the
provider returns Unifonic's accepted message id. It does not render templates,
store templates, expose a delivery-status webhook, send WhatsApp messages, or
add custom admin UI.

## Requirements

- Medusa v2.13 or newer
- Node.js 20 or newer
- A Unifonic account only for live SMS delivery
- A registered and approved Unifonic Sender ID for live KSA SMS

Builds and tests are fully mocked. They do not require a Unifonic account,
commercial registration, Sender ID approval, or live credentials. Live KSA SMS
may require Unifonic account verification and a commercial registration before a
Sender ID can be approved.

## Installation

```bash
npm install medusa-notification-unifonic
```

## Configuration

Register the provider in Medusa's Notification Module and attach it to the
`sms` channel. Environment variables are the happy path; the `options` block can
stay near-empty unless you are overriding defaults.

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
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

## Environment variables

```dotenv
UNIFONIC_APP_SID=your-unifonic-app-sid
UNIFONIC_SENDER_ID=YourBrand
UNIFONIC_BASE_URL=https://el.cloud.unifonic.com

# Optional. Used only by the key-gated live integration test.
UNIFONIC_TEST_RECIPIENT=+966501234567
```

| Variable | Required | Description |
|---|:---:|---|
| `UNIFONIC_APP_SID` | Yes | Unifonic AppSid credential. It is redacted from provider errors. |
| `UNIFONIC_SENDER_ID` | Yes | Default approved Sender ID. `notification.from` overrides it per message. |
| `UNIFONIC_BASE_URL` | No | Defaults to `https://el.cloud.unifonic.com`. Useful for proxies or test doubles. |
| `UNIFONIC_TEST_RECIPIENT` | No | Enables the opt-in live test when combined with live credentials. |

If `UNIFONIC_APP_SID` or `UNIFONIC_SENDER_ID` is missing, the provider fails at
server startup with a clear `KsaError` naming the missing variable.

## Sending behavior

- Only the `sms` channel is supported.
- `notification.content.text` is required. A `template` without rendered text is
  rejected before any HTTP request.
- Recipients are normalized to canonical Saudi international format internally:
  `05xxxxxxxx`, `5xxxxxxxx`, `9665xxxxxxxx`, and `+9665xxxxxxxx` become
  `+9665xxxxxxxx`. The transport converts that value to Unifonic's documented
  digits-only wire format.
- Arabic text is sent as Unicode and preserved byte-for-byte in tests.
- The SMS POST is never retried, even when a retry policy is configured, to
  avoid double SMS delivery.
- Provider failures are mapped through `KsaError`/Medusa errors and never return
  `UNIFONIC_APP_SID`.

## Testing

```bash
pnpm --filter medusa-notification-unifonic test
pnpm --filter medusa-notification-unifonic test:coverage
pnpm --filter medusa-notification-unifonic typecheck
pnpm --filter medusa-notification-unifonic build
```

The live integration test is skipped unless all three variables are present:
`UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID`, and `UNIFONIC_TEST_RECIPIENT`.

## Deferred

- WhatsApp channel support
- Template rendering or a template store
- Delivery-status / DLR webhook handling
- Bulk or scheduled SMS
- Custom admin UI

## License

[MIT](../../../LICENSE)
