# ZATCA signing/QR is adapted from a proven implementation and validated offline against the SDK before any network call

The `xml-builder`, `signer`, and `qr` are built by **adapting the approach of a proven open-source ZATCA implementation** (UBL 2.1 shape, XAdES-BES/ECDSA canonicalization, the 9-tag TLV QR with tags 6/7/8 derived from the signed hash) — **never hand-rolled from the PDF spec** — and every output is gated by a hard **offline validation step**: it must byte-match the **ZATCA Validation SDK's known-good samples** before the Fatoora client is pointed at the sandbox network.

## Why

- The XAdES canonicalization and the "QR tags from the signed hash" step are the **#1 source of ZATCA rejection**; a single wrong byte fails silently. Reusing battle-tested logic and proving it against golden samples turns a guess-and-submit loop into a deterministic "match the sample" task.
- It lets us certify correctness **without** burning sandbox attempts or ICVs while iterating.

## Consequences

- Implementation order is fixed: **build XML + hash-chain → sign → QR**, each gated by SDK sample-matching, and **only then** wire the sandbox. Network testing starts from known-correct artifacts.
- **Licensing:** if code is ported from an open-source library, its license must be honored (attribution / compatibility with MIT) or the logic clean-roomed. The chosen library and its license are recorded in the package.
- The offline sample-match tests are permanent regression guards — a future change that breaks canonicalization fails locally, not at the tax authority.
