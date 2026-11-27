import crypto from "crypto";
import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import {
  STALE_UNPAID_ORDER_MINUTES,
  expireStaleUnpaidOrders,
} from "@/services/order/order-expiry.service";

// ============================================================
// POST /api/internal/cron/expire-orders
//
// Cron entrypoint for the VPS crontab (every 5 minutes):
//
//   */5 * * * * curl -fsS -X POST \
//     -H "x-cron-secret: $CRON_SECRET" \
//     https://YOUR_DOMAIN/api/internal/cron/expire-orders
//
// AUTHENTICATION: shared secret header `x-cron-secret` compared against
// `CRON_SECRET` in constant time. If `CRON_SECRET` is NOT configured the
// endpoint fails closed (503) — it is never left open by accident.
//
// The route is not linked from any UI and requires no session — the shared
// secret IS the authentication, so it must only ever be called by the VPS
// crontab (or a trusted worker).
//
// Optional `?olderThanMinutes=N` (1..1440) overrides the default 30-minute
// grace period for manual/recovery runs.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseMinutes(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return STALE_UNPAID_ORDER_MINUTES;
  return Math.min(1440, Math.max(1, parsed));
}

export async function POST(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();

  if (!secret) {
    return errorResponse(
      "CRON_SECRET belum dikonfigurasi — endpoint cron dinonaktifkan.",
      "SERVICE_UNAVAILABLE",
      503
    );
  }

  const provided = (request.headers.get("x-cron-secret") || "").trim();
  if (!secretsMatch(provided, secret)) {
    return errorResponse("Unauthorized", "UNAUTHORIZED", 401);
  }

  try {
    const olderThanMinutes = parseMinutes(
      request.nextUrl.searchParams.get("olderThanMinutes")
    );

    const result = await expireStaleUnpaidOrders(olderThanMinutes);

    return successResponse(
      result,
      `${result.cancelled} pesanan kedaluwarsa dibatalkan (${result.scanned} diperiksa)`
    );
  } catch (error) {
    console.error("Error expiring stale unpaid orders:", error);
    return errorResponse(
      "Gagal membatalkan pesanan kedaluwarsa",
      "INTERNAL_ERROR",
      500
    );
  }
}
