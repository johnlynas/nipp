'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  'aria-label'?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search...', debounceMs = 200, 'aria-label': ariaLabel }: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => onChange(localValue), debounceMs);
    return () => clearTimeout(timer);
  }, [localValue, onChange, debounceMs]);

  return (
    <div className="relative flex-1 max-w-2xl">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
        aria-hidden="true"
      />
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full rounded border border-[#dee2e6] py-2 pl-9 pr-3 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2"
        style={{ '--tw-ring-color': '#F5A623' } as React.CSSProperties}
        aria-label={ariaLabel || placeholder}
      />
    </div>
  );
}
