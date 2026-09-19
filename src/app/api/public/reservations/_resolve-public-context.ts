import { NextRequest } from "next/server";
import { ValidationError } from "@/lib/errors";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";

/**
 * Shared public restaurant resolution for the reservation public routes.
 * Mirrors `POST /api/public/orders` — the client NEVER dictates the tenant:
 *   1. tableId wins (server-validated via Prisma; branch derives from it)
 *   2. the authenticated customer-session restaurant (only when ACTIVE)
 *   3. the client-claimed restaurantId (only when it maps to an ACTIVE
 *      restaurant)
 *   4. legacy fallback: the first active restaurant
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
  for (const candidate of [session?.restaurantId, hints.restaurantId]) {
    if (!candidate) continue;
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: candidate },
      select: { id: true, isActive: true },
    });
    if (restaurant?.isActive) return restaurant.id;
  }

  const fallback = await prisma.restaurant.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!fallback) {
    throw new ValidationError("Tidak ada restoran aktif");
  }
  return fallback.id;
}