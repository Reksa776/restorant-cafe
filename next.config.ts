import type { NextConfig } from "next";

// ============================================================
// PHASE 5 — PRODUCTION HARDENING (H6 / H10)
//
// Baseline security headers applied to EVERY route (`/:path*`). Applied here
// (not only in the nginx config) so the guarantees also hold for direct
// `next start` / PM2 deployments behind another reverse proxy.
//
// Deliberate allowlist for Permissions-Policy:
//   camera=(self)      — barcode scanner + attendance QR scan
//   geolocation=(self) — delivery checkout address pin
//   microphone=()      — never used
//
// Ad-hoc `allowedDevOrigins: ["100.88.79.104"]` was removed: a hardcoded
// developer IP must never ship in the production config. If you need a dev
// origin, set `ALLOWED_DEV_ORIGINS` (comma separated) in your LOCAL .env.
// ============================================================

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self)",
  },
];

const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  poweredByHeader: false,

  // `standalone` output is required by the Docker image (the runner stage
  // copies `.next/standalone` + `server.js`), but it forces the runtime
  // command to `node .next/standalone/server.js`: Next.js explicitly warns
  // that `next start` "does not work with output: standalone". PM2 deployments
  // on this same repo use `next start -p 3001`, so the output mode is enabled
  // only by the Docker build (`ENV BUILD_STANDALONE=1` in the Dockerfile).
  // Both deployment paths therefore stay 100% functional.
  ...(process.env.BUILD_STANDALONE === "1"
    ? { output: "standalone" as const }
    : {}),

  // ============================================================
  // BUILD MEMORY — VPS 1–2 GB RAM (anti-hang / anti-OOM)
  //
  // `next build` compiles ~160 pages + ~150 route handlers through Turbopack.
  // Each of these knobs removes a large, easily-avoidable RAM consumer while
  // keeping every feature and the emitted bundle behaviour identical:
  //
  //   productionBrowserSourceMaps: false — no giant client source-map pass.
  //   optimizePackageImports            — per-import rewrites instead of
  //     pulling the whole barrel of these large libraries into the graph.
  //   workerThreads: false / cpus: 1    — one build worker; no fan-out of
  //     N parallel compilers each holding its own heap on a 1–2 vCPU box.
  //   typescript.ignoreBuildErrors       — type checking moved to the
  //     separate `npm run typecheck` gate (see package.json). `next build`
  //     then only compiles bundles, so the 1.28 GB heap cap is enough.
  //
  // The heap cap itself comes from NODE_OPTIONS in the `build` script and in
  // the Dockerfile builder stage — not from here.
  // ============================================================
  productionBrowserSourceMaps: false,
  typescript: { ignoreBuildErrors: true },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "@base-ui/react",
      "date-fns",
    ],
    workerThreads: false,
    cpus: 1,
  },

  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
