import { randomUUID } from "node:crypto";

import { KsaError, KsaErrorCodes } from "@medusa-ksa/core";

import type { ComplianceCheckResponse } from "./fatoora-client";
import { SEED_PIH } from "./hash-chain";
import { generateQr } from "./qr";
import { signInvoice } from "./signer";
import {
  buildSimplifiedInvoiceXml,
  formatHalalas,
  type ZatcaSupplier,
} from "./xml-builder";

/**
 * Compliance checks (T4.4, SPEC §4 step 4): before ZATCA grants a Production
 * CSID it requires one passing sample of every document type the EGS declared
 * in its CSR. This EGS is B2C-only (CSR invoice-type `0100`), so the required
 * set is the three Simplified documents — invoice (388), credit note (381),
 * debit note (383).
 *
 * The samples are throwaway: signed with the Compliance CSID and chained
 * locally from the seed PIH. They never touch the real invoice chain.
 */

export const COMPLIANCE_SAMPLE_TYPES = [
  "simplified_invoice",
  "simplified_credit_note",
  "simplified_debit_note",
] as const;

export type ComplianceSampleType = (typeof COMPLIANCE_SAMPLE_TYPES)[number];

/** UN/CEFACT 1001 code per sample type. */
const TYPE_CODES: Record<ComplianceSampleType, string> = {
  simplified_invoice: "388",
  simplified_credit_note: "381",
  simplified_debit_note: "383",
};

export interface ComplianceCheckSubmission {
  signedXml: string;
  invoiceHash: string;
  uuid: string;
}

export interface ComplianceCheckDeps {
  client: {
    checkInvoiceCompliance: (
      input: ComplianceCheckSubmission,
    ) => Promise<ComplianceCheckResponse>;
  };
  /** Compliance CSID certificate (base64 body or PEM). */
  certificate: string;
  /** EGS private key (plaintext PEM — decrypt just-in-time, never log). */
  privateKey: string;
  /** Supplier party — must match the onboarded org (VAT cross-checked). */
  supplier: ZatcaSupplier;
  /** Clock override for reproducible tests. */
  now?: Date;
}

export interface ComplianceCheckOutcome {
  documentType: ComplianceSampleType;
  accepted: boolean;
  reportingStatus?: string;
  validationStatus?: string;
}

function isAccepted(response: ComplianceCheckResponse): boolean {
  const validation = response.validationResults?.status;
  if (validation === "PASS" || validation === "WARNING") return true;
  if (validation === "ERROR") return false;
  return response.reportingStatus === "REPORTED";
}

/**
 * Build, sign, and submit the three sample Simplified documents in chain
 * order. Throws on the first rejected document (the error names the document
 * type and ZATCA's validation messages — never key material).
 */
export async function runComplianceChecks(
  deps: ComplianceCheckDeps,
): Promise<ComplianceCheckOutcome[]> {
  const now = deps.now ?? new Date();
  const issueDate = now.toISOString().slice(0, 10);
  const issueTime = now.toISOString().slice(11, 19);

  const outcomes: ComplianceCheckOutcome[] = [];
  let pih = SEED_PIH;
  let icv = 1;
  const invoiceSerial = "CHK-0001";

  for (const documentType of COMPLIANCE_SAMPLE_TYPES) {
    const isNote = documentType !== "simplified_invoice";
    const serial = `CHK-${String(icv).padStart(4, "0")}`;
    const uuid = randomUUID();

    const built = buildSimplifiedInvoiceXml({
      serialNumber: serial,
      uuid,
      issueDate,
      issueTime,
      invoiceTypeCode: TYPE_CODES[documentType],
      icv,
      pih,
      supplier: deps.supplier,
      ...(isNote
        ? {
            billingReference: invoiceSerial,
            instructionNote: "Compliance check sample",
          }
        : {}),
      lines: [
        {
          id: 1,
          name: "Compliance check item",
          quantity: 1,
          unitPriceHalalas: 10_000,
          vatPercent: 15,
        },
      ],
    });

    const { signedXml, invoiceHash, digitalSignature } = signInvoice({
      xml: built.xml,
      certificate: deps.certificate,
      privateKey: deps.privateKey,
    });

    const qrCode = generateQr({
      sellerName: deps.supplier.name,
      vatNumber: deps.supplier.vatNumber,
      issueDateTime: `${issueDate}T${issueTime}`,
      taxInclusiveTotal: formatHalalas(built.taxInclusiveHalalas),
      vatTotal: formatHalalas(built.taxHalalas),
      invoiceHash,
      digitalSignature,
      certificate: deps.certificate,
    });

    const response = await deps.client.checkInvoiceCompliance({
      signedXml: signedXml.replace("SET_QR_CODE_DATA", qrCode),
      invoiceHash,
      uuid,
    });

    const accepted = isAccepted(response);
    if (!accepted) {
      throw new KsaError(
        `compliance check failed for ${documentType}: ` +
          `status=${response.validationResults?.status ?? "unknown"} ` +
          `errors=${JSON.stringify(response.validationResults?.errorMessages ?? [])}`,
        { prefix: "zatca", code: KsaErrorCodes.PROVIDER_ERROR },
      );
    }

    outcomes.push({
      documentType,
      accepted,
      reportingStatus: response.reportingStatus,
      validationStatus: response.validationResults?.status,
    });

    pih = invoiceHash;
    icv += 1;
  }

  return outcomes;
}
