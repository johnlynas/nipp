'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useNotifications } from '../api/useNotifications';
import { Notification } from '../api/useNotifications';

interface NotificationDropdownProps {}

export const NotificationDropdown = ({}: NotificationDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const { 
    notifications, 
    unreadCount, 
    isLoading 
  } = useNotifications();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasNotifications = notifications.length > 0;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors focus:outline-none"
        aria_label="Notifications"
      >
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          fill="none" 
          viewBox="0 0 24 24" 
          strokeWidth={1.5} 
          stroke="currentColor" 
          className="w-6 h-6"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.457 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>

        {/* Unread Badge */}
        {(unreadCount > 0 || isLoading) && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white">
            {isLoading ? (
              <div className="h-1 w-1 animate-pulse bg-white rounded-full" />
            ) : (
              unreadCount > 99 ? '99+' : unreadCount.toString()
            )}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Notifications</h3>
            <span className="text-xs text-gray-500">{notifications.length} Total</span>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-gray-500">No notifications yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {notifications.map((notif) => (
                  <li 
                    key={notif.id} 
                    className={`p-4 hover:bg-gray-50 transition-colors cursor-default ${!notif.read ? 'bg-blue-50/30' : ''}`}
                  >
                    <div className="flex items-start space-x-3">
                      {/* Icon based on type */}
                      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                        notif.type === 'error' ? 'bg-red-500' : 
                        notif.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                      }`} />
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{notif.message}</p>
                        <p className="text-[10px] text-gray-500 mt-1">
                          {new Date(notif.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-4 py-2 border-t border-gray-100 text-center">
            <button 
              className="text-xs text-blue-600 hover:underline font-medium"
              onClick={() => setIsOpen(false)}
            >
              Clear all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
