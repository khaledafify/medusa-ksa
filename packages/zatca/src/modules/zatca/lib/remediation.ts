import {
  ZATCA_DOCUMENT_TYPE,
  ZATCA_INVOICE_STATUS,
  type ZatcaDocumentType,
} from "./lifecycle";

export const ZATCA_REMEDIATION_ACTION = {
  ISSUE_CORRECTIVE_CREDIT_NOTE: "issue_corrective_credit_note",
  RETRY_FAILED_REPORTING: "retry_failed_reporting",
  REVIEW_ZATCA_REJECTION: "review_zatca_rejection",
} as const;

export type ZatcaTerminalStatus =
  | typeof ZATCA_INVOICE_STATUS.REJECTED
  | typeof ZATCA_INVOICE_STATUS.FAILED;

export type ZatcaRemediationAction =
  (typeof ZATCA_REMEDIATION_ACTION)[keyof typeof ZATCA_REMEDIATION_ACTION];

const ZATCA_REMEDIATION_ACTION_LABEL: Record<ZatcaRemediationAction, string> = {
  [ZATCA_REMEDIATION_ACTION.ISSUE_CORRECTIVE_CREDIT_NOTE]:
    "Issue corrective credit note",
  [ZATCA_REMEDIATION_ACTION.RETRY_FAILED_REPORTING]:
    "Retry failed reporting",
  [ZATCA_REMEDIATION_ACTION.REVIEW_ZATCA_REJECTION]:
    "Review ZATCA rejection",
};

export interface ZatcaTerminalDocument {
  id: string;
  order_id: string;
  source_type: string;
  source_id: string;
  document_type: ZatcaDocumentType;
  status?: string;
  parent_invoice_id?: string | null;
  icv?: number | string | null;
}

export interface ZatcaRemediationNotice {
  invoice_id: string;
  order_id: string;
  source_type: string;
  source_id: string;
  document_type: ZatcaDocumentType;
  status: ZatcaTerminalStatus;
  action: ZatcaRemediationAction;
  action_label: string;
  message: string;
  icv_consumed: true;
  mutates_order: false;
}

function documentLabel(documentType: ZatcaTerminalDocument["document_type"]): string {
  if (documentType === ZATCA_DOCUMENT_TYPE.CREDIT_NOTE) return "credit note";
  if (documentType === ZATCA_DOCUMENT_TYPE.DEBIT_NOTE) return "debit note";
  return ZATCA_DOCUMENT_TYPE.INVOICE;
}

function actionFor(
  row: ZatcaTerminalDocument,
  status: ZatcaTerminalStatus,
): { action: ZatcaRemediationAction; actionLabel: string } {
  if (status === ZATCA_INVOICE_STATUS.FAILED) {
    return {
      action: ZATCA_REMEDIATION_ACTION.RETRY_FAILED_REPORTING,
      actionLabel:
        ZATCA_REMEDIATION_ACTION_LABEL[
          ZATCA_REMEDIATION_ACTION.RETRY_FAILED_REPORTING
        ],
    };
  }
  if (row.document_type !== ZATCA_DOCUMENT_TYPE.INVOICE && row.parent_invoice_id) {
    return {
      action: ZATCA_REMEDIATION_ACTION.ISSUE_CORRECTIVE_CREDIT_NOTE,
      actionLabel:
        ZATCA_REMEDIATION_ACTION_LABEL[
          ZATCA_REMEDIATION_ACTION.ISSUE_CORRECTIVE_CREDIT_NOTE
        ],
    };
  }
  return {
    action: ZATCA_REMEDIATION_ACTION.REVIEW_ZATCA_REJECTION,
    actionLabel:
      ZATCA_REMEDIATION_ACTION_LABEL[
        ZATCA_REMEDIATION_ACTION.REVIEW_ZATCA_REJECTION
      ],
  };
}

export function zatcaRemediationNotice(
  row: ZatcaTerminalDocument,
  status: ZatcaTerminalStatus = row.status as ZatcaTerminalStatus,
): ZatcaRemediationNotice {
  const { action, actionLabel } = actionFor(row, status);
  const label = documentLabel(row.document_type);
  const icv = row.icv == null ? "the allocated" : String(row.icv);
  const message =
    status === ZATCA_INVOICE_STATUS.FAILED
      ? `Order ${row.order_id}: ZATCA ${label} ${row.id} missed the 24h reporting window. Retry reporting from the ZATCA dashboard; if ZATCA rejects a document that corrects an already reported invoice, issue a corrective credit note. ICV ${icv} is consumed and the order must not be changed.`
      : action === ZATCA_REMEDIATION_ACTION.ISSUE_CORRECTIVE_CREDIT_NOTE
        ? `Order ${row.order_id}: ZATCA rejected ${label} ${row.id}. The original invoice remains reported; review the rejection and issue a corrective credit note from the ZATCA dashboard. ICV ${icv} is consumed and the order must not be changed.`
        : `Order ${row.order_id}: ZATCA rejected ${label} ${row.id}. Review the rejection before issuing any new lifecycle document. ICV ${icv} is consumed and the order must not be changed.`;

  return {
    invoice_id: row.id,
    order_id: row.order_id,
    source_type: row.source_type,
    source_id: row.source_id,
    document_type: row.document_type,
    status,
    action,
    action_label: actionLabel,
    message,
    icv_consumed: true,
    mutates_order: false,
  };
}

function responseRecord(response: unknown): Record<string, unknown> {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return response as Record<string, unknown>;
  }
  return { response };
}

export function zatcaResponseWithRemediation(
  row: ZatcaTerminalDocument,
  status: ZatcaTerminalStatus,
  response: unknown,
): Record<string, unknown> {
  return {
    ...responseRecord(response),
    remediation: zatcaRemediationNotice(row, status),
  };
}
