import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  devIndicators: false,
  poweredByHeader: false,
  serverExternalPackages: ['@whiskeysockets/baileys', '@node-rs/argon2', 'pg'],
  // Frontend-only deployments (e.g. Vercel) set BACKEND_ORIGIN so the browser
  // keeps calling same-origin /api/* while the API runs on the backend server.
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN?.replace(/\/$/, '');
    if (!backend) return [];
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
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
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
