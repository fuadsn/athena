import type { NextConfig } from 'next';
import path from 'node:path';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
};
export default nextConfig;
