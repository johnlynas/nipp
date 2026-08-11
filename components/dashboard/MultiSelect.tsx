'use client';

import { useState, useEffect, useCallback } from 'react';

interface MultiSelectProps {
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  'aria-label'?: string;
}

export function MultiSelect({ options, selected, onChange, placeholder = 'Select...', searchPlaceholder = 'Search...' }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const toggle = useCallback((id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }, [selected, onChange]);

  const filtered = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative">
      {/* Selected tags */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-[38px] flex-wrap items-center gap-1 rounded border border-[#dee2e6] px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none"
        style={{ '--tw-ring-color': '#F5A623' } as React.CSSProperties}
        aria-label={placeholder}
        aria-expanded={open}
      >
        {selected.length === 0 && (
          <span className="text-gray-400">{placeholder}</span>
        )}
        {selected.map((id) => {
          const opt = options.find((o) => o.id === id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: '#1B2A4A', color: '#F5A623' }}
            >
              {opt?.label || id}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggle(id); }}
                className="ml-1 hover:opacity-70"
                aria-label={`Remove ${opt?.label || id}`}
              >
                ×
              </button>
            </span>
          );
        })}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full rounded border border-[#dee2e6] bg-white shadow-lg" style={{ maxHeight: '240px' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full border-b px-3 py-2 text-sm focus:outline-none"
              aria-label={searchPlaceholder}
            />
            <div className="overflow-y-auto" style={{ maxHeight: '200px' }}>
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-400">No results</p>
              ) : (
                filtered.map((opt) => {
                  const isSelected = selected.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggle(opt.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors ${isSelected ? 'font-medium' : ''}`}
                      style={isSelected ? { color: '#1B2A4A', backgroundColor: '#f0fdf4' } : {}}
                      aria-pressed={isSelected}
                    >
                      <span className="h-4 w-4 shrink-0 rounded border flex items-center justify-center" style={{ borderColor: isSelected ? '#1B2A4A' : '#dee2e6', backgroundColor: isSelected ? '#1B2A4A' : 'transparent' }}>
                        {isSelected && <span className="text-white text-xs">✓</span>}
                      </span>
                      {opt.label}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
