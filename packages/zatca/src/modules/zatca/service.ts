import { MedusaService } from "@medusajs/framework/utils";
import { KsaError, KsaErrorCodes, secrets } from "@medusa-ksa/core";
import { runComplianceChecks } from "./lib/compliance-checks";
import { FatooraClient } from "./lib/fatoora-client";
import {
  generatePendingInvoice,
  type GenerateInvoiceInput,
  type PendingZatcaInvoiceRecord,
  type ZatcaLifecycleSourceType,
} from "./lib/generate-invoice";
import {
  onboardCompliance,
  type OnboardComplianceInput,
  type OnboardComplianceResult,
} from "./lib/onboard-compliance";
import {
  onboardProduction,
  type OnboardProductionResult,
} from "./lib/onboard-production";
import {
  processPendingReports,
  type ProcessResult,
} from "./lib/retry-reporting";
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

/**
 * Minimal structural slice of MikroORM's SqlEntityManager (registered as
 * `manager` in the module container) — keeps `@mikro-orm/*` out of our deps.
 */
interface ZatcaEntityManager {
  transactional<T>(cb: (txEm: ZatcaEntityManager) => Promise<T>): Promise<T>;
  execute(sql: string, params?: unknown[]): Promise<unknown[]>;
}

/** Non-secret status view — the only thing API routes ever return (ADR-0004). */
export interface ZatcaOnboardingStatus {
  status: "not_onboarded" | "compliance" | "production";
  environment: string;
  vat_number?: string;
  org_name?: string;
  egs_serial_number?: string;
}

export type GenerateLifecycleDocumentInput = Omit<
  GenerateInvoiceInput,
  "egsKey" | "certificate" | "privateKey" | "supplier"
>;

type PersistedPendingZatcaInvoice = { id: string } & PendingZatcaInvoiceRecord;

function sourceKey(input: GenerateLifecycleDocumentInput): {
  source_type: ZatcaLifecycleSourceType;
  source_id: string;
} {
  return {
    source_type: input.sourceType ?? "order",
    source_id: input.sourceId ?? input.orderId,
  };
}

function isSourceKeyConflict(error: unknown): boolean {
  const maybePgError = error as { code?: string; constraint?: string; message?: string };
  const text = `${maybePgError.constraint ?? ""}\n${maybePgError.message ?? ""}\n${String(error)}`;
  return (
    maybePgError.code === "23505" &&
    (text.includes("IDX_zatca_invoice_source_type_source_id_unique") ||
      text.includes("zatca_invoice_source_type_source_id_key") ||
      (text.includes("source_type") && text.includes("source_id")))
  );
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
  protected readonly manager: ZatcaEntityManager;

  constructor(container: Record<string, unknown>, options?: unknown) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [Record<string, unknown>]));
    this.options = validateZatcaOptions(options ?? {});
    this.manager = container.manager as ZatcaEntityManager;
  }

  /** The configured issuance trigger (PRD §1.3). */
  getTrigger(): ZatcaModuleOptions["trigger"] {
    return this.options.trigger;
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
  async startOnboarding(input: OnboardEgsInput): Promise<OnboardComplianceResult> {
    const existing = await this.credentialRow();
    const { supplier, ...orgInput } = input;

    return onboardCompliance(
      { ...orgInput, environment: this.options.environment },
      {
        client: new FatooraClient({ environment: this.options.environment }),
        encryptionKey: this.options.encryptionKey,
        persist: async (record) => {
          if (existing) {
            await this.updateZatcaCredentials({
              id: existing.id,
              ...record,
              supplier: supplier as unknown as Record<string, unknown>,
              production_csid: null,
            });
          } else {
            await this.createZatcaCredentials({
              ...record,
              supplier: supplier as unknown as Record<string, unknown>,
            });
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

  async generateLifecycleDocument(
    input: GenerateLifecycleDocumentInput,
  ): Promise<PersistedPendingZatcaInvoice> {
    const key = sourceKey(input);
    const [existing] = await this.listZatcaInvoices(key, { take: 1 });
    if (existing) {
      return existing as PersistedPendingZatcaInvoice;
    }

    const { row, privateKey } = await this.decryptProductionCredentials();
    const supplier = row.supplier as GenerateInvoiceInput["supplier"] | null;
    if (!supplier) {
      throw new KsaError(
        "EGS credential has no supplier party — re-run onboarding.",
        { prefix: "zatca", code: KsaErrorCodes.INVALID_INPUT },
      );
    }
    if (!row.certificate) {
      throw new KsaError(
        "EGS credential has no Production CSID certificate — complete onboarding first.",
        { prefix: "zatca", code: KsaErrorCodes.INVALID_INPUT },
      );
    }
    const certificate = row.certificate;

    try {
      return await this.manager.transactional(async (txEm) => {
        const ex = {
          execute: (sql: string, params?: unknown[]) => txEm.execute(sql, params),
        };
        let created: PersistedPendingZatcaInvoice = null as never;
        await generatePendingInvoice(
          ex,
          {
            ...input,
            egsKey: row.id,
            certificate,
            privateKey,
            supplier,
          },
          async (record) => {
            created = (await this.createZatcaInvoices(record, {
              transactionManager: txEm,
            })) as PersistedPendingZatcaInvoice;
          },
        );
        return created;
      });
    } catch (error) {
      if (!isSourceKeyConflict(error)) throw error;

      const [racedExisting] = await this.listZatcaInvoices(key, { take: 1 });
      if (racedExisting) {
        return racedExisting as PersistedPendingZatcaInvoice;
      }
      throw error;
    }
  }

  /**
   * Generate, sign, QR-stamp, and persist the original invoice for an order
   * (S5, ADR-0004): the advisory lock + allocation + persist all run inside
   * one DB transaction; ZATCA submission stays outside. Idempotent on the
   * `("order", orderId)` source key.
   */
  async generateInvoiceForOrder(
    input: GenerateLifecycleDocumentInput,
  ): Promise<PersistedPendingZatcaInvoice> {
    return this.generateLifecycleDocument({
      ...input,
      documentType: "invoice",
      sourceType: "order",
      sourceId: input.orderId,
      parentInvoiceId: null,
      reason: null,
    });
  }

  /**
   * Report a pending invoice to ZATCA (S5). Runs outside any chain lock.
   * 200/202 → `reported`; a definitive ZATCA rejection → `rejected`; any
   * other failure leaves the invoice `pending` for the retry engine (S6),
   * with the attempt counted and the response recorded.
   */
  async reportZatcaInvoice(invoiceId: string): Promise<{
    id: string;
    status: "reported" | "rejected" | "pending";
  }> {
    const invoice = await this.retrieveZatcaInvoice(invoiceId);
    if (invoice.status === "reported") {
      return { id: invoice.id, status: "reported" };
    }

    const { row, csid } = await this.decryptProductionCredentials();
    void row;
    const client = new FatooraClient({
      environment: this.options.environment,
      credentials: { certificate: csid.certificate, secret: csid.secret },
    });

    const submittedAt = new Date();
    try {
      const response = await client.reportInvoice({
        signedXml: invoice.xml,
        invoiceHash: invoice.invoice_hash,
        uuid: invoice.uuid,
      });
      await this.updateZatcaInvoices({
        id: invoice.id,
        status: "reported",
        zatca_response: response as Record<string, unknown>,
        submitted_at: submittedAt,
        reported_at: new Date(),
        attempts: invoice.attempts + 1,
      });
      return { id: invoice.id, status: "reported" };
    } catch (error) {
      // A 4xx from ZATCA is a definitive rejection of this document; other
      // failures (network, 5xx) stay pending for the retry engine.
      const status =
        error instanceof KsaError && /responded 4\d\d/.test(error.message)
          ? "rejected"
          : "pending";
      await this.updateZatcaInvoices({
        id: invoice.id,
        status: status === "rejected" ? "rejected" : invoice.status,
        zatca_response: { error: String(error) },
        submitted_at: submittedAt,
        attempts: invoice.attempts + 1,
      });
      if (status === "rejected") {
        return { id: invoice.id, status };
      }
      throw error;
    }
  }

  /**
   * Retry engine entry point (S6): claim due pending invoices with
   * `SKIP LOCKED` and report them — exactly-once across concurrent runs.
   * Stores not yet in production simply have nothing to report.
   */
  async processPendingZatcaReports(options?: {
    limit?: number;
    now?: Date;
  }): Promise<ProcessResult> {
    const empty: ProcessResult = {
      reported: [],
      rejected: [],
      failed: [],
      skipped: [],
      errored: [],
    };
    const row = await this.credentialRow();
    if (row?.status !== "production") return empty;

    const { csid } = await this.decryptProductionCredentials();
    const client = new FatooraClient({
      environment: this.options.environment,
      credentials: { certificate: csid.certificate, secret: csid.secret },
    });

    return this.manager.transactional((txEm) =>
      processPendingReports(
        { execute: (sql, params) => txEm.execute(sql, params) },
        {
          ...options,
          report: async (invoice) => {
            try {
              const response = await client.reportInvoice({
                signedXml: invoice.xml,
                invoiceHash: invoice.invoice_hash,
                uuid: invoice.uuid,
              });
              return { status: "reported", response };
            } catch (error) {
              // 4xx = definitive rejection; anything else stays transient.
              if (
                error instanceof KsaError &&
                /responded 4\d\d/.test(error.message)
              ) {
                return { status: "rejected", response: { error: String(error) } };
              }
              throw error;
            }
          },
        },
      ),
    );
  }

  /** Invoice counts by status — the wizard dashboard (no row data, no XML). */
  async getZatcaInvoiceSummary(): Promise<{
    pending: number;
    reported: number;
    rejected: number;
    failed: number;
    total: number;
  }> {
    const rows = (await this.manager.execute(
      `select status, count(*)::int as count
         from zatca_invoice
        where deleted_at is null
        group by status`,
    )) as { status: string; count: number }[];
    const summary = { pending: 0, reported: 0, rejected: 0, failed: 0, total: 0 };
    for (const row of rows) {
      if (row.status in summary) {
        summary[row.status as keyof typeof summary] = row.count;
      }
      summary.total += row.count;
    }
    return summary;
  }

  /**
   * Admin-forced retry of terminally `failed` invoices (wizard "retry
   * failed"). Bypasses the 24h window check — the admin decides; ZATCA gets
   * the final say. Invoices that still can't be reported stay `failed`.
   */
  async retryFailedZatcaInvoices(): Promise<{
    reported: string[];
    rejected: string[];
    failed: string[];
  }> {
    const failedRows = await this.listZatcaInvoices({ status: "failed" });
    const result: { reported: string[]; rejected: string[]; failed: string[] } =
      { reported: [], rejected: [], failed: [] };
    for (const invoice of failedRows) {
      try {
        const outcome = await this.reportZatcaInvoice(invoice.id);
        result[outcome.status === "reported" ? "reported" : "rejected"].push(
          invoice.id,
        );
      } catch {
        result.failed.push(invoice.id); // transient — stays failed
      }
    }
    return result;
  }

  /** Decrypt the PCSID + private key just-in-time; never leaves memory. */
  private async decryptProductionCredentials() {
    const row = await this.requireCredentialRow("production");
    if (!row.production_csid || !row.private_key) {
      throw new KsaError(
        "EGS has no Production CSID — complete onboarding first.",
        { prefix: "zatca", code: KsaErrorCodes.INVALID_INPUT },
      );
    }
    const csid = JSON.parse(
      secrets.decrypt(row.production_csid, this.options.encryptionKey),
    ) as { requestId: string; certificate: string; secret: string };
    const privateKey = secrets.decrypt(
      row.private_key,
      this.options.encryptionKey,
    );
    return { row, csid, privateKey };
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
