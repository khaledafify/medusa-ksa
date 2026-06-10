---
"medusa-payment-moyasar": minor
---

Add the hosted-redirect payment flow (dual-mode): sessions without a `source` now create a Moyasar hosted payment and surface its checkout `url` as `requires_more` — no Moyasar.js or PCI exposure needed. The publishable key is now optional (only the embedded source path uses it), STC Pay and Samsung Pay are supported via the hosted page, and webhooks for hosted-page payments are routed through the hosted payment's metadata.
