import { createHash, randomBytes } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acquireChainLock,
  chainLockKeys,
  nextAllocation,
  readChainHead,
  SEED_PIH,
  type SqlExecutor,
} from "./hash-chain";

/**
 * Concurrency gate (PRD S2): N parallel generations must produce strictly
 * sequential ICVs and correct PIH links — zero duplicates, zero stale reads.
 * Runs against a real Postgres (advisory locks can't be faked in memory);
 * uses a throwaway schema so it never touches application data.
 */
const databaseUrl =
  process.env.ZATCA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe("nextAllocation (pure)", () => {
  it("starts the chain at ICV 1 with the seed PIH", () => {
    expect(nextAllocation(null)).toEqual({ icv: 1, pih: SEED_PIH });
  });

  it("links PIH to the previous invoice hash", () => {
    expect(nextAllocation({ icv: 41, invoiceHash: "abc=" })).toEqual({
      icv: 42,
      pih: "abc=",
    });
  });
});

describe("chainLockKeys", () => {
  it("is deterministic per EGS and distinct across EGSes", () => {
    expect(chainLockKeys("egs-1")).toEqual(chainLockKeys("egs-1"));
    expect(chainLockKeys("egs-1")).not.toEqual(chainLockKeys("egs-2"));
    const [ns, key] = chainLockKeys("egs-1");
    expect(Number.isInteger(ns)).toBe(true);
    expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(key).toBeLessThan(2 ** 31);
  });
});

describe.runIf(databaseUrl)("hash chain under concurrency (advisory lock)", () => {
  const schema = `zatca_chain_test_${randomBytes(4).toString("hex")}`;
  let pool: Pool;

  /** Adapt a pg client to the SqlExecutor surface (rows array). */
  const executor = (client: PoolClient): SqlExecutor => ({
    async execute(sql, params) {
      const result = await client.query(sql, params);
      return result.rows as unknown[];
    },
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 25 });
    await pool.query(`create schema ${schema}`);
    await pool.query(
      `create table ${schema}.zatca_invoice (
         id text primary key,
         icv integer not null unique,
         pih text not null,
         invoice_hash text not null
       )`,
    );
  });

  afterAll(async () => {
    await pool.query(`drop schema ${schema} cascade`);
    await pool.end();
  });

  it("N parallel generations produce a strictly sequential, correctly linked chain", async () => {
    const N = 20;

    const generateOne = async (i: number) => {
      const client = await pool.connect();
      try {
        await client.query(`set search_path to ${schema}`);
        await client.query("begin");
        const ex = executor(client);

        await acquireChainLock(ex, "egs-test");
        const allocation = nextAllocation(await readChainHead(ex));

        // Simulate build/hash/sign inside the lock (ADR-0004): the invoice
        // hash deterministically derives from the allocated position.
        const invoiceHash = createHash("sha256")
          .update(`invoice-${allocation.icv}`)
          .digest("base64");
        await client.query(
          `insert into zatca_invoice (id, icv, pih, invoice_hash) values ($1, $2, $3, $4)`,
          [`inv_${i}_${allocation.icv}`, allocation.icv, allocation.pih, invoiceHash],
        );

        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    };

    await Promise.all(Array.from({ length: N }, (_, i) => generateOne(i)));

    const { rows } = await pool.query(
      `select icv, pih, invoice_hash from ${schema}.zatca_invoice order by icv asc`,
    );

    expect(rows).toHaveLength(N);
    // Strictly sequential ICVs, no gaps or duplicates.
    rows.forEach((row, idx) => expect(row.icv).toBe(idx + 1));
    // First PIH is the seed; every later PIH equals the previous invoice hash.
    expect(rows[0].pih).toBe(SEED_PIH);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].pih).toBe(rows[i - 1].invoice_hash);
    }
  }, 30_000);
});
