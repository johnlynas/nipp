/**
 * Display-only helpers for OrgChartSidebar row rendering.
 */

/** Up to two initials from a person's display name ("Jane Doe" → "JD"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "super_admin" → "Super Admin" — for readable role sublines. */
export function slugLabel(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
