import type { NextConfig } from 'next';

const nextConfig: NextConfig = {

  // Keeps the Node.js runtime (Server Components) happy
  serverExternalPackages: ['ioredis'],

  // Fixes the Edge runtime (Middleware) build error
  webpack(config, { nextRuntime }) {
    if (nextRuntime === 'edge') {
      config.externals = config.externals || [];
      config.externals.push('ioredis');
    }

    // Node.js built-ins that webpack can't resolve natively
    const nodeBuiltins = ['crypto', 'fs', 'path', 'async_hooks'];
    config.externals = config.externals || [];
    for (const builtin of nodeBuiltins) {
      if (!config.externals.includes(builtin)) {
        config.externals.push(builtin);
      }
    }

    return config;
  },

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
              "object-src 'none'",
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

  async rewrites() {
    return [];
  },
};

export default nextConfig;
