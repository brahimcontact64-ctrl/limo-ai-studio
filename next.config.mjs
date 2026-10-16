import { fileURLToPath } from 'node:url';

const isDev = process.env.NODE_ENV !== 'production';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

const csp = [
  "default-src 'self'",
  `img-src 'self' data: blob: https: ${supabaseUrl}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `connect-src 'self' ${supabaseUrl} https://*.supabase.co wss://*.supabase.co`.trim(),
  "font-src 'self' data:",
  `media-src 'self' blob: https: ${supabaseUrl}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: csp },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
