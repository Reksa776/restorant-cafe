import { NextRequest } from "next/server";
import { ValidationError } from "@/lib/errors";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Shared public restaurant resolution for the reservation public routes.
 * Mirrors `POST /api/public/orders` — the client NEVER dictates the tenant:
 *   1. tableId wins (server-validated via Prisma; branch derives from it)
 *   2. the authenticated customer-session restaurant (only when ACTIVE)
 *   3. an explicit restaurantId/slug (body/query) or the tenant cookie
 *
 * Phase 2: the legacy "first active restaurant" fallback is REMOVED — no
 * tenant context is a 400, never another merchant's booking page.
 */
export async function resolvePublicReservationRestaurant(
  request: NextRequest,
  hints: { tableId?: string | null; restaurantId?: string | null }
): Promise<string> {
  const { prisma } = await import("@/lib/prisma");

  if (hints.tableId) {
    const table = await prisma.table.findUnique({
      where: { id: hints.tableId },
      select: { restaurantId: true, isActive: true },
    });
    if (!table || !table.isActive) {
      throw new ValidationError("Meja tidak valid");
    }
    return table.restaurantId;
  }

  const session = tryGetCustomerSessionFromRequest(request);
  const tenant = await resolveRequestTenant(request, {
    id: session?.restaurantId ?? hints.restaurantId ?? null,
  });
  if (!tenant) {
    throw new ValidationError(
      "Konteks restoran tidak ditemukan. Pindai QR meja atau gunakan link restoran."
    );
  }
  return tenant.id;
}