'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Search, X } from 'lucide-react';
import type { ChartTree, ChartMember } from './types';
import OrgChartNode from './OrgChartNode';
import OrgChartDetailModal from './OrgChartDetailModal';

interface OrgChartProps {
  tree: ChartTree;
  canEdit: boolean;
  organizationId: string;
  /** Team id requested for expansion by the sidebar (cleared after apply). */
  focusTeamId: string | null;
  onFocusTeamHandled: () => void;
}

// Layout constants (px) before zoom/pan.
const TEAM_COL_W = 190;
const NODE_W = 170;
const ORG_Y = 24;
const ORG_H = 56;
const TEAM_Y = 116;
const TEAM_H = 56;
const MEMBER_Y_START = 198;
const MEMBER_H = 54;
const MEMBER_STEP = 66;
const PADDING = 40;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

/**
 * Interactive org chart canvas.
 *
 * Desktop: absolute-positioned tree (org root → teams → members), zoom via
 * transform scale, drag-to-pan on the background, mouse wheel zoom
 * (roll forward = in, roll back = out), middle-click recentres the diagram.
 * The diagram opens centred in the viewport.
 * Mobile (<768px): vertical accordion layout (org header, team sections,
 * member lists) instead of a tiny zoomable canvas.
 */
export default function OrgChart({ tree, canEdit, organizationId, focusTeamId, onFocusTeamHandled }: OrgChartProps) {
  const [openTeamIds, setOpenTeamIds] = useState<Set<string>>(() => new Set());
  // Org node collapse state — defaults to teams visible.
  const [orgOpen, setOrgOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedMember, setSelectedMember] = useState<ChartMember | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [search, setSearch] = useState('');

  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Responsive breakpoint (matches Tailwind `md`).
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Sidebar → expand a team in the tree (revealing the team row if needed).
  useEffect(() => {
    if (focusTeamId) {
      setOrgOpen(true);
      setOpenTeamIds((prev) => new Set(prev).add(focusTeamId));
      onFocusTeamHandled();
    }
  }, [focusTeamId, onFocusTeamHandled]);

  const toggleTeam = useCallback((teamId: string) => {
    setOpenTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.1) * 10) / 10)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.1) * 10) / 10)), []);

  // -----------------------------------------------------------------------
  // Canvas geometry (memoized on tree + open state)
  // -----------------------------------------------------------------------
  const unassignedId = '__unassigned__';
  const columns = useMemo(
    () => [
      ...tree.teams.map((t) => ({ id: t.id, name: t.name, members: t.members, description: t.description })),
      ...(tree.unassigned.length > 0
        ? [{ id: unassignedId, name: 'Unassigned', members: tree.unassigned, description: null as string | null }]
        : []),
    ],
    [tree],
  );

  const canvasW = columns.length * TEAM_COL_W + PADDING * 2;

  // -----------------------------------------------------------------------
  // Search — case-insensitive text match across the whole chart
  // (org name, team name/description, member name/email). Matches are
  // highlighted in place as the user types; non-matching members are hidden.
  // -----------------------------------------------------------------------
  const searchQuery = search.trim().toLowerCase();
  const searching = searchQuery.length > 0;

  const { matchedMemberIds, matchedTeamIds, orgMatches } = useMemo(() => {
    const memberIds = new Set<string>();
    const teamIds = new Set<string>();
    let org = false;
    if (searching) {
      if (tree.organization.name.toLowerCase().includes(searchQuery)) org = true;
      for (const t of tree.teams) {
        if (
          t.name.toLowerCase().includes(searchQuery) ||
          (t.description ?? '').toLowerCase().includes(searchQuery)
        ) {
          teamIds.add(t.id);
        }
      }
      for (const m of [...tree.teams.flatMap((t) => t.members), ...tree.unassigned]) {
        if (
          m.name.toLowerCase().includes(searchQuery) ||
          m.email.toLowerCase().includes(searchQuery)
        ) {
          memberIds.add(m.userId);
        }
      }
    }
    return { matchedMemberIds: memberIds, matchedTeamIds: teamIds, orgMatches: org };
  }, [searching, searchQuery, tree]);

  /** Teams whose name matches or that contain at least one matching member. */
  const teamsWithMatches = useMemo(() => {
    const s = new Set<string>();
    if (searching) {
      for (const t of tree.teams) {
        if (matchedTeamIds.has(t.id) || t.members.some((m) => matchedMemberIds.has(m.userId))) {
          s.add(t.id);
        }
      }
    }
    return s;
  }, [searching, tree, matchedTeamIds, matchedMemberIds]);

  const unassignedMatches = searching && tree.unassigned.some((m) => matchedMemberIds.has(m.userId));

  const isVisibleMember = useCallback(
    (m: ChartMember) => !searching || matchedMemberIds.has(m.userId),
    [searching, matchedMemberIds],
  );

  /** Teams with matches are revealed automatically while searching. */
  const isColumnOpen = useCallback(
    (col: { id: string; members: ChartMember[] }) =>
      col.id === unassignedId ||
      openTeamIds.has(col.id) ||
      (searching && teamsWithMatches.has(col.id)),
    [openTeamIds, searching, teamsWithMatches],
  );

  const matchCount = (orgMatches ? 1 : 0) + matchedTeamIds.size + matchedMemberIds.size;

  // While searching, the team row must be shown so that matches — and every
  // element between them and the org root — render even if the user had the
  // org collapsed. The user's own toggle state is left untouched.
  const effectiveOrgOpen = orgOpen || searching;

  const canvasH = useMemo(() => {
    if (!effectiveOrgOpen) return ORG_Y + ORG_H + PADDING;
    let maxBottom = TEAM_Y + TEAM_H;
    for (const col of columns) {
      if (!isColumnOpen(col)) continue;
      const count = searching ? col.members.filter(isVisibleMember).length : col.members.length;
      const bottom = MEMBER_Y_START + count * MEMBER_STEP;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return maxBottom + PADDING + TEAM_H;
  }, [columns, isColumnOpen, searching, isVisibleMember, effectiveOrgOpen]);

  // Pan handlers (background only).
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // nodes handle their own clicks
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + (e.clientX - drag.startX), y: drag.panY + (e.clientY - drag.startY) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Mouse wheel zoom (native, non-passive so preventDefault works) +
  // middle-click (wheel centre) recentres the diagram. Refs mirror zoom/pan
  // and canvas size so the native listener and centering math always see
  // current values without re-subscribing.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  const canvasSizeRef = useRef({ w: canvasW, h: canvasH });
  useEffect(() => {
    canvasSizeRef.current = { w: canvasW, h: canvasH };
  }, [canvasW, canvasH]);

  /** Pan offset that centres the canvas content in the viewport at zoom z. */
  const centerPan = useCallback((z: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const { w, h } = canvasSizeRef.current;
    return { x: (rect.width - w * z) / 2, y: (rect.height - h * z) / 2 };
  }, []);

  // Reset = 100% zoom with the diagram centred in the viewport.
  const resetView = useCallback(() => {
    setZoom(1);
    setPan(centerPan(1));
  }, [centerPan]);

  // Default start position: each displayed org opens centred in the viewport,
  // with the team row visible.
  useEffect(() => {
    if (isMobile) return;
    setOrgOpen(true);
    setZoom(1);
    setPan(centerPan(1));
  }, [tree.organization.id, isMobile, centerPan]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * factor * 10) / 10));
      if (next === z) return;
      // Keep the point under the cursor fixed while scaling.
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const p = panRef.current;
      const newPan = { x: mx - ((mx - p.x) * next) / z, y: my - ((my - p.y) * next) / z };
      zoomRef.current = next;
      panRef.current = newPan;
      setZoom(next);
      setPan(newPan);
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        resetView();
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('mousedown', handleMouseDown);
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('mousedown', handleMouseDown);
    };
  }, [resetView, isMobile]); // isMobile: canvas element only exists on desktop

  const orgNodeLeft = canvasW / 2 - NODE_W / 2;

  // -----------------------------------------------------------------------
  // Mobile accordion
  // -----------------------------------------------------------------------
  if (isMobile) {
    return (
      <div className="h-full overflow-y-auto bg-canvas-subtle p-4" role="tree" aria-label={`Organization chart: ${tree.organization.name}`}>
        <div
          className="rounded-md p-4 text-white text-center"
          style={{ backgroundColor: 'var(--color-navy-850)', border: `2px solid ${searching && orgMatches ? 'var(--color-danger)' : '#2A9D8F'}` }}
        >
          <p className="text-base font-semibold">{tree.organization.name}</p>
          {tree.organization.description && (
            <p className="text-xs text-slate-300 mt-1">{tree.organization.description}</p>
          )}
        </div>

        <div className="mx-auto mt-4 max-w-md">
          <label htmlFor="org-chart-search" className="sr-only">
            Search organization chart
          </label>
          <div className="flex items-center gap-2 rounded-md border bg-white p-1.5 shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }}>
            <Search aria-hidden="true" className="ml-1 h-4 w-4 shrink-0 text-slate-500" />
            <input
              id="org-chart-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search teams & members"
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: 'var(--color-navy-850)' }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {searching && (
            <p className="mt-1 px-1 text-xs tabular-nums" style={{ color: 'var(--color-navy-850)' }}>
              {matchCount === 0
                ? 'No matches found'
                : `${matchCount} match${matchCount === 1 ? '' : 'es'}`}
            </p>
          )}
        </div>

        <ul className="mt-4 space-y-3">
          {searching && matchCount === 0 && (
            <li className="rounded border bg-white p-4 text-center text-sm" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
              No matches found for &ldquo;{search.trim()}&rdquo;
            </li>
          )}
          {columns.map((col) => {
            const open = isColumnOpen(col);
            const visibleMembers = searching ? col.members.filter(isVisibleMember) : col.members;
            const isUnassignedCol = col.id === unassignedId;
            // While searching, hide columns with no matching org / team / member.
            if (searching && !isUnassignedCol && !teamsWithMatches.has(col.id)) return null;
            if (searching && isUnassignedCol && !unassignedMatches) return null;
            return (
              <li key={col.id} className="rounded border bg-white" style={{ borderColor: 'var(--color-slate-200)' }}>
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={open}
                  onClick={() => col.id === unassignedId ? undefined : toggleTeam(col.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
                  style={{
                    color: 'var(--color-navy-850)',
                    ...(searching && matchedTeamIds.has(col.id) ? { boxShadow: 'inset 0 0 0 2px var(--color-danger)' } : {}),
                  }}
                >
                  <span>{col.name}</span>
                  <span className="text-xs text-slate-500">
                    {visibleMembers.length} member{visibleMembers.length === 1 ? '' : 's'} {open ? '▾' : '▸'}
                  </span>
                </button>
                {open && visibleMembers.length > 0 && (
                  <ul className="border-t px-2 py-2 space-y-1" style={{ borderColor: 'var(--color-slate-200)' }}>
                    {visibleMembers.map((m) => (
                      <li key={m.userId}>
                        <button
                          type="button"
                          role="treeitem"
                          aria-label={`Member ${m.name}${searching && matchedMemberIds.has(m.userId) ? ', matches search' : ''}`}
                          onClick={() => setSelectedMember(m)}
                          className="w-full text-left rounded px-2 py-2 hover:bg-slate-50"
                          style={searching && matchedMemberIds.has(m.userId) ? { boxShadow: 'inset 0 0 0 2px var(--color-danger)' } : undefined}
                        >
                          <p className="text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>{m.name}</p>
                          <p className="text-xs text-slate-500">
                            {m.email}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {open && visibleMembers.length === 0 && (
                  <p className="px-4 pb-3 text-xs text-slate-500">No members{searching ? ' match' : ''}</p>
                )}
              </li>
            );
          })}
        </ul>

        <OrgChartDetailModal
          member={selectedMember}
          canEdit={canEdit}
          organizationId={organizationId}
          onClose={() => setSelectedMember(null)}
        />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Desktop canvas
  // -----------------------------------------------------------------------
  return (
    <div className="relative h-full flex-1 overflow-hidden bg-canvas-subtle">
      {/* Zoom controls + color key (fixed overlay, right/top) */}
      <div className="absolute right-4 top-4 z-10 flex flex-col items-stretch gap-2">
        {/* Zoom controls */}
        <div className="flex items-center gap-1 rounded-md border bg-white p-1 shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }}>
          <button type="button" onClick={zoomIn} aria-label="Zoom in" className="rounded p-1.5 text-slate-600 hover:bg-slate-100">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={zoomOut} aria-label="Zoom out" className="rounded p-1.5 text-slate-600 hover:bg-slate-100">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={resetView} aria-label="Reset view" className="rounded p-1.5 text-slate-600 hover:bg-slate-100">
            <Maximize2 className="h-4 w-4" />
          </button>
          <span className="px-1 text-xs text-slate-500 tabular-nums">{Math.round(zoom * 100)}%</span>
        </div>

        {/* Color key */}
        <div className="flex flex-col gap-1.5 rounded-md border bg-white p-2 shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }} aria-label="Color key">
          {[
            { color: 'var(--color-navy-850)', label: 'Organization' },
            { color: 'var(--color-accent)', label: 'Team' },
            { color: '#2A9D8F', label: 'Members' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-xs leading-none" style={{ color: 'var(--color-navy-850)' }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Search (same styling as the key; matches update live in the chart) */}
        <div className="w-52 rounded-md border bg-white shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }}>
          <label htmlFor="org-chart-search" className="sr-only">
            Search organization chart
          </label>
          <div className="flex items-center gap-1.5 p-1.5">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              id="org-chart-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chart…"
              className="w-full bg-transparent text-xs outline-none"
              style={{ color: 'var(--color-navy-850)' }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p
            role="status"
            className={`px-2.5 text-xs leading-none tabular-nums ${searching ? '' : 'invisible'}`}
            style={{ color: 'var(--color-navy-850)', paddingBottom: searching ? 8 : 0 }}
          >
            {matchCount === 0
              ? 'No matches found'
              : `${matchCount} match${matchCount === 1 ? '' : 'es'}`}
          </p>
        </div>
      </div>

      {/* Pannable/zoomable canvas */}
      <div
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="tree"
        aria-label={`Organization chart: ${tree.organization.name}`}
      >
        <div
          className="relative origin-top-left"
          style={{
            width: canvasW,
            height: canvasH,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* Organization root — click toggles the team row */}
          <OrgChartNode
            kind="org"
            label={tree.organization.name}
            sublabel={tree.organization.description ?? undefined}
            x={orgNodeLeft}
            y={ORG_Y}
            w={NODE_W}
            h={ORG_H}
            expanded={effectiveOrgOpen}
            highlighted={orgMatches}
            onToggle={() => setOrgOpen((open) => !open)}
          />

          {effectiveOrgOpen && (
            <>
              {/* Connector line org → bus (stops at the horizontal bus so
                  every team gets the same short drop-line) */}
              <div
                className="absolute"
                style={{
                  left: orgNodeLeft + NODE_W / 2 - 1,
                  top: ORG_Y + ORG_H,
                  height: TEAM_Y - 10 - (ORG_Y + ORG_H),
                  width: 2,
                  backgroundColor: 'var(--color-slate-300)',
                }}
              />
              {/* Horizontal bus at the bottom of the org drop-line, spanning
                  from the org stem across to every visible team's drop-line
                  (all columns normally; matching ones only while searching) */}
              {(() => {
                const visibleCenters = searching
                  ? columns.map((c, i) => ({ c, i })).filter(({ c }) => isColumnOpen(c)).map(({ i }) => PADDING + i * TEAM_COL_W + TEAM_COL_W / 2)
                  : columns.map((_, i) => PADDING + i * TEAM_COL_W + TEAM_COL_W / 2);
                if (visibleCenters.length === 0) return null;
                const orgCx = orgNodeLeft + NODE_W / 2;
                const left = Math.min(orgCx, ...visibleCenters);
                const right = Math.max(orgCx, ...visibleCenters);
                return (
                  <div
                    className="absolute"
                    style={{
                      left,
                      top: TEAM_Y - 10,
                      height: 2,
                      width: right - left,
                      backgroundColor: 'var(--color-slate-300)',
                    }}
                  />
                );
              })()}

              {/* Drop lines bus → each team (matched columns only while searching) */}
              {columns.map((col, i) => (searching && !isColumnOpen(col) ? null : (
                <div
                  key={`drop-${col.id}`}
                  className="absolute"
                  style={{
                    left: PADDING + i * TEAM_COL_W + TEAM_COL_W / 2 - 1,
                    top: TEAM_Y - 10,
                    height: 10,
                    width: 2,
                    backgroundColor: 'var(--color-slate-300)',
                  }}
                />
              )))}

              {/* Team columns — while searching, only columns with matches show */}
              {columns.map((col, i) => {
                const open = isColumnOpen(col);
                const members = searching ? col.members.filter(isVisibleMember) : col.members;
                if (searching && !open) return null;
                const cx = PADDING + i * TEAM_COL_W + TEAM_COL_W / 2;
                return (
                  <div key={col.id}>
                    <OrgChartNode
                      kind="team"
                      label={col.name}
                      x={PADDING + i * TEAM_COL_W + (TEAM_COL_W - NODE_W) / 2}
                      y={TEAM_Y}
                      w={NODE_W}
                      h={TEAM_H}
                      expanded={open}
                      memberCount={members.length}
                      highlighted={searching && matchedTeamIds.has(col.id)}
                      onToggle={() => col.id === unassignedId ? undefined : toggleTeam(col.id)}
                    />
                    {open && members.length > 0 && (
                      <>
                        {/* Vertical spine team → members (visible in the gaps
                            between member cards; nodes render above it) */}
                        <div
                          className="absolute"
                          style={{
                            left: cx - 1,
                            top: TEAM_Y + TEAM_H,
                            height: MEMBER_Y_START + members.length * MEMBER_STEP - MEMBER_H + (MEMBER_H - 12) - (TEAM_Y + TEAM_H),
                            width: 2,
                            backgroundColor: 'var(--color-slate-300)',
                          }}
                        />
                        {members.map((m, j) => (
                          <OrgChartNode
                            key={`${col.id}-${m.userId}`}
                            kind="member"
                            label={m.name}
                            sublabel={m.email}
                            x={PADDING + i * TEAM_COL_W + (TEAM_COL_W - NODE_W) / 2}
                            y={MEMBER_Y_START + j * MEMBER_STEP}
                            w={NODE_W}
                            h={MEMBER_H}
                            highlighted={searching && matchedMemberIds.has(m.userId)}
                            onDetails={() => setSelectedMember(m)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}

              {searching && matchCount === 0 && (
                <div
                  className="absolute rounded-md border bg-white px-4 py-2 text-sm shadow-sm"
                  style={{ left: orgNodeLeft - 20, top: TEAM_Y + TEAM_H / 2 - 12, color: 'var(--color-navy-850)', borderColor: 'var(--color-slate-200)' }}
                >
                  No matches found for &ldquo;{search.trim()}&rdquo;
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <OrgChartDetailModal
        member={selectedMember}
        canEdit={canEdit}
        organizationId={organizationId}
        onClose={() => setSelectedMember(null)}
      />
    </div>
  );
}
