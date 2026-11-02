const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone" as const,
  env: {
    // Empty = same origin: the browser calls this app's /api/v1 proxy, never the AEGIS API directly.
    NEXT_PUBLIC_AEGIS_API_URL: process.env.NEXT_PUBLIC_AEGIS_API_URL || "",
    // Demo mode (in-memory mock data) must be requested explicitly; the default is the real API.
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "true" : "false",
  },
};

export default nextConfig;
