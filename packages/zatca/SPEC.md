# `medusa-plugin-zatca` — Module Specification

ZATCA Phase 2 (Fatoora) e-invoicing for Medusa v2. This is a **custom module** (not a native provider type) made of: data models + an invoice-generation pipeline (subscribers → workflows) + a ZATCA API client + a single admin onboarding wizard.

It is the **only** connector in the suite that justifies custom admin UI, because credentials are *generated through a handshake with ZATCA*, not pasted into a config file.

---

## 1. What ZATCA requires (the contract you're building to)

Every invoice must:

- Be **UBL 2.1 XML** (never PDF — the PDF is just a human-readable view).
- Carry a **UUID** (v4), an **ICV** (Invoice Counter Value, sequential integer from 1), and a **PIH** (Previous Invoice Hash, SHA-256 of the prior invoice's XML). These chain invoices cryptographically — you cannot insert, delete, or alter a past invoice without breaking the chain.
- Be **digitally signed** (XAdES-BES, ECDSA) using the **CSID** X.509 certificate issued by ZATCA.
- Include a **TLV-encoded, Base64 QR code** with the Phase 2 tag set (seller name, VAT number, timestamp, invoice total, VAT total, XML hash, ECDSA signature, public key, and for B2B the cert signature).

Two transaction types, two workflows:

| Type | Audience | Workflow | Timing | Must include |
|---|---|---|---|---|
| **Standard** | B2B / B2G | **Clearance** | Real-time, *before* delivery | Buyer VAT number + address |
| **Simplified** | B2C | **Reporting** | Within 24h of issuance | QR with cryptographic stamp |

> ⚠️ **Verify against the source.** Exact endpoint URLs, the signing canonicalization, and the precise QR tag ordering must be taken from ZATCA's Developer Portal / Validation SDK, not from memory. Study an existing open-source implementation (e.g. community ZATCA libraries) before writing the signer — the QR "tags 6/7/8 from the signed hash" step is the most common source of rejection.

---

## 2. Package layout

```
packages/zatca/
├── src/
│   ├── modules/zatca/
│   │   ├── models/
│   │   │   ├── zatca-invoice.ts        # per-order invoice record + status
│   │   │   └── zatca-credential.ts     # EGS unit: keys, CSID, status (encrypted)
│   │   ├── services/
│   │   │   ├── zatca.ts                 # main service (orchestrator)
│   │   │   ├── xml-builder.ts           # UBL 2.1 generation
│   │   │   ├── signer.ts                # XAdES-BES / ECDSA stamping
│   │   │   ├── qr.ts                     # TLV QR encoder
│   │   │   ├── hash-chain.ts            # ICV allocation + PIH + SHA-256
│   │   │   └── fatoora-client.ts        # ZATCA API client (sandbox/sim/prod)
│   │   ├── loaders/validate-config.ts   # fail-fast on boot
│   │   ├── migrations/
│   │   ├── service.ts
│   │   └── index.ts                      # module definition
│   ├── workflows/
│   │   ├── onboard-egs.ts                # CSR → CCSID → compliance → PCSID
│   │   ├── clear-invoice.ts              # B2B: build → sign → clear → persist
│   │   └── report-invoice.ts            # B2C: build → sign → persist → report
│   ├── subscribers/
│   │   └── order-placed.ts               # entry point: routes to clear/report
│   ├── jobs/
│   │   └── retry-reporting.ts            # scheduled: flush queued/failed B2C reports
│   ├── api/admin/zatca/                   # routes powering the onboarding wizard
│   └── admin/routes/settings/zatca/       # the onboarding + status UI
└── package.json
```

---

## 3. Data models

### `ZatcaCredential` (the EGS unit)

Stores the cryptographic identity. **All secret fields encrypted at rest.**

| Field | Type | Notes |
|---|---|---|
| `id` | string | PK |
| `environment` | enum | `sandbox` \| `simulation` \| `production` |
| `vat_number` | string | 15-digit VAT registration |
| `egs_serial_number` | string | EGS unit serial (goes into the CSR) |
| `org_name`, `org_address`, `crn` | string | Org details required for the CSR |
| `private_key` | text | 🔒 encrypted — generated during CSR step |
| `csr` | text | The generated CSR |
| `compliance_csid` | text | 🔒 CCSID + secret |
| `production_csid` | text | 🔒 PCSID + secret |
| `certificate` | text | X.509 cert returned by ZATCA |
| `status` | enum | `not_onboarded` \| `compliance` \| `production` |
| `created_at` / `updated_at` | datetime | |

### `ZatcaInvoice` (per order)

Linked to Medusa's Order via a **Module Link**.

| Field | Type | Notes |
|---|---|---|
| `id` | string | PK |
| `order_id` | string | Module link → Order |
| `invoice_type` | enum | `standard` \| `simplified` |
| `uuid` | string | v4 |
| `icv` | integer | sequential, **globally ordered per EGS** |
| `pih` | text | previous invoice hash |
| `invoice_hash` | text | SHA-256 of this invoice's XML |
| `xml` | text | signed UBL (or storage reference) |
| `qr_code` | text | Base64 TLV |
| `status` | enum | `pending` \| `cleared` \| `reported` \| `rejected` \| `failed` |
| `zatca_response` | json | status code, warnings, errors |
| `submitted_at`, `cleared_at`, `reported_at` | datetime | |
| `attempts` | integer | for retry logic |

---

## 4. The pipeline

### Onboarding (`onboard-egs` workflow — one-time, run from the wizard)

1. Collect org details + VAT + EGS serial; merchant pastes the **OTP** from the Fatoora portal.
2. Generate EC keypair + **CSR** (must embed VAT number, EGS serial, and ZATCA's certificate-template extension).
3. Call **Compliance CSID API** with CSR + OTP → store **CCSID**, set status `compliance`.
4. Run **compliance checks** (submit sample standard + simplified invoices/notes via the Compliance Invoice API).
5. On pass, call **Production CSID API** → store **PCSID**, set status `production`.

### Invoice generation (`order-placed` subscriber)

```
order.placed
   └─ resolve EGS credential (must be `production`)
   └─ decide type: buyer has VAT no.? → standard (clear)  : simplified (report)
   └─ run clearInvoiceWorkflow OR reportInvoiceWorkflow
```

Both workflows share these steps:

1. **Allocate ICV + read PIH** — *must be serialized* (see §5). Atomic increment.
2. **Build UBL 2.1 XML** (`xml-builder`), embedding UUID, ICV, PIH.
3. **Hash** the canonical XML (SHA-256) → `invoice_hash`.
4. **Sign** (`signer`: XAdES-BES, ECDSA with the private key) → cryptographic stamp.
5. **Generate QR** (`qr`: TLV, 9 tags).
6. **Submit** via `fatoora-client`:
   - **Clearance (B2B):** call Clearance API, *await* `Cleared`; persist returned XML + status. The invoice is **not** released to the buyer until cleared. Use a workflow compensation step so a failed clearance rolls back / flags the order rather than silently issuing.
   - **Reporting (B2C):** persist immediately (QR goes to the customer at checkout), then call Reporting API. This can be **deferred** — enqueue and let the `retry-reporting` scheduled job flush it within the 24h window with backoff.
7. **Persist** the `ZatcaInvoice` with final status.

---

## 5. The three things that will bite you

- **Hash-chain concurrency.** ICV is sequential and PIH points at the immediately previous invoice. Two orders placed at once must not get the same ICV or a stale PIH. Serialize invoice-number allocation with a DB lock or a single-writer queue. This is the #1 correctness risk.
- **Clearance blocks checkout.** B2B clearance is synchronous — your order-completion flow must wait on a government API or queue-and-hold. Design the UX for the "pending clearance" state; never issue an uncleared standard invoice.
- **Credential security.** The private key and CSID secrets are bearer credentials for signing legal tax documents. Encrypt them at rest (AES-GCM with a key from env, e.g. `ZATCA_ENCRYPTION_KEY`), never log them, never return them from an API route. Rotate via re-onboarding.

---

## 6. Configuration split

```ts
// medusa-config.ts — non-secret bootstrap only
plugins: [
  {
    resolve: "medusa-plugin-zatca",
    options: {
      environment: process.env.ZATCA_ENV ?? "sandbox", // sandbox | simulation | production
      // encryption key for credential storage (required, validated at boot)
      encryptionKey: process.env.ZATCA_ENCRYPTION_KEY,
      // when to issue: "order_placed" | "payment_captured"
      trigger: "order_placed",
    },
  },
]
```

```dotenv
ZATCA_ENV=sandbox
ZATCA_ENCRYPTION_KEY=base64-32-byte-key
```

Everything else — keys, CSID, certificate, org details — is **generated and stored in `ZatcaCredential`** through the onboarding wizard, not in env. A fail-fast loader throws at boot if `ZATCA_ENCRYPTION_KEY` is missing or the wrong length.

---

## 7. The admin onboarding wizard (the one justified UI)

A native Medusa admin route at **Settings → ZATCA**, built with Medusa's admin extension SDK (renders inside the existing admin — no new framework):

- **Status banner:** `Not onboarded` / `Compliance` / `Production`.
- **Wizard:** org details + VAT + EGS serial → "Generate CSR" → enter Fatoora OTP → "Get Compliance CSID" → "Run Compliance Checks" → "Activate Production".
- **Dashboard:** recent invoices with status, counts of cleared / reported / failed, and a "Retry failed" action.

---

## 8. Suggested build milestones

1. Models + module wiring + fail-fast loader.
2. `xml-builder` + `hash-chain` (validate XML offline against the ZATCA SDK before touching the network).
3. `signer` + `qr` (the hard cryptography — validate against known-good samples).
4. `fatoora-client` against **sandbox**: onboarding (CSR → CCSID → PCSID).
5. `report-invoice` (B2C) end-to-end in sandbox.
6. `clear-invoice` (B2B) + compensation.
7. Subscriber + scheduled retry job.
8. Admin wizard.
9. Simulation environment certification → production.

> Build and certify in **sandbox → simulation** long before a real deadline; ZATCA certification takes time.
