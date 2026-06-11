import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260611201000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "zatca_invoice" add column if not exists "document_type" text check ("document_type" in ('invoice', 'credit_note', 'debit_note')) not null default 'invoice';`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" add column if not exists "source_type" text check ("source_type" in ('order', 'refund', 'return', 'order_cancel', 'order_edit')) not null default 'order';`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" add column if not exists "source_id" text null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" add column if not exists "parent_invoice_id" text null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" add column if not exists "billing_reference" text null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" add column if not exists "reason" text null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" add column if not exists "lines_snapshot" jsonb null;`,
    );

    this.addSql(
      `update "zatca_invoice" set "document_type" = 'invoice' where "document_type" is null;`,
    );
    this.addSql(
      `update "zatca_invoice" set "source_type" = 'order' where "source_type" is null;`,
    );
    this.addSql(
      `update "zatca_invoice" set "source_id" = "order_id" where "source_id" is null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "source_id" set not null;`,
    );

    this.addSql(
      `alter table if exists "zatca_invoice" drop constraint if exists "zatca_invoice_order_id_unique";`,
    );
    this.addSql(`drop index if exists "IDX_zatca_invoice_order_id_unique";`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_zatca_invoice_order_id" ON "zatca_invoice" ("order_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_zatca_invoice_source_type_source_id_unique" ON "zatca_invoice" ("source_type", "source_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_zatca_invoice_parent_invoice_id" ON "zatca_invoice" ("parent_invoice_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_zatca_invoice_status_document_type" ON "zatca_invoice" ("status", "document_type") WHERE deleted_at IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop index if exists "IDX_zatca_invoice_status_document_type";`,
    );
    this.addSql(
      `drop index if exists "IDX_zatca_invoice_parent_invoice_id";`,
    );
    this.addSql(
      `drop index if exists "IDX_zatca_invoice_source_type_source_id_unique";`,
    );
    this.addSql(`drop index if exists "IDX_zatca_invoice_order_id";`);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_zatca_invoice_order_id_unique" ON "zatca_invoice" ("order_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" drop column if exists "lines_snapshot";`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" drop column if exists "reason";`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" drop column if exists "billing_reference";`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" drop column if exists "parent_invoice_id";`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" drop column if exists "source_id";`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" drop column if exists "source_type";`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" drop column if exists "document_type";`,
    );
  }
}
