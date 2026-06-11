import { randomBytes } from "node:crypto";

import { secrets } from "@medusa-ksa/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runComplianceChecks } from "./compliance-checks";
import { FatooraClient, type IssuedCsid } from "./fatoora-client";
import {
  onboardCompliance,
  type ComplianceCredentialRecord,
} from "./onboard-compliance";
import {
  onboardProduction,
  type ProductionCredentialUpdate,
} from "./onboard-production";
import type { ZatcaSupplier } from "./xml-builder";

const ENCRYPTION_KEY = randomBytes(32).toString("base64");
const PCSID_SECRET = "production-api-secret-value";
const PCSID_CERT = Buffer.from("MIIB-production-certificate").toString("base64");

function stubClient() {
  const calls: { complianceRequestId: string }[] = [];
  return {
    calls,
    client: {
      requestProductionCsid: (i: { complianceRequestId: string }) => {
        calls.push(i);
        return Promise.resolve<IssuedCsid>({
          requestId: "9876543210",
          dispositionMessage: "ISSUED",
          certificate: PCSID_CERT,
          secret: PCSID_SECRET,
        });
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onboardProduction (T4.5 gate — PCSID encrypted, no leaks)", () => {
  it("exchanges the compliance request id and persists the PCSID encrypted", async () => {
    const { client, calls } = stubClient();
    let persisted: ProductionCredentialUpdate | undefined;

    const result = await onboardProduction(
      { complianceRequestId: "1234567890" },
      {
        client,
        encryptionKey: ENCRYPTION_KEY,
        persist: (update) => {
          persisted = update;
          return Promise.resolve();
        },
      },
    );

    expect(calls).toEqual([{ complianceRequestId: "1234567890" }]);
    expect(result).toEqual({ requestId: "9876543210", status: "production" });

    const update = persisted!;
    expect(update.status).toBe("production");
    // PCSID certificate (public) stored as returned.
    expect(update.certificate).toBe(PCSID_CERT);
    // 🔒 PCSID encrypted at rest — ciphertext only, decrypts to the pair.
    expect(update.production_csid).not.toContain(PCSID_SECRET);
    const csid = JSON.parse(
      secrets.decrypt(update.production_csid, ENCRYPTION_KEY),
    ) as { requestId: string; certificate: string; secret: string };
    expect(csid).toEqual({
      requestId: "9876543210",
      certificate: PCSID_CERT,
      secret: PCSID_SECRET,
    });
  });

  it("never leaks the PCSID secret through logs, output, or the persisted row", async () => {
    const noop = (): void => undefined;
    const spies = [
      vi.spyOn(console, "log").mockImplementation(noop),
      vi.spyOn(console, "error").mockImplementation(noop),
      vi.spyOn(console, "warn").mockImplementation(noop),
    ];

    const { client } = stubClient();
    let persisted: ProductionCredentialUpdate | undefined;
    const result = await onboardProduction(
      { complianceRequestId: "1234567890" },
      {
        client,
        encryptionKey: ENCRYPTION_KEY,
        persist: (update) => {
          persisted = update;
          return Promise.resolve();
        },
      },
    );

    const logged = spies
      .flatMap((spy) => spy.mock.calls.flat())
      .map(String)
      .join("\n");
    expect(logged).not.toContain(PCSID_SECRET);
    expect(JSON.stringify(result)).not.toContain(PCSID_SECRET);
    expect(JSON.stringify(persisted)).not.toContain(PCSID_SECRET);
  });

  it("propagates rejection without persisting", async () => {
    const persist = vi.fn();
    await expect(
      onboardProduction(
        { complianceRequestId: "bad" },
        {
          client: {
            requestProductionCsid: () =>
              Promise.reject(new Error("production csid rejected (400)")),
          },
          encryptionKey: ENCRYPTION_KEY,
          persist,
        },
      ),
    ).rejects.toThrow(/rejected/);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects a bad encryption key before calling ZATCA", async () => {
    const { client, calls } = stubClient();
    await expect(
      onboardProduction(
        { complianceRequestId: "1234567890" },
        { client, encryptionKey: "nope", persist: () => Promise.resolve() },
      ),
    ).rejects.toThrow(/32 bytes/);
    expect(calls).toHaveLength(0);
  });
});

/**
 * Live sandbox gate (PRD T4.5): the full onboarding sequence —
 * CSR → CCSID → compliance checks → PCSID — reaches `production` against the
 * developer-portal sandbox. Enable with ZATCA_SANDBOX_E2E=1.
 */
describe.runIf(process.env.ZATCA_SANDBOX_E2E)("full onboarding (live sandbox)", () => {
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

  it("reaches production status end-to-end", async () => {
    const encryptionKey = randomBytes(32).toString("base64");
    const anonClient = new FatooraClient({ environment: "sandbox" });

    let credential: ComplianceCredentialRecord | undefined;
    const compliance = await onboardCompliance(
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
        client: anonClient,
        encryptionKey,
        persist: (record) => {
          credential = record;
          return Promise.resolve();
        },
      },
    );

    const ccsid = JSON.parse(
      secrets.decrypt(credential!.compliance_csid, encryptionKey),
    ) as { certificate: string; secret: string };
    const privateKey = secrets.decrypt(credential!.private_key, encryptionKey);

    const ccsidClient = new FatooraClient({
      environment: "sandbox",
      credentials: { certificate: ccsid.certificate, secret: ccsid.secret },
    });

    await runComplianceChecks({
      client: ccsidClient,
      certificate: ccsid.certificate,
      privateKey,
      supplier,
    });

    let update: ProductionCredentialUpdate | undefined;
    const production = await onboardProduction(
      { complianceRequestId: compliance.requestId },
      {
        client: ccsidClient,
        encryptionKey,
        persist: (u) => {
          update = u;
          return Promise.resolve();
        },
      },
    );

    expect(production.status).toBe("production");
    const pcsid = JSON.parse(
      secrets.decrypt(update!.production_csid, encryptionKey),
    ) as { certificate: string; secret: string };
    expect(pcsid.certificate.length).toBeGreaterThan(0);
    expect(pcsid.secret.length).toBeGreaterThan(0);
  }, 120_000);
});
