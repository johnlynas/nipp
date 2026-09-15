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
 * positioned by the parent canvas. Team nodes are expand/collapse buttons;
 * member nodes open the detail modal.
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
    'absolute flex flex-col items-center justify-center rounded-md border text-center transition-colors focus:outline-none focus:ring-2 focus:ring-[#F5A623]';

  let surface: string;
  if (kind === 'org') {
    surface = 'bg-[#1B2A4A] text-white border-[#2A9D8F] border-2';
  } else if (isTeam) {
    surface = expanded
      ? 'bg-[#24355c] text-white border-[#F5A623] border-2'
      : 'bg-[#1B2A4A] text-white border-[#3a4f7a]';
  } else {
    surface = 'bg-white text-[#1B2A4A] border-[#dee2e6] hover:border-[#1B2A4A]';
  }

  return (
    <button
      type="button"
      role="treeitem"
      aria-level={kind === 'org' ? 1 : kind === 'team' ? 2 : 3}
      aria-expanded={isTeam ? expanded : undefined}
      aria-label={
        isTeam
          ? `Team ${label}, ${memberCount} member${memberCount === 1 ? '' : 's'}${expanded ? ', expanded' : ', collapsed'}`
          : kind === 'org'
            ? `Organization ${label}`
            : `Member ${label}`
      }
      title={sublabel || label}
      className={`${base} ${surface}`}
      style={styles}
      onClick={() => (isTeam ? onToggle?.() : onDetails?.())}
    >
      {kind === 'org' && (
        <>
          <span className="text-sm font-semibold leading-tight px-2">{label}</span>
          {sublabel && <span className="text-xs text-gray-300 mt-0.5 px-2">{sublabel}</span>}
        </>
      )}
      {isTeam && (
        <>
          <span className="text-sm font-semibold leading-tight px-2">{label}</span>
          <span className="text-xs text-gray-300 mt-0.5">
            {memberCount} member{memberCount === 1 ? '' : 's'} {expanded ? '▾' : '▸'}
          </span>
        </>
      )}
      {kind === 'member' && (
        <>
          <span className="text-sm font-medium leading-tight px-2">{label}</span>
          {sublabel && <span className="text-xs text-gray-500 mt-0.5 px-2 truncate w-full">{sublabel}</span>}
        </>
      )}
    </button>
  );
}
