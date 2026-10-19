'use client';

import { PageHeader } from '@/components/dashboard/PageHeader';

/**
 * Super-admin work order detail — stub. The full page (header/meta, action bar,
 * notes, quotation and invoice panels) lands incrementally in the work order UI
 * plan tasks; this keeps the route rendering while it is built out.
 */
export default function WorkOrderDetailClient({ id }: { id: string }) {
  return (
    <PageHeader title={id} description="Work order detail is being built — check back shortly." />
  );
}
