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
 * transform scale, drag-to-pan on the background.
 * Mobile (<768px): vertical accordion layout (org header, team sections,
 * member lists) instead of a tiny zoomable canvas.
 */
export default function OrgChart({ tree, canEdit, organizationId, focusTeamId, onFocusTeamHandled }: OrgChartProps) {
  const [openTeamIds, setOpenTeamIds] = useState<Set<string>>(() => new Set());
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

  // Sidebar → expand a team in the tree.
  useEffect(() => {
    if (focusTeamId) {
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
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

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
    let maxBottom = TEAM_Y + TEAM_H;
    for (const col of columns) {
      if (!openTeamIds.has(col.id) && col.id !== unassignedId) continue;
      const bottom = MEMBER_Y_START + col.members.length * MEMBER_STEP;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return maxBottom + PADDING + TEAM_H;
  }, [columns, openTeamIds]);

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

          {/* Organization root */}
          <OrgChartNode
            kind="org"
            label={tree.organization.name}
            sublabel={tree.organization.description ?? undefined}
            x={orgNodeLeft}
            y={ORG_Y}
            w={NODE_W}
            h={ORG_H}
          />

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
