import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Never advertise the runtime (M10) — production runs `next start` behind
  // Cloudflare/Apache, and the header leaks framework fingerprinting.
  poweredByHeader: false,

  // Standalone output: Dockerfile & PM2/`node .next/standalone/server.js`
  // rely on the self-contained server bundle. Runtime product image uploads
  // live under ./public/uploads (process.cwd()-relative), which is a runtime
  // data directory — never copied into the build artifact or deleted by
  // `next build`. It must be persisted outside the image (docker volume /
  // host dir) so uploads survive rebuilds and restarts.
  // output: "standalone",
};

export default nextConfig;
