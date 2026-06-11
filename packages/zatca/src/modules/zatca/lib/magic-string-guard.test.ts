import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ZATCA_ALLOWANCE_CHARGE_REASON,
  ZATCA_COMPLIANCE_SAMPLE_TYPE,
  ZATCA_CURRENCY,
  ZATCA_DOCUMENT_TYPE,
  ZATCA_ERROR_CODE,
  ZATCA_INVOICE_STATUS,
  ZATCA_INVOICE_TYPE_CODE,
  ZATCA_LIFECYCLE_SOURCE_TYPE,
  ZATCA_MEDUSA_EVENT,
  ZATCA_NOTE_REASON,
  ZATCA_QUERY_ENTITY,
  ZATCA_TAX_SCHEME,
} from "./lifecycle";

const SRC_ROOT = join(__dirname, "..", "..", "..");
const CONSTANTS_FILE = "modules/zatca/lib/lifecycle.ts";
const TEMPLATE_DIR = "modules/zatca/lib/templates/";
const MIGRATIONS_DIR = "modules/zatca/migrations/";

const guardedLiterals = [
  ...Object.values(ZATCA_ALLOWANCE_CHARGE_REASON),
  ...Object.values(ZATCA_COMPLIANCE_SAMPLE_TYPE),
  ...Object.values(ZATCA_CURRENCY),
  ...Object.values(ZATCA_DOCUMENT_TYPE),
  ...Object.values(ZATCA_ERROR_CODE),
  ...Object.values(ZATCA_INVOICE_STATUS),
  ...Object.values(ZATCA_INVOICE_TYPE_CODE),
  ...Object.values(ZATCA_LIFECYCLE_SOURCE_TYPE),
  ...Object.values(ZATCA_MEDUSA_EVENT),
  ...Object.values(ZATCA_NOTE_REASON),
  ...Object.values(ZATCA_QUERY_ENTITY),
  ...Object.values(ZATCA_TAX_SCHEME),
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return tsFiles(fullPath);
    if (!entry.endsWith(".ts")) return [];
    if (entry.endsWith(".test.ts")) return [];
    return [fullPath];
  });
}

function stringLiteralPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(["'\`])${escaped}\\1`);
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("ZATCA domain literals", () => {
  it("keeps guarded literals in lifecycle constants or XML templates", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (
        rel === CONSTANTS_FILE ||
        rel.startsWith(TEMPLATE_DIR) ||
        rel.startsWith(MIGRATIONS_DIR)
      ) {
        continue;
      }
      const source = stripComments(readFileSync(file, "utf8"));
      for (const literal of guardedLiterals) {
        if (stringLiteralPattern(literal).test(source)) {
          offenders.push(`${rel}: ${literal}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
