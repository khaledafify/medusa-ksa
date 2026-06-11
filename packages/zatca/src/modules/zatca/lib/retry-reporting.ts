import type { SqlExecutor } from "./hash-chain";
import {
  ZATCA_ERROR_CODE,
  ZATCA_INVOICE_STATUS,
  ZATCA_TABLE,
  type ZatcaDocumentType,
} from "./lifecycle";
import { zatcaResponseWithRemediation } from "./remediation";

/**
 * Deferred reporting engine (S6, PRD §1.5).
 *
 * Reporting gives a 24h window per invoice. The engine claims pending
 * invoices with `SELECT … FOR UPDATE SKIP LOCKED` — concurrent job runs
 * (multi-instance deployments) each claim a disjoint set, so every invoice
 * is processed exactly once. Backoff doubles per attempt inside the window;
 * an invoice that outlives the window flips to `failed` (surfaced in the
 * wizard + admin notification). The order is never touched.
 *
 * MUST run inside an open transaction: row locks hold until commit, and the
 * status updates ride the same transaction as the claim.
 */

/** Reporting window: 24h after generation (ZATCA Simplified rule). */
export const REPORTING_WINDOW_MS = 24 * 60 * 60 * 1000;
/** First retry delay; doubles per attempt. */
export const BASE_BACKOFF_MS = 5 * 60 * 1000;
/** Backoff ceiling — keeps several attempts inside the 24h window. */
export const MAX_BACKOFF_MS = 4 * 60 * 60 * 1000;

/** The slice of a `zatca_invoice` row the engine claims. */
export interface ClaimedInvoice {
  id: string;
  order_id: string;
  source_type: string;
  source_id: string;
  document_type: ZatcaDocumentType;
  parent_invoice_id: string | null;
  icv: number;
  attempts: number;
  created_at: Date;
  submitted_at: Date | null;
  uuid: string;
  invoice_hash: string;
  xml: string;
}

/** Outcome of one ZATCA Reporting call (definitive — no retry). */
export interface ReportOutcome {
  status: typeof ZATCA_INVOICE_STATUS.REPORTED | typeof ZATCA_INVOICE_STATUS.REJECTED;
  response: unknown;
}

export interface ProcessResult {
  reported: string[];
  rejected: string[];
  /** Outlived the 24h window → terminal `failed` (notify the admin). */
  failed: string[];
  /** Claimed but backoff not elapsed — untouched. */
  skipped: string[];
  /** Transient reporting error — still pending, attempt counted. */
  errored: string[];
}

export interface ProcessOptions {
  /** Max invoices claimed per run. */
  limit?: number;
  /** Clock override for tests. */
  now?: Date;
  /**
   * Perform the ZATCA Reporting call for one claimed invoice. Return a
   * definitive outcome; throw for transient failures (network, 5xx).
   */
  report: (invoice: ClaimedInvoice) => Promise<ReportOutcome>;
}

/** Delay before attempt N+1 after N failed attempts. */
export function backoffMs(attempts: number): number {
  const exp = BASE_BACKOFF_MS * 2 ** Math.max(attempts - 1, 0);
  return Math.min(exp, MAX_BACKOFF_MS);
}

export function isDue(invoice: ClaimedInvoice, now: Date): boolean {
  if (invoice.attempts === 0 || !invoice.submitted_at) return true;
  return (
    new Date(invoice.submitted_at).getTime() + backoffMs(invoice.attempts) <=
    now.getTime()
  );
}

export function isExpired(invoice: ClaimedInvoice, now: Date): boolean {
  return (
    new Date(invoice.created_at).getTime() + REPORTING_WINDOW_MS <=
    now.getTime()
  );
}

/** Single-quoted SQL literal (the executor has no portable param style). */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function tsLit(date: Date): string {
  return `${lit(date.toISOString())}::timestamptz`;
}

function jsonLit(value: unknown): string {
  return `${lit(JSON.stringify(value) ?? "null")}::jsonb`;
}

/**
 * Claim due pending invoices and report them. Exactly-once across
 * concurrent runs via `FOR UPDATE SKIP LOCKED`. See module docs.
 */
export async function processPendingReports(
  ex: SqlExecutor,
  options: ProcessOptions,
): Promise<ProcessResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;

  const rows = (await ex.execute(
    `select id, order_id, source_type, source_id, document_type, parent_invoice_id,
            icv, attempts, created_at, submitted_at, uuid, invoice_hash, xml
       from ${ZATCA_TABLE.INVOICE}
      where status = '${ZATCA_INVOICE_STATUS.PENDING}' and deleted_at is null
      order by created_at
      limit ${Math.trunc(limit)}
        for update skip locked`,
  )) as ClaimedInvoice[];

  const result: ProcessResult = {
    reported: [],
    rejected: [],
    failed: [],
    skipped: [],
    errored: [],
  };

  for (const invoice of rows) {
    if (isExpired(invoice, now)) {
      await ex.execute(
        `update ${ZATCA_TABLE.INVOICE}
            set status = '${ZATCA_INVOICE_STATUS.FAILED}',
                zatca_response = ${jsonLit(zatcaResponseWithRemediation(invoice, ZATCA_INVOICE_STATUS.FAILED, { error: ZATCA_ERROR_CODE.REPORTING_WINDOW_EXPIRED }))},
                updated_at = now()
          where id = ${lit(invoice.id)}`,
      );
      result.failed.push(invoice.id);
      continue;
    }
    if (!isDue(invoice, now)) {
      result.skipped.push(invoice.id);
      continue;
    }

    try {
      const outcome = await options.report(invoice);
      await ex.execute(
        `update ${ZATCA_TABLE.INVOICE}
            set status = ${lit(outcome.status)},
                zatca_response = ${jsonLit(
                  outcome.status === ZATCA_INVOICE_STATUS.REJECTED
                    ? zatcaResponseWithRemediation(invoice, ZATCA_INVOICE_STATUS.REJECTED, outcome.response)
                    : outcome.response,
                )},
                submitted_at = ${tsLit(now)},
                reported_at = ${outcome.status === ZATCA_INVOICE_STATUS.REPORTED ? tsLit(now) : "null"},
                attempts = ${invoice.attempts + 1},
                updated_at = now()
          where id = ${lit(invoice.id)}`,
      );
      result[outcome.status].push(invoice.id);
    } catch (error) {
      await ex.execute(
        `update ${ZATCA_TABLE.INVOICE}
            set zatca_response = ${jsonLit({ error: String(error) })},
                submitted_at = ${tsLit(now)},
                attempts = ${invoice.attempts + 1},
                updated_at = now()
          where id = ${lit(invoice.id)}`,
      );
      result.errored.push(invoice.id);
    }
  }

  return result;
}
