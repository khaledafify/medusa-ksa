import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { getAdminOpenApiYaml } from "../../../../lib/admin-openapi"

export async function GET(_req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const yaml = await getAdminOpenApiYaml()

  res.setHeader("Cache-Control", "public, max-age=300")
  res.setHeader("Content-Type", "application/yaml; charset=utf-8")
  res.status(200).send(yaml)
}
