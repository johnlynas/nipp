/**
 * Financial-related permissions.
 */

export const FINANCIAL_PERMISSIONS = {
  'financial:view': 'View financial data',
  'financial:report': 'Generate financial reports',
  'financial:invoice:create': 'Create invoices',
  'financial:invoice:approve': 'Approve invoices',
  'financial:payment:record': 'Record payments',
} as const;

export type FinancialPermission = keyof typeof FINANCIAL_PERMISSIONS;
