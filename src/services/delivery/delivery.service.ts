import { Prisma } from "@prisma/client";
import type { OrderShipment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  DeliveryError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { BiteshipDeliveryProvider } from "./biteship.provider";
import { MockDeliveryProvider } from "./mock-delivery.provider";
import type {
  CreateShipmentResult,
  DeliveryDestination,
  DeliveryOrigin,
  DeliveryProviderClient,
  DeliveryRate,
  ShipmentItem,
} from "./delivery.interface";

// ============================================================
// DELIVERY SERVICE — tenant-scoped quoting, dispatch and tracking.
//
// Guarantees:
//  1. TENANT ISOLATION — every read starts from the session/tenant
//     restaurantId; a branch, order or shipment of another merchant is never
//     reachable.
//  2. ONE DRIVER PER ORDER — dispatch claims the shipment row inside a
//     `SELECT ... FOR UPDATE` on the order, flips it to ALLOCATING, and only
//     then calls the courier API OUTSIDE the lock. A repeated webhook or a
//     double click therefore sees ALLOCATING and never books a second driver.
//  3. MONEY IS SERVER-SIDE — the fee charged is always `order.deliveryFee`
//     (recomputed from the provider quote at checkout), never client input.
//  4. FAILURE IS RECORDED — a courier/API failure marks the shipment FAILED
//     so the dashboard can offer "Panggil Ulang Driver"; it never rolls back
//     a committed PAID order.
// ============================================================

export const DELIVERY_PROVIDERS = ["MOCK", "BITESHIP", "GRABEXPRESS"] as const;
export type DeliveryProviderCode = (typeof DELIVERY_PROVIDERS)[number];

export const DELIVERY_AUTO_DISPATCH_OPTIONS = ["PAID", "READY"] as const;
export type DeliveryAutoDispatchOn =
  (typeof DELIVERY_AUTO_DISPATCH_OPTIONS)[number];

const DEFAULT_COURIER = "grab";
const DEFAULT_SERVICE = "instant";
const DEFAULT_ITEM_WEIGHT_GRAM = 500;

const ACTIVE_SHIPMENT_STATUSES = [
  "ALLOCATING",
  "PICKING_UP",
  "IN_DELIVERY",
  "DELIVERED",
] as const;

/** Provider codes are stored uppercase; unknown values fall back to MOCK. */
export function normalizeProvider(value: string | null | undefined): DeliveryProviderCode {
  const upper = (value || "").trim().toUpperCase();
  return (DELIVERY_PROVIDERS as readonly string[]).includes(upper)
    ? (upper as DeliveryProviderCode)
    : "MOCK";
}

/** Never expose the full secret: "****1234" (last four characters). */
export function maskApiKey(apiKey: string | null | undefined): string | null {
  if (!apiKey) return null;
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  const tail = trimmed.slice(-4);
  return `****${tail}`;
}

/** JSON-safe value for Prisma's Json columns. */
function asJson(value: unknown): Prisma.InputJsonValue {
  try {
    return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
  } catch {
    return {};
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Normalize courier/aggregator status strings into the OrderShipment
 * lifecycle. Unknown intermediate values are treated as IN_DELIVERY (never
 * PENDING — a provider update always means the booking progressed).
 */
export function normalizeShipmentStatus(raw: string): string {
  const status = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["delivered", "completed", "done", "finished"].includes(status)) {
    return "DELIVERED";
  }
  if (["cancelled", "canceled", "rejected", "void"].includes(status)) {
    return "CANCELLED";
  }
  if (
    ["failed", "failure", "error", "courier_not_found", "no_driver"].includes(
      status
    )
  ) {
    return "FAILED";
  }
  if (
    [
      "in_delivery",
      "dropping_off",
      "on_delivery",
      "on_the_way",
      "picked",
      "picked_up",
      "pickedup",
    ].includes(status)
  ) {
    return "IN_DELIVERY";
  }
  if (
    [
      "picking_up",
      "picking",
      "confirmed",
      "allocated",
      "allocating",
      "finding_driver",
      "searching_driver",
    ].includes(status)
  ) {
    return status === "allocated" || status === "allocating"
      ? "ALLOCATING"
      : "PICKING_UP";
  }
  if (status === "pending") return "PENDING";
  return "IN_DELIVERY";
}

export interface DeliveryWebhookUpdate {
  provider?: string | null;
  externalShipmentId?: string | null;
  waybillId?: string | null;
  orderNumber?: string | null;
  status: string;
  driverName?: string | null;
  driverPhone?: string | null;
  driverPlate?: string | null;
  trackingUrl?: string | null;
  raw?: unknown;
}

export class DeliveryService {
  /** Build the provider client for ONE tenant's stored configuration. */
  private buildProvider(
    providerCode: string,
    apiKey: string | null
  ): DeliveryProviderClient {
    const provider = normalizeProvider(providerCode);
    if (provider === "BITESHIP") {
      return new BiteshipDeliveryProvider(apiKey, { code: "BITESHIP" });
    }
    if (provider === "GRABEXPRESS") {
      return new BiteshipDeliveryProvider(apiKey, {
        code: "GRABEXPRESS",
        pinnedCourier: "grab",
      });
    }
    return new MockDeliveryProvider();
  }

  private async loadSettings(restaurantId: string) {
    const settings = await prisma.restaurantSettings.findUnique({
      where: { restaurantId },
    });
    if (!settings?.deliveryEnabled) {
      throw new ValidationError(
        "Layanan pengiriman belum diaktifkan untuk restoran ini."
      );
    }
    return settings;
  }

  private buildOrigin(branch: {
    id: string;
    name: string;
    address: string | null;
    postalCode: string | null;
    contactPhone: string | null;
    latitude: number | null;
    longitude: number | null;
  }): DeliveryOrigin {
    if (branch.latitude === null || branch.longitude === null) {
      throw new ValidationError(
        `Cabang ${branch.name} belum memiliki koordinat (latitude/longitude). Lengkapi di Pengaturan → Cabang.`
      );
    }
    return {
      branchId: branch.id,
      name: branch.name,
      address: branch.address,
      postalCode: branch.postalCode,
      contactName: branch.name,
      contactPhone: branch.contactPhone,
      latitude: branch.latitude,
      longitude: branch.longitude,
    };
  }

  private pickRate(
    rates: DeliveryRate[],
    courierCode?: string | null,
    serviceType?: string | null
  ): DeliveryRate {
    if (rates.length === 0) {
      throw new ValidationError(
        "Tidak ada layanan kurir instan yang tersedia untuk alamat ini."
      );
    }
    const byService = serviceType
      ? rates.find(
          (rate) => rate.serviceType.toLowerCase() === serviceType.toLowerCase()
        )
      : undefined;
    if (byService) return byService;

    const byCourier = courierCode
      ? rates.find(
          (rate) => rate.courierCode.toLowerCase() === courierCode.toLowerCase()
        )
      : undefined;
    return byCourier ?? rates[0];
  }

  /**
   * Public quote — used by POST /api/public/delivery/rates. The branch is
   * resolved inside the tenant; an unknown branch or an inactive delivery
   * feature is a validation error.
   */
  async getRates(input: {
    restaurantId: string;
    branchId?: string | null;
    branchCode?: string | null;
    destination: DeliveryDestination;
    courierCode?: string | null;
    serviceType?: string | null;
  }): Promise<DeliveryRate[]> {
    const settings = await this.loadSettings(input.restaurantId);

    if (!input.branchId && !input.branchCode) {
      throw new ValidationError("Cabang pengiriman wajib dipilih.");
    }

    const branch = await prisma.branch.findFirst({
      where: {
        restaurantId: input.restaurantId,
        isActive: true,
        ...(input.branchId
          ? { id: input.branchId }
          : { code: (input.branchCode || "").trim().toUpperCase() }),
      },
    });
    if (!branch) {
      throw new NotFoundError("Cabang tidak ditemukan atau tidak aktif.");
    }

    const origin = this.buildOrigin(branch);
    const provider = this.buildProvider(
      settings.deliveryProvider,
      settings.deliveryApiKey
    );
    const rates = await provider.getRates(origin, input.destination, {
      courierCode: input.courierCode,
      serviceType: input.serviceType,
    });
    return rates;
  }

  /**
   * Server-authoritative quote used while creating a DELIVERY order. Returns
   * the chosen rate (its fee is what the customer is charged) plus the
   * provider code that must be persisted on the shipment intent.
   */
  async quoteForOrder(input: {
    restaurantId: string;
    branchId: string;
    destination: DeliveryDestination;
    courierCode?: string | null;
    serviceType?: string | null;
  }): Promise<{ rate: DeliveryRate; provider: DeliveryProviderCode }> {
    const settings = await this.loadSettings(input.restaurantId);
    const branch = await prisma.branch.findFirst({
      where: {
        id: input.branchId,
        restaurantId: input.restaurantId,
        isActive: true,
      },
    });
    if (!branch) {
      throw new NotFoundError("Cabang tidak ditemukan atau tidak aktif.");
    }

    const origin = this.buildOrigin(branch);
    const providerCode = normalizeProvider(settings.deliveryProvider);
    const provider = this.buildProvider(providerCode, settings.deliveryApiKey);
    const rates = await provider.getRates(origin, input.destination, {
      courierCode: input.courierCode,
      serviceType: input.serviceType,
    });
    const rate = this.pickRate(
      rates,
      input.courierCode,
      input.serviceType
    );
    return { rate, provider: providerCode };
  }

  /**
   * Book a courier for a DELIVERY order — idempotent and safe to call from a
   * payment webhook, the READY transition, or the admin retry button.
   *
   * The shipment row is the booking INTENT (created with the order). The
   * claim → ALLOCATING flip happens under the order row lock; the network
   * call happens after the transaction, so a slow/failing courier can never
   * hold a DB lock or roll back a PAID order.
   */
  async dispatchOrderShipment(
    orderId: string,
    restaurantId: string,
    options?: { branchFilters?: string[] | null }
  ): Promise<OrderShipment> {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
        ...(options?.branchFilters?.length
          ? { branchId: { in: options.branchFilters } }
          : {}),
      },
      include: {
        branch: true,
        customer: { select: { name: true, phone: true } },
        restaurant: { select: { name: true, settings: true } },
        items: {
          include: { product: { select: { name: true } } },
        },
        shipment: true,
      },
    });

    if (!order) {
      throw new NotFoundError("Pesanan tidak ditemukan.");
    }
    if (order.orderType !== "DELIVERY") {
      throw new ValidationError(
        "Pemanggilan kurir hanya tersedia untuk pesanan delivery."
      );
    }
    if (order.status === "CANCELLED") {
      throw new ConflictError("Pesanan sudah dibatalkan.");
    }
    if (order.paymentStatus !== "PAID") {
      throw new ConflictError(
        "Pesanan belum lunas — driver hanya dapat dipanggil setelah pembayaran diterima."
      );
    }

    const settings = order.restaurant.settings;
    if (!settings?.deliveryEnabled) {
      throw new ValidationError(
        "Layanan pengiriman belum diaktifkan untuk restoran ini."
      );
    }
    if (!order.branch) {
      throw new ValidationError("Pesanan tidak memiliki cabang asal.");
    }
    if (
      !order.deliveryAddress ||
      order.deliveryLatitude === null ||
      order.deliveryLongitude === null
    ) {
      throw new ValidationError(
        "Alamat dan koordinat pengiriman pesanan tidak lengkap."
      );
    }

    // Fast path: a booking is already live — never book a second driver.
    if (
      order.shipment &&
      (ACTIVE_SHIPMENT_STATUSES as readonly string[]).includes(
        order.shipment.status
      )
    ) {
      return order.shipment;
    }

    const origin = this.buildOrigin(order.branch);
    const destination: DeliveryDestination = {
      address: order.deliveryAddress,
      latitude: order.deliveryLatitude,
      longitude: order.deliveryLongitude,
      contactName: order.customer?.name || "Pelanggan",
      contactPhone: order.customer?.phone || null,
      postalCode: null,
    };

    const providerCode = normalizeProvider(
      order.shipment?.provider ?? settings.deliveryProvider
    );
    const courierCode = order.shipment?.courierCode || DEFAULT_COURIER;
    const serviceType = order.shipment?.serviceType || DEFAULT_SERVICE;

    // ---- Claim the shipment under the order row lock (idempotency) ----
    const claim = await prisma.$transaction(
      async (tx): Promise<
        | { claimed: true; shipmentId: string }
        | { claimed: false; shipment: OrderShipment }
      > => {
        await tx.$queryRaw`SELECT id FROM \`order\` WHERE id = ${order.id} FOR UPDATE`;

        const existing = await tx.orderShipment.findUnique({
          where: { orderId: order.id },
        });
        if (
          existing &&
          (ACTIVE_SHIPMENT_STATUSES as readonly string[]).includes(
            existing.status
          )
        ) {
          return { claimed: false, shipment: existing };
        }

        const data = {
          provider: providerCode,
          courierCode,
          serviceType,
          status: "ALLOCATING",
          fee: order.deliveryFee,
          externalShipmentId: null,
          waybillId: null,
          driverName: null,
          driverPhone: null,
          driverPlate: null,
          trackingUrl: null,
        };

        const shipment = existing
          ? await tx.orderShipment.update({
              where: { orderId: order.id },
              data,
            })
          : await tx.orderShipment.create({
              data: {
                ...data,
                restaurantId,
                orderId: order.id,
              },
            });

        return { claimed: true, shipmentId: shipment.id };
      }
    );

    if (!claim.claimed) {
      return claim.shipment;
    }

    const shipmentId = claim.shipmentId;

    // ---- Call the courier OUTSIDE the lock ----
    const items: ShipmentItem[] = order.items.map((item) => ({
      name: item.product?.name || "Menu",
      quantity: item.quantity,
      value: Number(item.unitPrice) || 0,
      weightGram: DEFAULT_ITEM_WEIGHT_GRAM,
    }));

    let result: CreateShipmentResult;
    try {
      const provider = this.buildProvider(providerCode, settings.deliveryApiKey);
      result = await provider.createShipment({
        orderNumber: order.orderNumber,
        restaurantName: order.restaurant.name,
        origin,
        destination,
        courierCode,
        serviceType,
        items,
        fee: order.deliveryFee,
        notes: order.deliveryNotes ?? null,
      });
    } catch (error) {
      const message = errorMessage(error);
      await prisma.orderShipment.updateMany({
        where: { id: shipmentId, status: "ALLOCATING" },
        data: {
          status: "FAILED",
          rawResponse: asJson({ error: message, failedAt: new Date().toISOString() }),
        },
      });
      throw error instanceof DeliveryError
        ? error
        : new DeliveryError(message);
    }

    await prisma.orderShipment.updateMany({
      where: { id: shipmentId, status: "ALLOCATING" },
      data: {
        status: result.status || "PICKING_UP",
        externalShipmentId: result.externalShipmentId,
        waybillId: result.waybillId,
        driverName: result.driverName,
        driverPhone: result.driverPhone,
        driverPlate: result.driverPlate,
        trackingUrl: result.trackingUrl,
        rawResponse: asJson(result.rawResponse),
      },
    });

    const shipment = await prisma.orderShipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) {
      throw new NotFoundError("Data pengiriman tidak ditemukan.");
    }
    return shipment;
  }

  /**
   * Apply a courier webhook update. The shipment is located by external id,
   * waybill, or (MOCK only) order number. DELIVERED completes the order when
   * it is still in a completable state — a delivery never consumes stock for
   * a cancelled order.
   */
  async handleProviderUpdate(
    update: DeliveryWebhookUpdate
  ): Promise<{ shipment: OrderShipment; orderCompleted: boolean }> {
    let shipment: OrderShipment | null = null;

    if (update.externalShipmentId) {
      shipment = await prisma.orderShipment.findFirst({
        where: { externalShipmentId: update.externalShipmentId },
      });
    }
    if (!shipment && update.waybillId) {
      shipment = await prisma.orderShipment.findFirst({
        where: { waybillId: update.waybillId },
      });
    }
    if (!shipment && update.orderNumber) {
      // Order numbers are high-entropy but only unique per tenant; this
      // fallback exists for the MOCK provider (tenant testing) and is
      // restricted to MOCK shipments below.
      const order = await prisma.order.findFirst({
        where: { orderNumber: update.orderNumber },
        select: { id: true },
      });
      if (order) {
        shipment = await prisma.orderShipment.findUnique({
          where: { orderId: order.id },
        });
      }
    }

    if (!shipment) {
      throw new NotFoundError("Data pengiriman tidak ditemukan.");
    }
    if (
      update.provider &&
      normalizeProvider(update.provider) !== normalizeProvider(shipment.provider)
    ) {
      throw new ValidationError("Provider pengiriman tidak sesuai.");
    }

    // Terminal states are never regressed by a late/duplicate callback.
    if (shipment.status === "DELIVERED") {
      return { shipment, orderCompleted: false };
    }
    if (shipment.status === "CANCELLED" && update.status !== "CANCELLED") {
      return { shipment, orderCompleted: false };
    }

    const nextStatus = normalizeShipmentStatus(update.status);
    const updated = await prisma.orderShipment.update({
      where: { id: shipment.id },
      data: {
        status: nextStatus,
        ...(update.externalShipmentId
          ? { externalShipmentId: update.externalShipmentId }
          : {}),
        ...(update.waybillId ? { waybillId: update.waybillId } : {}),
        ...(update.driverName ? { driverName: update.driverName } : {}),
        ...(update.driverPhone ? { driverPhone: update.driverPhone } : {}),
        ...(update.driverPlate ? { driverPlate: update.driverPlate } : {}),
        ...(update.trackingUrl ? { trackingUrl: update.trackingUrl } : {}),
        ...(update.raw !== undefined
          ? { rawResponse: asJson(update.raw) }
          : {}),
      },
    });

    let orderCompleted = false;
    if (nextStatus === "DELIVERED") {
      const order = await prisma.order.findUnique({
        where: { id: updated.orderId },
        select: { id: true, status: true, restaurantId: true },
      });
      if (
        order &&
        order.status !== "COMPLETED" &&
        order.status !== "CANCELLED"
      ) {
        try {
          const { orderService } = await import(
            "@/services/order/order.service"
          );
          await orderService.updateOrderStatus(
            order.id,
            {
              status: "COMPLETED",
              notes: "Kurir telah mengantar pesanan (webhook pengiriman).",
            },
            order.restaurantId
          );
          orderCompleted = true;
        } catch (error) {
          // The order may not be READY yet (or is fully refunded). The
          // shipment stays DELIVERED; staff can complete it manually.
          console.warn(
            `[Delivery] Order ${updated.orderId} delivered but could not be completed automatically: ${errorMessage(
              error
            )}`
          );
        }
      }
    }

    return { shipment: updated, orderCompleted };
  }
}

export const deliveryService = new DeliveryService();
