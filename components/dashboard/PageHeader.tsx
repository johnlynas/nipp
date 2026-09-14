'use client';

interface PageHeaderProps {
  title?: string;
  description?: string;
  actionButton?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, actionButton, children }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        {title && <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>{title}</h2>}
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      {actionButton || children}
    </div>
  );
}
