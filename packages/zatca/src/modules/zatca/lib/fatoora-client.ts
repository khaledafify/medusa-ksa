import { HttpClient, KsaError, KsaErrorCodes } from "@medusa-ksa/core";

import type { ZatcaEnvironment } from "../types";

/**
 * Fatoora API client over core {@link HttpClient} — the only sanctioned
 * network path (ADR-0002). Base URLs and endpoint paths verified against the
 * official Fatoora Portal User Manual (zatca.gov.sa) and the SDK; the auth
 * scheme (Basic with the base64 CSID certificate as username) is adapted from
 * wes4m/zatca-xml-js (ADR-0007).
 *
 * Submission calls (reporting, compliance checks) are POSTs and are never
 * retried at the transport level — the retry-reporting engine (S6) owns
 * retries with its own idempotency guarantees.
 */

/** Per-environment base URLs (Fatoora Portal User Manual §3 "API endpoints"). */
export const FATOORA_BASE_URLS: Record<ZatcaEnvironment, string> = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};

const ACCEPT_VERSION = "V2";
const DEFAULT_TIMEOUT_MS = 30_000;

/** CSID credential pair returned by onboarding and used for Basic auth. */
export interface FatooraCredentials {
  /** CSID certificate (base64 body or PEM). */
  certificate: string;
  /** API secret issued alongside the CSID. */
  secret: string;
}

export interface FatooraClientOptions {
  environment: ZatcaEnvironment;
  /** Required for every endpoint except the compliance-CSID request. */
  credentials?: FatooraCredentials;
  timeoutMs?: number;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

/** Raw CSID issuance payload (compliance and production share the shape). */
interface RawCsidResponse {
  requestID: number | string;
  dispositionMessage: string;
  binarySecurityToken: string;
  secret: string;
}

export interface IssuedCsid {
  /** `requestID` as a string — compliance id is needed for the PCSID call. */
  requestId: string;
  dispositionMessage: string;
  /** Decoded certificate body (single-line base64, PEM armor not included). */
  certificate: string;
  /** API secret paired with the certificate. */
  secret: string;
}

/** Validation outcome attached to compliance-check and reporting responses. */
export interface FatooraValidationResults {
  status?: string;
  infoMessages?: unknown[];
  warningMessages?: unknown[];
  errorMessages?: unknown[];
}

export interface ComplianceCheckResponse {
  validationResults?: FatooraValidationResults;
  reportingStatus?: string;
  clearanceStatus?: string;
}

export interface ReportingResponse {
  validationResults?: FatooraValidationResults;
  reportingStatus?: string;
}

const pemBody = (input: string): string =>
  input.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");

function parseCsid(raw: RawCsidResponse): IssuedCsid {
  return {
    requestId: String(raw.requestID),
    dispositionMessage: raw.dispositionMessage,
    certificate: Buffer.from(raw.binarySecurityToken, "base64").toString("utf8"),
    secret: raw.secret,
  };
}

export class FatooraClient {
  private readonly environment: ZatcaEnvironment;
  private readonly credentials?: FatooraCredentials;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: FatooraClientOptions) {
    this.environment = options.environment;
    this.credentials = options.credentials;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl;
  }

  /** Anonymous client — only the compliance-CSID request runs unauthenticated. */
  private anonymousHttp(): HttpClient {
    return new HttpClient({
      baseUrl: FATOORA_BASE_URLS[this.environment],
      timeoutMs: this.timeoutMs,
      headers: { "Accept-Version": ACCEPT_VERSION },
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Authenticated client. ZATCA Basic auth uses the base64 certificate body
   * as username and the API secret as password; core builds and redacts the
   * header so neither can leak through an error message.
   */
  private authenticatedHttp(): HttpClient {
    if (!this.credentials) {
      throw new KsaError(
        "This Fatoora endpoint requires CSID credentials — onboard the EGS first.",
        { prefix: "zatca", code: KsaErrorCodes.INVALID_OPTIONS },
      );
    }
    return new HttpClient({
      baseUrl: FATOORA_BASE_URLS[this.environment],
      timeoutMs: this.timeoutMs,
      auth: {
        type: "basic",
        username: Buffer.from(pemBody(this.credentials.certificate)).toString("base64"),
        password: this.credentials.secret,
      },
      headers: { "Accept-Version": ACCEPT_VERSION },
      redact: [this.credentials.secret],
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * `POST /compliance` — exchange a CSR + portal OTP for a Compliance CSID.
   * The OTP travels in a header; it is short-lived and redacted from errors.
   */
  async requestComplianceCsid(input: { csr: string; otp: string }): Promise<IssuedCsid> {
    const raw = await this.anonymousHttp().request<RawCsidResponse>({
      method: "POST",
      path: "/compliance",
      headers: { OTP: input.otp },
      body: { csr: Buffer.from(input.csr, "utf8").toString("base64") },
    });
    return parseCsid(raw);
  }

  /**
   * `POST /compliance/invoices` — run a signed document through ZATCA's
   * compliance checks (required before a Production CSID is granted).
   * Auth: Compliance CSID.
   */
  async checkInvoiceCompliance(input: {
    signedXml: string;
    invoiceHash: string;
    uuid: string;
  }): Promise<ComplianceCheckResponse> {
    return this.authenticatedHttp().request<ComplianceCheckResponse>({
      method: "POST",
      path: "/compliance/invoices",
      headers: { "Accept-Language": "en" },
      body: {
        invoiceHash: input.invoiceHash,
        uuid: input.uuid,
        invoice: Buffer.from(input.signedXml, "utf8").toString("base64"),
      },
    });
  }

  /**
   * `POST /production/csids` — exchange a passed compliance request for the
   * Production CSID. Auth: Compliance CSID.
   */
  async requestProductionCsid(input: {
    complianceRequestId: string;
  }): Promise<IssuedCsid> {
    const raw = await this.authenticatedHttp().request<RawCsidResponse>({
      method: "POST",
      path: "/production/csids",
      body: { compliance_request_id: input.complianceRequestId },
    });
    return parseCsid(raw);
  }

  /**
   * `POST /invoices/reporting/single` — report a signed Simplified invoice
   * (B2C). 200 = reported, 202 = reported with warnings; both are success.
   * Auth: Production CSID.
   */
  async reportInvoice(input: {
    signedXml: string;
    invoiceHash: string;
    uuid: string;
  }): Promise<ReportingResponse> {
    return this.authenticatedHttp().request<ReportingResponse>({
      method: "POST",
      path: "/invoices/reporting/single",
      headers: { "Accept-Language": "en", "Clearance-Status": "0" },
      body: {
        invoiceHash: input.invoiceHash,
        uuid: input.uuid,
        invoice: Buffer.from(input.signedXml, "utf8").toString("base64"),
      },
    });
  }
}
