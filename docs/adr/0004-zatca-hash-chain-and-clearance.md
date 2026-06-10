# ZATCA invoice-number allocation is serialized; B2B clearance uses an explicit pending state, never a silent block

The ZATCA invoice counter (**ICV**, sequential integer) and previous-invoice-hash (**PIH**, SHA-256 of the prior invoice) form a legal cryptographic chain — two invoices allocated concurrently must not share an ICV or read a stale PIH, or the chain is corrupt and unrepairable. We therefore **serialize allocation** with a single-writer lock (Postgres advisory lock or a dedicated queue) around the ICV/PIH step. Because B2B **Clearance** is synchronous government I/O, the order enters an explicit **`pending_clearance`** state with a workflow **compensation** step, rather than blocking checkout indefinitely or ever issuing an uncleared standard invoice.

## Consequences

- ICV/PIH allocation is the one deliberately non-concurrent step in the pipeline; everything downstream (sign, QR, submit) can parallelize.
- Credentials (`private_key`, CSID secrets) are encrypted at rest (AES-256-GCM, key from env) via the core secrets primitive, **never logged and never returned from an API route**.
- B2C **Reporting** is deferred: persist + enqueue at checkout, flush via the `retry-reporting` scheduled job with backoff inside the 24h window.

See `packages/zatca/SPEC.md` §4–§5 for the full pipeline.
