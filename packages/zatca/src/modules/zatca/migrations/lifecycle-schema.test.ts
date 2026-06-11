import { randomBytes } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Migration20260611201000 } from "./Migration20260611201000";

const databaseUrl =
  process.env.ZATCA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

async function migrationSql(
  direction: "up" | "down",
): Promise<string[]> {
  const statements: string[] = [];
  const migration = Object.create(
    Migration20260611201000.prototype,
  ) as Migration20260611201000 & {
    addSql: (statement: unknown) => void;
  };
  migration.addSql = (statement) => statements.push(String(statement));
  await migration[direction]();
  return statements;
}

describe.runIf(databaseUrl)("ZATCA lifecycle schema migration", () => {
  const schema = `zatca_lifecycle_test_${randomBytes(4).toString("hex")}`;
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    client = await pool.connect();
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}`);
    await client.query(
      `create table zatca_invoice (
         id text primary key,
         order_id text not null,
         invoice_type text not null default 'simplified',
         uuid text not null,
         icv integer not null,
         pih text not null,
         invoice_hash text not null,
         xml text not null,
         qr_code text,
         status text not null default 'pending',
         zatca_response jsonb,
         submitted_at timestamptz,
         reported_at timestamptz,
         attempts integer not null default 0,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now(),
         deleted_at timestamptz
       )`,
    );
    await client.query(
      `CREATE UNIQUE INDEX "IDX_zatca_invoice_order_id_unique" ON zatca_invoice (order_id) WHERE deleted_at IS NULL`,
    );
    await client.query(
      `insert into zatca_invoice
         (id, order_id, invoice_type, uuid, icv, pih, invoice_hash, xml, status)
       values
         ('zatinv_existing', 'order_existing', 'simplified', 'uuid-existing', 1, 'seed', 'hash-1', '<xml/>', 'reported')`,
    );
  });

  afterAll(async () => {
    client.release();
    await pool.query(`drop schema ${schema} cascade`);
    await pool.end();
  });

  it("backfills old invoice rows and replaces order uniqueness with source uniqueness", async () => {
    for (const statement of await migrationSql("up")) {
      await client.query(statement);
    }

    const { rows: existingRows } = await client.query<{
      document_type: string;
      source_type: string;
      source_id: string;
      lines_snapshot: Record<string, unknown> | null;
    }>(
      `select document_type, source_type, source_id, lines_snapshot
       from zatca_invoice
       where id = 'zatinv_existing'`,
    );
    expect(existingRows[0]).toEqual({
      document_type: "invoice",
      source_type: "order",
      source_id: "order_existing",
      lines_snapshot: null,
    });

    await client.query(
      `insert into zatca_invoice
         (id, order_id, document_type, invoice_type, source_type, source_id,
          parent_invoice_id, billing_reference, reason, uuid, icv, pih,
          invoice_hash, xml, status)
       values
         ('zatinv_credit_1', 'order_existing', 'credit_note', 'simplified',
          'refund', 'refund_1', 'zatinv_existing', 'SME00010', 'Refund',
          'uuid-credit-1', 2, 'hash-1', 'hash-2', '<xml/>', 'pending')`,
    );
    await client.query(
      `insert into zatca_invoice
         (id, order_id, document_type, invoice_type, source_type, source_id,
          parent_invoice_id, billing_reference, reason, uuid, icv, pih,
          invoice_hash, xml, status)
       values
         ('zatinv_credit_2', 'order_existing', 'credit_note', 'simplified',
          'refund', 'refund_2', 'zatinv_existing', 'SME00010', 'Refund',
          'uuid-credit-2', 3, 'hash-2', 'hash-3', '<xml/>', 'pending')`,
    );

    await expect(
      client.query(
        `insert into zatca_invoice
           (id, order_id, document_type, invoice_type, source_type, source_id,
            uuid, icv, pih, invoice_hash, xml, status)
         values
           ('zatinv_dup', 'order_other', 'credit_note', 'simplified',
            'refund', 'refund_2', 'uuid-dup', 4, 'hash-3', 'hash-4', '<xml/>', 'pending')`,
      ),
    ).rejects.toThrow(/duplicate key value/);

    const { rows } = await client.query<{ count: string }>(
      `select count(*) from zatca_invoice where order_id = 'order_existing'`,
    );
    expect(rows[0]!.count).toBe("3");
  });
});
