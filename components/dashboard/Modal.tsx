'use client';

import { useEffect, useCallback } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = { sm: '28rem', md: '32rem', lg: '42rem' };

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div 
        className="relative w-full max-h-[90vh] overflow-y-auto rounded-lg border border-[#dee2e6] bg-white shadow-xl"
        style={{ maxWidth: sizeMap[size] }}
      >
        {title && (
          <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#dee2e6' }}>
            <h3 className="text-lg font-semibold" style={{ color: '#1B2A4A' }}>{title}</h3>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close modal"
            >
              ×
            </button>
          </div>
        )}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
