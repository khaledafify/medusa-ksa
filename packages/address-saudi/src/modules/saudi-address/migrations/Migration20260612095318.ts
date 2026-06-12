import { Migration } from "@medusajs/framework/mikro-orm/migrations";

import { TABLE } from "../constants.js";
import { loadSaudiGeoDataset } from "../data.js";
import { buildSaudiGeoSeedSql } from "../seed-sql.js";

function table(name: string): string {
  return `"${name}"`;
}

export class Migration20260612095318 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists ${table(TABLE.REGION)} (` +
        `"id" text not null, ` +
        `"code" text not null, ` +
        `"name_ar" text not null, ` +
        `"name_en" text not null, ` +
        `"sort_weight" integer not null default 0, ` +
        `"capital_city_code" text null, ` +
        `"population" integer null, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "saudi_address_region_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create table if not exists ${table(TABLE.CITY)} (` +
        `"id" text not null, ` +
        `"code" text not null, ` +
        `"region_code" text not null, ` +
        `"name_ar" text not null, ` +
        `"name_en" text not null, ` +
        `"sort_weight" integer not null default 0, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "saudi_address_city_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create table if not exists ${table(TABLE.DISTRICT)} (` +
        `"id" text not null, ` +
        `"code" text not null, ` +
        `"city_code" text not null, ` +
        `"region_code" text not null, ` +
        `"name_ar" text not null, ` +
        `"name_en" text not null, ` +
        `"sort_weight" integer not null default 0, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "saudi_address_district_pkey" primary key ("id"));`,
    );

    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_saudi_address_region_code_unique" ` +
        `ON ${table(TABLE.REGION)} ("code") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_saudi_address_city_code_unique" ` +
        `ON ${table(TABLE.CITY)} ("code") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_saudi_address_district_code_unique" ` +
        `ON ${table(TABLE.DISTRICT)} ("code") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_saudi_address_city_region" ` +
        `ON ${table(TABLE.CITY)} ("region_code") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_saudi_address_district_city" ` +
        `ON ${table(TABLE.DISTRICT)} ("city_code") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_saudi_address_district_region" ` +
        `ON ${table(TABLE.DISTRICT)} ("region_code") WHERE deleted_at IS NULL;`,
    );

    for (const sql of buildSaudiGeoSeedSql(loadSaudiGeoDataset())) {
      this.addSql(sql);
    }
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists ${table(TABLE.DISTRICT)} cascade;`);
    this.addSql(`drop table if exists ${table(TABLE.CITY)} cascade;`);
    this.addSql(`drop table if exists ${table(TABLE.REGION)} cascade;`);
  }
}
