import { MedusaService } from "@medusajs/framework/utils";
import { KsaError, KsaErrorCodes, secrets } from "@medusa-ksa/core";

import { runComplianceChecks } from "./lib/compliance-checks";
import { FatooraClient } from "./lib/fatoora-client";
import {
  onboardCompliance,
  type OnboardComplianceInput,
  type OnboardComplianceResult,
} from "./lib/onboard-compliance";
import {
  onboardProduction,
  type OnboardProductionResult,
} from "./lib/onboard-production";
import ZatcaCredential from "./models/zatca-credential";
import ZatcaInvoice from "./models/zatca-invoice";
import { validateZatcaOptions } from "./loaders/validate-config";
import type { ZatcaModuleOptions } from "./types";
import type { ZatcaSupplier } from "./lib/xml-builder";

/** Org details collected by the wizard (PRD §1.6) — everything non-secret. */
export interface OnboardEgsInput
  extends Omit<OnboardComplianceInput, "environment"> {
  /** Supplier party for the compliance-check sample documents. */
  supplier: ZatcaSupplier;
}

/** Non-secret status view — the only thing API routes ever return (ADR-0004). */
export interface ZatcaOnboardingStatus {
  status: "not_onboarded" | "compliance" | "production";
  environment: string;
  vat_number?: string;
  org_name?: string;
  egs_serial_number?: string;
}

/**
 * Main module service. `MedusaService` auto-generates the CRUD surface for
 * both models (createZatcaInvoices, listZatcaCredentials, …).
 *
 * Credential encryption is a service concern: every secret is encrypted with
 * the module's `encryptionKey` before it reaches a row, and decrypted
 * just-in-time in memory. Secrets never appear in returns of the onboarding
 * methods — those surface status + request ids only.
 */
class ZatcaModuleService extends MedusaService({
  ZatcaCredential,
  ZatcaInvoice,
}) {
  protected readonly options: ZatcaModuleOptions;

  constructor(container: Record<string, unknown>, options?: unknown) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [Record<string, unknown>]));
    this.options = validateZatcaOptions(options ?? {});
  }

  /** The singleton EGS credential row (v1: single EGS, ADR-0006). */
  private async credentialRow() {
    const [row] = await this.listZatcaCredentials(
      { environment: this.options.environment },
      { take: 1 },
    );
    return row;
  }

  async getOnboardingStatus(): Promise<ZatcaOnboardingStatus> {
    const row = await this.credentialRow();
    if (!row) {
      return { status: "not_onboarded", environment: this.options.environment };
    }
    return {
      status: row.status,
      environment: row.environment,
      vat_number: row.vat_number,
      org_name: row.org_name,
      egs_serial_number: row.egs_serial_number,
    };
  }

  /**
   * Onboarding step 1 (T4.3): CSR → Compliance CSID. Creates (or replaces —
   * re-onboarding rotates credentials, ADR-0004) the singleton credential.
   */
  async startOnboarding(
    input: Omit<OnboardEgsInput, "supplier">,
  ): Promise<OnboardComplianceResult> {
    const existing = await this.credentialRow();

    return onboardCompliance(
      { ...input, environment: this.options.environment },
      {
        client: new FatooraClient({ environment: this.options.environment }),
        encryptionKey: this.options.encryptionKey,
        persist: async (record) => {
          if (existing) {
            await this.updateZatcaCredentials({
              id: existing.id,
              ...record,
              production_csid: null,
            });
          } else {
            await this.createZatcaCredentials(record);
          }
        },
      },
    );
  }

  /** Onboarding step 2 (T4.4): the required Simplified-document checks. */
  async runOnboardingComplianceChecks(supplier: ZatcaSupplier): Promise<void> {
    const { ccsid, privateKey } = await this.decryptComplianceCredentials();

    await runComplianceChecks({
      client: new FatooraClient({
        environment: this.options.environment,
        credentials: { certificate: ccsid.certificate, secret: ccsid.secret },
      }),
      certificate: ccsid.certificate,
      privateKey,
      supplier,
    });
  }

  /** Onboarding step 3 (T4.5): compliance request id → Production CSID. */
  async completeOnboarding(
    complianceRequestId: string,
  ): Promise<OnboardProductionResult> {
    const row = await this.requireCredentialRow("compliance");
    const { ccsid } = await this.decryptComplianceCredentials();

    return onboardProduction(
      { complianceRequestId },
      {
        client: new FatooraClient({
          environment: this.options.environment,
          credentials: { certificate: ccsid.certificate, secret: ccsid.secret },
        }),
        encryptionKey: this.options.encryptionKey,
        persist: async (update) => {
          await this.updateZatcaCredentials({ id: row.id, ...update });
        },
      },
    );
  }

  private async requireCredentialRow(expectedStatus?: string) {
    const row = await this.credentialRow();
    if (!row || (expectedStatus && row.status !== expectedStatus)) {
      throw new KsaError(
        `EGS credential is ${row?.status ?? "missing"} — run the previous onboarding step first.`,
        { prefix: "zatca", code: KsaErrorCodes.INVALID_INPUT },
      );
    }
    return row;
  }

  /** Decrypt the CCSID + private key just-in-time; never leaves memory. */
  private async decryptComplianceCredentials() {
    const row = await this.requireCredentialRow();
    if (!row.compliance_csid || !row.private_key) {
      throw new KsaError(
        "EGS has no Compliance CSID yet — run the compliance step first.",
        { prefix: "zatca", code: KsaErrorCodes.INVALID_INPUT },
      );
    }
    const ccsid = JSON.parse(
      secrets.decrypt(row.compliance_csid, this.options.encryptionKey),
    ) as { requestId: string; certificate: string; secret: string };
    const privateKey = secrets.decrypt(
      row.private_key,
      this.options.encryptionKey,
    );
    return { row, ccsid, privateKey };
  }
}

export default ZatcaModuleService;
