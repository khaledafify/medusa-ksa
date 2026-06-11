import { KsaError } from "@medusa-ksa/core";
import { describe, expect, it, vi } from "vitest";

import { FATOORA_BASE_URLS, FatooraClient } from "./fatoora-client";

const CERT_BODY = "MIID3jCCA4SgAwIBAgITEQAAOAPF90Ajs"; // representative body
const SECRET = "Xlj15LyMCgSC66ObnEO4qlPPybiK6jjHJcm6F5HBfIE=";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** fetch stub capturing the request and returning a canned JSON response. */
function fetchStub(status: number, responseBody: unknown) {
  const captured: CapturedRequest[] = [];
  const impl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { captured, impl: impl as unknown as typeof fetch };
}

const csidResponse = {
  requestID: 1234567890123,
  dispositionMessage: "ISSUED",
  binarySecurityToken: Buffer.from(CERT_BODY).toString("base64"),
  secret: SECRET,
};

describe("FatooraClient base URLs (verified against the Fatoora portal manual)", () => {
  it("targets the documented endpoint per environment", () => {
    expect(FATOORA_BASE_URLS.sandbox).toBe(
      "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
    );
    expect(FATOORA_BASE_URLS.simulation).toBe(
      "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
    );
    expect(FATOORA_BASE_URLS.production).toBe(
      "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
    );
  });
});

describe("requestComplianceCsid", () => {
  it("POSTs the base64 CSR with the OTP header and no auth", async () => {
    const { captured, impl } = fetchStub(200, csidResponse);
    const client = new FatooraClient({ environment: "sandbox", fetchImpl: impl });

    const result = await client.requestComplianceCsid({
      csr: "-----BEGIN CERTIFICATE REQUEST-----\nABC\n-----END CERTIFICATE REQUEST-----",
      otp: "123456",
    });

    const req = captured[0]!;
    expect(req.url).toBe(`${FATOORA_BASE_URLS.sandbox}/compliance`);
    expect(req.method).toBe("POST");
    expect(req.headers["Accept-Version"]).toBe("V2");
    expect(req.headers.OTP).toBe("123456");
    expect(req.headers.Authorization).toBeUndefined();
    // CSR travels base64-encoded.
    expect(req.body).toEqual({
      csr: Buffer.from(
        "-----BEGIN CERTIFICATE REQUEST-----\nABC\n-----END CERTIFICATE REQUEST-----",
      ).toString("base64"),
    });

    expect(result.requestId).toBe("1234567890123");
    expect(result.certificate).toBe(CERT_BODY);
    expect(result.secret).toBe(SECRET);
  });

  it("wraps non-2xx as KsaError without leaking the OTP", async () => {
    const { impl } = fetchStub(400, { code: "Invalid-OTP" });
    const client = new FatooraClient({ environment: "sandbox", fetchImpl: impl });
    try {
      await client.requestComplianceCsid({ csr: "x", otp: "999999" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KsaError);
      expect((err as KsaError).code).toBe("http_error");
      expect(String(err)).not.toContain("999999");
    }
  });
});

describe("authenticated calls", () => {
  const credentials = { certificate: CERT_BODY, secret: SECRET };
  /** ZATCA Basic auth: base64(base64(cert) + ":" + secret). */
  const expectedAuth = `Basic ${Buffer.from(
    `${Buffer.from(CERT_BODY).toString("base64")}:${SECRET}`,
  ).toString("base64")}`;

  it("checkInvoiceCompliance posts to /compliance/invoices with CSID basic auth", async () => {
    const { captured, impl } = fetchStub(200, {
      reportingStatus: "REPORTED",
      validationResults: { status: "PASS" },
    });
    const client = new FatooraClient({
      environment: "simulation",
      credentials,
      fetchImpl: impl,
    });

    await client.checkInvoiceCompliance({
      signedXml: "<Invoice/>",
      invoiceHash: "hash=",
      uuid: "uuid-1",
    });

    const req = captured[0]!;
    expect(req.url).toBe(`${FATOORA_BASE_URLS.simulation}/compliance/invoices`);
    expect(req.headers.Authorization).toBe(expectedAuth);
    expect(req.headers["Accept-Version"]).toBe("V2");
    expect(req.headers["Accept-Language"]).toBe("en");
    expect(req.body).toEqual({
      invoiceHash: "hash=",
      uuid: "uuid-1",
      invoice: Buffer.from("<Invoice/>").toString("base64"),
    });
  });

  it("requestProductionCsid posts the compliance request id", async () => {
    const { captured, impl } = fetchStub(200, csidResponse);
    const client = new FatooraClient({
      environment: "production",
      credentials,
      fetchImpl: impl,
    });

    const result = await client.requestProductionCsid({
      complianceRequestId: "1234567890123",
    });

    const req = captured[0]!;
    expect(req.url).toBe(`${FATOORA_BASE_URLS.production}/production/csids`);
    expect(req.headers.Authorization).toBe(expectedAuth);
    expect(req.body).toEqual({ compliance_request_id: "1234567890123" });
    expect(result.certificate).toBe(CERT_BODY);
  });

  it("reportInvoice posts to /invoices/reporting/single with Clearance-Status 0", async () => {
    const { captured, impl } = fetchStub(200, { reportingStatus: "REPORTED" });
    const client = new FatooraClient({
      environment: "sandbox",
      credentials,
      fetchImpl: impl,
    });

    const result = await client.reportInvoice({
      signedXml: "<Invoice/>",
      invoiceHash: "hash=",
      uuid: "uuid-1",
    });

    const req = captured[0]!;
    expect(req.url).toBe(`${FATOORA_BASE_URLS.sandbox}/invoices/reporting/single`);
    expect(req.headers["Clearance-Status"]).toBe("0");
    expect(req.headers.Authorization).toBe(expectedAuth);
    expect(result.reportingStatus).toBe("REPORTED");
  });

  it("accepts 202 (reported with warnings) as success", async () => {
    const { impl } = fetchStub(202, {
      reportingStatus: "REPORTED",
      validationResults: { status: "WARNING" },
    });
    const client = new FatooraClient({
      environment: "sandbox",
      credentials,
      fetchImpl: impl,
    });
    const result = await client.reportInvoice({
      signedXml: "<Invoice/>",
      invoiceHash: "h",
      uuid: "u",
    });
    expect(result.reportingStatus).toBe("REPORTED");
  });

  it("never leaks the CSID secret through error messages", async () => {
    const { impl } = fetchStub(401, { message: `bad secret ${SECRET}` });
    const client = new FatooraClient({
      environment: "sandbox",
      credentials,
      fetchImpl: impl,
    });
    try {
      await client.reportInvoice({ signedXml: "<x/>", invoiceHash: "h", uuid: "u" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KsaError);
      expect(String(err)).not.toContain(SECRET);
    }
  });

  it("requires credentials for authenticated endpoints", async () => {
    const { impl } = fetchStub(200, {});
    const client = new FatooraClient({ environment: "sandbox", fetchImpl: impl });
    await expect(
      client.reportInvoice({ signedXml: "<x/>", invoiceHash: "h", uuid: "u" }),
    ).rejects.toThrow(/credentials/i);
  });
});
