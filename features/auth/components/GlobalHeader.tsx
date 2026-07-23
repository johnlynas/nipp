'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

// --- Architecture Imports (The integrated pieces) ---
import { useUser } from '@/features/user/api/useUser'; // Identity Data
import { useNotifications } from '@/features/notifications/api/useNotifications'; // Real-time SSE
import { RequiredPermissions } from '@/features/permissions/components/RequiredPermissions'; // RBAC Shield
import { NotificationDropdown } from '@/features/notifications/components/NotificationDropdown'; // Real-time UI

const APP_NAME = "Property NI Multi-Tenant Portal";

// ========================================================================
// COMPONENT: GlobalHeader (Top Navigation Bar)
// ========================================================================
export const GlobalHeader = () => {
  // 1. Identity Logic: Fetches the global user session (Next.js App Router cookies)
  // We handle local state to prevent FOUC (Flash of Unauthorized Content) on logout/login.
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  
  // Using `null` as the userId makes `useUser` attempt to resolve it from the authenticated cookie automatically.
  // It will return `undefined` if no valid session is found.
  const { data: user, isLoading } = useUser(null);

  // ========================================================================
  
  if (isLoading) {
    return <AuthHeaderSkeleton />;
  }

  if (!user) {
    // If there is no user (logged out), show the public/maintenance header
    return <PublicHeader />;
  }

  // If a user is logged in, render the fully authenticated dashboard header.
  return (
    <>
      <auth-nav>
        {/* --- LEFT: Branding & Main Nav Links --- */}
        <div className="flex items-center space-x-8">
          <Link href="/" className="text-xl font-bold tracking-tight text-gray-900 hover:text-blue-600 transition-colors">
            {APP_NAME}
          </Link>
          
          <div className="hidden md:flex items-center space-x-4">
            <Link href="/dashboard" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
              Dashboard
            </Link>
            
            {/* 
              RBAC SHIELD: The "Platform Admin" link is completely hidden from non-Super-Admins.
              If they inspect the DOM, it won't be there! 
            */}
            <RequiredPermissions permission="platform:manage_organizations">
              <Link href="/admin/organizations" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
                Platform Admin
              </Link>
            </RequiredPermissions>

            <RequiredPermissions permission="platform:view_audit_logs">
              <Link href="/admin/audit-logs" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
                Audit Logs
              </Link>
            </RequiredPermissions>
          </div>
        </div>

        {/* --- RIGHT: Identity & Real-Time Tools --- */}
        <div className="flex items-center space-x-4">
          
          {/* 2. Real-Time Notification Shield: Uses SSE Bridge to inject data */}
          {user && (
            <NotificationDropdown />
          )}

          {/* 3. User Identity & Menu: Combines the Query Cache ID with UI */}
          <div className="relative">
            <button 
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center space-x-2 focus:outline-none group"
            >
              <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center ring-2 ring-white group-hover:ring-blue-200 transition-all">
                {user?.image ? (
                  <img src={user.image} alt="Avatar" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <span className="text-blue-600 font-semibold text-sm">
                    {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
                  </span>
                )}
              </div>
              <span className="hidden md:block text-sm font-medium text-gray-700 group-hover:text-blue-600 transition-colors">
                {user.name} <span className="text-gray-400 text-xs ml-1">({user.role})</span>
              </span>
            </button>

            {/* User Dropdown Menu */}
            {isUserMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
                <Link href="/profile" className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 transition-colors">
                  User Profile & Settings
                </Link>
                <div className="block px-4 py-2 text-sm text-gray-500 border-t border-gray-100 cursor-default">
                  Logged in as <span className="font-medium text-gray-700">{user.email}</span>
                </div>
                <button className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                  Sign Out
                </button>
              </div>
            )}
          </div>

        </div>
      </auth-nav>
    </>
  );
};

const AuthHeaderSkeleton = () => (
  <nav className="bg-white shadow-sm border-b border-gray-200 h-16 flex items-center px-8 animate-pulse">
    <div className="h-5 w-32 bg-gray-200 rounded"></div>
    <div className="flex-1 flex justify-end space-x-4">
      <div className="md:hidden flex space-x-2 items-center">
        <div className="h-8 w-8 rounded-full bg-gray-200"></div>
        <div className="h-4 w-24 bg-gray-200 rounded"></div>
      </div>
    </div>
  </nav>
);

const PublicHeader = () => (
  <nav className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
    <div className="flex justify-between items-center h-14 px-6 lg:px-8">
      <div className="flex items-center space-x-2 font-bold text-gray-900">
        <span className="text-blue-600">&#127998;</span> {APP_NAME}
      </div>
    </div>
  </nav>
);
