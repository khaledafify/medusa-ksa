import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KsaError, KsaErrorCodes } from "@medusa-ksa/core";

import type { ZatcaEnvironment } from "../types";

/**
 * EGS keypair + CSR generation (T4.2) — adapted from wes4m/zatca-xml-js
 * (ADR-0007) and verified against the official SDK's `fatoora -csr` output:
 * secp256k1 key, ecdsa-with-SHA256 signature, certificate-template extension
 * `1.3.6.1.4.1.311.20.2` encoded as UTF8String, and a dirName subjectAltName
 * carrying SN / UID / title / registeredAddress / businessCategory.
 *
 * The keypair is minted with `node:crypto`; only CSR assembly shells out to
 * OpenSSL (no JS library reliably signs requests over secp256k1). The private
 * key is piped to OpenSSL over stdin — it never touches the filesystem.
 */

/** Certificate template per environment (Developer Portal manual + SDK). */
const CERTIFICATE_TEMPLATES: Record<ZatcaEnvironment, string> = {
  sandbox: "TSTZATCA-Code-Signing",
  simulation: "PREZATCA-Code-Signing",
  production: "ZATCA-Code-Signing",
};

/**
 * Invoice-type capability flags (TSCZ): standard=0, simplified=1.
 * B2C-only per ADR-0006 — the EGS is certified for Simplified invoices only.
 */
const INVOICE_TYPE = "0100";

export interface EgsCsrInput {
  environment: ZatcaEnvironment;
  /** EGS unit name shown in the Fatoora portal (free text). */
  commonName: string;
  /** Solution name — part 1 of the EGS serial (`1-name|2-model|3-serial`). */
  solutionName: string;
  /** Solution model/version — part 2 of the EGS serial. */
  model: string;
  /** Unique unit serial (e.g. a UUID) — part 3 of the EGS serial. */
  serialNumber: string;
  /** VAT registration number: 15 digits, starts and ends with 3. */
  vatNumber: string;
  /** Registered taxpayer name. */
  organizationName: string;
  /** Branch name (organizational unit). */
  branchName: string;
  /** Branch address (national short address or street address). */
  address: string;
  /** Industry / business category. */
  industry: string;
}

export interface EgsKeyAndCsr {
  /** SEC1 `EC PRIVATE KEY` PEM — store encrypted, never log. */
  privateKey: string;
  /** PEM certificate request to submit for the Compliance CSID. */
  csr: string;
}

const VAT_NUMBER_PATTERN = /^3\d{13}3$/;

function fail(message: string): never {
  throw new KsaError(message, {
    prefix: "zatca",
    code: KsaErrorCodes.INVALID_OPTIONS,
  });
}

/** OpenSSL config values must stay single-line and quote-free. */
function configValue(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) fail(`${label} is required to generate a CSR.`);
  if (/[\r\n"]/.test(trimmed)) {
    fail(`${label} must not contain line breaks or double quotes.`);
  }
  return trimmed;
}

function buildOpensslConfig(input: EgsCsrInput): string {
  const egsSerial = [
    `1-${configValue("solutionName", input.solutionName)}`,
    `2-${configValue("model", input.model)}`,
    `3-${configValue("serialNumber", input.serialNumber)}`,
  ].join("|");

  return [
    "[req]",
    "prompt = no",
    "utf8 = no",
    "distinguished_name = dn",
    "req_extensions = v3_req",
    "",
    "[v3_req]",
    `1.3.6.1.4.1.311.20.2 = ASN1:UTF8String:${CERTIFICATE_TEMPLATES[input.environment]}`,
    "subjectAltName = dirName:alt_names",
    "",
    "[alt_names]",
    `SN = ${egsSerial}`,
    `UID = ${input.vatNumber}`,
    `title = ${INVOICE_TYPE}`,
    `registeredAddress = ${configValue("address", input.address)}`,
    `businessCategory = ${configValue("industry", input.industry)}`,
    "",
    "[dn]",
    `commonName = ${configValue("commonName", input.commonName)}`,
    `organizationalUnitName = ${configValue("branchName", input.branchName)}`,
    `organizationName = ${configValue("organizationName", input.organizationName)}`,
    "countryName = SA",
    "",
  ].join("\n");
}

/** Run OpenSSL, feeding the private key over stdin. */
function opensslReq(args: string[], privateKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("openssl", args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) =>
      reject(
        new KsaError(`OpenSSL is required to generate a CSR: ${error.message}`, {
          prefix: "zatca",
          code: KsaErrorCodes.INVALID_OPTIONS,
        }),
      ),
    );
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      // stderr from `openssl req` never echoes key material.
      reject(
        new KsaError(`OpenSSL CSR generation failed (exit ${code}): ${stderr.trim()}`, {
          prefix: "zatca",
          code: KsaErrorCodes.INVALID_OPTIONS,
        }),
      );
    });
    child.stdin.end(privateKey);
  });
}

/** Mint a fresh secp256k1 keypair as a SEC1 PEM. */
export function generateSecp256k1PrivateKey(): string {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
  });
  return privateKey
    .export({ type: "sec1", format: "pem" })
    .toString()
    .trim();
}

/**
 * Generate a fresh EGS keypair and a ZATCA-compliant CSR.
 *
 * The caller (onboarding workflow, T4.3) is responsible for encrypting the
 * private key at rest immediately — it must never be logged or persisted in
 * plaintext.
 */
export async function generateEgsKeyAndCsr(
  input: EgsCsrInput,
): Promise<EgsKeyAndCsr> {
  if (!VAT_NUMBER_PATTERN.test(input.vatNumber)) {
    fail(
      "VAT registration number must be 15 digits starting and ending with 3 " +
        `(got "${input.vatNumber}").`,
    );
  }

  const config = buildOpensslConfig(input);
  const privateKey = generateSecp256k1PrivateKey();

  // The config carries no secrets; only it goes to disk (private tmp dir).
  const dir = await mkdtemp(join(tmpdir(), "zatca-csr-"));
  const configPath = join(dir, "csr.cnf");
  try {
    await writeFile(configPath, config, { mode: 0o600 });
    const output = await opensslReq(
      ["req", "-new", "-sha256", "-key", "/dev/stdin", "-config", configPath],
      `${privateKey}\n`,
    );
    const marker = "-----BEGIN CERTIFICATE REQUEST-----";
    const start = output.indexOf(marker);
    if (start === -1) {
      fail("OpenSSL produced no certificate request.");
    }
    return { privateKey, csr: output.slice(start).trim() };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
