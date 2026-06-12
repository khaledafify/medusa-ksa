import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  ArrowPathMini,
  CheckCircle,
  Clock,
  CreditCardRefresh,
  DocumentText,
  ExclamationCircle,
  ListCheckbox,
  ReceiptPercent,
  ShieldCheck,
} from "@medusajs/icons";
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
import {
  ZATCA_DOCUMENT_TYPE,
  ZATCA_INVOICE_STATUS,
} from "../../../../modules/zatca/lib/lifecycle";

/**
 * Settings -> ZATCA is the suite's one custom admin UI: operational status,
 * safe setup metadata, onboarding, and lifecycle remediation. It never asks
 * for or displays generated ZATCA credentials.
 */

interface ZatcaStatus {
  status: "not_onboarded" | "compliance" | "production";
  environment: string;
  configuration: {
    trigger: "payment_captured" | "order_placed";
    encryption: "configured";
    reporting_window_hours: 24;
    scope: "b2c_simplified_reporting";
  };
  readiness: {
    bootstrap: true;
    compliance_identity: boolean;
    production_identity: boolean;
    signing_identity: boolean;
    supplier_profile: boolean;
  };
  lifecycle: {
    invoices: true;
    refunds: true;
    returns: true;
    cancellations: true;
    order_edits: true;
    credit_notes: true;
    debit_notes: true;
    reporting: true;
    clearance: false;
    single_egs: true;
  };
  vat_number?: string;
  org_name?: string;
  egs_serial_number?: string;
}

const REMEDIATION_ACTION = {
  ISSUE_CORRECTIVE_CREDIT_NOTE: "issue_corrective_credit_note",
  RETRY_FAILED_REPORTING: "retry_failed_reporting",
  REVIEW_ZATCA_REJECTION: "review_zatca_rejection",
} as const;

const REMEDIATION_DOCUMENT_TYPE = ZATCA_DOCUMENT_TYPE;

const TERMINAL_STATUS = {
  REJECTED: ZATCA_INVOICE_STATUS.REJECTED,
  FAILED: ZATCA_INVOICE_STATUS.FAILED,
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
  [TERMINAL_STATUS.REJECTED]: ZATCA_INVOICE_STATUS.REJECTED,
  [TERMINAL_STATUS.FAILED]: ZATCA_INVOICE_STATUS.FAILED,
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
  icv_consumed: true;
  mutates_order: false;
}

interface RetryResult {
  reported: string[];
  rejected: string[];
  failed: string[];
}

const STATUS_BADGE: Record<
  ZatcaStatus["status"],
  { color: "green" | "orange" | "red"; label: string; description: string }
> = {
  production: {
    color: "green",
    label: "Production",
    description: "Reporting is live for B2C Simplified documents.",
  },
  compliance: {
    color: "orange",
    label: "Compliance",
    description: "Finish onboarding before legal documents can be reported.",
  },
  not_onboarded: {
    color: "red",
    label: "Not onboarded",
    description: "Run the Fatoora onboarding flow before issuing documents.",
  },
};

const TRIGGER_LABEL: Record<ZatcaStatus["configuration"]["trigger"], string> = {
  payment_captured: "Payment captured",
  order_placed: "Order placed",
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

const FIELD_META: Record<
  Exclude<keyof FormState, "otp">,
  { label: string; placeholder: string }
> = {
  organizationName: {
    label: "Organization name",
    placeholder: "Maximum Speed Tech Supply LTD",
  },
  vatNumber: { label: "VAT number", placeholder: "399999999900003" },
  crn: { label: "Commercial registration", placeholder: "1010010000" },
  branchName: { label: "Branch name", placeholder: "Riyadh Branch" },
  industry: { label: "Industry", placeholder: "Retail" },
  serialNumber: { label: "EGS serial number", placeholder: "egs-pos-1" },
  commonName: {
    label: "EGS common name",
    placeholder: "TST-886431145-399999999900003",
  },
  address: { label: "Short address code", placeholder: "RRRD2929" },
  street: { label: "Street", placeholder: "Prince Sultan" },
  building: { label: "Building number", placeholder: "2322" },
  citySubdivision: { label: "District", placeholder: "Al-Murabba" },
  city: { label: "City", placeholder: "Riyadh" },
  postalZone: { label: "Postal code", placeholder: "23333" },
};

const FIELD_GROUPS: {
  title: string;
  description: string;
  fields: Exclude<keyof FormState, "otp">[];
}[] = [
  {
    title: "Seller profile",
    description: "Legal identity used in every UBL supplier party.",
    fields: [
      "organizationName",
      "vatNumber",
      "crn",
      "branchName",
      "industry",
    ],
  },
  {
    title: "EGS unit",
    description: "Device identity used for the Fatoora onboarding handshake.",
    fields: ["serialNumber", "commonName"],
  },
  {
    title: "National address",
    description: "Structured Saudi address stamped into issued documents.",
    fields: [
      "address",
      "street",
      "building",
      "citySubdivision",
      "city",
      "postalZone",
    ],
  },
];

const REQUIRED_FIELD_COUNT = Object.keys(EMPTY_FORM).length;

function formatCount(value: number | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat().format(value);
}

function formatSourceType(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readinessColor(ready: boolean): "green" | "orange" {
  return ready ? "green" : "orange";
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-ui-border-base bg-ui-bg-subtle">
        <Icon className="text-ui-fg-subtle" />
      </div>
      <div className="flex min-w-0 flex-col gap-y-1">
        <Text size="small" leading="compact" weight="plus">
          {title}
        </Text>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {description}
        </Text>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-y-1">
      <Label size="small" weight="plus" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        size="small"
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function LoadingText(): React.JSX.Element {
  return (
    <Text size="small" leading="compact" className="text-ui-fg-subtle">
      Loading...
    </Text>
  );
}

const ZatcaSettingsPage = (): React.JSX.Element => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const {
    data: status,
    isPending: statusLoading,
    error: statusError,
  } = useQuery({
    queryKey: ["zatca-status"],
    queryFn: () => sdk.client.fetch<ZatcaStatus>("/admin/zatca/status"),
  });

  const {
    data: summary,
    isPending: summaryLoading,
    error: summaryError,
  } = useQuery({
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
      toast.success("EGS onboarded. ZATCA reporting is live.");
      setForm(EMPTY_FORM);
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
  const completedFields = (Object.values(form) as string[]).filter(
    (value) => value.trim().length > 0,
  ).length;
  const formComplete = completedFields === REQUIRED_FIELD_COUNT;
  const reportedPercent =
    summary && summary.total > 0
      ? Math.round((summary.reported / summary.total) * 100)
      : 0;

  const readinessItems = status
    ? [
        {
          label: "Bootstrap config",
          description:
            "The module booted with a valid environment, trigger, and encrypted storage.",
          ready:
            status.readiness.bootstrap &&
            status.configuration.encryption === "configured",
        },
        {
          label: "Compliance identity",
          description: "Fatoora accepted the generated EGS identity for checks.",
          ready: status.readiness.compliance_identity,
        },
        {
          label: "Production identity",
          description: "The EGS identity can report legal Simplified documents.",
          ready: status.readiness.production_identity,
        },
        {
          label: "Signing material",
          description: "The module can sign UBL documents before reporting.",
          ready: status.readiness.signing_identity,
        },
        {
          label: "Supplier profile",
          description: "Seller VAT, CRN, and address are stored for UBL output.",
          ready: status.readiness.supplier_profile,
        },
      ]
    : [];

  const lifecycleRows = status
    ? [
        {
          label: "Original sale",
          document: "Invoice 388",
          enabled: status.lifecycle.invoices,
          detail:
            status.configuration.trigger === "payment_captured"
              ? "Issued when payment is captured."
              : "Issued when the order is placed, useful for COD and authorize-only stores.",
        },
        {
          label: "Refund",
          document: "Credit note 381",
          enabled: status.lifecycle.refunds && status.lifecycle.credit_notes,
          detail:
            "One credit note per refund source, idempotent by lifecycle source.",
        },
        {
          label: "Return received",
          document: "Credit note 381",
          enabled: status.lifecycle.returns && status.lifecycle.credit_notes,
          detail:
            "Credits returned quantities against the original issued lines.",
        },
        {
          label: "Cancellation",
          document: "Credit note 381",
          enabled: status.lifecycle.cancellations && status.lifecycle.credit_notes,
          detail:
            "Full credit note only after the original invoice has been reported.",
        },
        {
          label: "Order edit",
          document: "Credit or debit note",
          enabled:
            status.lifecycle.order_edits &&
            status.lifecycle.credit_notes &&
            status.lifecycle.debit_notes,
          detail:
            "Post-issuance decreases become 381; increases become 383.",
        },
        {
          label: "B2B Clearance",
          document: "Future scope",
          enabled: status.lifecycle.clearance,
          detail:
            "This release is B2C Simplified Reporting only; Clearance remains disabled.",
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-4 px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-y-1">
            <Heading level="h2">ZATCA e-invoicing</Heading>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              B2C Simplified Reporting for Saudi invoices, credit notes, and debit notes.
            </Text>
          </div>
          {statusLoading || !badge ? (
            <LoadingText />
          ) : (
            <div className="flex flex-col items-start gap-y-1 lg:items-end">
              <StatusBadge color={badge.color}>{badge.label}</StatusBadge>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {badge.description}
              </Text>
            </div>
          )}
        </div>

        {(statusError ?? summaryError) && (
          <div className="flex items-start gap-3 px-6 py-4">
            <ExclamationCircle className="mt-0.5 shrink-0 text-ui-fg-error" />
            <div className="flex flex-col gap-y-1">
              <Text size="small" leading="compact" weight="plus">
                Admin data could not be loaded
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {(statusError ?? summaryError)?.message ??
                  "Check the ZATCA admin routes and server logs."}
              </Text>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col gap-y-1">
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Environment
            </Text>
            {status ? (
              <div className="flex items-center gap-2">
                <Text size="small" leading="compact" weight="plus">
                  {status.environment}
                </Text>
                <Badge size="2xsmall">{status.status}</Badge>
              </div>
            ) : (
              <LoadingText />
            )}
          </div>
          <div className="flex flex-col gap-y-1">
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Issuance trigger
            </Text>
            <Text size="small" leading="compact" weight="plus">
              {status ? TRIGGER_LABEL[status.configuration.trigger] : "-"}
            </Text>
          </div>
          <div className="flex flex-col gap-y-1">
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Reporting window
            </Text>
            <Text size="small" leading="compact" weight="plus">
              {status ? `${status.configuration.reporting_window_hours} hours` : "-"}
            </Text>
          </div>
          <div className="flex flex-col gap-y-1">
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Scope
            </Text>
            <Text size="small" leading="compact" weight="plus">
              B2C Simplified, single EGS
            </Text>
          </div>
        </div>
      </Container>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <SectionHeading
              icon={ShieldCheck}
              title="Readiness"
              description="What must be ready before the module can sign and report legal documents."
            />
          </div>
          <div className="divide-y">
            {statusLoading && (
              <div className="px-6 py-4">
                <LoadingText />
              </div>
            )}
            {readinessItems.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-y-1">
                  <Text size="small" leading="compact" weight="plus">
                    {item.label}
                  </Text>
                  <Text size="small" leading="compact" className="text-ui-fg-subtle">
                    {item.description}
                  </Text>
                </div>
                <StatusBadge color={readinessColor(item.ready)}>
                  {item.ready ? "Ready" : "Needed"}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <SectionHeading
              icon={ListCheckbox}
              title="Active configuration"
              description="These are loaded from module options and validated at server boot."
            />
          </div>
          <div className="divide-y">
            <div className="flex items-center justify-between gap-4 px-6 py-3">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" weight="plus">
                  Encrypted storage
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Required for generated EGS material at rest.
                </Text>
              </div>
              <StatusBadge color={status ? "green" : "orange"}>
                {status ? "Configured" : "Unknown"}
              </StatusBadge>
            </div>
            <div className="flex items-center justify-between gap-4 px-6 py-3">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" weight="plus">
                  Lifecycle notes
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Legal credit/debit notes are always active in v1.1.
                </Text>
              </div>
              <StatusBadge color="green">On</StatusBadge>
            </div>
            <div className="flex items-center justify-between gap-4 px-6 py-3">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" weight="plus">
                  Reporting mode
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Documents are reported through the Simplified flow.
                </Text>
              </div>
              <StatusBadge color="green">Reporting</StatusBadge>
            </div>
          </div>
        </Container>
      </div>

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <SectionHeading
            icon={ReceiptPercent}
            title="Lifecycle coverage"
            description="How Medusa order events map to ZATCA document types in this release."
          />
        </div>
        <div className="divide-y">
          {statusLoading && (
            <div className="px-6 py-4">
              <LoadingText />
            </div>
          )}
          {lifecycleRows.map((item) => (
            <div
              key={item.label}
              className="grid grid-cols-1 gap-3 px-6 py-3 md:grid-cols-[minmax(150px,0.4fr)_minmax(150px,0.4fr)_minmax(0,1fr)_auto]"
            >
              <Text size="small" leading="compact" weight="plus">
                {item.label}
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {item.document}
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {item.detail}
              </Text>
              {item.enabled ? (
                <StatusBadge color="green">Active</StatusBadge>
              ) : (
                <Badge size="2xsmall">Out of scope</Badge>
              )}
            </div>
          ))}
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="flex flex-col gap-4 px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
          <SectionHeading
            icon={DocumentText}
            title="Reporting health"
            description="Counts include original invoices, credit notes, and debit notes."
          />
          <Button
            size="small"
            type="button"
            variant="secondary"
            onClick={() => retryFailed.mutate()}
            disabled={retryFailed.isPending || !summary || summary.failed === 0}
            isLoading={retryFailed.isPending}
          >
            <ArrowPathMini />
            Retry failed
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-6 py-4 md:grid-cols-3 xl:grid-cols-6">
          {(
            [
              ["Total", summary?.total, "All generated documents"],
              ["Reported", summary?.reported, `${reportedPercent}% success rate`],
              ["Pending", summary?.pending, "Waiting for reporting"],
              ["Rejected", summary?.rejected, "ZATCA refused"],
              ["Failed", summary?.failed, "Retry or remediate"],
              ["Attention", summary?.needs_attention, "Needs admin action"],
            ] as const
          ).map(([label, count, detail]) => (
            <div key={label} className="flex flex-col gap-y-1">
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {label}
              </Text>
              <Text size="large" leading="compact" weight="plus">
                {summaryLoading ? "-" : formatCount(count)}
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                {detail}
              </Text>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-0 divide-y px-6 py-0 md:grid-cols-3 md:divide-x md:divide-y-0">
          {(
            [
              ["Invoices", summary?.documents.invoice, "InvoiceTypeCode 388"],
              ["Credit notes", summary?.documents.credit_note, "InvoiceTypeCode 381"],
              ["Debit notes", summary?.documents.debit_note, "InvoiceTypeCode 383"],
            ] as const
          ).map(([label, count, detail]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-4 md:px-4 first:md:pl-0 last:md:pr-0">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" weight="plus">
                  {label}
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  {detail}
                </Text>
              </div>
              <Text size="large" leading="compact" weight="plus">
                {summaryLoading ? "-" : formatCount(count)}
              </Text>
            </div>
          ))}
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <SectionHeading
            icon={CreditCardRefresh}
            title="Remediation"
            description="Rejected and failed documents keep their ICV; the order is never mutated from here."
          />
        </div>

        {summaryLoading && (
          <div className="px-6 py-4">
            <LoadingText />
          </div>
        )}

        {summary?.needs_attention === 0 && (
          <div className="flex items-start gap-3 px-6 py-4">
            <CheckCircle className="mt-0.5 shrink-0 text-ui-fg-success" />
            <div className="flex flex-col gap-y-1">
              <Text size="small" leading="compact" weight="plus">
                No documents need attention
              </Text>
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                Failed reporting and ZATCA rejections will appear here with the safe next action.
              </Text>
            </div>
          </div>
        )}

        {summary && summary.needs_attention > 0 && (
          <div className="divide-y">
            {summary.remediation.map((item) => (
              <div key={item.invoice_id} className="flex flex-col gap-3 px-6 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 flex-col gap-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        color={
                          item.status === TERMINAL_STATUS.FAILED
                            ? "orange"
                            : "red"
                        }
                      >
                        {TERMINAL_STATUS_LABEL[item.status]}
                      </StatusBadge>
                      <Badge size="2xsmall">
                        {REMEDIATION_DOCUMENT_TYPE_LABEL[item.document_type]}
                      </Badge>
                      <Badge size="2xsmall">{formatSourceType(item.source_type)}</Badge>
                    </div>
                    <Text size="small" leading="compact">
                      {item.message}
                    </Text>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <Text size="small" leading="compact" className="text-ui-fg-subtle">
                        Order {item.order_id}
                      </Text>
                      <Text size="small" leading="compact" className="text-ui-fg-subtle">
                        Source {item.source_id}
                      </Text>
                      <Text size="small" leading="compact" className="text-ui-fg-subtle">
                        Document {item.invoice_id}
                      </Text>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {item.action ===
                      REMEDIATION_ACTION.ISSUE_CORRECTIVE_CREDIT_NOTE && (
                      <Button
                        size="small"
                        type="button"
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
                        type="button"
                        variant="secondary"
                        onClick={() => retryFailed.mutate()}
                        disabled={retryFailed.isPending}
                        isLoading={retryFailed.isPending}
                      >
                        <ArrowPathMini />
                        {item.action_label}
                      </Button>
                    )}
                    {item.action === REMEDIATION_ACTION.REVIEW_ZATCA_REJECTION && (
                      <Badge size="2xsmall">Review rejection</Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>

      {status?.status === "production" && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <SectionHeading
              icon={CheckCircle}
              title="Onboarding complete"
              description="The active EGS is ready for production reporting. Re-onboarding rotates the generated identity and should be handled deliberately."
            />
          </div>
          <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-3">
            <div className="flex flex-col gap-y-1">
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                Organization
              </Text>
              <Text size="small" leading="compact" weight="plus">
                {status.org_name ?? "-"}
              </Text>
            </div>
            <div className="flex flex-col gap-y-1">
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                VAT number
              </Text>
              <Text size="small" leading="compact" weight="plus">
                {status.vat_number ?? "-"}
              </Text>
            </div>
            <div className="flex flex-col gap-y-1">
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                EGS serial
              </Text>
              <Text size="small" leading="compact" weight="plus">
                {status.egs_serial_number ?? "-"}
              </Text>
            </div>
          </div>
        </Container>
      )}

      {status && status.status !== "production" && (
        <Container className="divide-y p-0">
          <div className="flex flex-col gap-4 px-6 py-4 lg:flex-row lg:items-start lg:justify-between">
            <SectionHeading
              icon={Clock}
              title="Onboarding wizard"
              description="Generates the EGS identity, runs compliance checks, and activates production reporting. Generated material is stored encrypted and never shown."
            />
            <Badge size="2xsmall">
              {completedFields}/{REQUIRED_FIELD_COUNT} fields complete
            </Badge>
          </div>

          <form
            className="divide-y"
            onSubmit={(event) => {
              event.preventDefault();
              onboard.mutate(form);
            }}
          >
            {FIELD_GROUPS.map((group) => (
              <div key={group.title} className="grid grid-cols-1 gap-4 px-6 py-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="flex flex-col gap-y-1">
                  <Text size="small" leading="compact" weight="plus">
                    {group.title}
                  </Text>
                  <Text size="small" leading="compact" className="text-ui-fg-subtle">
                    {group.description}
                  </Text>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {group.fields.map((key) => (
                    <Field
                      key={key}
                      id={`zatca-${key}`}
                      label={FIELD_META[key].label}
                      placeholder={FIELD_META[key].placeholder}
                      value={form[key]}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, [key]: value }))
                      }
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="grid grid-cols-1 gap-4 px-6 py-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" weight="plus">
                  Fatoora OTP
                </Text>
                <Text size="small" leading="compact" className="text-ui-fg-subtle">
                  Generate this one-time code in the ZATCA Fatoora portal.
                </Text>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  id="zatca-otp"
                  label="OTP"
                  placeholder="123456"
                  value={form.otp}
                  autoComplete="off"
                  onChange={(value) =>
                    setForm((current) => ({ ...current, otp: value }))
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <Text size="small" leading="compact" className="text-ui-fg-subtle">
                The server refuses to boot without encrypted storage, so this form only collects non-secret seller and EGS details.
              </Text>
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
