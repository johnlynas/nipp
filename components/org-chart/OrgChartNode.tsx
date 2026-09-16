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
  let surface: string;
  if (kind === 'org') {
    surface = 'bg-[#1B2A4A] text-white border-[#2A9D8F] border-2';
  } else if (isTeam) {
    surface = expanded
      ? 'bg-[#F5A623] text-[#16233A] border-[#1B2A4A] border-2'
      : 'bg-[#F5A623] text-[#16233A] border-[#C9861B]';
  } else {
    surface = 'bg-[#2A9D8F] text-[#16233A] border-[#1F7A70] hover:border-[#1B2A4A]';
  }

  return (
    <button
      type="button"
      role="treeitem"
      aria-level={kind === 'org' ? 1 : kind === 'team' ? 2 : 3}
      aria-expanded={kind === 'member' ? undefined : expanded}
      aria-label={
        isTeam
          ? `Team ${label}, ${memberCount} member${memberCount === 1 ? '' : 's'}${expanded ? ', expanded' : ', collapsed'}`
          : kind === 'org'
            ? `Organization ${label}${expanded ? ', teams visible' : ', teams hidden'}`
            : `Member ${label}`
      }
      title={sublabel || label}
      className={`${base} ${surface}`}
      style={styles}
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
