'use client';

interface OrgChartNodeProps {
  kind: 'org' | 'team' | 'member';
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Only meaningful for team nodes (collapsible). */
  expanded?: boolean;
  /** Only meaningful for team nodes. */
  memberCount?: number;
  /** True when the node matches the active search query (highlighted). */
  highlighted?: boolean;
  onToggle?: () => void;
  onDetails?: () => void;
}

/**
 * A single org-chart node (organization / team / member), absolutely
 * positioned by the parent canvas. Org and team nodes are expand/collapse
 * buttons (org toggles the whole team row, team its member list); member
 * nodes open the detail modal.
 */
export default function OrgChartNode({
  kind,
  label,
  sublabel,
  x,
  y,
  w,
  h,
  expanded,
  memberCount = 0,
  highlighted = false,
  onToggle,
  onDetails,
}: OrgChartNodeProps) {
  const isTeam = kind === 'team';

  const styles: React.CSSProperties = {
    left: x,
    top: y,
    width: w,
    height: h,
  };

  const base =
    'absolute flex flex-col items-center justify-center rounded-md border text-center transition-colors focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]';

  // Complementary fill scheme: navy (org) and amber (team) are colour-wheel
  // opposites; teal (member) bridges the two. Warm/cool fills carry dark ink
  // text for contrast; only the navy org node uses white text.
  const surface = kind === 'org' ? (
    highlighted
      ? 'bg-[#1B2A4A] text-white border-[#F5A623] border-2'
      : 'bg-[#1B2A4A] text-white border-[#2A9D8F] border-2'
  ) : isTeam ? (
    expanded
      ? 'bg-[#F5A623] text-[#16233A] border-[#1B2A4A] border-2'
      : 'bg-[#F5A623] text-[#16233A] border-[#C9861B]'
  ) : (
    'bg-[#2A9D8F] text-[#16233A] border-[#1F7A70] hover:border-[#1B2A4A]'
  );

  // Search highlight: bold outline + slight lift so matches pop without
  // changing the node's shape or position.
  const highlightStyle: React.CSSProperties = highlighted
    ? { boxShadow: '0 0 0 3px #F5A623, 0 2px 8px rgba(27, 42, 74, 0.35)' }
    : {};

  return (
    <button
      type="button"
      role="treeitem"
      aria-level={kind === 'org' ? 1 : kind === 'team' ? 2 : 3}
      aria-expanded={kind === 'member' ? undefined : expanded}
      aria-label={
        isTeam
          ? `Team ${label}, ${memberCount} member${memberCount === 1 ? '' : 's'}${expanded ? ', expanded' : ', collapsed'}${highlighted ? ', matches search' : ''}`
          : kind === 'org'
            ? `Organization ${label}${expanded ? ', teams visible' : ', teams hidden'}${highlighted ? ', matches search' : ''}`
            : `Member ${label}${highlighted ? ', matches search' : ''}`
      }
      title={sublabel || label}
      className={`${base} ${surface}`}
      style={{ ...styles, ...highlightStyle }}
      onClick={() => (kind === 'member' ? onDetails?.() : onToggle?.())}
    >
      {kind === 'org' && (
        <span className="text-sm font-semibold leading-tight px-2">{label}</span>
      )}
      {isTeam && (
        <span className="text-sm font-semibold leading-tight px-2">{label}</span>
      )}
      {kind === 'member' && (
        <>
          <span className="text-sm font-medium leading-tight px-2">{label}</span>
          {sublabel && <span className="text-xs text-[#16233A] mt-0.5 px-2 truncate w-full">{sublabel}</span>}
        </>
      )}
    </button>
  );
}
