import { secrets } from "@medusa-ksa/core";

import type { IssuedCsid } from "./fatoora-client";
import type { CsidSecret } from "./onboard-compliance";

/**
 * Production-CSID onboarding step (T4.5, SPEC §4 step 5): after the
 * compliance checks pass, exchange the compliance request id for the
 * Production CSID and flip the credential to `production`.
 *
 * 🔒 The PCSID (certificate + API secret) is encrypted before it reaches the
 * persist callback; the return value is secret-free by construction.
 */

/** Column updates applied to the existing `ZatcaCredential` row. */
export interface ProductionCredentialUpdate {
  /** 🔒 AES-256-GCM ciphertext of `{ requestId, certificate, secret }`. */
  production_csid: string;
  /** PCSID certificate body (public) — used for signing from now on. */
  certificate: string;
  status: "production";
}

export interface OnboardProductionDeps {
  /** Fatoora client authenticated with the Compliance CSID. */
  client: {
    requestProductionCsid: (input: {
      complianceRequestId: string;
    }) => Promise<IssuedCsid>;
  };
  encryptionKey: string;
  persist: (update: ProductionCredentialUpdate) => Promise<void>;
}

export interface OnboardProductionResult {
  requestId: string;
  status: "production";
}

export async function onboardProduction(
  input: { complianceRequestId: string },
  deps: OnboardProductionDeps,
): Promise<OnboardProductionResult> {
  // Fail fast on a bad key before spending the one-shot exchange.
  secrets.encrypt("key-check", deps.encryptionKey);

  const csid = await deps.client.requestProductionCsid({
    complianceRequestId: input.complianceRequestId,
  });

  const csidSecret: CsidSecret = {
    requestId: csid.requestId,
    certificate: csid.certificate,
    secret: csid.secret,
  };

  await deps.persist({
    production_csid: secrets.encrypt(JSON.stringify(csidSecret), deps.encryptionKey),
    certificate: csid.certificate,
    status: "production",
  });

  return { requestId: csid.requestId, status: "production" };
}
