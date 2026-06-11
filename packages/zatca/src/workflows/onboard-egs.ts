import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { ZATCA_MODULE } from "../modules/zatca";
import type ZatcaModuleService from "../modules/zatca/service";
import type { OnboardEgsInput, ZatcaOnboardingStatus } from "../modules/zatca/service";

/**
 * `onboard-egs` workflow (SPEC §4, PRD §1.6): the full one-time handshake —
 * CSR → Compliance CSID → compliance checks → Production CSID.
 *
 * Steps have no compensation by design: the portal OTP is consumed by the
 * first network call, so a "rollback" cannot restore the previous state.
 * Each step is independently re-runnable instead — re-onboarding rotates
 * credentials (ADR-0004).
 *
 * The workflow result is the non-secret status view only.
 */

const requestComplianceCsidStep = createStep(
  "zatca-request-compliance-csid",
  async (input: OnboardEgsInput, { container }) => {
    const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
    const { supplier: _supplier, ...orgInput } = input;
    const result = await service.startOnboarding(orgInput);
    return new StepResponse({ complianceRequestId: result.requestId });
  },
);

const runComplianceChecksStep = createStep(
  "zatca-run-compliance-checks",
  async (input: OnboardEgsInput, { container }) => {
    const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
    await service.runOnboardingComplianceChecks(input.supplier);
    return new StepResponse(undefined);
  },
);

const requestProductionCsidStep = createStep(
  "zatca-request-production-csid",
  async (input: { complianceRequestId: string }, { container }) => {
    const service: ZatcaModuleService = container.resolve(ZATCA_MODULE);
    await service.completeOnboarding(input.complianceRequestId);
    const status: ZatcaOnboardingStatus = await service.getOnboardingStatus();
    return new StepResponse(status);
  },
);

export const onboardEgsWorkflow = createWorkflow(
  "zatca-onboard-egs",
  (input: OnboardEgsInput) => {
    const compliance = requestComplianceCsidStep(input);
    runComplianceChecksStep(input);
    const status = requestProductionCsidStep(compliance);
    return new WorkflowResponse(status);
  },
);

export default onboardEgsWorkflow;
