import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  devIndicators: false,
  poweredByHeader: false,
  serverExternalPackages: ['@whiskeysockets/baileys', '@node-rs/argon2', 'pg', 'pdfkit', 'docx'],
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
      {
        // Client links: never indexed, never cached, and the secret in the address is never passed on.
        source: '/s/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
