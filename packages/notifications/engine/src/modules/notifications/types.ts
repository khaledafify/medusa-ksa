import type { CHANNEL, EVENTS, LOCALES } from "./constants";

/** Supported notification channel. */
export type NotificationChannel = typeof CHANNEL;

/** Supported order notification event name. */
export type NotificationEvent = (typeof EVENTS)[keyof typeof EVENTS];

/** Supported template locale. */
export type NotificationLocale = (typeof LOCALES)[keyof typeof LOCALES];

/** Persisted notification template row. */
export interface NotificationTemplateDTO {
  id: string;
  channel: string;
  event: string;
  locale: string;
  body: string;
  enabled: boolean;
  from: string | null;
}

/** Input used to create a notification template. */
export interface CreateNotificationTemplateInput {
  channel: NotificationChannel;
  event: NotificationEvent;
  locale: NotificationLocale;
  body: string;
  enabled: boolean;
  from?: string | null;
}

/** Input used to resolve a template by channel, event, and locale. */
export interface ResolveNotificationTemplateInput {
  channel: string;
  event: string;
  locale: string;
}

/** Template filters supported by repository-shaped seed and resolve helpers. */
export interface NotificationTemplateFilters {
  channel: string;
  event: string;
  locale: string;
}

/** Repository-shaped dependency used by the seed helper. */
export interface NotificationTemplateSeedRepository {
  listNotificationTemplates(
    filters: NotificationTemplateFilters,
    config?: { take?: number },
  ): Promise<NotificationTemplateDTO[]>;
  createNotificationTemplates(
    data: CreateNotificationTemplateInput,
  ): Promise<NotificationTemplateDTO>;
}

/** Repository-shaped dependency used by template resolution. */
export interface NotificationTemplateResolverRepository {
  listNotificationTemplates(
    filters: NotificationTemplateFilters,
    config?: { take?: number },
  ): Promise<NotificationTemplateDTO[]>;
}

/** Result returned by idempotent default seeding. */
export interface SeedNotificationTemplatesResult {
  created: string[];
  skipped: string[];
}

/** Successful template resolution result. */
export interface FoundNotificationTemplateResolution {
  status: "found";
  template: NotificationTemplateDTO;
}

/** Disabled template resolution result. */
export interface DisabledNotificationTemplateResolution {
  status: "disabled";
  template: NotificationTemplateDTO;
}

/** Missing template resolution result. */
export interface MissingNotificationTemplateResolution {
  status: "missing";
  template: null;
}

/** Template resolution outcome consumed by subscribers and APIs. */
export type NotificationTemplateResolution =
  | FoundNotificationTemplateResolution
  | DisabledNotificationTemplateResolution
  | MissingNotificationTemplateResolution;
