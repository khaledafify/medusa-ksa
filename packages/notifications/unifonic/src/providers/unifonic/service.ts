import type { NotificationTypes } from "@medusajs/framework/types";
import { AbstractNotificationProviderService } from "@medusajs/framework/utils";

import {
  KsaError,
  KsaErrorCodes,
  redactSecrets,
  toMedusaError,
} from "@medusa-ksa/core";

import { UnifonicClient } from "./client.js";
import {
  CHANNEL,
  EMPTY_STRING,
  ERROR_MESSAGES,
  NOTIFICATION_FIELDS,
  PROVIDER_ID,
  UNIFONIC_PREFIX,
} from "./constants.js";
import { resolveUnifonicOptions } from "./options.js";
import { normalizeRecipient } from "./recipient.js";
import type { ResolvedUnifonicOptions } from "./options.js";
import type { UnifonicSendInput } from "./types.js";

/**
 * Medusa v2 notification provider for Unifonic SMS.
 *
 * The service boundary owns Medusa DTO mapping only: it validates the rendered
 * SMS input, normalizes the recipient, resolves the Sender ID, delegates the
 * transport to {@link UnifonicClient}, and maps failures to Medusa errors.
 */
export class UnifonicNotificationProviderService extends AbstractNotificationProviderService {
  static override identifier = PROVIDER_ID;

  protected readonly options_: ResolvedUnifonicOptions;
  protected readonly client_: UnifonicClient;

  /** Fail-fast boot validation through the shared core loader contract. */
  static override validateOptions(options: Record<string, unknown>): void {
    resolveUnifonicOptions(options);
  }

  constructor(
    _cradle: Record<string, unknown>,
    config: Record<string, unknown>,
  ) {
    super();

    this.options_ = resolveUnifonicOptions(config);
    this.client_ = new UnifonicClient({
      baseUrl: this.options_.baseUrl,
      timeoutMs: this.options_.timeoutMs,
      retry: this.options_.retry,
    });
  }

  /**
   * Send an already-rendered SMS through Unifonic and return its provider id.
   */
  override async send(
    notification: NotificationTypes.ProviderSendNotificationDTO,
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    try {
      const input = this.toSendInput(notification);
      const result = await this.client_.sendSms(input);
      return { id: result.id };
    } catch (err) {
      throw toMedusaError(this.redactAppSid(err));
    }
  }

  /** Map Medusa's notification DTO to the Unifonic transport input. */
  private toSendInput(
    notification: NotificationTypes.ProviderSendNotificationDTO,
  ): UnifonicSendInput {
    if (notification.channel !== CHANNEL) {
      throw new KsaError(ERROR_MESSAGES.UNSUPPORTED_CHANNEL, {
        prefix: UNIFONIC_PREFIX,
        code: KsaErrorCodes.INVALID_INPUT,
      });
    }

    const body = notification.content?.[NOTIFICATION_FIELDS.TEXT];
    if (typeof body !== "string" || body.trim() === EMPTY_STRING) {
      throw new KsaError(ERROR_MESSAGES.MISSING_TEXT, {
        prefix: UNIFONIC_PREFIX,
        code: KsaErrorCodes.INVALID_INPUT,
      });
    }

    return {
      appSid: this.options_.appSid,
      senderId: this.resolveSender(notification.from),
      body,
      recipient: normalizeRecipient(notification.to),
    };
  }

  /** Resolve the per-message sender override before falling back to config. */
  private resolveSender(from: string | null | undefined): string {
    const senderId =
      from?.trim() !== EMPTY_STRING && from !== null && from !== undefined
        ? from.trim()
        : this.options_.senderId.trim();

    if (senderId === EMPTY_STRING) {
      throw new KsaError(ERROR_MESSAGES.MISSING_SENDER, {
        prefix: UNIFONIC_PREFIX,
        code: KsaErrorCodes.INVALID_INPUT,
      });
    }

    return senderId;
  }

  /** Redact AppSid defensively before mapping provider failures to Medusa. */
  private redactAppSid(err: unknown): unknown {
    if (KsaError.isKsaError(err)) {
      return new KsaError(redactSecrets(err.rawMessage, [this.options_.appSid]), {
        prefix: err.prefix ?? UNIFONIC_PREFIX,
        code: err.code,
        cause: err,
      });
    }

    if (err instanceof Error) {
      return new KsaError(redactSecrets(err.message, [this.options_.appSid]), {
        prefix: UNIFONIC_PREFIX,
        code: KsaErrorCodes.UNEXPECTED,
        cause: err,
      });
    }

    return err;
  }
}
