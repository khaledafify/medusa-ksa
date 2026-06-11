# ZATCA invoice-number allocation is serialized; B2B clearance uses an explicit pending state, never a silent block

The ZATCA invoice counter (**ICV**, sequential integer) and previous-invoice-hash (**PIH**, SHA-256 of the prior invoice) form a legal cryptographic chain — two invoices allocated concurrently must not share an ICV or read a stale PIH, or the chain is corrupt and unrepairable. We therefore **serialize allocation** with a single-writer lock (Postgres advisory lock or a dedicated queue) around the ICV/PIH step. Because B2B **Clearance** is synchronous government I/O, the order enters an explicit **`pending_clearance`** state with a workflow **compensation** step, rather than blocking checkout indefinitely or ever issuing an uncleared standard invoice.

## Consequences

- ICV/PIH allocation is the one deliberately non-concurrent step in the pipeline; everything downstream (sign, QR, submit) can parallelize.
- Credentials (`private_key`, CSID secrets) are encrypted at rest (AES-256-GCM, key from env) via the core secrets primitive, **never logged and never returned from an API route**.
- B2C **Reporting** is deferred: persist + enqueue at checkout, flush via the `retry-reporting` scheduled job with backoff inside the 24h window.

## Amendment (Phase 3 grill — mechanism resolved)

- **Mechanism = per-EGS Postgres advisory lock** (or the equivalent `SELECT … FOR UPDATE` on a chain-head row), not an application queue — it works across Medusa instances (an in-process mutex would not), needs no extra worker, and the critical section is fast local crypto, not a network call.
- **Critical-section boundary:** the lock wraps **allocate → build UBL → SHA-256 → sign → persist `ZatcaInvoice`** only. The slow ZATCA submission happens **outside** the lock, so the chain can't become a checkout bottleneck.
- **An ICV is consumed at generation.** A later-rejected invoice does not free or reuse its ICV — it is corrected with a credit note, keeping the chain monotonic.
- **B2B Clearance is deferred to a future slice** (see ADR-0006). The `pending_clearance` + compensation design above stands for when it is built; v1 ships **B2C Reporting only**, so the synchronous-clearance path is not implemented yet.

See `packages/zatca/SPEC.md` §4–§5 and `docs/prds/phase-3-zatca.md`.
