import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  StatusBadge,
  Text,
  toast,
} from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useState } from "react";

import { sdk } from "../../../lib/client";

/**
 * Settings → ZATCA — the suite's one custom UI (CLAUDE.md §6): status
 * banner, onboarding wizard over the backend routes, and a reporting
 * dashboard. Shows status only; no credential field ever reaches this page
 * (the routes can't leak them — ADR-0004).
 */

interface ZatcaStatus {
  status: "not_onboarded" | "compliance" | "production";
  environment: string;
  vat_number?: string;
  org_name?: string;
  egs_serial_number?: string;
}

const REMEDIATION_ACTION = {
  ISSUE_CORRECTIVE_CREDIT_NOTE: "issue_corrective_credit_note",
  RETRY_FAILED_REPORTING: "retry_failed_reporting",
  REVIEW_ZATCA_REJECTION: "review_zatca_rejection",
} as const;

const REMEDIATION_DOCUMENT_TYPE = {
  INVOICE: "invoice",
  CREDIT_NOTE: "credit_note",
  DEBIT_NOTE: "debit_note",
} as const;

const TERMINAL_STATUS = {
  REJECTED: "rejected",
  FAILED: "failed",
} as const;

type RemediationDocumentType =
  (typeof REMEDIATION_DOCUMENT_TYPE)[keyof typeof REMEDIATION_DOCUMENT_TYPE];

type TerminalStatus = (typeof TERMINAL_STATUS)[keyof typeof TERMINAL_STATUS];

const REMEDIATION_DOCUMENT_TYPE_LABEL: Record<RemediationDocumentType, string> = {
  [REMEDIATION_DOCUMENT_TYPE.INVOICE]: "invoice",
  [REMEDIATION_DOCUMENT_TYPE.CREDIT_NOTE]: "credit note",
  [REMEDIATION_DOCUMENT_TYPE.DEBIT_NOTE]: "debit note",
};

const TERMINAL_STATUS_LABEL: Record<TerminalStatus, string> = {
  [TERMINAL_STATUS.REJECTED]: "rejected",
  [TERMINAL_STATUS.FAILED]: "failed",
};

interface ZatcaSummary {
  pending: number;
  reported: number;
  rejected: number;
  failed: number;
  total: number;
  documents: {
    invoice: number;
    credit_note: number;
    debit_note: number;
  };
  needs_attention: number;
  remediation: ZatcaRemediation[];
}

interface ZatcaRemediation {
  invoice_id: string;
  order_id: string;
  source_type: string;
  source_id: string;
  document_type: RemediationDocumentType;
  status: TerminalStatus;
  action:
    (typeof REMEDIATION_ACTION)[keyof typeof REMEDIATION_ACTION];
  action_label: string;
  message: string;
  mutates_order: false;
}

interface RetryResult {
  reported: string[];
  rejected: string[];
  failed: string[];
}

const STATUS_BADGE: Record<
  ZatcaStatus["status"],
  { color: "green" | "orange" | "red"; label: string }
> = {
  production: { color: "green", label: "Production — reporting live" },
  compliance: { color: "orange", label: "Compliance — finish onboarding" },
  not_onboarded: { color: "red", label: "Not onboarded" },
};

interface FormState {
  organizationName: string;
  vatNumber: string;
  crn: string;
  branchName: string;
  industry: string;
  serialNumber: string;
  commonName: string;
  address: string;
  street: string;
  building: string;
  citySubdivision: string;
  city: string;
  postalZone: string;
  otp: string;
}

const EMPTY_FORM: FormState = {
  organizationName: "",
  vatNumber: "",
  crn: "",
  branchName: "",
  industry: "",
  serialNumber: "",
  commonName: "",
  address: "",
  street: "",
  building: "",
  citySubdivision: "",
  city: "",
  postalZone: "",
  otp: "",
};

const FIELDS: {
  key: keyof FormState;
  label: string;
  placeholder: string;
}[] = [
  { key: "organizationName", label: "Organization name", placeholder: "Maximum Speed Tech Supply LTD" },
  { key: "vatNumber", label: "VAT number", placeholder: "399999999900003" },
  { key: "crn", label: "Commercial registration (CRN)", placeholder: "1010010000" },
  { key: "branchName", label: "Branch name", placeholder: "Riyadh Branch" },
  { key: "industry", label: "Industry", placeholder: "Retail" },
  { key: "serialNumber", label: "EGS serial number", placeholder: "egs-pos-1" },
  { key: "commonName", label: "EGS common name", placeholder: "TST-886431145-399999999900003" },
  { key: "address", label: "Short address code", placeholder: "RRRD2929" },
  { key: "street", label: "Street", placeholder: "Prince Sultan" },
  { key: "building", label: "Building number", placeholder: "2322" },
  { key: "citySubdivision", label: "District", placeholder: "Al-Murabba" },
  { key: "city", label: "City", placeholder: "Riyadh" },
  { key: "postalZone", label: "Postal code", placeholder: "23333" },
];

const ZatcaSettingsPage = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: status, isPending: statusLoading } = useQuery({
    queryKey: ["zatca-status"],
    queryFn: () => sdk.client.fetch<ZatcaStatus>("/admin/zatca/status"),
  });

  const { data: summary } = useQuery({
    queryKey: ["zatca-invoice-summary"],
    queryFn: () => sdk.client.fetch<ZatcaSummary>("/admin/zatca/invoices"),
  });

  const onboard = useMutation({
    mutationFn: (input: FormState) =>
      sdk.client.fetch<ZatcaStatus>("/admin/zatca/onboard", {
        method: "POST",
        body: {
          otp: input.otp,
          commonName: input.commonName,
          serialNumber: input.serialNumber,
          vatNumber: input.vatNumber,
          organizationName: input.organizationName,
          branchName: input.branchName,
          address: input.address,
          industry: input.industry,
          crn: input.crn,
          supplier: {
            crn: input.crn,
            street: input.street,
            building: input.building,
            citySubdivision: input.citySubdivision,
            city: input.city,
            postalZone: input.postalZone,
            vatNumber: input.vatNumber,
            name: input.organizationName,
          },
        },
      }),
    onSuccess: () => {
      toast.success("EGS onboarded — ZATCA reporting is live");
      void queryClient.invalidateQueries({ queryKey: ["zatca-status"] });
    },
    onError: (error: Error) => {
      toast.error(`Onboarding failed: ${error.message}`);
    },
  });

  const retryFailed = useMutation({
    mutationFn: () =>
      sdk.client.fetch<RetryResult>("/admin/zatca/invoices/retry", {
        method: "POST",
      }),
    onSuccess: (result) => {
      toast.success(
        `Retried: ${result.reported.length} reported, ${result.rejected.length} rejected, ${result.failed.length} still failed`,
      );
      void queryClient.invalidateQueries({ queryKey: ["zatca-invoice-summary"] });
    },
    onError: (error: Error) => {
      toast.error(`Retry failed: ${error.message}`);
    },
  });

  const correctiveCreditNote = useMutation({
    mutationFn: (invoiceId: string) =>
      sdk.client.fetch<ZatcaRemediation>(
        `/admin/zatca/invoices/${invoiceId}/corrective-credit-note`,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ["zatca-invoice-summary"] });
    },
    onError: (error: Error) => {
      toast.error(`Corrective action failed: ${error.message}`);
    },
  });

  const badge = status ? STATUS_BADGE[status.status] : undefined;
  const formComplete = (Object.values(form) as string[]).every(
    (value) => value.trim().length > 0,
  );

  return (
    <div className="flex flex-col gap-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">ZATCA e-invoicing</Heading>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Fatoora Phase 2 — B2C Simplified invoices, reported within 24h
            </Text>
          </div>
          {statusLoading || !badge ? (
            <Text size="small" className="text-ui-fg-subtle">
              Loading…
            </Text>
          ) : (
            <StatusBadge color={badge.color}>{badge.label}</StatusBadge>
          )}
        </div>
        {status && status.status !== "not_onboarded" && (
          <div className="flex flex-wrap gap-x-8 gap-y-2 px-6 py-4">
            <div>
              <Text size="small" leading="compact" weight="plus">
                Environment
              </Text>
              <Badge size="2xsmall">{status.environment}</Badge>
            </div>
            <div>
              <Text size="small" leading="compact" weight="plus">
                Organization
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {status.org_name ?? "—"}
              </Text>
            </div>
            <div>
              <Text size="small" leading="compact" weight="plus">
                VAT number
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {status.vat_number ?? "—"}
              </Text>
            </div>
            <div>
              <Text size="small" leading="compact" weight="plus">
                EGS serial
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {status.egs_serial_number ?? "—"}
              </Text>
            </div>
          </div>
        )}
      </Container>

      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Text size="small" leading="compact" weight="plus">
              Reporting dashboard
            </Text>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Invoices by status
            </Text>
          </div>
          <Button
            size="small"
            variant="secondary"
            onClick={() => retryFailed.mutate()}
            disabled={retryFailed.isPending || !summary || summary.failed === 0}
            isLoading={retryFailed.isPending}
          >
            Retry failed
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4 px-6 py-4 sm:grid-cols-5">
          {(
            [
              ["Total", summary?.total],
              ["Pending", summary?.pending],
              ["Reported", summary?.reported],
              ["Rejected", summary?.rejected],
              ["Failed", summary?.failed],
            ] as const
          ).map(([label, count]) => (
            <div key={label}>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {label}
              </Text>
              <Text size="large" leading="compact" weight="plus">
                {count ?? "—"}
              </Text>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4 px-6 py-4">
          {(
            [
              ["Invoices", summary?.documents.invoice],
              ["Credit notes", summary?.documents.credit_note],
              ["Debit notes", summary?.documents.debit_note],
            ] as const
          ).map(([label, count]) => (
            <div key={label}>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {label}
              </Text>
              <Text size="large" leading="compact" weight="plus">
                {count ?? "—"}
              </Text>
            </div>
          ))}
        </div>
        {summary && summary.needs_attention > 0 && (
          <div className="flex flex-col gap-3 border-t px-6 py-4">
            <div className="flex items-center gap-2">
              <StatusBadge color="red">Needs attention</StatusBadge>
              <Text size="small" leading="compact" weight="plus">
                {summary.needs_attention} ZATCA document
                {summary.needs_attention === 1 ? "" : "s"} need remediation
              </Text>
            </div>
            {summary.remediation.map((item) => (
              <div
                key={item.invoice_id}
                className="flex flex-col gap-2 rounded-md border border-ui-border-base px-3 py-3"
              >
                <Text size="small" leading="compact">
                  {item.message}
                </Text>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="2xsmall">
                    {TERMINAL_STATUS_LABEL[item.status]}
                  </Badge>
                  <Badge size="2xsmall">
                    {REMEDIATION_DOCUMENT_TYPE_LABEL[item.document_type]}
                  </Badge>
                  <Text size="small" leading="compact" className="text-ui-fg-subtle">
                    Order {item.order_id}
                  </Text>
                  {item.action ===
                    REMEDIATION_ACTION.ISSUE_CORRECTIVE_CREDIT_NOTE && (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() =>
                        correctiveCreditNote.mutate(item.invoice_id)
                      }
                      disabled={correctiveCreditNote.isPending}
                      isLoading={correctiveCreditNote.isPending}
                    >
                      {item.action_label}
                    </Button>
                  )}
                  {item.action === REMEDIATION_ACTION.RETRY_FAILED_REPORTING && (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => retryFailed.mutate()}
                      disabled={retryFailed.isPending}
                      isLoading={retryFailed.isPending}
                    >
                      {item.action_label}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>

      {status && status.status !== "production" && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              Onboarding wizard
            </Text>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Generates the EGS keys, exchanges the CSR + OTP for a Compliance
              CSID, runs the compliance checks, and activates the Production
              CSID. Credentials are stored encrypted — never shown here.
            </Text>
          </div>
          <form
            className="px-6 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              onboard.mutate(form);
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FIELDS.map(({ key, label, placeholder }) => (
                <div key={key} className="flex flex-col gap-1">
                  <Label size="small" weight="plus" htmlFor={`zatca-${key}`}>
                    {label}
                  </Label>
                  <Input
                    id={`zatca-${key}`}
                    size="small"
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <Label size="small" weight="plus" htmlFor="zatca-otp">
                  Fatoora portal OTP
                </Label>
                <Input
                  id="zatca-otp"
                  size="small"
                  placeholder="123456"
                  autoComplete="off"
                  value={form.otp}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, otp: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                size="small"
                type="submit"
                disabled={!formComplete || onboard.isPending}
                isLoading={onboard.isPending}
              >
                Onboard EGS
              </Button>
            </div>
          </form>
        </Container>
      )}
    </div>
  );
};

export const config = defineRouteConfig({
  label: "ZATCA",
});

export default ZatcaSettingsPage;
