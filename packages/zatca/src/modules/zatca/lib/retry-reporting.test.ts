import { randomBytes } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlExecutor } from "./hash-chain";
import {
  backoffMs,
  BASE_BACKOFF_MS,
  isDue,
  isExpired,
  MAX_BACKOFF_MS,
  processPendingReports,
  REPORTING_WINDOW_MS,
  type ClaimedInvoice,
} from "./retry-reporting";

/**
 * S6 gates (PRD): the retry engine claims pending invoices with
 * `FOR UPDATE SKIP LOCKED` (exactly-once across concurrent runs), backs off
 * exponentially inside the 24h Reporting window, marks expired invoices
 * `failed`, and never touches anything but the `zatca_invoice` row.
 */

const databaseUrl =
  process.env.ZATCA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const NOW = new Date("2026-06-11T12:00:00Z");

function candidate(over: Partial<ClaimedInvoice> = {}): ClaimedInvoice {
  return {
    id: "zatinv_1",
    attempts: 0,
    created_at: NOW,
    submitted_at: null,
    uuid: "uuid-1",
    invoice_hash: "hash=",
    xml: "<Invoice/>",
    ...over,
  };
}

describe("backoff schedule (pure)", () => {
  it("doubles per attempt from the base, capped at the max", () => {
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(2)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(3)).toBe(BASE_BACKOFF_MS * 4);
    expect(backoffMs(99)).toBe(MAX_BACKOFF_MS);
  });

  it("never-attempted invoices are due immediately", () => {
    expect(isDue(candidate(), NOW)).toBe(true);
  });

  it("recently attempted invoices are not due before their backoff", () => {
    const c = candidate({
      attempts: 1,
      submitted_at: new Date(NOW.getTime() - BASE_BACKOFF_MS / 2),
    });
    expect(isDue(c, NOW)).toBe(false);
  });

  it("attempted invoices become due after their backoff elapses", () => {
    const c = candidate({
      attempts: 1,
      submitted_at: new Date(NOW.getTime() - BASE_BACKOFF_MS - 1),
    });
    expect(isDue(c, NOW)).toBe(true);
  });

  it("invoices expire 24h after creation", () => {
    expect(isExpired(candidate(), NOW)).toBe(false);
    const old = candidate({
      created_at: new Date(NOW.getTime() - REPORTING_WINDOW_MS - 1),
    });
    expect(isExpired(old, NOW)).toBe(true);
  });
});

describe.runIf(databaseUrl)("processPendingReports (postgres)", () => {
  const schema = `zatca_retry_test_${randomBytes(4).toString("hex")}`;
  let pool: Pool;

  function executor(client: PoolClient): SqlExecutor {
    return {
      execute: async (sql, params) => {
        const result = await client.query(sql, params);
        return result.rows as unknown[];
      },
    };
  }

  async function withTx<T>(fn: (ex: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local search_path to ${schema}`);
      const out = await fn(executor(client));
      await client.query("commit");
      return out;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function insertInvoice(
    id: string,
    over: { status?: string; attempts?: number; created_at?: Date; submitted_at?: Date | null } = {},
  ): Promise<void> {
    await pool.query(
      `insert into ${schema}.zatca_invoice
         (id, status, attempts, created_at, submitted_at, uuid, invoice_hash, xml)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        over.status ?? "pending",
        over.attempts ?? 0,
        over.created_at ?? NOW,
        over.submitted_at ?? null,
        `uuid-${id}`,
        "hash=",
        "<Invoice/>",
      ],
    );
  }

  async function rowOf(id: string) {
    const { rows } = await pool.query(
      `select * from ${schema}.zatca_invoice where id = $1`,
      [id],
    );
    return rows[0] as {
      status: string;
      attempts: number;
      zatca_response: unknown;
      submitted_at: Date | null;
      reported_at: Date | null;
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    await pool.query(`create schema ${schema}`);
    await pool.query(`
      create table ${schema}.zatca_invoice (
        id text primary key,
        status text not null default 'pending',
        attempts integer not null default 0,
        created_at timestamptz not null default now(),
        submitted_at timestamptz,
        reported_at timestamptz,
        zatca_response jsonb,
        uuid text not null,
        invoice_hash text not null,
        xml text not null,
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      )
    `);
  });

  afterAll(async () => {
    await pool.query(`drop schema ${schema} cascade`);
    await pool.end();
  });

  it("reports a due pending invoice and records the bookkeeping", async () => {
    await insertInvoice("inv_ok");
    const result = await withTx((ex) =>
      processPendingReports(ex, {
        now: NOW,
        report: () => Promise.resolve({ status: "reported", response: { ok: true } }),
      }),
    );
    expect(result.reported).toContain("inv_ok");

    const row = await rowOf("inv_ok");
    expect(row.status).toBe("reported");
    expect(row.attempts).toBe(1);
    expect(row.reported_at).not.toBeNull();
    expect(row.zatca_response).toEqual({ ok: true });
  });

  it("marks a definitive rejection as rejected", async () => {
    await insertInvoice("inv_rej");
    const result = await withTx((ex) =>
      processPendingReports(ex, {
        now: NOW,
        report: () =>
          Promise.resolve({ status: "rejected", response: { error: "bad" } }),
      }),
    );
    expect(result.rejected).toContain("inv_rej");
    expect((await rowOf("inv_rej")).status).toBe("rejected");
  });

  it("keeps a transient failure pending with the attempt counted", async () => {
    await insertInvoice("inv_transient");
    const result = await withTx((ex) =>
      processPendingReports(ex, {
        now: NOW,
        report: () => Promise.reject(new Error("zatca is down")),
      }),
    );
    expect(result.errored).toContain("inv_transient");

    const row = await rowOf("inv_transient");
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.submitted_at).not.toBeNull();
  });

  it("skips invoices whose backoff has not elapsed", async () => {
    await insertInvoice("inv_backoff", {
      attempts: 2,
      submitted_at: new Date(NOW.getTime() - 1000),
    });
    let calls = 0;
    const result = await withTx((ex) =>
      processPendingReports(ex, {
        now: NOW,
        report: () => {
          calls += 1;
          return Promise.resolve({ status: "reported" as const, response: {} });
        },
      }),
    );
    expect(result.skipped).toContain("inv_backoff");
    expect(calls).toBe(0);
    expect((await rowOf("inv_backoff")).status).toBe("pending");
  });

  it("fails invoices that outlived the 24h window without reporting them", async () => {
    await insertInvoice("inv_expired", {
      created_at: new Date(NOW.getTime() - REPORTING_WINDOW_MS - 60_000),
      attempts: 3,
      submitted_at: new Date(NOW.getTime() - MAX_BACKOFF_MS - 1),
    });
    let calls = 0;
    const result = await withTx((ex) =>
      processPendingReports(ex, {
        now: NOW,
        report: () => {
          calls += 1;
          return Promise.resolve({ status: "reported" as const, response: {} });
        },
      }),
    );
    expect(result.failed).toContain("inv_expired");
    expect(calls).toBe(0);
    expect((await rowOf("inv_expired")).status).toBe("failed");
  });

  it("never touches reported/rejected/failed invoices", async () => {
    await insertInvoice("inv_done", { status: "reported" });
    const result = await withTx((ex) =>
      processPendingReports(ex, {
        now: NOW,
        report: () => Promise.resolve({ status: "reported" as const, response: {} }),
      }),
    );
    expect([
      ...result.reported,
      ...result.rejected,
      ...result.failed,
      ...result.skipped,
      ...result.errored,
    ]).not.toContain("inv_done");
  });

  it("is exactly-once across concurrent runs (SKIP LOCKED claim)", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `inv_conc_${i}`);
    for (const id of ids) await insertInvoice(id);

    const reportedBy: Record<string, number> = {};
    const run = () =>
      withTx((ex) =>
        processPendingReports(ex, {
          now: NOW,
          report: async (row) => {
            reportedBy[row.id] = (reportedBy[row.id] ?? 0) + 1;
            // hold the row long enough for the runs to overlap
            await new Promise((r) => setTimeout(r, 25));
            return { status: "reported" as const, response: {} };
          },
        }),
      );

    const [a, b, c] = await Promise.all([run(), run(), run()]);

    const allReported = [...a.reported, ...b.reported, ...c.reported].filter(
      (id) => id.startsWith("inv_conc_"),
    );
    expect(allReported.sort()).toEqual([...ids].sort());
    // No invoice was ever reported twice.
    for (const id of ids) expect(reportedBy[id]).toBe(1);
  });
});
