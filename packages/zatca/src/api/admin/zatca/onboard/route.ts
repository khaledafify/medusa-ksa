import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import { onboardEgsWorkflow } from "../../../../workflows/onboard-egs";

/**
 * `POST /admin/zatca/onboard` — runs the full onboarding handshake
 * (CSR → CCSID → compliance checks → PCSID) from org details + the portal
 * OTP. Responds with the non-secret status view only (ADR-0004).
 */

const nonEmpty = z.string().trim().min(1);

const supplierSchema = z.object({
  crn: nonEmpty,
  street: nonEmpty,
  building: nonEmpty,
  citySubdivision: nonEmpty,
  city: nonEmpty,
  postalZone: nonEmpty,
  vatNumber: nonEmpty,
  name: nonEmpty,
});

export const onboardBodySchema = z.object({
  otp: nonEmpty,
  commonName: nonEmpty,
  solutionName: nonEmpty.default("medusa-ksa"),
  model: nonEmpty.default("1.0"),
  serialNumber: nonEmpty,
  vatNumber: nonEmpty,
  organizationName: nonEmpty,
  branchName: nonEmpty,
  address: nonEmpty,
  industry: nonEmpty,
  crn: nonEmpty,
  supplier: supplierSchema,
});

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> {
  const input = onboardBodySchema.parse(req.body);

  const { result } = await onboardEgsWorkflow(req.scope).run({ input });

  // The workflow result is the status view — secret-free by construction.
  res.json(result);
}
