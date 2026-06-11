import { createHash } from "node:crypto";

/**
 * ICV/PIH hash-chain allocation (ADR-0004 amended).
 *
 * Every invoice carries a strictly sequential counter (ICV, KSA-16) and the
 * hash of the previous invoice (PIH, KSA-13). Concurrent allocation would
 * fork the chain, which ZATCA rejects silently — so allocation happens under
 * a **per-EGS Postgres advisory transaction lock**: the lock wraps
 * allocate → build → hash → sign → persist; ZATCA submission stays outside.
 *
 * The helpers take a minimal {@link SqlExecutor} so the same logic runs on
 * MikroORM's EntityManager at runtime and on a raw `pg` client in tests.
 */

/** Minimal SQL surface shared by MikroORM's SqlEntityManager and pg clients. */
export interface SqlExecutor {
  execute(sql: string, params?: unknown[]): Promise<unknown[]>;
}

/**
 * PIH of the very first invoice in a chain: base64 of the **hex** SHA-256
 * digest of the string "0" (ZATCA convention, matches the SDK's pih.txt).
 */
export const SEED_PIH =
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

/** Fixed application namespace for the advisory-lock keyspace. */
const LOCK_NAMESPACE = 0x5a41; // "ZA"

/**
 * Derive the deterministic two-int32 advisory lock key for an EGS.
 * (Postgres advisory locks are keyed by two 32-bit ints.)
 */
export function chainLockKeys(egsKey: string): [number, number] {
  const digest = createHash("sha256").update(`zatca:${egsKey}`).digest();
  // Signed 32-bit read keeps the value in Postgres int4 range.
  return [LOCK_NAMESPACE, digest.readInt32BE(0)];
}

/**
 * Acquire the per-EGS chain lock for the current transaction. Blocks until
 * the holder commits/rolls back; auto-released at transaction end.
 * MUST be called inside an open transaction.
 */
export async function acquireChainLock(
  ex: SqlExecutor,
  egsKey: string,
): Promise<void> {
  const [ns, key] = chainLockKeys(egsKey);
  await ex.execute(`select pg_advisory_xact_lock(${ns}, ${key})`);
}

export interface ChainHead {
  icv: number;
  invoiceHash: string;
}

/**
 * Read the current chain head (highest ICV). Call only while holding the
 * chain lock — otherwise the read is meaningless.
 */
export async function readChainHead(ex: SqlExecutor): Promise<ChainHead | null> {
  const rows = (await ex.execute(
    `select icv, invoice_hash from zatca_invoice order by icv desc limit 1`,
  )) as { icv: number | string; invoice_hash: string }[];
  const head = rows[0];
  if (!head) return null;
  return { icv: Number(head.icv), invoiceHash: head.invoice_hash };
}

export interface ChainAllocation {
  icv: number;
  pih: string;
}

/** Next ICV/PIH from the current head (seed PIH for the first invoice). */
export function nextAllocation(head: ChainHead | null): ChainAllocation {
  if (!head) {
    return { icv: 1, pih: SEED_PIH };
  }
  return { icv: head.icv + 1, pih: head.invoiceHash };
}

/**
 * Convenience: acquire the lock, read the head, and return the next
 * allocation. The caller must already be inside a transaction and must
 * persist the new invoice **before** the transaction commits.
 */
export async function allocateChainPosition(
  ex: SqlExecutor,
  egsKey: string,
): Promise<ChainAllocation> {
  await acquireChainLock(ex, egsKey);
  return nextAllocation(await readChainHead(ex));
}
