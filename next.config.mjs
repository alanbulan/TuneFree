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
  webpack(config, { isServer }) {
    if (isServer) {
      config.output.chunkFilename = 'chunks/[name].js';
    }
    return config;
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' }
    ]
  }
};

export default nextConfig;
