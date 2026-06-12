import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Medusa KSA Admin API Swagger</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        background: #f8fafc;
      }

      .topbar {
        display: none;
      }

      #swagger-ui .scheme-container {
        position: sticky;
        top: 0;
        z-index: 2;
        box-shadow: 0 1px 0 rgba(15, 23, 42, 0.08);
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
      window.addEventListener("load", function () {
        window.ui = SwaggerUIBundle({
          url: "/docs/admin/openapi",
          dom_id: "#swagger-ui",
          deepLinking: true,
          displayOperationId: true,
          docExpansion: "none",
          filter: true,
          persistAuthorization: true,
          tryItOutEnabled: true,
          requestInterceptor: function (request) {
            request.credentials = "include";
            return request;
          },
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset,
          ],
          layout: "StandaloneLayout",
        });
      });
    </script>
  </body>
</html>`

export async function GET(_req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.status(200).send(swaggerHtml)
}
