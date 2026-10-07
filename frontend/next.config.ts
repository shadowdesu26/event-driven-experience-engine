import type { NextConfig } from "next";

// Two-mode engine wiring:
//
// - Local development (launch.bat sets ENGINE_URL to its randomly-picked
//   middleware port — unassigned dynamic range starting at 39107):
//   /api/* is rewritten to the real Python middleware, which stays the
//   reference implementation.
// - Production / demo build (no ENGINE_URL): requests fall through to the
//   built-in TypeScript engine under app/api/, so a single deployment on
//   Netlify runs the whole experience engine server-side.
const engineUrl = process.env.ENGINE_URL;

const nextConfig: NextConfig = {
  ...(engineUrl
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${engineUrl}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
