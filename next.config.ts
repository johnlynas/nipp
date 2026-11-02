import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keeps the Node.js runtime (Server Components) happy.
  // Also serves as the Turbopack externalization list — these server-only
  // packages must never be bundled (they spawn sockets, schedulers, or
  // depend on Node built-ins). Replaces the legacy webpack() externals
  // block from Next 15: node built-in modules are handled natively by
  // Turbopack and need no per-module externals.
  serverExternalPackages: ['ioredis', 'pg', 'bree', 'graceful', '@breejs/later'],

  // CSP is now handled dynamically in middleware.ts with nonce injection
  // Old static headers removed to avoid conflicts:
  /*
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://fonts.gstatic.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self'",
              "frame-src 'self' https://www.google.com",
              "object-src: none",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
        ],
      },
    ];
  },
  */

  // Image optimization — only allow images from trusted sources
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  async redirects() {
    // Legacy app/admin/* shell retired — forward to the dashboard/admin equivalents.
    const base = ':path*';
    return [
      { source: `/admin/users/${base}`, destination: '/dashboard/admin/users', permanent: true },
      { source: `/admin/organizations/${base}`, destination: '/dashboard/admin/organizations', permanent: true },
      { source: `/admin/roles/${base}`, destination: '/dashboard/admin/roles', permanent: true },
      { source: `/admin/permissions/${base}`, destination: '/dashboard/admin/permissions', permanent: true },
      { source: `/admin/system-logs/${base}`, destination: '/dashboard/admin/system-logs', permanent: true },
      { source: `/admin/audit-logs/${base}`, destination: '/dashboard/admin/audit-logs', permanent: true },
      { source: '/admin/:other*', destination: '/dashboard/admin/users', permanent: true },
    ];
  },

  async rewrites() {
    return [];
  },
};

export default nextConfig;
