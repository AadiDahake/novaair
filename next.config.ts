import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the dev overlay badge out of screenshots.
  devIndicators: false,
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
}

export default nextConfig
