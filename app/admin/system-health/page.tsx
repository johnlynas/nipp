import SystemHealthCard from '@/components/admin/SystemHealthCard';

export default function SystemHealthPage() {
  return (
    <div className="space-y-6">
      {/* Page Header matching other admin pages */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">System Health</h1>
          <p className="mt-1 text-sm text-gray-500">Monitor system status and dependencies</p>
        </div>
      </div>

      {/* Health Card Container */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <SystemHealthCard />
      </div>
    </div>
  );
}
