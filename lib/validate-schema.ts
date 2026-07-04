import fs from 'node:fs';
import path from 'node:path';

/**
 * Startup validation that checks all non-exempt Prisma models have an organizationId field.
 *
 * This acts as a safety net against developers forgetting to add organizationId
 * to new organization-scoped models, which would break tenant isolation.
 */

const EXEMPT_MODELS = new Set([
  'User',
  'Session',
  'Account',
  'Organization',
  'Member',
  'Invitation',
  'SentInvitation',
]);

/**
 * Parse the Prisma schema to check for organizationId on all models.
 * Exits with a critical error if any non-exempt model is missing organizationId.
 */
export function validateSchema(): void {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');

  if (!fs.existsSync(schemaPath)) {
    // eslint-disable-next-line no-console
    console.error('CRITICAL: prisma/schema.prisma not found. Tenant isolation cannot be validated.');
    process.exit(1);
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const modelNames = extractModelNames(schema);

  let hasErrors = false;

  for (const modelName of modelNames) {
    if (EXEMPT_MODELS.has(modelName)) continue;

    const hasOrgId = modelHasOrganizationId(schema, modelName);
    if (!hasOrgId) {
      // eslint-disable-next-line no-console
      console.error(
        `CRITICAL: Model "${modelName}" is missing the required organizationId field. ` +
          'All organization-scoped models MUST include: ' +
          'organizationId String, organization relation, and @@index([organizationId]).'
      );
      hasErrors = true;
    }
  }

  if (hasErrors) {
    // eslint-disable-next-line no-console
    console.error('\nTenant isolation is BROKEN. Add organizationId to the affected models.');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('Schema validation passed: all non-exempt models have organizationId.');
}

/**
 * Extract model names from the Prisma schema.
 */
function extractModelNames(schema: string): string[] {
  const matches = schema.matchAll(/^model\s+(\w+)\s+\{/gm);
  return Array.from(matches, (m) => m[1]);
}

/**
 * Check if a specific model has an organizationId field.
 */
function modelHasOrganizationId(schema: string, modelName: string): boolean {
  // Extract the model block
  const modelRegex = new RegExp(
    `model\\s+${modelName}\\s*\\{([^}]+)\\}`,
    's'
  );
  const match = schema.match(modelRegex);

  if (!match) return false;

  const modelBody = match[1];
  return (
    /organizationId\s+String/.test(modelBody) &&
    /@@index\(\s*\[organizationId\s*\]\s*\)/.test(modelBody)
  );
}
