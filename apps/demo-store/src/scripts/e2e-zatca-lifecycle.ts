import { randomUUID } from "node:crypto";

import type { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import { onboardEgsWorkflow, reportInvoiceWorkflow } from "medusa-plugin-zatca/workflows";
import type { ZatcaModuleService } from "medusa-plugin-zatca/modules/zatca";
import { ensureZatcaInvoiceOrderLink } from "medusa-plugin-zatca/lib/zatca-order-link";
import {
  deriveSimplifiedInvoiceTaxBase,
  type DerivedSimplifiedInvoiceTaxBase,
  type OrderGraphForZatcaTaxBase,
  ZATCA_CURRENCY,
  ZATCA_DOCUMENT_TYPE,
  ZATCA_INVOICE_STATUS,
  ZATCA_LIFECYCLE_SOURCE_TYPE,
  ZATCA_NOTE_REASON,
  ZATCA_ORIGINAL_INVOICE_ORDER_FIELDS,
  ZATCA_QUERY_ENTITY,
  ZATCA_VAT,
} from "medusa-plugin-zatca/modules/zatca";
import { issueCancellationCreditNote } from "medusa-plugin-zatca/subscribers/zatca-cancel-credit-note";
import { issueOrderEditNote } from "medusa-plugin-zatca/subscribers/zatca-order-edit-note";
import { issueRefundCreditNotesForPayment } from "medusa-plugin-zatca/subscribers/zatca-refund-credit-note";
import { issueReturnCreditNote } from "medusa-plugin-zatca/subscribers/zatca-return-credit-note";

/**
 * Live ZATCA sandbox lifecycle gate.
 *
 * This script creates real demo orders for Module Link coverage, reports the
 * original invoice for each, then drives the same lifecycle functions used by
 * the subscribers with deterministic event graph data:
 *
 * - real tax-inclusive order graph -> reported 388
 * - capture/original invoice -> reported 388
 * - partial refund -> reported credit note 381
 * - full refund on a second order -> reported credit note 381
 * - return received -> line-accurate reported credit note 381
 * - cancellation after invoice -> reported full credit note 381
 * - post-issuance edit down -> reported credit note 381
 * - post-issuance edit up -> reported debit note 383
 *
 * Run: `pnpm --filter demo-store e2e:zatca-lifecycle`
 */

interface ZatcaInvoiceRow {
  id: string;
  order_id: string;
  document_type: string;
  source_type: string;
  source_id: string;
  parent_invoice_id: string | null;
  billing_reference: string | null;
  reason: string | null;
  lines_snapshot?: unknown;
  status: string;
  icv: number;
  pih: string;
  invoice_hash: string;
  xml: string;
  qr_code: string | null;
  reported_at?: Date | string | null;
}

interface DemoOrder {
  id: string;
}

interface LifecycleLine {
  id: number;
  sourceItemId: string;
  name: string;
  quantity: number;
  unitPriceHalalas: number;
  lineExtensionHalalas: number;
  vatPercent: number;
}

const VAT_PERCENT = ZATCA_VAT.DEFAULT_PERCENT;

const supplier = {
  crn: "1010010000",
  street: "Prince Sultan",
  building: "2322",
  citySubdivision: "Al-Murabba",
  city: "Riyadh",
  postalZone: "23333",
  vatNumber: "399999999900003",
  name: "Maximum Speed Tech Supply LTD",
};

const logger = {
  info: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
};

function vatOf(taxExclusiveHalalas: number, vatPercent: number): number {
  return Math.round((taxExclusiveHalalas * Math.round(vatPercent * 100)) / 10_000);
}

function totalsForLines(lines: LifecycleLine[]): {
  expectedTaxInclusiveHalalas: number;
  expectedTaxHalalas: number;
} {
  const expectedTaxHalalas = lines.reduce(
    (sum, line) => sum + vatOf(line.lineExtensionHalalas, line.vatPercent),
    0,
  );
  const taxExclusiveHalalas = lines.reduce(
    (sum, line) => sum + line.lineExtensionHalalas,
    0,
  );
  return {
    expectedTaxInclusiveHalalas: taxExclusiveHalalas + expectedTaxHalalas,
    expectedTaxHalalas,
  };
}

function sar(halalas: number): number {
  return halalas / 100;
}

function issueParts(now = new Date()): { issueDate: string; issueTime: string } {
  const iso = now.toISOString();
  return {
    issueDate: iso.slice(0, 10),
    issueTime: iso.slice(11, 19),
  };
}

function baseLines(orderId: string): LifecycleLine[] {
  return [
    {
      id: 1,
      sourceItemId: `${orderId}:line-a`,
      name: "Lifecycle item A",
      quantity: 2,
      unitPriceHalalas: 1000,
      lineExtensionHalalas: 2000,
      vatPercent: VAT_PERCENT,
    },
    {
      id: 2,
      sourceItemId: `${orderId}:line-b`,
      name: "Lifecycle item B",
      quantity: 1,
      unitPriceHalalas: 2000,
      lineExtensionHalalas: 2000,
      vatPercent: VAT_PERCENT,
    },
  ];
}

function singleLine(orderId: string, netHalalas: number): LifecycleLine[] {
  return [
    {
      id: 1,
      sourceItemId: `${orderId}:line-a`,
      name: "Lifecycle item A",
      quantity: 1,
      unitPriceHalalas: netHalalas,
      lineExtensionHalalas: netHalalas,
      vatPercent: VAT_PERCENT,
    },
  ];
}

function orderGraph(orderId: string, netHalalas: number) {
  const taxHalalas = vatOf(netHalalas, VAT_PERCENT);
  return {
    id: orderId,
    currency_code: ZATCA_CURRENCY.SAR_LOWERCASE,
    status: "completed",
    total: sar(netHalalas + taxHalalas),
    tax_total: sar(taxHalalas),
    items: [
      {
        id: `${orderId}:line-a`,
        title: "Lifecycle item A",
        quantity: 1,
        detail: { quantity: 1 },
        unit_price: sar(netHalalas),
        is_tax_inclusive: false,
        subtotal: sar(netHalalas),
        total: sar(netHalalas + taxHalalas),
        tax_total: sar(taxHalalas),
        discount_total: 0,
        discount_tax_total: 0,
        tax_lines: [
          {
            rate: VAT_PERCENT,
            total: sar(taxHalalas),
            subtotal: sar(netHalalas),
          },
        ],
      },
    ],
    shipping_methods: [],
  };
}

async function ensureProductionEgs(
  container: ExecArgs["container"],
  service: InstanceType<typeof ZatcaModuleService>,
): Promise<void> {
  const status = await service.getOnboardingStatus();
  if (status.status === "production") {
    const [credential] = await service.listZatcaCredentials({}, { take: 1 });
    if (credential && !credential.supplier) {
      await service.updateZatcaCredentials({ id: credential.id, supplier });
    }
    return;
  }

  await onboardEgsWorkflow(container).run({
    input: {
      otp: "123456",
      commonName: "TST-886431145-399999999900003",
      solutionName: "medusa-ksa",
      model: "1.0",
      serialNumber: `egs-${Date.now()}`,
      vatNumber: supplier.vatNumber,
      organizationName: supplier.name,
      branchName: "Riyadh Branch",
      address: "RRRD2929",
      industry: "Supply activities",
      crn: supplier.crn,
      supplier,
    },
  });
}

async function createDemoOrder(container: ExecArgs["container"], label: string) {
  const orderModule = container.resolve(Modules.ORDER) as {
    createOrders(input: Record<string, unknown>): Promise<DemoOrder>;
  };
  const token = randomUUID().slice(0, 8);
  return orderModule.createOrders({
    currency_code: ZATCA_CURRENCY.SAR_LOWERCASE,
    email: `zatca-lifecycle-${token}@example.com`,
    items: [{ title: label, quantity: 1, unit_price: 10 }],
  });
}

async function createTaxInclusiveOrder(container: ExecArgs["container"]) {
  const orderModule = container.resolve(Modules.ORDER) as {
    createOrders(input: Record<string, unknown>): Promise<DemoOrder>;
  };
  const token = randomUUID().slice(0, 8);
  return orderModule.createOrders({
    currency_code: ZATCA_CURRENCY.SAR_LOWERCASE,
    email: `zatca-inclusive-${token}@example.com`,
    items: [
      {
        title: "Inclusive discounted taxable item",
        quantity: 2,
        unit_price: 115,
        is_tax_inclusive: true,
        tax_lines: [
          {
            code: `vat-${ZATCA_VAT.DEFAULT_PERCENT}`,
            rate: ZATCA_VAT.DEFAULT_PERCENT,
          },
        ],
        adjustments: [
          {
            code: `zatca-inclusive-discount-${token}`,
            amount: 23,
            description: "Inclusive line discount",
          },
        ],
      },
      {
        title: "Inclusive zero-rate item",
        quantity: 1,
        unit_price: 50,
        is_tax_inclusive: true,
        tax_lines: [
          {
            code: `vat-${ZATCA_VAT.ZERO_PERCENT}`,
            rate: ZATCA_VAT.ZERO_PERCENT,
          },
        ],
      },
    ],
    shipping_methods: [
      {
        name: "Inclusive delivery",
        amount: 11.5,
        is_tax_inclusive: true,
        tax_lines: [
          {
            code: `vat-${ZATCA_VAT.DEFAULT_PERCENT}`,
            rate: ZATCA_VAT.DEFAULT_PERCENT,
          },
        ],
      },
    ],
  });
}

async function issueOriginalInvoice(input: {
  container: ExecArgs["container"];
  service: InstanceType<typeof ZatcaModuleService>;
  order: DemoOrder;
  serialNumber: string;
  lines: LifecycleLine[];
}): Promise<ZatcaInvoiceRow> {
  const parts = issueParts();
  const { result } = await reportInvoiceWorkflow(input.container).run({
    input: {
      orderId: input.order.id,
      serialNumber: input.serialNumber,
      issueDate: parts.issueDate,
      issueTime: parts.issueTime,
      lines: input.lines,
      ...totalsForLines(input.lines),
    },
  });
  if (result.status !== ZATCA_INVOICE_STATUS.REPORTED) {
    throw new Error(
      `original invoice ${input.serialNumber} was ${result.status}, expected reported`,
    );
  }
  await ensureZatcaInvoiceOrderLink(input.container, input.order.id, result.id);
  return input.service.retrieveZatcaInvoice(result.id) as Promise<ZatcaInvoiceRow>;
}

async function invoiceBySource(
  service: InstanceType<typeof ZatcaModuleService>,
  sourceType: string,
  sourceId: string,
): Promise<ZatcaInvoiceRow> {
  const [row] = await service.listZatcaInvoices(
    { source_type: sourceType, source_id: sourceId },
    { take: 1 },
  );
  if (!row) {
    throw new Error(`no ZATCA invoice for ${sourceType}:${sourceId}`);
  }
  return row as ZatcaInvoiceRow;
}

function assertReportedDocument(
  row: ZatcaInvoiceRow,
  expected: {
    documentType: string;
    sourceType: string;
    sourceId: string;
    parent?: ZatcaInvoiceRow;
    billingReference?: string;
  },
): void {
  if (row.status !== ZATCA_INVOICE_STATUS.REPORTED) {
    throw new Error(`${row.id} status ${row.status}; expected reported`);
  }
  if (row.document_type !== expected.documentType) {
    throw new Error(
      `${row.id} document_type ${row.document_type}; expected ${expected.documentType}`,
    );
  }
  if (row.source_type !== expected.sourceType || row.source_id !== expected.sourceId) {
    throw new Error(
      `${row.id} source ${row.source_type}:${row.source_id}; expected ${expected.sourceType}:${expected.sourceId}`,
    );
  }
  if (!row.reported_at || !row.qr_code || !row.invoice_hash || !row.pih) {
    throw new Error(`${row.id} is missing reporting or chain fields`);
  }
  if (expected.parent) {
    if (row.parent_invoice_id !== expected.parent.id) {
      throw new Error(`${row.id} parent ${row.parent_invoice_id}; expected ${expected.parent.id}`);
    }
    if (row.billing_reference !== expected.billingReference) {
      throw new Error(
        `${row.id} billing_reference ${row.billing_reference}; expected ${expected.billingReference}`,
      );
    }
    if (!row.reason || !row.xml.includes("<cbc:InstructionNote>")) {
      throw new Error(`${row.id} is missing the note reason`);
    }
    if (row.xml.includes("<cbc:PayableAmount currencyID=\"SAR\">-")) {
      throw new Error(`${row.id} contains a negative payable amount`);
    }
  }
}

function assertStrictIcvs(rows: ZatcaInvoiceRow[]): void {
  for (let idx = 1; idx < rows.length; idx += 1) {
    const previous = rows[idx - 1]!;
    const current = rows[idx]!;
    if (current.icv !== previous.icv + 1) {
      throw new Error(
        `ICV chain gap between ${previous.id} (${previous.icv}) and ${current.id} (${current.icv})`,
      );
    }
  }
}

function assertReturnLineAccurate(row: ZatcaInvoiceRow, expectedQuantity: number): void {
  const snapshot = row.lines_snapshot as { lines?: { quantity?: unknown }[] } | null;
  const quantity = Number(snapshot?.lines?.[0]?.quantity);
  if (quantity !== expectedQuantity) {
    throw new Error(`return credit note quantity ${quantity}; expected ${expectedQuantity}`);
  }
}

function assertLocalFailureUnchained(row: ZatcaInvoiceRow): void {
  if (row.status !== ZATCA_INVOICE_STATUS.FAILED) {
    throw new Error(`${row.id} status ${row.status}; expected failed`);
  }
  if (row.icv !== null || row.pih !== null || row.invoice_hash !== null || row.xml !== null) {
    throw new Error(`${row.id} unexpectedly touched the ZATCA chain`);
  }
  if (row.qr_code !== null) {
    throw new Error(`${row.id} unexpectedly has a QR code`);
  }
}

function assertSnapshotTotals(
  row: ZatcaInvoiceRow,
  taxBase: DerivedSimplifiedInvoiceTaxBase,
): void {
  const snapshot = row.lines_snapshot as
    | {
        totals?: {
          taxInclusiveHalalas?: unknown;
          taxHalalas?: unknown;
        };
      }
    | null;
  const taxInclusive = Number(snapshot?.totals?.taxInclusiveHalalas);
  const tax = Number(snapshot?.totals?.taxHalalas);
  if (taxInclusive !== taxBase.expectedTaxInclusiveHalalas) {
    throw new Error(
      `${row.id} TaxInclusiveAmount ${taxInclusive}; expected ${taxBase.expectedTaxInclusiveHalalas}`,
    );
  }
  if (tax !== taxBase.expectedTaxHalalas) {
    throw new Error(`${row.id} TaxAmount ${tax}; expected ${taxBase.expectedTaxHalalas}`);
  }
}

async function assertForcedFailureChainProof(
  service: InstanceType<typeof ZatcaModuleService>,
  input: {
    failed: ZatcaInvoiceRow;
    previous: ZatcaInvoiceRow;
    next: ZatcaInvoiceRow;
  },
): Promise<void> {
  const manager = (service as unknown as {
    manager?: { execute(sql: string, params?: unknown[]): Promise<unknown[]> };
  }).manager;
  if (!manager) {
    throw new Error("ZATCA service manager is unavailable for chain proof query");
  }
  const [row] = (await manager.execute(
    `select
        (select max(icv) from zatca_invoice where deleted_at is null) as max_icv,
        concat_ws(':', f.icv, f.pih, f.invoice_hash) as failed_chain_fields,
        n.pih as next_pih
       from zatca_invoice f
       cross join zatca_invoice n
      where f.id = ? and n.id = ?`,
    [input.failed.id, input.next.id],
  )) as {
    max_icv: number | string;
    failed_chain_fields: string;
    next_pih: string;
  }[];
  if (!row) {
    throw new Error("forced failure chain proof query returned no rows");
  }
  const maxIcv = Number(row.max_icv);
  if (maxIcv !== input.next.icv) {
    throw new Error(`max(icv) ${maxIcv}; expected next invoice ICV ${input.next.icv}`);
  }
  if (row.failed_chain_fields !== "") {
    throw new Error(`forced failure has chain fields: ${row.failed_chain_fields}`);
  }
  if (row.next_pih !== input.previous.invoice_hash) {
    throw new Error("next invoice PIH does not match previous submitted hash");
  }
  console.log(
    `ZATCA forced failure chain proof: max_icv=${maxIcv}, failed_chain_fields="", next_pih_matches_previous=true`,
  );
}

export default async function e2eZatcaLifecycle({ container }: ExecArgs) {
  const service: InstanceType<typeof ZatcaModuleService> =
    container.resolve("zatca");
  const query = container.resolve<{
    graph(input: {
      entity: string;
      fields: string[];
      filters: Record<string, unknown>;
    }): Promise<{ data: unknown[] }>;
  }>(ContainerRegistrationKeys.QUERY);

  await ensureProductionEgs(container, service);

  const reportedRows: ZatcaInvoiceRow[] = [];

  const inclusiveOrder = await createTaxInclusiveOrder(container);
  const { data: inclusiveOrders } = await query.graph({
    entity: ZATCA_QUERY_ENTITY.ORDER,
    fields: [...ZATCA_ORIGINAL_INVOICE_ORDER_FIELDS],
    filters: { id: inclusiveOrder.id },
  });
  const inclusiveOrderGraph = inclusiveOrders[0] as
    | (OrderGraphForZatcaTaxBase & { display_id?: number })
    | undefined;
  if (!inclusiveOrderGraph) {
    throw new Error(`tax-inclusive order ${inclusiveOrder.id} was not resolved`);
  }
  const inclusiveTaxBase = deriveSimplifiedInvoiceTaxBase(inclusiveOrderGraph);
  const inclusiveParts = issueParts();
  const inclusiveSerialNumber = `INV-INCL-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const { result: inclusiveResult } = await reportInvoiceWorkflow(container).run({
    input: {
      orderId: inclusiveOrder.id,
      serialNumber: inclusiveSerialNumber,
      issueDate: inclusiveParts.issueDate,
      issueTime: inclusiveParts.issueTime,
      lines: inclusiveTaxBase.lines,
      documentAllowances: inclusiveTaxBase.documentAllowances,
      documentCharges: inclusiveTaxBase.documentCharges,
      expectedTaxInclusiveHalalas: inclusiveTaxBase.expectedTaxInclusiveHalalas,
      expectedTaxHalalas: inclusiveTaxBase.expectedTaxHalalas,
    },
  });
  const inclusiveInvoice = await service.retrieveZatcaInvoice(
    inclusiveResult.id,
  ) as ZatcaInvoiceRow;
  assertReportedDocument(inclusiveInvoice, {
    documentType: ZATCA_DOCUMENT_TYPE.INVOICE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER,
    sourceId: inclusiveOrder.id,
  });
  assertSnapshotTotals(inclusiveInvoice, inclusiveTaxBase);
  await ensureZatcaInvoiceOrderLink(container, inclusiveOrder.id, inclusiveResult.id);
  reportedRows.push(inclusiveInvoice);

  const chainPreviousOrder = await createDemoOrder(
    container,
    "ZATCA chain continuity previous",
  );
  const chainPrevious = await issueOriginalInvoice({
    container,
    service,
    order: chainPreviousOrder,
    serialNumber: `INV-CHAIN-PREV-${Date.now()}-${randomUUID().slice(0, 6)}`,
    lines: baseLines(chainPreviousOrder.id),
  });
  reportedRows.push(chainPrevious);

  const chainFailedOrder = await createDemoOrder(
    container,
    "ZATCA chain continuity forced failure",
  );
  const failedLines = baseLines(chainFailedOrder.id);
  const failedTotals = totalsForLines(failedLines);
  const failedParts = issueParts();
  const { result: failedResult } = await reportInvoiceWorkflow(container).run({
    input: {
      orderId: chainFailedOrder.id,
      serialNumber: `INV-CHAIN-FAIL-${Date.now()}-${randomUUID().slice(0, 6)}`,
      issueDate: failedParts.issueDate,
      issueTime: failedParts.issueTime,
      lines: failedLines,
      expectedTaxInclusiveHalalas: failedTotals.expectedTaxInclusiveHalalas + 1,
      expectedTaxHalalas: failedTotals.expectedTaxHalalas,
    },
  });
  const forcedFailure = await service.retrieveZatcaInvoice(
    failedResult.id,
  ) as ZatcaInvoiceRow;
  assertLocalFailureUnchained(forcedFailure);

  const chainNextOrder = await createDemoOrder(container, "ZATCA chain continuity next");
  const chainNext = await issueOriginalInvoice({
    container,
    service,
    order: chainNextOrder,
    serialNumber: `INV-CHAIN-NEXT-${Date.now()}-${randomUUID().slice(0, 6)}`,
    lines: baseLines(chainNextOrder.id),
  });
  if (chainNext.icv !== chainPrevious.icv + 1) {
    throw new Error(
      `chain next ICV ${chainNext.icv}; expected ${chainPrevious.icv + 1}`,
    );
  }
  if (chainNext.pih !== chainPrevious.invoice_hash) {
    throw new Error("chain next PIH does not match previous submitted hash");
  }
  await assertForcedFailureChainProof(service, {
    failed: forcedFailure,
    previous: chainPrevious,
    next: chainNext,
  });
  reportedRows.push(chainNext);

  const createInvoice = async (label: string, linesForOrder: LifecycleLine[]) => {
    const order = await createDemoOrder(container, label);
    const serialNumber = `INV-LC-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const original = await issueOriginalInvoice({
      container,
      service,
      order,
      serialNumber,
      lines: linesForOrder.map((line) => ({
        ...line,
        sourceItemId: line.sourceItemId.replace("ORDER_ID", order.id),
      })),
    });
    assertReportedDocument(original, {
      documentType: ZATCA_DOCUMENT_TYPE.INVOICE,
      sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER,
      sourceId: order.id,
    });
    reportedRows.push(original);
    return { order, original, serialNumber };
  };

  const partial = await createInvoice("ZATCA lifecycle partial refund", baseLines("ORDER_ID"));
  const partialRefundId = `refund_lc_${randomUUID().slice(0, 8)}`;
  await issueRefundCreditNotesForPayment(`pay_lc_${partialRefundId}`, {
    queryGraph: async () => ({
      data: [
        {
          id: `pay_lc_${partialRefundId}`,
          refunds: [
            {
              id: partialRefundId,
              amount: 11.5,
              created_at: new Date(),
            },
          ],
          payment_collection: { order: { id: partial.order.id } },
        },
      ],
    }),
    service,
    runReportWorkflow: async (input) =>
      (await reportInvoiceWorkflow(container).run({ input })).result,
    linkDocument: (orderId, invoiceId) =>
      ensureZatcaInvoiceOrderLink(container, orderId, invoiceId),
    logger,
    now: () => new Date(),
  });
  const partialCredit = await invoiceBySource(
    service,
    ZATCA_LIFECYCLE_SOURCE_TYPE.REFUND,
    partialRefundId,
  );
  assertReportedDocument(partialCredit, {
    documentType: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.REFUND,
    sourceId: partialRefundId,
    parent: partial.original,
    billingReference: partial.serialNumber,
  });
  reportedRows.push(partialCredit);

  const full = await createInvoice("ZATCA lifecycle full refund", baseLines("ORDER_ID"));
  const fullRefundId = `refund_lc_${randomUUID().slice(0, 8)}`;
  await issueRefundCreditNotesForPayment(`pay_lc_${fullRefundId}`, {
    queryGraph: async () => ({
      data: [
        {
          id: `pay_lc_${fullRefundId}`,
          refunds: [
            {
              id: fullRefundId,
              amount: 46,
              created_at: new Date(),
            },
          ],
          payment_collection: { order: { id: full.order.id } },
        },
      ],
    }),
    service,
    runReportWorkflow: async (input) =>
      (await reportInvoiceWorkflow(container).run({ input })).result,
    linkDocument: (orderId, invoiceId) =>
      ensureZatcaInvoiceOrderLink(container, orderId, invoiceId),
    logger,
    now: () => new Date(),
  });
  const fullCredit = await invoiceBySource(
    service,
    ZATCA_LIFECYCLE_SOURCE_TYPE.REFUND,
    fullRefundId,
  );
  assertReportedDocument(fullCredit, {
    documentType: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.REFUND,
    sourceId: fullRefundId,
    parent: full.original,
    billingReference: full.serialNumber,
  });
  reportedRows.push(fullCredit);

  const returned = await createInvoice("ZATCA lifecycle return", baseLines("ORDER_ID"));
  const returnId = `return_lc_${randomUUID().slice(0, 8)}`;
  await issueReturnCreditNote(
    { order_id: returned.order.id, return_id: returnId },
    {
      queryGraph: async () => ({
        data: [
          {
            id: returnId,
            order_id: returned.order.id,
            reason: ZATCA_NOTE_REASON.RETURN_RECEIVED,
            items: [
              {
                item_id: `${returned.order.id}:line-a`,
                quantity: 1,
                received_quantity: 1,
              },
            ],
          },
        ],
      }),
      service,
      runReportWorkflow: async (input) =>
        (await reportInvoiceWorkflow(container).run({ input })).result,
      linkDocument: (orderId, invoiceId) =>
        ensureZatcaInvoiceOrderLink(container, orderId, invoiceId),
      logger,
      now: () => new Date(),
    },
  );
  const returnCredit = await invoiceBySource(
    service,
    ZATCA_LIFECYCLE_SOURCE_TYPE.RETURN,
    returnId,
  );
  assertReportedDocument(returnCredit, {
    documentType: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.RETURN,
    sourceId: returnId,
    parent: returned.original,
    billingReference: returned.serialNumber,
  });
  assertReturnLineAccurate(returnCredit, 1);
  reportedRows.push(returnCredit);

  const canceled = await createInvoice("ZATCA lifecycle cancel", baseLines("ORDER_ID"));
  await issueCancellationCreditNote(canceled.order.id, {
    service,
    runReportWorkflow: async (input) =>
      (await reportInvoiceWorkflow(container).run({ input })).result,
    linkDocument: (orderId, invoiceId) =>
      ensureZatcaInvoiceOrderLink(container, orderId, invoiceId),
    logger,
    now: () => new Date(),
  });
  const cancelCredit = await invoiceBySource(
    service,
    ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_CANCEL,
    canceled.order.id,
  );
  assertReportedDocument(cancelCredit, {
    documentType: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_CANCEL,
    sourceId: canceled.order.id,
    parent: canceled.original,
    billingReference: canceled.serialNumber,
  });
  reportedRows.push(cancelCredit);

  const editDown = await createInvoice(
    "ZATCA lifecycle edit down",
    singleLine("ORDER_ID", 2000),
  );
  const editDownId = `edit_down_${randomUUID().slice(0, 8)}`;
  await issueOrderEditNote(
    { id: editDownId, order_id: editDown.order.id, actions: [{ type: "item_update" }] },
    {
      queryGraph: async (input) =>
        input.entity === ZATCA_QUERY_ENTITY.ORDER
          ? { data: [orderGraph(editDown.order.id, 1000)] }
          : query.graph(input),
      service,
      runReportWorkflow: async (input) =>
        (await reportInvoiceWorkflow(container).run({ input })).result,
      linkDocument: (orderId, invoiceId) =>
        ensureZatcaInvoiceOrderLink(container, orderId, invoiceId),
      logger,
      now: () => new Date(),
    },
  );
  const editDownCredit = await invoiceBySource(
    service,
    ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_EDIT,
    editDownId,
  );
  assertReportedDocument(editDownCredit, {
    documentType: ZATCA_DOCUMENT_TYPE.CREDIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_EDIT,
    sourceId: editDownId,
    parent: editDown.original,
    billingReference: editDown.serialNumber,
  });
  reportedRows.push(editDownCredit);

  const editUp = await createInvoice(
    "ZATCA lifecycle edit up",
    singleLine("ORDER_ID", 1000),
  );
  const editUpId = `edit_up_${randomUUID().slice(0, 8)}`;
  await issueOrderEditNote(
    { id: editUpId, order_id: editUp.order.id, actions: [{ type: "item_update" }] },
    {
      queryGraph: async (input) =>
        input.entity === ZATCA_QUERY_ENTITY.ORDER
          ? { data: [orderGraph(editUp.order.id, 2000)] }
          : query.graph(input),
      service,
      runReportWorkflow: async (input) =>
        (await reportInvoiceWorkflow(container).run({ input })).result,
      linkDocument: (orderId, invoiceId) =>
        ensureZatcaInvoiceOrderLink(container, orderId, invoiceId),
      logger,
      now: () => new Date(),
    },
  );
  const editUpDebit = await invoiceBySource(
    service,
    ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_EDIT,
    editUpId,
  );
  assertReportedDocument(editUpDebit, {
    documentType: ZATCA_DOCUMENT_TYPE.DEBIT_NOTE,
    sourceType: ZATCA_LIFECYCLE_SOURCE_TYPE.ORDER_EDIT,
    sourceId: editUpId,
    parent: editUp.original,
    billingReference: editUp.serialNumber,
  });
  reportedRows.push(editUpDebit);

  assertStrictIcvs(reportedRows);

  const summary = reportedRows
    .map((row) => `${row.document_type}:${row.source_type}:${row.icv}`)
    .join(", ");
  console.log(`ZATCA lifecycle e2e passed (${reportedRows.length} documents): ${summary}`);
}
