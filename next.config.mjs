import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  outputFileTracingRoot: __dirname,
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  // images.unoptimized is true (static export), so remotePatterns is not needed.
  // Next.js skips image optimization entirely when unoptimized is enabled.
};

export default nextConfig;
