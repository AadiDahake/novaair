import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The end-to-end run builds into its own directory so it never fights a running dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Keep the dev overlay badge out of screenshots.
  devIndicators: false,
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
}

export default nextConfig
