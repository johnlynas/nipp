'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, Trash2, Play, Pause, Zap, FileCode, Clock, Calendar, CheckCircle, XCircle } from 'lucide-react';
import { useIsSuperAdmin } from '@/hooks/usePermission';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';
import { StatCard } from '@/components/dashboard/StatCard';

interface JobDefinition {
  id: string;
  name: string;
  description: string | null;
  handlerKey: string;
  code: string | null;
  scheduleExpr: string;
  timezone: string | null;
  timeoutMs: number | null;
  concurrencyLimit: number;
  enabled: boolean;
  approved: boolean;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface JobExecution {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  startedAt: Date;
  finishedAt: Date | null;
  trigger: 'SCHEDULE' | 'MANUAL';
  error: string | null;
  resultJson?: Record<string, unknown>;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function ScriptsPage() {
  const [jobs, setJobs] = useState<JobDefinition[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [approvedFilter, setApprovedFilter] = useState<'all' | 'approved' | 'unapproved'>('all');
  const [runStatusFilter, setRunStatusFilter] = useState<'all' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobDefinition | null>(null);
  const [executionsModalOpen, setExecutionsModalOpen] = useState(false);
  const [executions, setExecutions] = useState<JobExecution[]>([]);

  // Create modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    handlerKey: 'script-handler',
    scheduleType: 'interval' as 'interval' | 'cron' | 'oneshot',
    intervalMs: '60000',
    cronExpr: '',
    oneshotTime: '',
    timezone: 'Europe/London',
    timeoutMs: 300000,
    concurrencyLimit: 1,
    code: '',
  });

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    handlerKey: 'script-handler',
    scheduleExpr: '',
    timezone: 'Europe/London',
    timeoutMs: 300000,
    concurrencyLimit: 1,
    code: '',
    enabled: false,
  });

  // Trigger modal states
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [triggerInput, setTriggerInput] = useState('');

  // Approval confirmation
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject'>('approve');
  const [approvalNote, setApprovalNote] = useState('');

  // Delete confirmation
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Check if current user is a platform super admin
  const isSuperAdmin = useIsSuperAdmin();

  // Abort controller to cancel stale fetch requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch jobs
  const fetchData = useCallback(async (page?: number) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);
    try {
      const pageToUse = page ?? pagination.page;
      const params = new URLSearchParams({
        page: String(pageToUse),
        pageSize: String(pagination.pageSize),
      });
      if (search) params.set('search', search);
      if (enabledFilter !== 'all') params.set('enabled', enabledFilter === 'enabled' ? 'true' : 'false');
      if (approvedFilter !== 'all') params.set('approved', approvedFilter === 'approved' ? 'true' : 'false');
      if (runStatusFilter !== 'all') params.set('lastRunStatus', runStatusFilter);

      const res = await fetch(`/api/dashboard/admin/scripts?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch scripts');
      }

      const data = await res.json();
      setJobs(data.items || []);

      const total = data.pagination?.total ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
      setPagination({
        page: pageToUse,
        pageSize: pagination.pageSize,
        total,
        totalPages,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to fetch scripts';
      console.error('Failed to fetch scripts:', err);
      logClientError(message, 'scripts', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, search, enabledFilter, approvedFilter, runStatusFilter]);

  // Fetch when filters change (reset to page 1)
  useEffect(() => {
    fetchData(1);
  }, [search, enabledFilter, approvedFilter, runStatusFilter]);

  // Handle page change
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchData(newPage);
    }
  };

  // Auto-dismiss error banners after 6 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // Handle view job details
  const handleView = (job: JobDefinition) => {
    setSelectedJob(job);
    setDetailModalOpen(true);
  };

  // Handle view executions
  const handleViewExecutions = async (job: JobDefinition) => {
    setSelectedJob(job);
    try {
      const res = await fetch(`/api/dashboard/admin/scripts/${job.id}`);
      if (res.ok) {
        const data = await res.json();
        setExecutions(data.executions || []);
      }
    } catch (err) {
      console.error('Failed to fetch executions:', err);
    }
    setExecutionsModalOpen(true);
  };

  // Handle edit job
  const handleEditClick = (job: JobDefinition) => {
    setSelectedJob(job);
    setEditForm({
      name: job.name,
      description: job.description ?? '',
      handlerKey: job.handlerKey,
      scheduleExpr: job.scheduleExpr,
      timezone: job.timezone || 'Europe/London',
      timeoutMs: job.timeoutMs ?? 300000,
      concurrencyLimit: job.concurrencyLimit ?? 1,
      code: job.code ?? '',
      enabled: job.enabled,
    });
    setEditModalOpen(true);
  };

  // Handle delete job
  const handleDeleteClick = (job: JobDefinition) => {
    setSelectedJob(job);
    setDeleteModalOpen(true);
  };

  // Handle delete job
  const handleDelete = async () => {
    if (!selectedJob) return;

    try {
      const res = await fetch(`/api/dashboard/admin/scripts/${selectedJob.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete script');
      }

      setDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete script';
      console.error('Failed to delete script:', err);
      logClientError(message, 'scripts', 'delete');
      setError(message);
    }
  };

  // Handle update job
  const handleUpdate = async () => {
    if (!selectedJob) return;

    try {
      const res = await fetch(`/api/dashboard/admin/scripts/${selectedJob.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMessage = data.error || 'Failed to update script';
        // Handle the approval edge case more gracefully
        if (errorMessage.includes('Job is not approved')) {
          setError('This job needs to be approved before it can be enabled. Use the Approve button.');
        } else {
          throw new Error(errorMessage);
        }
        return;
      }

      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update script';
      console.error('Failed to update script:', err);
      logClientError(message, 'scripts', 'update');
      setError(message);
    }
  };

  // Handle approve/reject job
  const handleApproval = async () => {
    if (!selectedJob) return;

    try {
      const res = await fetch(`/api/admin/jobs/${selectedJob.id}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: approvalAction,
          note: approvalNote.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update approval status');
      }

      setApprovalModalOpen(false);
      setApprovalNote('');
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update approval status';
      console.error('Failed to update approval:', err);
      logClientError(message, 'scripts', 'approval');
      setError(message);
    }
  };

  // Build schedule expression from form
  const buildScheduleExpression = (form: typeof createForm): string => {
    if (form.scheduleType === 'interval') {
      const intervalMs = parseInt(form.intervalMs || '60000');
      return JSON.stringify({ kind: 'interval', everyMs: isNaN(intervalMs) ? 60000 : intervalMs });
    } else if (form.scheduleType === 'cron') {
      return JSON.stringify({ kind: 'cron', expr: form.cronExpr, timezone: form.timezone });
    } else {
      return JSON.stringify({ kind: 'oneshot', at: form.oneshotTime });
    }
  };

  // Handle create job
  const handleCreate = async () => {
    try {
      const scheduleExpr = buildScheduleExpression(createForm);

      const res = await fetch('/api/dashboard/admin/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          description: createForm.description || null,
          handlerKey: createForm.handlerKey,
          scheduleExpr,
          timezone: createForm.timezone,
          timeoutMs: createForm.timeoutMs,
          concurrencyLimit: createForm.concurrencyLimit,
          code: createForm.code || null,
          enabled: false, // New jobs start disabled
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create script');
      }

      setCreateModalOpen(false);
      setCreateForm({
        name: '',
        description: '',
        handlerKey: 'script-handler',
        scheduleType: 'interval',
        intervalMs: '60000',
        cronExpr: '',
        oneshotTime: '',
        timezone: 'Europe/London',
        timeoutMs: 300000,
        concurrencyLimit: 1,
        code: '',
      });
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create script';
      console.error('Failed to create script:', err);
      logClientError(message, 'scripts', 'create');
      setError(message);
    }
  };

  // Handle trigger job
  const handleTrigger = async () => {
    if (!selectedJob) return;

    try {
      const res = await fetch(`/api/dashboard/admin/scripts/${selectedJob.id}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: triggerInput ? JSON.parse(triggerInput) : undefined }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to trigger script');
      }

      setTriggerModalOpen(false);
      setTriggerInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to trigger script';
      console.error('Failed to trigger script:', err);
      logClientError(message, 'scripts', 'trigger');
      setError(message);
    }
  };

  // Handle enable/disable job
  const handleToggleEnable = async (job: JobDefinition) => {
    // Prevent enabling an unapproved job - show approval modal instead
    if (job.enabled === false && !job.approved) {
      setApprovalModalOpen(true);
      setApprovalAction('approve');
      setApprovalNote('');
      setSelectedJob(job);
      return;
    }

    try {
      const res = await fetch(`/api/dashboard/admin/scripts/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMessage = data.error || 'Failed to update script';
        // Handle the approval edge case more gracefully
        if (errorMessage.includes('Job is not approved')) {
          setError('This job needs to be approved before it can be enabled. Use the Approve button.');
        } else {
          setError(errorMessage);
        }
        return;
      }

      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update script';
      console.error('Failed to update script:', err);
      setError(message);
    }
  };

  const columns = [
    { key: 'name', label: 'Name', render: (j: JobDefinition) => (
      <div className="flex flex-col">
        <span className="font-medium" style={{ color: 'var(--color-navy-850)' }}>{j.name}</span>
        <span className="text-xs text-slate-500">{j.handlerKey}</span>
      </div>
    )},
    { key: 'description', label: 'Description', render: (j: JobDefinition) => (
      <span className="block max-w-[280px] truncate text-sm text-slate-600" title={j.description || undefined}>
        {j.description || '—'}
      </span>
    )},
    { key: 'enabled', label: 'Status', render: (j: JobDefinition) => (
      <StatusBadge status={j.enabled ? (j.approved ? 'Active' : 'Pending Approval') : 'Disabled'} />
    )},
    { key: 'lastRunAt', label: 'Last Run', render: (j: JobDefinition) => (
      j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : '—'
    )},
    { key: 'lastRunStatus', label: 'Run Status', render: (j: JobDefinition) => (
      j.lastRunStatus ? <StatusBadge status={j.lastRunStatus} /> : '—'
    )},
    { key: 'actions', label: 'Actions', render: (j: JobDefinition) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleView(j)}
          title="View details"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label="View details"
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          onClick={() => handleEditClick(j)}
          title="Edit"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label="Edit"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => handleViewExecutions(j)}
          title="View executions"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label="View executions"
        >
          <FileCode className="h-4 w-4" />
        </button>
        {/* Approve/Reject button for unapproved jobs */}
        {!j.approved && (
          <button
            onClick={() => { setSelectedJob(j); setApprovalAction('approve'); setApprovalModalOpen(true); }}
            title="Approve"
            className="rounded p-1.5 text-slate-600 hover:bg-canvas-subtle hover:text-slate-900 transition-colors"
            aria-label="Approve"
          >
            <CheckCircle className="h-4 w-4" />
          </button>
        )}
        {/* Enable/Disable button */}
        <button
          onClick={() => handleToggleEnable(j)}
          title={j.enabled ? 'Disable' : (j.approved ? 'Enable' : 'Approve to Enable')}
          className="rounded p-1.5 transition-colors"
          style={{
            color: j.enabled || j.approved ? 'var(--color-slate-500)' : 'var(--color-slate-400)',
            cursor: j.approved ? 'pointer' : 'not-allowed',
          }}
          aria-label={j.enabled ? 'Disable' : 'Enable'}
          disabled={!j.approved}
        >
          {j.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          onClick={() => { setSelectedJob(j); setTriggerModalOpen(true); }}
          title="Trigger"
          className={`rounded p-1.5 transition-colors ${
            !j.enabled || !j.approved
              ? 'text-slate-300 cursor-not-allowed'
              : 'text-slate-400 hover:bg-slate-100 hover:text-navy-850'
          }`}
          aria-label="Trigger"
          disabled={!j.enabled || !j.approved}
        >
          <Zap className="h-4 w-4" />
        </button>
        <button
          onClick={() => handleDeleteClick(j)}
          title="Delete"
          className="rounded p-1.5 text-slate-500 hover:bg-danger-tint hover:text-danger-ink transition-colors"
          aria-label="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    )},
  ];

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded border bg-danger-tint border-danger-border p-3 text-sm text-danger-ink" role="alert">
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Total Scripts" value={jobs.length} />
        <StatCard label="Approved" value={jobs.filter(j => j.approved).length} color="success" />
        <StatCard label="Unapproved" value={jobs.filter(j => !j.approved).length} color="warning" />
        <StatCard label="Enabled" value={jobs.filter(j => j.enabled).length} color="success" />
        <StatCard label="Disabled" value={jobs.filter(j => !j.enabled).length} color="danger" />
      </div>

      {/* Page Header */}
      <PageHeader title="Custom Scripts" description="Background job scheduler for custom scripts" primaryAction={
        <button
          onClick={() => setCreateModalOpen(true)}
          className="w-full sm:w-auto rounded px-4 py-2 text-center text-sm font-medium text-accent-ink transition-colors hover:opacity-90"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          + Create Script
        </button>
      } />

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search scripts..." aria-label="Search scripts" />
        <select
          value={enabledFilter}
          onChange={(e) => setEnabledFilter(e.target.value as 'all' | 'enabled' | 'disabled')}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by enabled status"
        >
          <option value="all">All Scripts</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>

        <select
          value={approvedFilter}
          onChange={(e) => setApprovedFilter(e.target.value as 'all' | 'approved' | 'unapproved')}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by approval status"
        >
          <option value="all">All Approval Status</option>
          <option value="approved">Approved</option>
          <option value="unapproved">Unapproved</option>
        </select>

        <select
          value={runStatusFilter}
          onChange={(e) => setRunStatusFilter(e.target.value as 'all' | 'RUNNING' | 'SUCCEEDED' | 'FAILED')}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by run status"
        >
          <option value="all">All Run Status</option>
          <option value="RUNNING">Running</option>
          <option value="SUCCEEDED">Succeeded</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {/* Table */}
      <DataTable<JobDefinition> columns={columns} data={jobs} loading={loading} emptyMessage="No scripts found" />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={handlePageChange}
      />

      {/* Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Script Details" size="lg">
        {selectedJob && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Name</label>
                <p className="mt-1 font-medium" style={{ color: 'var(--color-navy-850)' }}>{selectedJob.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Handler</label>
                <p className="mt-1 font-mono text-sm" style={{ color: 'var(--color-navy-850)' }}>{selectedJob.handlerKey}</p>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Status</label>
                <div className="mt-1"><StatusBadge status={selectedJob.enabled ? (selectedJob.approved ? 'Active' : 'Pending Approval') : 'Disabled'} /></div>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Timeout</label>
                <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedJob.timeoutMs ? `${selectedJob.timeoutMs}ms` : 'Default'}</p>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Concurrency</label>
                <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedJob.concurrencyLimit}</p>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Last Run</label>
                <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>
                  {selectedJob.lastRunAt ? new Date(selectedJob.lastRunAt).toLocaleString() : 'Never'}
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Description</label>
              <p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: 'var(--color-navy-850)' }}>{selectedJob.description || '—'}</p>
            </div>

            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Code</label>
              <div className="mt-1">
                <pre className="bg-slate-50 p-3 rounded text-xs overflow-x-auto" style={{ color: 'var(--color-navy-850)' }}>
                  {selectedJob.code || '// No code defined'}
                </pre>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setExecutionsModalOpen(true)}
                className="rounded px-4 py-2 text-sm font-medium"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}
              >
                View Executions
              </button>
              <button
                onClick={() => { setDetailModalOpen(false); setEditModalOpen(true); }}
                className="rounded px-4 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              >
                Edit
              </button>
              <button
                onClick={() => { setDetailModalOpen(false); setDeleteModalOpen(true); }}
                className="rounded px-4 py-2 text-sm font-medium"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-danger)' }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Executions Modal */}
      <Modal isOpen={executionsModalOpen} onClose={() => setExecutionsModalOpen(false)} title="Execution History" size="lg">
        {executions.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {executions.map((exec) => (
              <div key={exec.id} className="border rounded p-3" style={{ borderColor: 'var(--color-slate-200)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium" style={{ color: 'var(--color-navy-850)' }}>
                      Execution #{executions.indexOf(exec) + 1}
                    </span>
                    <span className="text-xs text-slate-500 ml-2">
                      • {exec.trigger} • {new Date(exec.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <StatusBadge status={exec.status} />
                </div>
                {exec.finishedAt && (
                  <span className="text-xs text-slate-500">
                    Duration: {Math.round((new Date(exec.finishedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000)}s
                  </span>
                )}
                {exec.error && (
                  <pre className="mt-2 text-xs bg-danger-tint p-2 rounded overflow-x-auto text-danger-ink">
                    {exec.error}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No executions found for this script.</p>
        )}
      </Modal>

      {/* Create Script Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Script" size="lg">
        <div className="space-y-4">
          <div>
            <label htmlFor="script-name" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Name</label>
            <input
              id="script-name"
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              placeholder="My Background Script"
            />
          </div>

          <div>
            <label htmlFor="script-description" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Description</label>
            <textarea
              id="script-description"
              value={createForm.description}
              onChange={(e) => setCreateForm(f => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              rows={2}
              placeholder="What does this script do?"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="script-handler" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Handler Key</label>
              <input
                id="script-handler"
                type="text"
                value={createForm.handlerKey}
                onChange={(e) => setCreateForm(f => ({ ...f, handlerKey: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                placeholder="script-handler"
              />
            </div>
            <div>
              <label htmlFor="script-concurrency" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Concurrency</label>
              <input
                id="script-concurrency"
                type="number"
                min="1"
                value={createForm.concurrencyLimit}
                onChange={(e) => setCreateForm(f => ({ ...f, concurrencyLimit: parseInt(e.target.value) || 1 }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Schedule Type</label>
            <div className="flex gap-2">
              {(['interval', 'cron', 'oneshot'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setCreateForm(f => ({ ...f, scheduleType: type }))}
                  className={`flex-1 rounded-lg p-3 border flex items-center gap-2 transition-colors ${
                    createForm.scheduleType === type
                      ? 'bg-navy-850 text-white border-navy-850'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {{
                    interval: <Clock className="h-4 w-4" />,
                    cron: <Calendar className="h-4 w-4" />,
                    oneshot: <Zap className="h-4 w-4" />,
                  }[type]}
                  <span className="text-sm font-medium capitalize">{type}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>
              {{
                interval: 'Interval (milliseconds)',
                cron: 'Cron Expression (e.g., "0 * * * *")',
                oneshot: 'One-shot Time (ISO 8601, e.g., "2024-01-01T12:00:00")',
              }[createForm.scheduleType]}
            </label>
            {createForm.scheduleType === 'interval' && (
              <input
                type="number"
                value={createForm.intervalMs}
                onChange={(e) => setCreateForm(f => ({ ...f, intervalMs: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none mt-1"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            )}
            {createForm.scheduleType === 'cron' && (
              <input
                type="text"
                value={createForm.cronExpr}
                onChange={(e) => setCreateForm(f => ({ ...f, cronExpr: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none mt-1"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                placeholder="0 * * * * (every hour)"
              />
            )}
            {createForm.scheduleType === 'oneshot' && (
              <input
                type="datetime-local"
                value={createForm.oneshotTime}
                onChange={(e) => setCreateForm(f => ({ ...f, oneshotTime: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none mt-1"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            )}
          </div>

          <div>
            <label htmlFor="script-timeout" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Timeout (ms)</label>
            <input
              id="script-timeout"
              type="number"
              min="1000"
              value={createForm.timeoutMs}
              onChange={(e) => setCreateForm(f => ({ ...f, timeoutMs: parseInt(e.target.value) || 300000 }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
            />
          </div>

          <div>
            <label htmlFor="script-code" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Code</label>
            <textarea
              id="script-code"
              value={createForm.code}
              onChange={(e) => setCreateForm(f => ({ ...f, code: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none font-mono"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              rows={6}
              placeholder={`// Your script code here
// Example:
// module.exports = async (ctx) => {
//   console.log('Script running', ctx.jobDefinitionId);
//   return { ok: true };
// };`}
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setCreateModalOpen(false)}
              className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!createForm.name.trim()}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Create Script
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Script Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Script" size="lg">
        <div className="space-y-4">
          <div>
            <label htmlFor="edit-script-name" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Name</label>
            <input
              id="edit-script-name"
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
            />
          </div>

          <div>
            <label htmlFor="edit-script-description" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Description</label>
            <textarea
              id="edit-script-description"
              value={editForm.description}
              onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              rows={2}
              placeholder="What does this script do?"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-script-handler" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Handler Key</label>
              <input
                id="edit-script-handler"
                type="text"
                value={editForm.handlerKey}
                onChange={(e) => setEditForm(f => ({ ...f, handlerKey: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            </div>
            <div>
              <label htmlFor="edit-script-concurrency" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Concurrency</label>
              <input
                id="edit-script-concurrency"
                type="number"
                min="1"
                value={editForm.concurrencyLimit}
                onChange={(e) => setEditForm(f => ({ ...f, concurrencyLimit: parseInt(e.target.value) || 1 }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            </div>
          </div>

          <div>
            <label htmlFor="edit-script-timeout" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Timeout (ms)</label>
            <input
              id="edit-script-timeout"
              type="number"
              min="1000"
              value={editForm.timeoutMs}
              onChange={(e) => setEditForm(f => ({ ...f, timeoutMs: parseInt(e.target.value) || 300000 }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
            />
          </div>

          <div>
            <label htmlFor="edit-script-code" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Code</label>
            <textarea
              id="edit-script-code"
              value={editForm.code}
              onChange={(e) => setEditForm(f => ({ ...f, code: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none font-mono"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              rows={6}
              placeholder={`// Your script code here
// Example:
// module.exports = async (ctx) => {
//   console.log('Script running', ctx.jobDefinitionId);
//   return { ok: true };
// };`}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="edit-script-enabled"
              type="checkbox"
              checked={editForm.enabled}
              onChange={(e) => setEditForm(f => ({ ...f, enabled: e.target.checked }))}
              className="h-4 w-4 rounded"
            />
            <label htmlFor="edit-script-enabled" className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>
              Enabled
            </label>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setEditModalOpen(false)}
              className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleUpdate}
              disabled={!editForm.name.trim()}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Save Changes
            </button>
          </div>
        </div>
      </Modal>

      {/* Trigger Modal */}
      <Modal isOpen={triggerModalOpen} onClose={() => setTriggerModalOpen(false)} title="Trigger Script" size="md">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
            Run <strong>{selectedJob?.name}</strong> manually. You can optionally provide input data for the script.
          </p>
          <div>
            <label htmlFor="trigger-input" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Input (JSON)</label>
            <textarea
              id="trigger-input"
              value={triggerInput}
              onChange={(e) => setTriggerInput(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none font-mono"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              rows={4}
              placeholder='{"key": "value"}'
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setTriggerModalOpen(false)}
              className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleTrigger}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Trigger
            </button>
          </div>
        </div>
      </Modal>

      {/* Approval Confirmation Modal */}
      <Modal isOpen={approvalModalOpen} onClose={() => setApprovalModalOpen(false)} title={approvalAction === 'approve' ? 'Approve Script' : 'Reject Script'} size="md">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
            {approvalAction === 'approve'
              ? `Approve "${selectedJob?.name}"? Approved jobs can be enabled and triggered.`
              : `Reject "${selectedJob?.name}"? This will disable and clear approval.`
            }
          </p>
          <div>
            <label htmlFor="approval-note" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Note (optional)</label>
            <textarea
              id="approval-note"
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none font-mono"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              rows={3}
              placeholder={`Add a note about this ${approvalAction === 'approve' ? 'approval' : 'rejection'}...`}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setApprovalModalOpen(false)}
              className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleApproval}
              className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{
                backgroundColor: approvalAction === 'approve' ? '#28a745' : 'var(--color-danger)',
              }}
            >
              {approvalAction === 'approve' ? 'Approve' : 'Reject'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Script"
        message={`Are you sure you want to delete "${selectedJob?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}