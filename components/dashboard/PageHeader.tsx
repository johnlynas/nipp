'use client';

interface PageHeaderProps {
  title?: string;
  description?: string;
  /** Primary CTA — rendered inline on ≥sm and in a sticky bottom bar (thumb zone) below */
  primaryAction?: React.ReactNode;
  actionButton?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, primaryAction, actionButton, children }: PageHeaderProps) {
  const inline = primaryAction ?? actionButton ?? null;
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          {title && <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>}
          {description && <p className="text-sm text-slate-500">{description}</p>}
        </div>
        {inline && (
          <div className={primaryAction ? 'hidden sm:block' : ''}>
            {inline}
          </div>
        )}
        {!primaryAction && children}
      </div>
      {primaryAction && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:hidden">
          <div className="mx-auto max-w-lg">{primaryAction}</div>
        </div>
      )}
    </>
  );
}
