import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260611092832 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "zatca_invoice" drop constraint if exists "zatca_invoice_uuid_unique";`);
    this.addSql(`alter table if exists "zatca_invoice" drop constraint if exists "zatca_invoice_icv_unique";`);
    this.addSql(`alter table if exists "zatca_invoice" drop constraint if exists "zatca_invoice_order_id_unique";`);
    this.addSql(`create table if not exists "zatca_credential" ("id" text not null, "environment" text check ("environment" in ('sandbox', 'simulation', 'production')) not null, "vat_number" text not null, "egs_serial_number" text not null, "org_name" text not null, "org_address" text not null, "crn" text not null, "private_key" text null, "csr" text null, "compliance_csid" text null, "production_csid" text null, "certificate" text null, "status" text check ("status" in ('not_onboarded', 'compliance', 'production')) not null default 'not_onboarded', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "zatca_credential_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_zatca_credential_deleted_at" ON "zatca_credential" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "zatca_invoice" ("id" text not null, "order_id" text not null, "invoice_type" text check ("invoice_type" in ('simplified')) not null default 'simplified', "uuid" text not null, "icv" integer not null, "pih" text not null, "invoice_hash" text not null, "xml" text not null, "qr_code" text null, "status" text check ("status" in ('pending', 'reported', 'rejected', 'failed')) not null default 'pending', "zatca_response" jsonb null, "submitted_at" timestamptz null, "reported_at" timestamptz null, "attempts" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "zatca_invoice_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_zatca_invoice_deleted_at" ON "zatca_invoice" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_zatca_invoice_order_id_unique" ON "zatca_invoice" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_zatca_invoice_icv_unique" ON "zatca_invoice" ("icv") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_zatca_invoice_uuid_unique" ON "zatca_invoice" ("uuid") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_zatca_invoice_status" ON "zatca_invoice" ("status") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "zatca_credential" cascade;`);

    this.addSql(`drop table if exists "zatca_invoice" cascade;`);
  }

}
