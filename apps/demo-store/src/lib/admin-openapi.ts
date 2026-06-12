import { parse, stringify } from "yaml"

const DEFAULT_MEDUSA_ADMIN_OPENAPI_URL = "https://docs.medusajs.com/api/download/admin"

type OpenApiObject = Record<string, unknown>

interface OpenApiDocument extends OpenApiObject {
  openapi?: string
  info?: OpenApiObject
  servers?: OpenApiObject[]
  tags?: OpenApiObject[]
  paths?: Record<string, OpenApiObject>
  components?: {
    schemas?: Record<string, OpenApiObject>
    [key: string]: unknown
  }
}

let cachedAdminOpenApiYaml: string | undefined

export async function getAdminOpenApiYaml(): Promise<string> {
  if (cachedAdminOpenApiYaml) {
    return cachedAdminOpenApiYaml
  }

  const sourceUrl = process.env.MEDUSA_ADMIN_OPENAPI_URL ?? DEFAULT_MEDUSA_ADMIN_OPENAPI_URL
  const response = await fetch(sourceUrl, {
    headers: {
      accept: "application/yaml, text/yaml, text/plain, */*",
    },
  })

  if (!response.ok) {
    throw new Error(
      `Unable to fetch Medusa Admin OpenAPI spec from ${sourceUrl}: ${response.status} ${response.statusText}`
    )
  }

  const baseYaml = await response.text()
  const document = parse(baseYaml) as OpenApiDocument

  if (!document || !document.openapi || !document.paths) {
    throw new Error("Medusa Admin OpenAPI source did not contain a valid spec")
  }

  const merged = withZatcaAdminRoutes(document, sourceUrl)
  cachedAdminOpenApiYaml = stringify(merged, { lineWidth: 0 })

  return cachedAdminOpenApiYaml
}

function withZatcaAdminRoutes(document: OpenApiDocument, sourceUrl: string): OpenApiDocument {
  const title = String(document.info?.title ?? "Medusa Admin API")
  const description = [
    document.info?.description,
    `This demo-store reference is generated from ${sourceUrl} and extended with Medusa KSA ZATCA admin routes.`,
  ]
    .filter(Boolean)
    .join("\n\n")

  document.info = {
    ...document.info,
    title: `${title} + Medusa KSA`,
    description,
    "x-medusa-ksa-source": sourceUrl,
  }

  document.servers = [
    {
      url: "/",
      description: "Current demo-store origin",
    },
    ...(document.servers ?? []),
  ]

  document.tags = [
    ...(document.tags ?? []).filter((tag) => tag.name !== "ZATCA"),
    {
      name: "ZATCA",
      description:
        "Medusa KSA ZATCA onboarding, readiness, invoice summary, and remediation endpoints. These admin routes return non-secret dashboard views only.",
    },
  ]
  document["x-tagGroups"] = adminApiTagGroups()

  document.paths = {
    ...document.paths,
    ...zatcaAdminPaths(),
  }

  document.components = {
    ...document.components,
    schemas: {
      ...(document.components?.schemas ?? {}),
      ...zatcaAdminSchemas(),
    },
  }

  return document
}

const adminSecurity = [{ api_token: [] }, { cookie_auth: [] }, { jwt_token: [] }]

function jsonContent(schema: OpenApiObject, example?: unknown): OpenApiObject {
  return {
    content: {
      "application/json": {
        schema,
        ...(example ? { example } : {}),
      },
    },
  }
}

function commonErrorResponses(): OpenApiObject {
  return {
    "400": { $ref: "#/components/responses/400_error" },
    "401": { $ref: "#/components/responses/unauthorized" },
    "500": { $ref: "#/components/responses/500_error" },
  }
}

function adminApiTagGroups(): OpenApiObject[] {
  return [
    {
      name: "Access and platform",
      tags: [
        "Auth",
        "Users",
        "Invites",
        "Multi-Factor Authentication",
        "Api Keys",
        "Feature Flags",
        "Plugins",
        "Workflows Executions",
        "Index",
      ],
    },
    {
      name: "Catalog and pricing",
      tags: [
        "Products",
        "Product Variants",
        "Product Categories",
        "Product Tags",
        "Product Types",
        "Collections",
        "Price Lists",
        "Price Preferences",
        "Promotions",
        "Campaigns",
        "Gift Cards",
        "Property Labels",
      ],
    },
    {
      name: "Orders and customers",
      tags: [
        "Orders",
        "Draft Orders",
        "Order Changes",
        "Order Edits",
        "Claims",
        "Exchanges",
        "Returns",
        "Refund Reasons",
        "Return Reasons",
        "Customers",
        "Customer Groups",
        "Store Credit Accounts",
      ],
    },
    {
      name: "Payments and tax",
      tags: ["Payments", "Payment Collections", "Tax Providers", "Tax Rates", "Tax Regions"],
    },
    {
      name: "Fulfillment and inventory",
      tags: [
        "Fulfillment Providers",
        "Fulfillment Sets",
        "Fulfillments",
        "Inventory Items",
        "Reservations",
        "Shipping Option Types",
        "Shipping Options",
        "Shipping Profiles",
        "Stock Locations",
      ],
    },
    {
      name: "Store configuration",
      tags: [
        "Stores",
        "Regions",
        "Currencies",
        "Sales Channels",
        "Locales",
        "Translations",
        "Views",
      ],
    },
    {
      name: "Files and messaging",
      tags: ["Notifications", "Uploads"],
    },
    {
      name: "Medusa KSA",
      tags: ["ZATCA"],
    },
  ]
}

function zatcaAdminPaths(): Record<string, OpenApiObject> {
  return {
    "/admin/zatca/status": {
      get: {
        tags: ["ZATCA"],
        operationId: "GetZatcaStatus",
        summary: "Get ZATCA onboarding status",
        description:
          "Returns the non-secret ZATCA onboarding and readiness view used by the admin onboarding wizard. Credential material, CSIDs, certificates, XML, QR bytes, and private keys are never returned.",
        "x-authenticated": true,
        security: adminSecurity,
        responses: {
          "200": {
            description: "The current ZATCA onboarding status.",
            ...jsonContent(
              { $ref: "#/components/schemas/ZatcaOnboardingStatus" },
              {
                status: "production",
                environment: "sandbox",
                configuration: {
                  trigger: "payment_captured",
                  encryption: "configured",
                  reporting_window_hours: 24,
                  scope: "b2c_simplified_reporting",
                },
                readiness: {
                  bootstrap: true,
                  compliance_identity: true,
                  production_identity: true,
                  signing_identity: true,
                  supplier_profile: true,
                },
                lifecycle: {
                  invoices: true,
                  refunds: true,
                  returns: true,
                  cancellations: true,
                  order_edits: true,
                  credit_notes: true,
                  debit_notes: true,
                  reporting: true,
                  clearance: false,
                  single_egs: true,
                },
                vat_number: "399999999900003",
                org_name: "Maximum Speed Tech Supply LTD",
                egs_serial_number: "1-medusa-ksa|2-1.0|3-abc",
              }
            ),
          },
          ...commonErrorResponses(),
        },
      },
    },
    "/admin/zatca/onboard": {
      post: {
        tags: ["ZATCA"],
        operationId: "PostZatcaOnboard",
        summary: "Run ZATCA EGS onboarding",
        description:
          "Runs the CSR to Compliance CSID to simulation checks to Production CSID onboarding handshake from organization details and a ZATCA portal OTP. The response is the same non-secret status view returned by the status endpoint.",
        "x-authenticated": true,
        security: adminSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ZatcaOnboardRequest" },
              example: {
                otp: "123456",
                commonName: "TST-886431145-399999999900003",
                solutionName: "medusa-ksa",
                model: "1.0",
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
                  citySubdivision: "Al Olaya",
                  city: "Riyadh",
                  postalZone: "12211",
                  vatNumber: "399999999900003",
                  name: "Maximum Speed Tech Supply LTD",
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The resulting non-secret onboarding status.",
            ...jsonContent({ $ref: "#/components/schemas/ZatcaOnboardingStatus" }),
          },
          ...commonErrorResponses(),
        },
      },
    },
    "/admin/zatca/invoices": {
      get: {
        tags: ["ZATCA"],
        operationId: "GetZatcaInvoicesSummary",
        summary: "Get ZATCA invoice summary",
        description:
          "Returns aggregate ZATCA document counts and the latest remediation notices for terminal failed or rejected invoices. The response intentionally excludes invoice XML, QR codes, certificates, and credentials.",
        "x-authenticated": true,
        security: adminSecurity,
        responses: {
          "200": {
            description: "ZATCA invoice counts and safe remediation notices.",
            ...jsonContent(
              { $ref: "#/components/schemas/ZatcaInvoiceSummary" },
              {
                pending: 1,
                reported: 5,
                rejected: 1,
                failed: 2,
                total: 9,
                documents: {
                  invoice: 6,
                  credit_note: 2,
                  debit_note: 1,
                },
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
              }
            ),
          },
          ...commonErrorResponses(),
        },
      },
    },
    "/admin/zatca/invoices/retry": {
      post: {
        tags: ["ZATCA"],
        operationId: "PostZatcaInvoicesRetry",
        summary: "Retry failed ZATCA invoice reporting",
        description:
          "Retries all invoices currently in the terminal failed state and groups invoice IDs by the resulting reporting outcome.",
        "x-authenticated": true,
        security: adminSecurity,
        responses: {
          "200": {
            description: "Invoice IDs grouped by retry outcome.",
            ...jsonContent(
              { $ref: "#/components/schemas/ZatcaRetryFailedInvoicesResponse" },
              {
                reported: ["zatinv_1"],
                rejected: [],
                failed: ["zatinv_2"],
              }
            ),
          },
          ...commonErrorResponses(),
        },
      },
    },
    "/admin/zatca/invoices/{id}/corrective-credit-note": {
      post: {
        tags: ["ZATCA"],
        operationId: "PostZatcaInvoiceCorrectiveCreditNote",
        summary: "Get corrective credit-note action",
        description:
          "Returns the non-mutating admin remediation action for a rejected ZATCA document that supports a corrective credit note. The route does not create or mutate order documents automatically.",
        "x-authenticated": true,
        security: adminSecurity,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The ZATCA invoice ID.",
            schema: {
              type: "string",
              example: "zatinv_rej",
            },
          },
        ],
        responses: {
          "200": {
            description: "The safe corrective credit-note remediation action.",
            ...jsonContent(
              { $ref: "#/components/schemas/ZatcaRemediationNotice" },
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
                  "Order order_123: issue a corrective credit note for the rejected document.",
                icv_consumed: true,
                mutates_order: false,
              }
            ),
          },
          "404": { $ref: "#/components/responses/not_found_error" },
          ...commonErrorResponses(),
        },
      },
    },
  }
}

function zatcaAdminSchemas(): Record<string, OpenApiObject> {
  const stringRequired = { type: "string", minLength: 1 }

  return {
    ZatcaOnboardSupplier: {
      type: "object",
      description:
        "Supplier identity and address fields persisted during ZATCA EGS onboarding. These values are business profile data only; certificate and private-key material is never returned by admin routes.",
      required: [
        "crn",
        "street",
        "building",
        "citySubdivision",
        "city",
        "postalZone",
        "vatNumber",
        "name",
      ],
      additionalProperties: false,
      properties: {
        crn: {
          ...stringRequired,
          description: "Commercial registration number.",
        },
        street: { ...stringRequired, description: "Supplier street name." },
        building: {
          ...stringRequired,
          description: "Supplier building number.",
        },
        citySubdivision: {
          ...stringRequired,
          description: "Supplier district or city subdivision.",
        },
        city: { ...stringRequired, description: "Supplier city." },
        postalZone: {
          ...stringRequired,
          description: "Supplier postal code.",
        },
        vatNumber: {
          ...stringRequired,
          description: "Supplier VAT registration number.",
        },
        name: { ...stringRequired, description: "Supplier legal name." },
      },
    },
    ZatcaOnboardRequest: {
      type: "object",
      description:
        "Request body for the one-time ZATCA EGS onboarding handshake. The OTP is exchanged with ZATCA immediately; generated credentials are encrypted at rest and omitted from all API responses.",
      required: [
        "otp",
        "commonName",
        "serialNumber",
        "vatNumber",
        "organizationName",
        "branchName",
        "address",
        "industry",
        "crn",
        "supplier",
      ],
      additionalProperties: false,
      properties: {
        otp: {
          ...stringRequired,
          description: "One-time password generated in the ZATCA portal.",
        },
        commonName: {
          ...stringRequired,
          description: "CSR common name for the EGS.",
        },
        solutionName: {
          ...stringRequired,
          default: "medusa-ksa",
          description: "EGS solution name.",
        },
        model: {
          ...stringRequired,
          default: "1.0",
          description: "EGS model/version string.",
        },
        serialNumber: {
          ...stringRequired,
          description: "EGS serial number.",
        },
        vatNumber: {
          ...stringRequired,
          description: "Organization VAT registration number.",
        },
        organizationName: {
          ...stringRequired,
          description: "Organization legal name.",
        },
        branchName: {
          ...stringRequired,
          description: "Branch name used for onboarding.",
        },
        address: {
          ...stringRequired,
          description: "Short organization address used in the CSR.",
        },
        industry: {
          ...stringRequired,
          description: "Organization industry.",
        },
        crn: {
          ...stringRequired,
          description: "Organization commercial registration number.",
        },
        supplier: { $ref: "#/components/schemas/ZatcaOnboardSupplier" },
      },
    },
    ZatcaOnboardingStatus: {
      type: "object",
      description:
        "Secret-free readiness view for the ZATCA admin wizard. It reports configuration, identity readiness, and supported lifecycle coverage without exposing CSIDs, certificates, private keys, invoice XML, or QR bytes.",
      required: ["status", "environment", "configuration", "readiness", "lifecycle"],
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          description: "Current onboarding phase for the configured ZATCA environment.",
          enum: ["not_onboarded", "compliance", "production"],
        },
        environment: {
          type: "string",
          description: "ZATCA Fatoora environment selected by the demo store configuration.",
          enum: ["sandbox", "simulation", "production"],
        },
        configuration: {
          type: "object",
          description:
            "Non-secret module configuration that affects invoice issuance and reporting.",
          required: ["trigger", "encryption", "reporting_window_hours", "scope"],
          additionalProperties: false,
          properties: {
            trigger: {
              type: "string",
              description: "Medusa lifecycle event that triggers invoice issuance.",
              enum: ["payment_captured", "order_placed"],
            },
            encryption: {
              type: "string",
              description: "Indicates that encrypted credential storage is configured.",
              enum: ["configured"],
            },
            reporting_window_hours: {
              type: "integer",
              description: "Maximum window for B2C simplified invoice reporting.",
              enum: [24],
            },
            scope: {
              type: "string",
              description: "Current supported ZATCA scope for this package milestone.",
              enum: ["b2c_simplified_reporting"],
            },
          },
        },
        readiness: {
          type: "object",
          description: "Boolean readiness checks used by the onboarding wizard banner.",
          required: [
            "bootstrap",
            "compliance_identity",
            "production_identity",
            "signing_identity",
            "supplier_profile",
          ],
          additionalProperties: false,
          properties: {
            bootstrap: {
              type: "boolean",
              description: "Whether the module bootstrapped with valid non-secret configuration.",
              enum: [true],
            },
            compliance_identity: {
              type: "boolean",
              description: "Whether a Compliance CSID has been obtained.",
            },
            production_identity: {
              type: "boolean",
              description: "Whether a Production CSID has been obtained.",
            },
            signing_identity: {
              type: "boolean",
              description: "Whether encrypted signing material is present for invoice signing.",
            },
            supplier_profile: {
              type: "boolean",
              description: "Whether the supplier profile required for invoice XML exists.",
            },
          },
        },
        lifecycle: {
          type: "object",
          description: "Supported ZATCA document lifecycle coverage in the demo-store package.",
          required: [
            "invoices",
            "refunds",
            "returns",
            "cancellations",
            "order_edits",
            "credit_notes",
            "debit_notes",
            "reporting",
            "clearance",
            "single_egs",
          ],
          additionalProperties: false,
          properties: {
            invoices: {
              type: "boolean",
              description: "Simplified invoice generation is supported.",
              enum: [true],
            },
            refunds: {
              type: "boolean",
              description: "Refund-triggered credit notes are supported.",
              enum: [true],
            },
            returns: {
              type: "boolean",
              description: "Return-triggered credit notes are supported.",
              enum: [true],
            },
            cancellations: {
              type: "boolean",
              description: "Cancellation-triggered credit notes are supported.",
              enum: [true],
            },
            order_edits: {
              type: "boolean",
              description: "Order-edit credit and debit notes are supported.",
              enum: [true],
            },
            credit_notes: {
              type: "boolean",
              description: "Credit-note document generation is supported.",
              enum: [true],
            },
            debit_notes: {
              type: "boolean",
              description: "Debit-note document generation is supported.",
              enum: [true],
            },
            reporting: {
              type: "boolean",
              description: "B2C simplified reporting is supported.",
              enum: [true],
            },
            clearance: {
              type: "boolean",
              description: "B2B clearance is outside the current package milestone.",
              enum: [false],
            },
            single_egs: {
              type: "boolean",
              description: "This milestone uses one EGS identity per Medusa deployment.",
              enum: [true],
            },
          },
        },
        vat_number: {
          type: "string",
          description: "VAT registration number for the onboarded organization, when available.",
        },
        org_name: {
          type: "string",
          description: "Legal organization name for the onboarded EGS, when available.",
        },
        egs_serial_number: {
          type: "string",
          description: "EGS serial number shown for operator support; not a credential.",
        },
      },
    },
    ZatcaInvoiceSummary: {
      type: "object",
      description:
        "Aggregate ZATCA document counts plus safe remediation notices for the dashboard. This response intentionally excludes raw XML, QR payloads, certificates, and credential fields.",
      required: [
        "pending",
        "reported",
        "rejected",
        "failed",
        "total",
        "documents",
        "needs_attention",
        "remediation",
      ],
      additionalProperties: false,
      properties: {
        pending: {
          type: "integer",
          description: "Number of ZATCA documents created locally and waiting for reporting.",
          minimum: 0,
        },
        reported: {
          type: "integer",
          description: "Number of ZATCA documents successfully reported to ZATCA.",
          minimum: 0,
        },
        rejected: {
          type: "integer",
          description: "Number of terminal documents rejected by ZATCA and requiring review.",
          minimum: 0,
        },
        failed: {
          type: "integer",
          description:
            "Number of terminal documents that could not be reported within the local retry window.",
          minimum: 0,
        },
        total: {
          type: "integer",
          description: "Total number of non-deleted ZATCA document records.",
          minimum: 0,
        },
        documents: {
          type: "object",
          description: "Counts grouped by ZATCA document type.",
          required: ["invoice", "credit_note", "debit_note"],
          additionalProperties: false,
          properties: {
            invoice: {
              type: "integer",
              description: "Simplified invoice count.",
              minimum: 0,
            },
            credit_note: {
              type: "integer",
              description: "Credit-note count.",
              minimum: 0,
            },
            debit_note: {
              type: "integer",
              description: "Debit-note count.",
              minimum: 0,
            },
          },
        },
        needs_attention: {
          type: "integer",
          description: "Total rejected plus failed documents that require operator attention.",
          minimum: 0,
        },
        remediation: {
          type: "array",
          description: "Latest safe remediation notices for rejected or failed documents.",
          items: { $ref: "#/components/schemas/ZatcaRemediationNotice" },
        },
      },
    },
    ZatcaRemediationNotice: {
      type: "object",
      description:
        "Safe operator action for a terminal ZATCA document. The notice explains the next admin action without mutating orders or exposing invoice XML, QR payloads, certificates, CSIDs, secrets, or private keys.",
      required: [
        "invoice_id",
        "order_id",
        "source_type",
        "source_id",
        "document_type",
        "status",
        "action",
        "action_label",
        "message",
        "icv_consumed",
        "mutates_order",
      ],
      additionalProperties: false,
      properties: {
        invoice_id: {
          type: "string",
          description: "ZATCA invoice record ID.",
        },
        order_id: {
          type: "string",
          description: "Related Medusa order ID.",
        },
        source_type: {
          type: "string",
          description: "Medusa lifecycle source that created the ZATCA document.",
          enum: ["order", "refund", "return", "order_cancel", "order_edit"],
        },
        source_id: {
          type: "string",
          description: "ID of the Medusa source record, such as a refund, return, or order edit.",
        },
        document_type: {
          type: "string",
          description: "ZATCA document type that needs attention.",
          enum: ["invoice", "credit_note", "debit_note"],
        },
        status: {
          type: "string",
          description: "Terminal ZATCA document status that produced the notice.",
          enum: ["rejected", "failed"],
        },
        action: {
          type: "string",
          description: "Machine-readable remediation action.",
          enum: [
            "issue_corrective_credit_note",
            "retry_failed_reporting",
            "review_zatca_rejection",
          ],
        },
        action_label: {
          type: "string",
          description: "Human-readable action label for the admin dashboard.",
        },
        message: {
          type: "string",
          description:
            "Operator-facing explanation that includes why the order must not be changed after ICV allocation.",
        },
        icv_consumed: {
          type: "boolean",
          description:
            "Always true for remediation notices because ICV allocation is irreversible.",
          enum: [true],
        },
        mutates_order: {
          type: "boolean",
          description:
            "Always false; remediation notices describe an action and never mutate Medusa order state directly.",
          enum: [false],
        },
      },
    },
    ZatcaRetryFailedInvoicesResponse: {
      type: "object",
      description:
        "Result of manually retrying terminally failed ZATCA reporting attempts. Invoice IDs are grouped by the final outcome from the retry run.",
      required: ["reported", "rejected", "failed"],
      additionalProperties: false,
      properties: {
        reported: {
          type: "array",
          description: "Invoice IDs successfully reported during the retry run.",
          items: { type: "string" },
        },
        rejected: {
          type: "array",
          description: "Invoice IDs that reached ZATCA but were rejected during retry.",
          items: { type: "string" },
        },
        failed: {
          type: "array",
          description: "Invoice IDs that still could not be reported after retry.",
          items: { type: "string" },
        },
      },
    },
  }
}
