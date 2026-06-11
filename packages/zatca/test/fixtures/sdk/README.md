# ZATCA SDK golden fixtures

Authoritative offline-validation fixtures (ADR-0007). Sourced from the
official **ZATCA Compliance & Enablement Toolbox SDK v3.3.8**
(`zatca-einvoicing-sdk-238-R3.3.8`), downloaded from the ZATCA sandbox
developer portal (https://sandbox.zatca.gov.sa → Download SDK).

| File | Origin in SDK | Purpose |
| --- | --- | --- |
| `simplified-invoice.xml` | `Data/Samples/Simplified/Invoice/Simplified_Invoice.xml` | Golden **signed** Simplified invoice. The byte-match target for the UBL 2.1 builder and the hash/canonicalization pipeline. |
| `simplified-invoice-signed.xml` | output of `fatoora -sign` (SDK 3.3.8, JDK 11) on the sample above | Proves which bytes change on re-signing (SignedProperties digest, SignatureValue, SigningTime, QR tag 7) and which are deterministic. |
| `sample-cert.pem` | `Data/Certificates/cert.pem` | SDK sample signing certificate (test-only, public SDK material). |
| `sample-priv-key.pem` | `Data/Certificates/ec-secp256k1-priv-key.pem` | SDK sample `secp256k1` private key (test-only, public SDK material — **never** a real credential). |
| `pih.txt` | `Data/PIH/pih.txt` | SDK seed Previous Invoice Hash. |

## Known-good invariants (verified with the SDK validator)

- Invoice body hash of the golden sample: `Hss2gNFjBY5OJn/5CEVZSSNUMrSf4QlCMxwsioPN6fA=`
  (SHA-256 of the C14N11-canonicalized invoice with `UBLExtensions`, the
  `Signature` element, and the QR `AdditionalDocumentReference` removed;
  base64 of the raw 32-byte digest). Deterministic across re-signs.
- `fatoora -validate` on `simplified-invoice-signed.xml`:
  XSD / EN / KSA / QR / SIGNATURE / PIH all **PASSED** (GLOBAL = PASSED).
- `fatoora -validate` on a fully generated invoice from this package
  (`npx tsx scripts/emit-sample-signed-invoice.ts /tmp/out.xml` — fresh
  XAdES signature + TLV QR, golden data, SDK test credentials):
  XSD / EN / KSA / QR / SIGNATURE / PIH all **PASSED** (GLOBAL = PASSED,
  SDK 3.3.8, JDK 11).

## Running the validator locally

The SDK lives outside the repo (large): `~/zatca-sdk/latest/zatca-einvoicing-sdk-238-R3.3.8`.
Signature verification requires **JDK 11–14** (`secp256k1` was removed from
newer JDKs; signing alone works on later JDKs but `SIGNATURE` validation fails).

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@11
export FATOORA_HOME=~/zatca-sdk/latest/zatca-einvoicing-sdk-238-R3.3.8/Apps
export SDK_CONFIG=~/zatca-sdk/latest/zatca-einvoicing-sdk-238-R3.3.8/Configuration/config.json
export PATH="$JAVA_HOME/bin:$FATOORA_HOME:$PATH"
fatoora -validate -invoice <file>.xml
```

(`Configuration/config.json` must use absolute local paths, not the shipped
Windows paths.)

## Adaptation source (ADR-0007 license record)

Signing/QR logic is **adapted from [`wes4m/zatca-xml-js`](https://github.com/wes4m/zatca-xml-js)**
(MIT license — compatible with this package's MIT license; attribution
retained here and in the package README). Chosen because it is the
most-proven open-source TypeScript implementation of the ZATCA Phase-2
pipeline: EGS onboarding (CSR/CSID), XAdES-BES/ECDSA `secp256k1` signing,
SignedProperties canonicalization, and the 9-tag TLV QR.
