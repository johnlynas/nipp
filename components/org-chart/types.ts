/**
 * Client-side types for the org chart UI.
 * Re-exported from the pure shaper in lib/org-chart.ts so components and the
 * page share one type source with the API route.
 */

export type {
  ChartRole,
  ChartMember,
  ChartTeam,
  ChartOrganization,
  ChartTree,
} from '@/lib/org-chart';
