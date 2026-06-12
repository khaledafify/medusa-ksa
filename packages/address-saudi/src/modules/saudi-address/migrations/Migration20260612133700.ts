import { Migration } from "@medusajs/framework/mikro-orm/migrations";

import { TABLE } from "../constants.js";

function table(name: string): string {
  return `"${name}"`;
}

export class Migration20260612133700 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists ${table(TABLE.CACHE)} (` +
        `"id" text not null, ` +
        `"cache_key" text not null, ` +
        `"query_type" text not null, ` +
        `"payload" jsonb not null, ` +
        `"expires_at" timestamptz not null, ` +
        `"stale_expires_at" timestamptz not null, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "national_address_cache_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_national_address_cache_key_unique" ` +
        `ON ${table(TABLE.CACHE)} ("cache_key") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_national_address_cache_query_type" ` +
        `ON ${table(TABLE.CACHE)} ("query_type") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_national_address_cache_expires_at" ` +
        `ON ${table(TABLE.CACHE)} ("expires_at") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_national_address_cache_stale_expires_at" ` +
        `ON ${table(TABLE.CACHE)} ("stale_expires_at") WHERE deleted_at IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists ${table(TABLE.CACHE)} cascade;`);
  }
}
