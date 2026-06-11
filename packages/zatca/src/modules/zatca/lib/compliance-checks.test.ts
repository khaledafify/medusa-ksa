import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { secrets } from "@medusa-ksa/core";
import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_SAMPLE_TYPES,
  runComplianceChecks,
  type ComplianceCheckSubmission,
} from "./compliance-checks";
import { FatooraClient } from "./fatoora-client";
import { computeInvoiceHash } from "./invoice-hash";
import { SEED_PIH } from "./hash-chain";
import { onboardCompliance } from "./onboard-compliance";
import type { ZatcaSupplier } from "./xml-builder";

const FIXTURES = join(__dirname, "../../../../test/fixtures/sdk");
const sampleCert = readFileSync(join(FIXTURES, "sample-cert.pem"), "utf8");
const sampleKey = readFileSync(join(FIXTURES, "sample-priv-key.pem"), "utf8");

const supplier: ZatcaSupplier = {
  crn: "1010010000",
  street: "الامير سلطان | Prince Sultan",
  building: "2322",
  citySubdivision: "المربع | Al-Murabba",
  city: "الرياض | Riyadh",
  postalZone: "23333",
  vatNumber: "399999999900003",
  name: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
};

function stubClient(outcome: { reportingStatus?: string; status?: string }) {
  const submissions: {
    body: { signedXml: string; invoiceHash: string; uuid: string };
  }[] = [];
  return {
    submissions,
    client: {
      checkInvoiceCompliance: (body: {
        signedXml: string;
        invoiceHash: string;
        uuid: string;
      }) => {
        submissions.push({ body });
        return Promise.resolve({
          reportingStatus: outcome.reportingStatus,
          validationResults: outcome.status
            ? { status: outcome.status, errorMessages: [] }
            : undefined,
        });
      },
    },
  };
}

describe("runComplianceChecks (T4.4 gate)", () => {
  it("submits one of each required Simplified document, hash-chained", async () => {
    const { client, submissions } = stubClient({ reportingStatus: "REPORTED" });

    const outcomes = await runComplianceChecks({
      client,
      certificate: sampleCert,
      privateKey: sampleKey,
      supplier,
    });

    expect(outcomes.map((o) => o.documentType)).toEqual([
      ...COMPLIANCE_SAMPLE_TYPES,
    ]);
    expect(submissions).toHaveLength(3);

    const [invoice, credit, debit] = submissions.map((s) => s.body) as [
      ComplianceCheckSubmission,
      ComplianceCheckSubmission,
      ComplianceCheckSubmission,
    ];

    // Document types: 388 invoice, 381 credit, 383 debit (all simplified).
    expect(invoice.signedXml).toContain('name="0200000">388<');
    expect(credit.signedXml).toContain('name="0200000">381<');
    expect(debit.signedXml).toContain('name="0200000">383<');

    // Notes reference the sample invoice and carry a reason (BR-KSA-17/56).
    expect(credit.signedXml).toContain("BillingReference");
    expect(credit.signedXml).toContain("InstructionNote");
    expect(debit.signedXml).toContain("BillingReference");

    // The three samples form a valid PIH chain seeded at the chain origin.
    expect(invoice.signedXml).toContain(SEED_PIH);
    expect(credit.signedXml).toContain(invoice.invoiceHash);
    expect(debit.signedXml).toContain(credit.invoiceHash);

    // Each submitted hash matches its document's canonical hash.
    for (const body of [invoice, credit, debit]) {
      expect(computeInvoiceHash(body.signedXml)).toBe(body.invoiceHash);
      expect(body.uuid).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("accepts PASS and WARNING validation statuses", async () => {
    const { client } = stubClient({ status: "WARNING" });
    const outcomes = await runComplianceChecks({
      client,
      certificate: sampleCert,
      privateKey: sampleKey,
      supplier,
    });
    expect(outcomes).toHaveLength(3);
  });

  it("throws on a failed check, naming the failing document type", async () => {
    const { client } = stubClient({ status: "ERROR", reportingStatus: "NOT_REPORTED" });
    await expect(
      runComplianceChecks({
        client,
        certificate: sampleCert,
        privateKey: sampleKey,
        supplier,
      }),
    ).rejects.toThrow(/simplified_invoice/);
  });

  it("never includes the private key in errors or submissions", async () => {
    const { client, submissions } = stubClient({ reportingStatus: "REPORTED" });
    await runComplianceChecks({
      client,
      certificate: sampleCert,
      privateKey: sampleKey,
      supplier,
    });
    const keyBody = sampleKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    for (const { body } of submissions) {
      expect(body.signedXml).not.toContain(keyBody);
    }
  });
});

/**
 * Live sandbox gate (PRD T4.4): full onboarding → compliance checks against
 * the developer-portal sandbox. Enable with ZATCA_SANDBOX_E2E=1.
 */
describe.runIf(process.env.ZATCA_SANDBOX_E2E)("compliance checks (live sandbox)", () => {
  it("passes the required Simplified document checks with a fresh CCSID", async () => {
    const encryptionKey = randomBytes(32).toString("base64");
    const client = new FatooraClient({ environment: "sandbox" });

    let storedCsid: string | undefined;
    let storedKey: string | undefined;
    await onboardCompliance(
      {
        environment: "sandbox",
        otp: "123456",
        commonName: "TST-886431145-399999999900003",
        solutionName: "medusa-ksa",
        model: "1.0",
        serialNumber: "ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
        vatNumber: supplier.vatNumber,
        organizationName: "Maximum Speed Tech Supply LTD",
        branchName: "Riyadh Branch",
        address: "RRRD2929",
        industry: "Supply activities",
        crn: supplier.crn,
      },
      {
        client,
        encryptionKey,
        persist: (record) => {
          storedCsid = record.compliance_csid;
          storedKey = record.private_key;
          return Promise.resolve();
        },
      },
    );

    const csid = JSON.parse(secrets.decrypt(storedCsid!, encryptionKey)) as {
      certificate: string;
      secret: string;
    };
    const privateKey = secrets.decrypt(storedKey!, encryptionKey);

    const authedClient = new FatooraClient({
      environment: "sandbox",
      credentials: { certificate: csid.certificate, secret: csid.secret },
    });

    const outcomes = await runComplianceChecks({
      client: authedClient,
      certificate: csid.certificate,
      privateKey,
      supplier,
    });

    expect(outcomes).toHaveLength(3);
    for (const outcome of outcomes) {
      expect(outcome.accepted).toBe(true);
    }
  }, 120_000);
});
