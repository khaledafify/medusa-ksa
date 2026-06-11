import type { ExecArgs } from "@medusajs/framework/types";
import type { ZatcaModuleService } from "medusa-plugin-zatca/modules/zatca";
import { onboardEgsWorkflow } from "medusa-plugin-zatca/workflows";

/**
 * T4.6 gate: full onboarding completes headlessly through the onboard-egs
 * workflow (the same path the admin routes drive), against the sandbox.
 *
 * Asserts:
 *  - status reaches `production`
 *  - the workflow/route response carries no secret
 *  - credentials are encrypted at rest (ciphertext only in the row)
 *
 * Run: ../../node_modules/.bin/medusa exec ./src/scripts/test-zatca-onboarding.ts
 */
export default async function testZatcaOnboarding({ container }: ExecArgs) {
  const service: InstanceType<typeof ZatcaModuleService> =
    container.resolve("zatca");

  const supplier = {
    crn: "1010010000",
    street: "الامير سلطان | Prince Sultan",
    building: "2322",
    citySubdivision: "المربع | Al-Murabba",
    city: "الرياض | Riyadh",
    postalZone: "23333",
    vatNumber: "399999999900003",
    name: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
  };

  const { result } = await onboardEgsWorkflow(container).run({
    input: {
      otp: "123456",
      commonName: "TST-886431145-399999999900003",
      solutionName: "medusa-ksa",
      model: "1.0",
      serialNumber: `egs-${Date.now()}`,
      vatNumber: supplier.vatNumber,
      organizationName: "Maximum Speed Tech Supply LTD",
      branchName: "Riyadh Branch",
      address: "RRRD2929",
      industry: "Supply activities",
      crn: supplier.crn,
      supplier,
    },
  });

  // 1. The workflow (= route response) reaches production, status only.
  if (result.status !== "production") {
    throw new Error(`expected production status, got ${JSON.stringify(result)}`);
  }
  const responseJson = JSON.stringify(result);
  for (const marker of ["PRIVATE KEY", "secret", "csid", "csr"]) {
    if (responseJson.toLowerCase().includes(marker.toLowerCase())) {
      throw new Error(`route response leaks "${marker}": ${responseJson}`);
    }
  }

  // 2. Status route view is consistent and secret-free.
  const status = await service.getOnboardingStatus();
  if (status.status !== "production") {
    throw new Error(`status view says ${status.status}, expected production`);
  }

  // 3. Credentials provably encrypted at rest.
  const [row] = await service.listZatcaCredentials({}, { take: 1 });
  if (!row) throw new Error("credential row missing after onboarding");
  for (const [field, value] of [
    ["private_key", row.private_key],
    ["compliance_csid", row.compliance_csid],
    ["production_csid", row.production_csid],
  ] as const) {
    if (!value) throw new Error(`${field} missing after onboarding`);
    if (value.includes("PRIVATE KEY") || value.trim().startsWith("{")) {
      throw new Error(`${field} stored as plaintext`);
    }
    // AES-256-GCM payloads are base64(iv|tag|ciphertext) — minimum 28 bytes.
    if (Buffer.from(value, "base64").length < 28) {
      throw new Error(`${field} does not look like an encrypted payload`);
    }
  }

  console.log(
    `zatca onboarding test passed: ${row.id} status=${row.status} env=${row.environment}`,
  );
}
