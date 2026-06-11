# medusa-plugin-zatca

ZATCA / Fatoora Phase 2 e-invoicing for Medusa v2, built for Saudi B2C commerce.

This package is a Medusa custom module that generates tax-correct Simplified UBL 2.1 invoices, signs them with the onboarded EGS Production CSID, stamps the 9-tag TLV QR code, maintains the ICV/PIH hash chain, and reports invoices plus lifecycle credit/debit notes to ZATCA.

Status: Beta. The B2C Simplified Reporting path is implemented. Simulation certification is still pending, so this is not marked stable yet.

## Scope

Implemented in v1.1:

- B2C Simplified invoices only
- Single EGS identity
- Reporting API flow
- ZATCA onboarding: CSR, Compliance CSID, compliance checks, Production CSID
- Per-order invoice generation on `payment_captured` by default, with `order_placed` available for COD/auth-only stores
- Correct original-invoice tax base for line discounts, shipping charges, tax-inclusive pricing, and multiple VAT rates
- Fail-closed reconciliation: if built totals do not match Medusa's order total/VAT total, the document is not reported
- Reported credit notes (381) for refunds, returns, and post-issuance cancellations
- Reported credit notes (381) or debit notes (383) for post-issuance order edits
- Source-key idempotency, so one order can own one invoice and many lifecycle notes
- PostgreSQL-serialized ICV/PIH hash chain
- Deferred retry job with `FOR UPDATE SKIP LOCKED`
- Admin remediation notices for rejected or failed documents

Not implemented yet:

- B2B Standard invoices and Clearance
- Multiple EGS units
- Buyer-VAT routing
- True partial-capture business models
- Mixed-rate partial money refunds that are not tied to returned items
- Exchanges and claims documents
- Automatic re-issue after rejection beyond admin notification/action
- Storefront UI

## Requirements

- Medusa v2.13 or newer
- Node.js 20+
- PostgreSQL
- Access to the ZATCA Fatoora sandbox, then simulation before production
- A 32-byte base64 encryption key for stored EGS credentials

Generate the encryption key with:

```bash
openssl rand -base64 32
```

## Installation

```bash
npm install medusa-plugin-zatca
```

## Configuration

Register the plugin in `medusa-config.ts`.

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  plugins: [
    {
      resolve: "medusa-plugin-zatca",
      options: {
        environment: process.env.ZATCA_ENV ?? "sandbox",
        encryptionKey: process.env.ZATCA_ENCRYPTION_KEY,
        trigger: process.env.ZATCA_TRIGGER ?? "payment_captured",
      },
    },
  ],
})
```

Environment variables:

```dotenv
ZATCA_ENV=sandbox
ZATCA_ENCRYPTION_KEY=base64-32-byte-key
ZATCA_TRIGGER=payment_captured
```

Options:

| Option | Type | Default | Description |
|---|---:|---|---|
| `environment` | `sandbox | simulation | production` | `env.ZATCA_ENV ?? "sandbox"` | Fatoora environment. Start with sandbox, certify in simulation, then use production. |
| `encryptionKey` | `string` | `env.ZATCA_ENCRYPTION_KEY` | Required. Base64 string that decodes to exactly 32 bytes. Used by `@medusa-ksa/core` AES-256-GCM helpers. |
| `trigger` | `payment_captured | order_placed` | `env.ZATCA_TRIGGER ?? "payment_captured"` | Event that issues the invoice. |

The loader validates `ZATCA_ENCRYPTION_KEY` and `ZATCA_ENV` at server boot. A missing or short key fails fast before any invoice or credential work runs.

## Onboarding

Open Medusa Admin -> Settings -> ZATCA.

The wizard collects organization details and the Fatoora portal OTP, then runs:

1. Generate EGS private key and CSR.
2. Exchange CSR + OTP for the Compliance CSID.
3. Submit the required Simplified compliance samples.
4. Exchange the compliance request for the Production CSID.

The private key, Compliance CSID, and Production CSID are encrypted before they are stored in the database. Admin routes return status only and never return private keys, CSID secrets, certificates, or CSR payloads.

## Invoice Flow

For each configured event:

1. Resolve the order.
2. Guard idempotency with the lifecycle source key: original invoices use `("order", order_id)`, notes use their triggering refund, return, cancellation, or order-edit id.
3. Acquire the per-EGS PostgreSQL advisory transaction lock.
4. Allocate the next ICV and PIH.
5. Build UBL 2.1 XML and reconcile the built tax-inclusive amount and VAT against Medusa's computed order graph.
6. Hash, sign, QR-stamp, and persist the pending invoice.
7. Submit to the Reporting API outside the chain lock.

Transient Reporting failures keep the invoice pending for the retry job. Definitive 4xx rejections mark the invoice rejected. Invoices that outlive the 24-hour Reporting window are marked failed and surfaced to the admin.

Credit/debit notes use the same `<Invoice>` root and Reporting endpoint as original invoices. The document type is carried by `cbc:InvoiceTypeCode`: 388 for invoices, 381 for credit notes, and 383 for debit notes. Note amounts are positive; the type code carries the direction. Notes reference the original invoice with a bare serial in `cac:BillingReference` and include the human-readable reason in `cbc:InstructionNote`.

## Retry Reporting

The scheduled job claims due pending invoices with `SELECT ... FOR UPDATE SKIP LOCKED`, so overlapping workers claim disjoint rows. Backoff doubles per attempt and is capped inside the 24-hour Reporting window.

The job never mutates the order. Terminal rejected or failed documents keep their ICV and remain part of the chain; the admin dashboard shows a remediation notice and emits an admin feed notification when a notification provider is installed, with an error log as the fallback.

## Admin

The package includes the suite's only sanctioned custom UI:

- Status banner: not onboarded, compliance, or production
- Onboarding wizard
- Reporting dashboard with pending, reported, rejected, failed, total, invoice, credit-note, and debit-note counts
- Rejected/failed document remediation notices
- Retry failed action
- Corrective credit-note action for rejected lifecycle documents whose original invoice remains reported

No API keys are entered in the admin. Bootstrap configuration stays in env and `medusa-config.ts`; generated ZATCA credentials are encrypted in the database.

## Validation and Adaptation Source

XML, signing, and QR behavior is validated offline against fixtures from the official ZATCA Compliance & Enablement Toolbox SDK v3.3.8 before sandbox calls are made. New tax-base and lifecycle paths are covered by deterministic tests; run the SDK validator and ZATCA simulation again before production certification.

Signing and QR logic is adapted from [`wes4m/zatca-xml-js`](https://github.com/wes4m/zatca-xml-js), MIT licensed and compatible with this repository's MIT license. The fixture provenance and validator notes live in [`test/fixtures/sdk/README.md`](./test/fixtures/sdk/README.md).

Useful official references:

- [ZATCA Systems Developers](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/default.aspx)
- [ZATCA SDK download](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx)
- [Medusa custom modules](https://docs.medusajs.com/learn/fundamentals/modules)
- [Medusa module links](https://docs.medusajs.com/learn/fundamentals/module-links)

## Testing

Package gates:

```bash
pnpm --filter medusa-plugin-zatca build
pnpm --filter medusa-plugin-zatca test
pnpm --filter medusa-plugin-zatca typecheck
pnpm lint
```

To run the PostgreSQL-backed concurrency tests, load a test database URL first:

```bash
set -a
source apps/demo-store/.env
set +a
pnpm --filter medusa-plugin-zatca test
```

Live sandbox scripts in the demo store:

```bash
pnpm --filter demo-store exec medusa exec ./src/scripts/test-zatca-invoice.ts
ZATCA_TRIGGER=order_placed pnpm --filter demo-store exec medusa exec ./src/scripts/test-zatca-subscriber.ts
pnpm --filter demo-store exec medusa exec ./src/scripts/test-zatca-retry.ts
```

## Go-Live Checklist

1. Complete sandbox onboarding and reporting.
2. Re-run the full flow against the ZATCA simulation environment.
3. Keep `ZATCA_ENV=simulation` until simulation invoices are accepted.
4. Rotate to production credentials through onboarding.
5. Set `ZATCA_ENV=production`.
6. Monitor the retry-reporting job and failed invoice notifications.

The package should remain Beta until simulation certification is complete.

## License

[MIT](../../LICENSE) (c) Medusa KSA contributors.
