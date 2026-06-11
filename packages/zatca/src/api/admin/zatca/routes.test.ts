import { describe, expect, it } from "vitest";

import type ZatcaModuleService from "../../../modules/zatca/service";
import type { ZatcaInvoiceSummary } from "../../../modules/zatca/service";
import { POST as postCorrectiveCreditNote } from "./invoices/[id]/corrective-credit-note/route";
import { GET as getSummary } from "./invoices/route";
import { POST as postRetry } from "./invoices/retry/route";
import { onboardBodySchema } from "./onboard/route";
import { GET as getStatus } from "./status/route";

/**
 * Route-level secret hygiene (PRD §6): the wizard sees status only. The
 * full headless onboarding-via-routes gate runs in apps/demo-store
 * (src/scripts/test-zatca-onboarding.ts) against the sandbox.
 */

function fakeReqRes(service: Partial<InstanceType<typeof ZatcaModuleService>>) {
  let payload: unknown;
  const req = {
    params: {},
    scope: { resolve: () => service },
  } as unknown as Parameters<typeof getStatus>[0];
  const res = {
    json: (body: unknown) => {
      payload = body;
    },
  } as unknown as Parameters<typeof getStatus>[1];
  return { req, res, payload: () => payload };
}

describe("GET /admin/zatca/status", () => {
  it("returns the service's non-secret status view verbatim", async () => {
    const view = {
      status: "production" as const,
      environment: "sandbox",
      vat_number: "399999999900003",
      org_name: "Maximum Speed Tech Supply LTD",
      egs_serial_number: "1-medusa-ksa|2-1.0|3-abc",
    };
    const { req, res, payload } = fakeReqRes({
      getOnboardingStatus: () => Promise.resolve(view),
    });

    await getStatus(req, res);

    expect(payload()).toEqual(view);
    // No credential-bearing key can appear in the response shape.
    const keys = Object.keys(payload() as Record<string, unknown>);
    for (const key of keys) {
      expect(key).not.toMatch(/private|csid|secret|csr|certificate|key/i);
    }
  });
});

describe("GET /admin/zatca/invoices", () => {
  it("returns counts plus safe remediation notices — no XML, QR, or credentials", async () => {
    const summary: ZatcaInvoiceSummary = {
      pending: 1,
      reported: 5,
      rejected: 1,
      failed: 2,
      total: 9,
      documents: { invoice: 6, credit_note: 2, debit_note: 1 },
      needs_attention: 3,
      remediation: [
        {
          invoice_id: "zatinv_rej",
          order_id: "order_123",
          source_type: "refund",
          source_id: "refund_123",
          document_type: "credit_note",
          status: "rejected",
          action: "issue_corrective_credit_note",
          action_label: "Issue corrective credit note",
          message:
            "Order order_123: review the rejection and issue a corrective credit note.",
          icv_consumed: true,
          mutates_order: false,
        },
      ],
    };
    const { req, res, payload } = fakeReqRes({
      getZatcaInvoiceSummary: () => Promise.resolve(summary),
    });

    await getSummary(req, res);

    expect(payload()).toEqual(summary);
    expect(JSON.stringify(payload())).not.toMatch(
      /<Invoice|qr_code|xml|certificate|private|secret|csid/i,
    );
  });
});

describe("POST /admin/zatca/invoices/retry", () => {
  it("returns ids per outcome from the forced retry", async () => {
    const outcome = { reported: ["zatinv_1"], rejected: [], failed: ["zatinv_2"] };
    const { req, res, payload } = fakeReqRes({
      retryFailedZatcaInvoices: () => Promise.resolve(outcome),
    });

    await postRetry(req, res);

    expect(payload()).toEqual(outcome);
  });
});

describe("POST /admin/zatca/invoices/:id/corrective-credit-note", () => {
  it("returns the non-mutating corrective action for the admin dashboard", async () => {
    const action = {
      invoice_id: "zatinv_rej",
      order_id: "order_123",
      source_type: "refund",
      source_id: "refund_123",
      document_type: "credit_note" as const,
      status: "rejected" as const,
      action: "issue_corrective_credit_note" as const,
      action_label: "Issue corrective credit note",
      message:
        "Order order_123: issue a corrective credit note for the rejected document.",
      icv_consumed: true as const,
      mutates_order: false as const,
    };
    const { req, res, payload } = fakeReqRes({
      getCorrectiveCreditNoteAction: () => Promise.resolve(action),
    });
    (req as unknown as { params: { id: string } }).params = { id: "zatinv_rej" };

    await postCorrectiveCreditNote(req, res);

    expect(payload()).toEqual(action);
    expect(JSON.stringify(payload())).not.toMatch(
      /<Invoice|qr_code|xml|certificate|private|secret|csid/i,
    );
  });
});

describe("POST /admin/zatca/onboard body schema", () => {
  const validBody = {
    otp: "123456",
    commonName: "TST-886431145-399999999900003",
    serialNumber: "ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
    vatNumber: "399999999900003",
    organizationName: "Maximum Speed Tech Supply LTD",
    branchName: "Riyadh Branch",
    address: "RRRD2929",
    industry: "Supply activities",
    crn: "1010010000",
    supplier: {
      crn: "1010010000",
      street: "Prince Sultan",
      building: "2322",
      citySubdivision: "Al-Murabba",
      city: "Riyadh",
      postalZone: "23333",
      vatNumber: "399999999900003",
      name: "Maximum Speed Tech Supply LTD",
    },
  };

  it("accepts a full body and applies solution defaults", () => {
    const parsed = onboardBodySchema.parse(validBody);
    expect(parsed.solutionName).toBe("medusa-ksa");
    expect(parsed.model).toBe("1.0");
  });

  it("rejects a missing OTP or empty org fields", () => {
    const { otp: _otp, ...withoutOtp } = validBody;
    expect(() => onboardBodySchema.parse(withoutOtp)).toThrow();
    expect(() =>
      onboardBodySchema.parse({ ...validBody, organizationName: " " }),
    ).toThrow();
  });
});
