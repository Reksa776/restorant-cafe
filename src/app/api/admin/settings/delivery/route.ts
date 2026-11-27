import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { maskApiKey } from "@/services/delivery/delivery.service";

// ============================================================
// GET   /api/admin/settings/delivery — tenant delivery configuration
// PATCH /api/admin/settings/delivery — ADMIN update (BYOK)
//
// The API key is write-only from the client's perspective: GET returns
// `deliveryApiKeyMasked` ("****1234") and `hasApiKey`, never the secret.
// PATCH only overwrites the stored key when a NEW non-empty value is sent;
// `clearApiKey: true` removes it.
//
// Tenant isolation: restaurantId always comes from the session.
// ============================================================

const UpdateDeliverySettingsSchema = z.object({
  deliveryEnabled: z.boolean().optional(),
  deliveryProvider: z.enum(["MOCK", "BITESHIP", "GRABEXPRESS"]).optional(),
  deliveryAutoDispatchOn: z.enum(["PAID", "READY"]).optional(),
  deliveryApiKey: z.string().max(500).optional().nullable(),
  clearApiKey: z.boolean().optional(),
});

const MASK_PREFIX = "****";

/**
 * Phase 4 — third-party couriers are TEMPORARILY disabled (business
 * decision). The Biteship/GrabExpress provider code is kept intact, but the
 * API only exposes/accepts the internal MOCK mode, so a new configuration can
 * never switch a tenant onto a hidden provider. Re-enabling is a one-line
 * change here (and in the settings UI).
 */
const ACTIVE_DELIVERY_PROVIDER = "MOCK" as const;

function toDto(settings: {
  deliveryEnabled: boolean;
  deliveryProvider: string;
  deliveryApiKey: string | null;
  deliveryAutoDispatchOn: string;
} | null) {
  return {
    deliveryEnabled: settings?.deliveryEnabled ?? false,
    deliveryProvider: ACTIVE_DELIVERY_PROVIDER,
    deliveryApiKeyMasked: maskApiKey(settings?.deliveryApiKey),
    hasApiKey: Boolean(settings?.deliveryApiKey),
    deliveryAutoDispatchOn:
      settings?.deliveryAutoDispatchOn === "READY" ? "READY" : "PAID",
  };
}

export async function GET() {
  try {
    const { restaurantId } = await requireRoles(["ADMIN"]);

    const settings = await prisma.restaurantSettings.findUnique({
      where: { restaurantId },
      select: {
        deliveryEnabled: true,
        deliveryProvider: true,
        deliveryApiKey: true,
        deliveryAutoDispatchOn: true,
      },
    });

    return successResponse(toDto(settings));
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching delivery settings:", error);
    return errorResponse(
      "Gagal memuat pengaturan pengiriman",
      "INTERNAL_ERROR",
      500
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { restaurantId } = await requireRoles(["ADMIN"]);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = UpdateDeliverySettingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const input = parsed.data;

    const existing = await prisma.restaurantSettings.findUnique({
      where: { restaurantId },
      select: {
        deliveryEnabled: true,
        deliveryProvider: true,
        deliveryApiKey: true,
        deliveryAutoDispatchOn: true,
      },
    });

    // A masked value echoed back by the UI is never treated as a new key.
    const submittedKey = input.deliveryApiKey?.trim();
    const isMaskedEcho = Boolean(
      submittedKey && submittedKey.startsWith(MASK_PREFIX)
    );
    const nextApiKey = input.clearApiKey
      ? null
      : submittedKey && !isMaskedEcho
        ? submittedKey
        : (existing?.deliveryApiKey ?? null);

    // Third-party providers are hidden for now: any submitted value is
    // coerced to the internal MOCK mode (the stored provider is overwritten on
    // the next save, so a legacy BITESHIP tenant also lands on MOCK).
    const nextProvider = ACTIVE_DELIVERY_PROVIDER;
    const nextEnabled = input.deliveryEnabled ?? existing?.deliveryEnabled ?? false;

    const settings = await prisma.restaurantSettings.upsert({
      where: { restaurantId },
      update: {
        deliveryEnabled: nextEnabled,
        deliveryProvider: nextProvider,
        deliveryApiKey: nextApiKey,
        deliveryAutoDispatchOn:
          input.deliveryAutoDispatchOn ??
          (existing?.deliveryAutoDispatchOn === "READY" ? "READY" : "PAID"),
      },
      create: {
        restaurantId,
        deliveryEnabled: nextEnabled,
        deliveryProvider: nextProvider,
        deliveryApiKey: nextApiKey,
        deliveryAutoDispatchOn: input.deliveryAutoDispatchOn ?? "PAID",
      },
      select: {
        deliveryEnabled: true,
        deliveryProvider: true,
        deliveryApiKey: true,
        deliveryAutoDispatchOn: true,
      },
    });

    return successResponse(
      toDto(settings),
      "Pengaturan pengiriman berhasil disimpan"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating delivery settings:", error);
    return errorResponse(
      "Gagal menyimpan pengaturan pengiriman",
      "INTERNAL_ERROR",
      500
    );
  }
}
