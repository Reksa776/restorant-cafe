import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { deliveryService } from "@/services/delivery/delivery.service";

// ============================================================
// POST /api/webhooks/delivery
//
// Receives courier/aggregator status updates (driver found, plate number,
// in delivery, delivered…). Two transports are normalized here:
//   - this app's simple shape  { orderNumber, status, driverName, ... }
//   - Biteship's native shape  { order_id, status, courier: { ... } }
//
// SECURITY: a per-deployment `DELIVERY_WEBHOOK_SECRET` (header
// `x-webhook-secret` or `?secret=`) is required for real providers. When it
// is not configured, only MOCK shipments may be updated — so an anonymous
// caller can never mark a real Biteship order as delivered.
// ============================================================

const WebhookSchema = z.object({
  provider: z.string().trim().max(40).optional(),
  externalShipmentId: z.string().trim().max(200).optional(),
  waybillId: z.string().trim().max(200).optional(),
  orderNumber: z.string().trim().max(100).optional(),
  status: z.string().trim().min(1).max(60),
  driverName: z.string().trim().max(120).optional(),
  driverPhone: z.string().trim().max(40).optional(),
  driverPlate: z.string().trim().max(30).optional(),
  trackingUrl: z.string().trim().max(500).optional(),
  raw: z.unknown().optional(),
});

type RawBody = Record<string, unknown>;

function asRecord(value: unknown): RawBody {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawBody)
    : {};
}

function pickString(source: RawBody, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody: unknown = await request.json().catch(() => null);
    const body = asRecord(rawBody);
    const courier = asRecord(body.courier);
    const metadata = asRecord(body.metadata);

    const normalized = {
      provider: pickString(body, ["provider"]),
      externalShipmentId:
        pickString(body, ["externalShipmentId", "external_shipment_id", "order_id", "id"]) ||
        pickString(courier, ["order_id"]),
      waybillId:
        pickString(body, ["waybillId", "waybill_id"]) ||
        pickString(courier, ["waybill_id", "tracking_id"]),
      orderNumber:
        pickString(body, ["orderNumber", "order_number"]) ||
        pickString(metadata, ["orderNumber"]),
      status:
        pickString(body, ["status", "event", "state"]) || "",
      driverName:
        pickString(body, ["driverName", "driver_name"]) ||
        pickString(courier, ["name", "driver_name"]),
      driverPhone:
        pickString(body, ["driverPhone", "driver_phone"]) ||
        pickString(courier, ["phone", "driver_phone"]),
      driverPlate:
        pickString(body, ["driverPlate", "driver_plate", "plate_number"]) ||
        pickString(courier, ["plate_number"]),
      trackingUrl: pickString(body, ["trackingUrl", "tracking_url"]),
      raw: rawBody,
    };

    const parsed = WebhookSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const data = parsed.data;

    const provider = (data.provider || "").toUpperCase() || null;
    const secret = (process.env.DELIVERY_WEBHOOK_SECRET || "").trim();
    const providedSecret =
      request.headers.get("x-webhook-secret") ||
      request.nextUrl.searchParams.get("secret");

    if (secret) {
      if (providedSecret !== secret) {
        throw new AppError("Invalid webhook secret", 401, "UNAUTHORIZED");
      }
    } else if (provider && provider !== "MOCK") {
      throw new AppError(
        "DELIVERY_WEBHOOK_SECRET belum dikonfigurasi — webhook provider nyata ditolak.",
        503,
        "WEBHOOK_NOT_CONFIGURED"
      );
    }

    const result = await deliveryService.handleProviderUpdate({
      ...data,
      // Without a configured secret only MOCK shipments are reachable; the
      // service verifies the provider matches the stored shipment.
      provider: provider ?? "MOCK",
    });

    return successResponse(
      {
        shipmentId: result.shipment.id,
        orderId: result.shipment.orderId,
        status: result.shipment.status,
        orderCompleted: result.orderCompleted,
      },
      "Delivery webhook processed"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error processing delivery webhook:", error);
    return errorResponse(
      "Failed to process delivery webhook",
      "INTERNAL_ERROR",
      500
    );
  }
}
