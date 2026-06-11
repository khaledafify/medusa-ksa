export const ZATCA_DOCUMENT_TYPE = {
  INVOICE: "invoice",
  CREDIT_NOTE: "credit_note",
  DEBIT_NOTE: "debit_note",
} as const;

export const ZATCA_DOCUMENT_TYPES = [
  ZATCA_DOCUMENT_TYPE.INVOICE,
  ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
  ZATCA_DOCUMENT_TYPE.DEBIT_NOTE,
] as const;

export type ZatcaDocumentType = (typeof ZATCA_DOCUMENT_TYPES)[number];

export const ZATCA_LIFECYCLE_SOURCE_TYPE = {
  ORDER: "order",
  REFUND: "refund",
  RETURN: "return",
  ORDER_CANCEL: "order_cancel",
  ORDER_EDIT: "order_edit",
} as const;

export const ZATCA_LIFECYCLE_SOURCE_TYPES = [
  ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER,
  ZATCA_LIFECYCLE_SOURCE_TYPE.REFUND,
  ZATCA_LIFECYCLE_SOURCE_TYPE.RETURN,
  ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_CANCEL,
  ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_EDIT,
] as const;

export type ZatcaLifecycleSourceType =
  (typeof ZATCA_LIFECYCLE_SOURCE_TYPES)[number];

export const ZATCA_INVOICE_STATUS = {
  PENDING: "pending",
  REPORTED: "reported",
  REJECTED: "rejected",
  FAILED: "failed",
} as const;

export const ZATCA_INVOICE_STATUSES = [
  ZATCA_INVOICE_STATUS.PENDING,
  ZATCA_INVOICE_STATUS.REPORTED,
  ZATCA_INVOICE_STATUS.REJECTED,
  ZATCA_INVOICE_STATUS.FAILED,
] as const;

export type ZatcaInvoiceStatus = (typeof ZATCA_INVOICE_STATUSES)[number];
