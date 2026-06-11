import { model } from "@medusajs/framework/utils";

/**
 * The EGS unit (E-invoicing Generation Solution) — the cryptographic identity
 * onboarded with ZATCA. Singleton in v1 (ADR-0006: single EGS).
 *
 * 🔒 `private_key`, `compliance_csid`, `production_csid` hold AES-256-GCM
 * ciphertext produced by core `secrets` in the service layer — never
 * plaintext, never logged, never returned from an API route (ADR-0004).
 * The columns themselves are plain text; encryption is a service concern.
 */
const ZatcaCredential = model.define("zatca_credential", {
  id: model.id({ prefix: "zatcred" }).primaryKey(),
  /** Environment this EGS was onboarded against. */
  environment: model.enum(["sandbox", "simulation", "production"]),
  /** 15-digit VAT registration number. */
  vat_number: model.text(),
  /** EGS unit serial — embedded in the CSR. */
  egs_serial_number: model.text(),
  org_name: model.text(),
  org_address: model.text(),
  /** Commercial registration number. */
  crn: model.text(),
  /** 🔒 encrypted — EC private key generated during the CSR step. */
  private_key: model.text().nullable(),
  /** The generated CSR (PEM, not secret). */
  csr: model.text().nullable(),
  /** 🔒 encrypted — Compliance CSID (binary token + secret). */
  compliance_csid: model.text().nullable(),
  /** 🔒 encrypted — Production CSID (binary token + secret). */
  production_csid: model.text().nullable(),
  /** X.509 certificate returned by ZATCA (public, not secret). */
  certificate: model.text().nullable(),
  status: model
    .enum(["not_onboarded", "compliance", "production"])
    .default("not_onboarded"),
});

export default ZatcaCredential;
