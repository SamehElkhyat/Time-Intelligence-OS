import type { NextConfig } from 'next';

/**
 * The browser only ever talks to `/api/*` on the frontend's own origin. Next forwards those
 * requests to the backend, which keeps the session cookie first-party (no CORS, SameSite=Lax just
 * works) while the two applications stay separately built and deployed.
 *
 * API_INTERNAL_URL is server-side only: the backend's address as seen from this server.
 */
const apiInternal = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternal}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
