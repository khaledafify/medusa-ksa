import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260611122033 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "zatca_credential" add column if not exists "supplier" jsonb null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "zatca_credential" drop column if exists "supplier";`,
    );
  }
}
