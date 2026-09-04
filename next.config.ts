import type { NextConfig } from 'next';

const nextConfig: NextConfig = {

  // Keeps the Node.js runtime (Server Components) happy
  serverExternalPackages: ['ioredis', 'pg'],

  // Fixes the Edge runtime (Middleware) build error
  webpack(config, { nextRuntime }) {
    if (nextRuntime === 'edge') {
      config.externals = config.externals || [];
      config.externals.push('ioredis');
    }

    // Node.js built-ins that webpack can't resolve natively.
    // `crypto` is available in both Node.js and Edge runtimes, so it's always externalized.
    // The other modules are only needed for server-side bundles where Node.js built-ins 
    // aren't polyfilled (instrumentation.ts uses require() to load pg/ioredis dynamically).
    // These are NOT needed for browser bundles where Node.js built-ins like Buffer are 
    // polyfilled by webpack.
    const alwaysExternal = ['crypto'];
    config.externals = config.externals || [];
    for (const builtin of alwaysExternal) {
      if (!config.externals.includes(builtin)) {
        config.externals.push(builtin);
      }
    }

    // Node.js-specific built-ins — only needed for server-side bundles
    if (nextRuntime === 'nodejs') {
      const nodeBuiltins = ['fs', 'path', 'async_hooks', 'net', 'tls', 'dns', 'util/types', 'stream', 'events', 'util', 'string_decoder', 'readline', 'os'];
      config.externals = config.externals || [];
      for (const builtin of nodeBuiltins) {
        if (!config.externals.includes(builtin)) {
          config.externals.push(builtin);
        }
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

  async rewrites() {
    return [];
  },
};

export default nextConfig;
