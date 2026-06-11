import type { ExecArgs } from "@medusajs/framework/types";

/**
 * Boot check for the ZATCA module (Phase 3, T1.3): the app must boot with
 * medusa-plugin-zatca registered and resolve the module service from the
 * container. Run: pnpm --filter demo-store exec medusa exec ./src/scripts/check-zatca-module.ts
 */
export default async function checkZatcaModule({ container }: ExecArgs) {
  const service: unknown = container.resolve("zatca");

  if (!service || typeof service !== "object") {
    throw new Error("zatca module did not resolve to a service instance");
  }

  const ctor = (service as { constructor: { name: string } }).constructor.name;
  console.log(`zatca module resolved: ${ctor}`);

  for (const method of [
    "createZatcaCredentials",
    "listZatcaCredentials",
    "createZatcaInvoices",
    "listZatcaInvoices",
  ]) {
    if (typeof (service as Record<string, unknown>)[method] !== "function") {
      throw new Error(`expected generated CRUD method missing: ${method}`);
    }
  }

  console.log("zatca module boot check passed");
}
