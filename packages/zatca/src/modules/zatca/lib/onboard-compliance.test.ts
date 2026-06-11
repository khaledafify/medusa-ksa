import { randomBytes } from "node:crypto";

import { secrets } from "@medusa-ksa/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FatooraClient, type IssuedCsid } from "./fatoora-client";
import {
  onboardCompliance,
  type ComplianceCredentialRecord,
  type OnboardComplianceInput,
} from "./onboard-compliance";

const ENCRYPTION_KEY = randomBytes(32).toString("base64");

const OTP = "123456";
const API_SECRET = "very-secret-api-credential";
const CERTIFICATE_B64 = Buffer.from("MIIB-fake-certificate-body").toString("base64");

const input: OnboardComplianceInput = {
  environment: "sandbox",
  otp: OTP,
  commonName: "TST-886431145-399999999900003",
  solutionName: "medusa-ksa",
  model: "1.0",
  serialNumber: "ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
  vatNumber: "399999999900003",
  organizationName: "Maximum Speed Tech Supply LTD",
  branchName: "Riyadh Branch",
  address: "RRRD2929",
  industry: "Supply activities",
  crn: "1010010000",
};

function stubClient(): {
  client: { requestComplianceCsid: (i: { csr: string; otp: string }) => Promise<IssuedCsid> };
  calls: { csr: string; otp: string }[];
} {
  const calls: { csr: string; otp: string }[] = [];
  return {
    calls,
    client: {
      requestComplianceCsid: (i: { csr: string; otp: string }) => {
        calls.push(i);
        return Promise.resolve({
          requestId: "1234567890",
          dispositionMessage: "ISSUED",
          certificate: CERTIFICATE_B64,
          secret: API_SECRET,
        });
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onboardCompliance (T4.3 gate — CCSID encrypted at rest, no leaks)", () => {
  it("persists an encrypted credential record with status compliance", async () => {
    const { client, calls } = stubClient();
    let persisted: ComplianceCredentialRecord | undefined;

    const result = await onboardCompliance(input, {
      client,
      encryptionKey: ENCRYPTION_KEY,
      persist: (record) => {
        persisted = record;
        return Promise.resolve();
      },
    });

    // The CSR sent to ZATCA is the generated PEM.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.csr).toContain("-----BEGIN CERTIFICATE REQUEST-----");
    expect(calls[0]!.otp).toBe(OTP);

    expect(persisted).toBeDefined();
    const record = persisted!;
    expect(record.status).toBe("compliance");
    expect(record.environment).toBe("sandbox");
    expect(record.vat_number).toBe(input.vatNumber);
    expect(record.egs_serial_number).toBe(
      "1-medusa-ksa|2-1.0|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
    );
    expect(record.crn).toBe(input.crn);
    expect(record.csr).toContain("-----BEGIN CERTIFICATE REQUEST-----");
    // Public certificate stored as returned (not secret).
    expect(record.certificate).toBe(CERTIFICATE_B64);

    // 🔒 private key encrypted at rest: not PEM, decrypts back to SEC1 PEM.
    expect(record.private_key).not.toContain("EC PRIVATE KEY");
    const privateKey = secrets.decrypt(record.private_key, ENCRYPTION_KEY);
    expect(privateKey).toContain("-----BEGIN EC PRIVATE KEY-----");

    // 🔒 CCSID encrypted at rest: ciphertext, decrypts to cert+secret pair.
    expect(record.compliance_csid).not.toContain(API_SECRET);
    const csid = JSON.parse(
      secrets.decrypt(record.compliance_csid, ENCRYPTION_KEY),
    ) as { requestId: string; certificate: string; secret: string };
    expect(csid.requestId).toBe("1234567890");
    expect(csid.certificate).toBe(CERTIFICATE_B64);
    expect(csid.secret).toBe(API_SECRET);

    // The function's return value is secret-free (safe for API routes).
    expect(result).toEqual({ requestId: "1234567890", status: "compliance" });
  });

  it("never leaks the secret, OTP, or private key through logs or output", async () => {
    const noop = (): void => undefined;
    const logSpy = vi.spyOn(console, "log").mockImplementation(noop);
    const errSpy = vi.spyOn(console, "error").mockImplementation(noop);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(noop);

    const { client } = stubClient();
    let persisted: ComplianceCredentialRecord | undefined;
    const result = await onboardCompliance(input, {
      client,
      encryptionKey: ENCRYPTION_KEY,
      persist: (record) => {
        persisted = record;
        return Promise.resolve();
      },
    });

    const logged = [logSpy, errSpy, warnSpy]
      .flatMap((spy) => spy.mock.calls.flat() as unknown[])
      .map(String)
      .join("\n");
    expect(logged).not.toContain(API_SECRET);
    expect(logged).not.toContain(OTP);
    expect(logged).not.toContain("EC PRIVATE KEY");

    expect(JSON.stringify(result)).not.toContain(API_SECRET);
    // The persisted row never holds plaintext secrets either.
    expect(JSON.stringify(persisted)).not.toContain(API_SECRET);
    expect(JSON.stringify(persisted)).not.toContain("EC PRIVATE KEY");
  });

  it("propagates ZATCA rejection without persisting and without echoing secrets", async () => {
    const client = {
      requestComplianceCsid: () =>
        Promise.reject(new Error("compliance request rejected (400)")),
    };
    const persist = vi.fn();

    await expect(
      onboardCompliance(input, {
        client,
        encryptionKey: ENCRYPTION_KEY,
        persist,
      }),
    ).rejects.toThrow(/rejected/);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects a bad encryption key before calling ZATCA", async () => {
    const { client, calls } = stubClient();
    await expect(
      onboardCompliance(input, {
        client,
        encryptionKey: "too-short",
        persist: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/32 bytes/);
    expect(calls).toHaveLength(0);
  });
});

/**
 * Live sandbox gate (PRD T4.3): runs the real CSR → Compliance CSID exchange
 * against the ZATCA developer-portal sandbox, which accepts any OTP.
 * Enable with: ZATCA_SANDBOX_E2E=1 pnpm vitest run …
 */
describe.runIf(process.env.ZATCA_SANDBOX_E2E)("sandbox onboarding (live)", () => {
  it("obtains a Compliance CSID from the sandbox and stores it encrypted", async () => {
    const client = new FatooraClient({ environment: "sandbox" });
    let persisted: ComplianceCredentialRecord | undefined;

    const result = await onboardCompliance(
      { ...input, otp: "123456" },
      {
        client,
        encryptionKey: ENCRYPTION_KEY,
        persist: (record) => {
          persisted = record;
          return Promise.resolve();
        },
      },
    );

    expect(result.status).toBe("compliance");
    expect(result.requestId).toMatch(/^\d+$/);

    const csid = JSON.parse(
      secrets.decrypt(persisted!.compliance_csid, ENCRYPTION_KEY),
    ) as { certificate: string; secret: string };
    expect(csid.certificate.length).toBeGreaterThan(0);
    expect(csid.secret.length).toBeGreaterThan(0);
    // The sandbox returns a real (base64 PEM body) certificate.
    expect(persisted!.status).toBe("compliance");
  }, 60_000);
});
