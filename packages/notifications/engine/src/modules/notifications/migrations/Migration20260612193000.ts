import { Migration } from "@medusajs/framework/mikro-orm/migrations";

import { CHANNEL, LOCALES, TABLES } from "../constants.js";

function table(name: string): string {
  return `"${name}"`;
}

/** Creates the notification template table and uniqueness constraint. */
export class Migration20260612193000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists ${table(TABLES.NOTIFICATION_TEMPLATE)} (` +
        `"id" text not null, ` +
        `"channel" text not null default '${CHANNEL}', ` +
        `"event" text not null, ` +
        `"locale" text not null default '${LOCALES.AR}', ` +
        `"body" text not null, ` +
        `"enabled" boolean not null default true, ` +
        `"from" text null, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "notification_template_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS ` +
        `"IDX_notification_template_channel_event_locale_unique" ` +
        `ON ${table(TABLES.NOTIFICATION_TEMPLATE)} ` +
        `("channel", "event", "locale") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_template_event" ` +
        `ON ${table(TABLES.NOTIFICATION_TEMPLATE)} ("event") ` +
        `WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_template_enabled" ` +
        `ON ${table(TABLES.NOTIFICATION_TEMPLATE)} ("enabled") ` +
        `WHERE deleted_at IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop table if exists ${table(TABLES.NOTIFICATION_TEMPLATE)} cascade;`,
    );
  }
}
