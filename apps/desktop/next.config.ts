import type { NextConfig } from 'next';

/**
 * Static export: the webview loads plain files from the Tauri dist folder.
 */
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
};

export default nextConfig;
