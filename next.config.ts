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
