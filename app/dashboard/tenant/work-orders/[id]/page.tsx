import { notFound } from 'next/navigation';
import TenantWorkOrderDetailClient from './TenantWorkOrderDetailClient';

export const runtime = 'nodejs';

/**
 * Tenant work order detail — server wrapper (Next 15 async params). The client
 * resolves the active organization then fetches via the membership-scoped route;
 * RLS makes foreign-org ids a 404 for org members.
 */
export default async function TenantWorkOrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!id) notFound();
  return <TenantWorkOrderDetailClient id={id} />;
}
