import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260611235000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "icv" drop not null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "pih" drop not null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "invoice_hash" drop not null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "xml" drop not null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `delete from "zatca_invoice" where "icv" is null or "pih" is null or "invoice_hash" is null or "xml" is null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "xml" set not null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "invoice_hash" set not null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "pih" set not null;`,
    );
    this.addSql(
      `alter table if exists "zatca_invoice" alter column "icv" set not null;`,
    );
  }
}
