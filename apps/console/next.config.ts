const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone" as const,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    NEXT_PUBLIC_AEGIS_API_URL: process.env.NEXT_PUBLIC_AEGIS_API_URL || "http://localhost:3200",
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE || "true",
  },
};

export default nextConfig;
