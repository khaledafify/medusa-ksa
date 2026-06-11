import { secrets } from "@medusa-ksa/core";

import type { ZatcaEnvironment } from "../types";
import { generateEgsKeyAndCsr, type EgsCsrInput } from "./csr";
import type { IssuedCsid } from "./fatoora-client";

/**
 * Compliance-CSID onboarding step (T4.3, SPEC §4 steps 1–3):
 * generate keypair + CSR → exchange CSR + portal OTP for the Compliance CSID
 * → persist everything with secrets encrypted at rest (ADR-0004).
 *
 * 🔒 The private key and the CCSID (certificate + API secret) are encrypted
 * with AES-256-GCM (core `secrets`) before they reach the persist callback.
 * The function's return value is secret-free by construction so API routes
 * can forward it verbatim.
 */

export interface OnboardComplianceInput extends EgsCsrInput {
  /** Short-lived OTP the merchant copies from the Fatoora portal. */
  otp: string;
  /** Commercial registration number (stored on the credential). */
  crn: string;
}

/** Row shape persisted into `ZatcaCredential` (encrypted fields marked 🔒). */
export interface ComplianceCredentialRecord {
  environment: ZatcaEnvironment;
  vat_number: string;
  egs_serial_number: string;
  org_name: string;
  org_address: string;
  crn: string;
  /** 🔒 AES-256-GCM ciphertext of the SEC1 private-key PEM. */
  private_key: string;
  /** Generated CSR (PEM — public by nature). */
  csr: string;
  /** 🔒 AES-256-GCM ciphertext of `{ requestId, certificate, secret }`. */
  compliance_csid: string;
  /** CSID certificate body (public). */
  certificate: string;
  status: "compliance";
}

/** Decrypted CCSID payload — only ever materialized in memory. */
export interface CsidSecret {
  requestId: string;
  certificate: string;
  secret: string;
}

export interface OnboardComplianceDeps {
  client: {
    requestComplianceCsid: (input: { csr: string; otp: string }) => Promise<IssuedCsid>;
  };
  /** 32-byte (base64) key — validated by core `secrets` before any network call. */
  encryptionKey: string;
  persist: (record: ComplianceCredentialRecord) => Promise<void>;
}

export interface OnboardComplianceResult {
  /** Compliance request id — needed later for the Production CSID exchange. */
  requestId: string;
  status: "compliance";
}

export async function onboardCompliance(
  input: OnboardComplianceInput,
  deps: OnboardComplianceDeps,
): Promise<OnboardComplianceResult> {
  // Fail fast on a bad key — before minting keys or spending the OTP.
  secrets.encrypt("key-check", deps.encryptionKey);

  const { privateKey, csr } = await generateEgsKeyAndCsr(input);

  const csid = await deps.client.requestComplianceCsid({ csr, otp: input.otp });

  const csidSecret: CsidSecret = {
    requestId: csid.requestId,
    certificate: csid.certificate,
    secret: csid.secret,
  };

  await deps.persist({
    environment: input.environment,
    vat_number: input.vatNumber,
    egs_serial_number: `1-${input.solutionName}|2-${input.model}|3-${input.serialNumber}`,
    org_name: input.organizationName,
    org_address: input.address,
    crn: input.crn,
    private_key: secrets.encrypt(privateKey, deps.encryptionKey),
    csr,
    compliance_csid: secrets.encrypt(JSON.stringify(csidSecret), deps.encryptionKey),
    certificate: csid.certificate,
    status: "compliance",
  });

  return { requestId: csid.requestId, status: "compliance" };
}
