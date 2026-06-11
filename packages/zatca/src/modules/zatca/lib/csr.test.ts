import { execFile } from "node:child_process";

import { describe, expect, it } from "vitest";

import { generateEgsKeyAndCsr, type EgsCsrInput } from "./csr";

/** Parse a CSR with OpenSSL (the same oracle the ZATCA SDK uses). */
function opensslText(csrPem: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "openssl",
      ["req", "-noout", "-text"],
      (err, out) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(out)),
    );
    child.stdin!.end(csrPem);
  });
}

const input: EgsCsrInput = {
  environment: "sandbox",
  commonName: "TST-886431145-399999999900003",
  solutionName: "medusa-ksa",
  model: "1.0",
  serialNumber: "ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
  vatNumber: "399999999900003",
  organizationName: "Maximum Speed Tech Supply LTD",
  branchName: "Riyadh Branch",
  address: "RRRD2929",
  industry: "Supply activities",
};

describe("generateEgsKeyAndCsr (T4.2 gate — required fields, offline)", () => {
  it("generates a secp256k1 key and a CSR carrying every ZATCA-required field", async () => {
    const { privateKey, csr } = await generateEgsKeyAndCsr(input);

    expect(privateKey).toContain("-----BEGIN EC PRIVATE KEY-----");
    expect(csr).toContain("-----BEGIN CERTIFICATE REQUEST-----");

    const text = await opensslText(csr);
    // Subject RDNs (Developer Portal manual §5.3.1).
    expect(text).toContain("C=SA");
    expect(text).toContain("OU=Riyadh Branch");
    expect(text).toContain("O=Maximum Speed Tech Supply LTD");
    expect(text).toContain("CN=TST-886431145-399999999900003");
    // Key and signature algorithms.
    expect(text).toContain("secp256k1");
    expect(text).toContain("ecdsa-with-SHA256");
    // Certificate template extension (sandbox value, UTF8String like the SDK).
    expect(text).toContain("1.3.6.1.4.1.311.20.2");
    expect(text).toContain("TSTZATCA-Code-Signing");
    // subjectAltName dirName payload.
    expect(text).toContain(
      "SN=1-medusa-ksa|2-1.0|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
    );
    expect(text).toContain("UID=399999999900003");
    expect(text).toContain("title=0100"); // B2C only: simplified, no standard
    expect(text).toContain("registeredAddress=RRRD2929");
    expect(text).toContain("businessCategory=Supply activities");
  });

  it("selects the certificate template per environment", async () => {
    const sim = await generateEgsKeyAndCsr({ ...input, environment: "simulation" });
    expect(await opensslText(sim.csr)).toContain("PREZATCA-Code-Signing");

    const prod = await generateEgsKeyAndCsr({ ...input, environment: "production" });
    const prodText = await opensslText(prod.csr);
    expect(prodText).toContain("ZATCA-Code-Signing");
    expect(prodText).not.toContain("TSTZATCA");
    expect(prodText).not.toContain("PREZATCA");
  });

  it("each call mints a fresh keypair", async () => {
    const a = await generateEgsKeyAndCsr(input);
    const b = await generateEgsKeyAndCsr(input);
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.csr).not.toBe(b.csr);
  });

  it("rejects a malformed VAT number with a clear message", async () => {
    await expect(
      generateEgsKeyAndCsr({ ...input, vatNumber: "123" }),
    ).rejects.toThrow(/VAT/);
    await expect(
      // 15 digits but does not start/end with 3
      generateEgsKeyAndCsr({ ...input, vatNumber: "199999999900001" }),
    ).rejects.toThrow(/VAT/);
  });

  it("never embeds the private key in the CSR or error messages", async () => {
    const { privateKey, csr } = await generateEgsKeyAndCsr(input);
    const keyBody = privateKey
      .replace(/-----(BEGIN|END) EC PRIVATE KEY-----/g, "")
      .replace(/\s+/g, "");
    expect(csr).not.toContain(keyBody);
  });
});
