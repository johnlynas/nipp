import { notFound } from 'next/navigation';
import WorkOrderDetailClient from './WorkOrderDetailClient';

export const runtime = 'nodejs';

/**
 * Super-admin work order management — server wrapper. The client fetches via
 * the admin API routes (auth + tenant RLS verified server-side); the page is a
 * thin identity carrier, matching the dashboard's all-client page pattern.
 */
export default async function WorkOrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!id) notFound();
  return <WorkOrderDetailClient id={id} />;
}
