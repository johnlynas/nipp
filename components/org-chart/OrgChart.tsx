'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
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
  const canvasH = useMemo(() => {
    if (!orgOpen) return ORG_Y + ORG_H + PADDING;
    let maxBottom = TEAM_Y + TEAM_H;
    for (const col of columns) {
      if (!openTeamIds.has(col.id) && col.id !== unassignedId) continue;
      const bottom = MEMBER_Y_START + col.members.length * MEMBER_STEP;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return maxBottom + PADDING + TEAM_H;
  }, [columns, openTeamIds, orgOpen]);

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
      <div className="h-full overflow-y-auto bg-[#f8f9fa] p-4" role="tree" aria-label={`Organization chart: ${tree.organization.name}`}>
        <div
          className="rounded-md p-4 text-white text-center"
          style={{ backgroundColor: '#1B2A4A', border: '2px solid #2A9D8F' }}
        >
          <p className="text-base font-semibold">{tree.organization.name}</p>
          {tree.organization.description && (
            <p className="text-xs text-gray-300 mt-1">{tree.organization.description}</p>
          )}
        </div>

        <ul className="mt-4 space-y-3">
          {columns.map((col) => {
            const open = col.id === unassignedId || openTeamIds.has(col.id);
            return (
              <li key={col.id} className="rounded border bg-white" style={{ borderColor: '#dee2e6' }}>
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={open}
                  onClick={() => col.id === unassignedId ? undefined : toggleTeam(col.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
                  style={{ color: '#1B2A4A' }}
                >
                  <span>{col.name}</span>
                  <span className="text-xs text-gray-500">
                    {col.members.length} member{col.members.length === 1 ? '' : 's'} {open ? '▾' : '▸'}
                  </span>
                </button>
                {open && col.members.length > 0 && (
                  <ul className="border-t px-2 py-2 space-y-1" style={{ borderColor: '#dee2e6' }}>
                    {col.members.map((m) => (
                      <li key={m.userId}>
                        <button
                          type="button"
                          role="treeitem"
                          aria-label={`Member ${m.name}`}
                          onClick={() => setSelectedMember(m)}
                          className="w-full text-left rounded px-2 py-2 hover:bg-gray-50"
                        >
                          <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{m.name}</p>
                          <p className="text-xs text-gray-500">
                            {m.memberRole}
                            {m.assignedRoles.length > 0 && ` · ${m.assignedRoles.map((r) => r.name).join(', ')}`}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {open && col.members.length === 0 && (
                  <p className="px-4 pb-3 text-xs text-gray-500">No members</p>
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
    <div className="relative h-full flex-1 overflow-hidden bg-[#f8f9fa]">
      {/* Zoom controls */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-md border bg-white p-1 shadow-sm" style={{ borderColor: '#dee2e6' }}>
        <button type="button" onClick={zoomIn} aria-label="Zoom in" className="rounded p-1.5 text-gray-600 hover:bg-gray-100">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button type="button" onClick={zoomOut} aria-label="Zoom out" className="rounded p-1.5 text-gray-600 hover:bg-gray-100">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button type="button" onClick={resetView} aria-label="Reset view" className="rounded p-1.5 text-gray-600 hover:bg-gray-100">
          <Maximize2 className="h-4 w-4" />
        </button>
        <span className="px-1 text-xs text-gray-500 tabular-nums">{Math.round(zoom * 100)}%</span>
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
            expanded={orgOpen}
            onToggle={() => setOrgOpen((open) => !open)}
          />

          {orgOpen && (
            <>
              {/* Connector line org → team row */}
              <div
                className="absolute"
                style={{
                  left: orgNodeLeft + NODE_W / 2,
                  top: ORG_Y + ORG_H,
                  height: TEAM_Y - (ORG_Y + ORG_H),
                  width: 2,
                  backgroundColor: '#b6c2d9',
                }}
              />
              {columns.length > 1 && (
                <div
                  className="absolute"
                  style={{
                    left: PADDING + NODE_W / 2,
                    top: TEAM_Y - 10,
                    height: 2,
                    width: (columns.length - 1) * TEAM_COL_W,
                    backgroundColor: '#b6c2d9',
                  }}
                />
              )}

              {/* Team columns */}
              {columns.map((col, i) => {
                const open = col.id === unassignedId || openTeamIds.has(col.id);
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
                      memberCount={col.members.length}
                      onToggle={() => col.id === unassignedId ? undefined : toggleTeam(col.id)}
                    />
                    {open &&
                      col.members.map((m, j) => (
                        <OrgChartNode
                          key={`${col.id}-${m.userId}`}
                          kind="member"
                          label={m.name}
                          sublabel={`${m.memberRole}${m.assignedRoles.length > 0 ? ' · ' + m.assignedRoles.map((r) => r.name).join(', ') : ''}`}
                          x={PADDING + i * TEAM_COL_W + (TEAM_COL_W - NODE_W) / 2}
                          y={MEMBER_Y_START + j * MEMBER_STEP}
                          w={NODE_W}
                          h={MEMBER_H}
                          onDetails={() => setSelectedMember(m)}
                        />
                      ))}
                  </div>
                );
              })}
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
