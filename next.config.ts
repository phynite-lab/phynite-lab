import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.PHYNITE_APP_MODE === 'local'
  ? { output: 'standalone', images: { unoptimized: true } } : {};

export default nextConfig;
