'use client';

import React from 'react';
import { useNotifications } from '../api/useNotifications';

export const NotificationBell = () => {
  const { unreadCount, isLoading } = useNotifications();

  return (
    <div className="relative p-2 cursor-pointer hover:bg-gray-100 rounded-full transition-colors">
      {/* Bell Icon (SVG) */}
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24" 
        strokeWidth={1.5} 
        stroke="currentColor" 
        className="w-6 h-6 text-gray-600"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.457 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
      </svg>

      {/* Unread Badge */}
      {(unreadCount > 0 || isLoading) && (
        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white">
          {isLoading ? (
            <div className="h-1 w-1 animate-pulse bg-white rounded-full" />
          ) : (
            unreadCount > 99 ? '99+' : unreadCount.toString()
          )}
        </span>
      )}

      {/* Tooltip/Dropdown Placeholder - for future expansion */}
    </div>
  );
};
