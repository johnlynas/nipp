export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Swagger UI shell for the generated OpenAPI spec.
 *
 * - /api-docs                     -> this HTML page (loads the bundle below)
 * - /api-docs/openapi             -> docs/openapi/generated/openapi.json (route in ./openapi/)
 * - /api-docs/assets/<file>       -> swagger-ui-dist static files (route in ./assets/[file]/)
 *
 * The spec is produced by `npm run docs:generate`.
 */
function docPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>NIPP API — OpenAPI</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="/api-docs/assets/swagger-ui.css" />
  <link rel="icon" type="image/png" href="/api-docs/assets/favicon-32x32.png" sizes="32x32" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api-docs/assets/swagger-ui-bundle.js" charset="UTF-8"></script>
  <script>
    window.addEventListener('load', function () {
      SwaggerUIBundle({
        url: '/api-docs/openapi',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
      });
    });
  </script>
</body>
</html>`;
}

export function GET() {
  return new Response(docPage(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
