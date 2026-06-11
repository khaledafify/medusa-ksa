/**
 * Module options — the non-secret bootstrap config (PRD §2, SPEC §6).
 *
 * Everything else (keys, CSIDs, certificate, org details) is generated through
 * the onboarding handshake and stored encrypted in `ZatcaCredential`, never in
 * env or `medusa-config.ts`.
 */

/** ZATCA Fatoora environments. Selected via `ZATCA_ENV`. */
export const ZATCA_ENVIRONMENTS = [
  "sandbox",
  "simulation",
  "production",
] as const;

export type ZatcaEnvironment = (typeof ZATCA_ENVIRONMENTS)[number];

/**
 * When an invoice is issued for an order. `payment_captured` is the default;
 * `order_placed` suits COD / authorize-only stores (PRD §1.3).
 */
export const ZATCA_TRIGGERS = ["payment_captured", "order_placed"] as const;

export type ZatcaTrigger = (typeof ZATCA_TRIGGERS)[number];

export interface ZatcaModuleOptions {
  /** ZATCA environment the Fatoora client targets. Env: `ZATCA_ENV`. */
  environment: ZatcaEnvironment;
  /**
   * 32-byte base64 key for encrypting EGS credentials at rest (AES-256-GCM
   * via core `secrets`). Env: `ZATCA_ENCRYPTION_KEY`. Length-validated at
   * boot — the server refuses to start without a valid key.
   */
  encryptionKey: string;
  /** Invoice issuance trigger. Env: `ZATCA_TRIGGER`. */
  trigger: ZatcaTrigger;
}
