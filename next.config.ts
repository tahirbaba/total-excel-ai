import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // In local development the Python Excel function is not served by `next dev`.
  // Run `npm run dev:py` (port 8000) and this rewrite forwards /api/export to it.
  // On Vercel, /api/export is served directly by the Python function in /api/export.py.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/export", destination: "http://127.0.0.1:8000/api/export" }];
  },
};

export default nextConfig;
