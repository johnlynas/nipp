'use client';

import { WORK_ORDER_STATE_LABELS, workOrderStateTone, type WorkOrderState } from '@/lib/work-order-state';

/**
 * Work order state badge — pill in the incumbent StatusBadge vocabulary.
 * Colors come straight from the global token palette (see lib/work-order-state).
 */
export function WorkOrderStateBadge({ state }: { state: WorkOrderState }) {
  const tone = workOrderStateTone(state);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: tone.bg, color: tone.text }}
    >
      {WORK_ORDER_STATE_LABELS[state] ?? state}
    </span>
  );
}
