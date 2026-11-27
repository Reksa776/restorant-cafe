import { DeliveryError } from "@/lib/errors";
import type {
  CancelShipmentInput,
  CreateShipmentInput,
  CreateShipmentResult,
  DeliveryDestination,
  DeliveryOrigin,
  DeliveryProviderClient,
  DeliveryRate,
  DeliveryRateOptions,
} from "./delivery.interface";

// ============================================================
// BITESHIP DELIVERY PROVIDER
//
// Biteship is the aggregator used for GrabExpress Instant. The tenant's own
// API key (RestaurantSettings.deliveryApiKey) is sent as the Authorization
// header — no platform-wide key, so each merchant pays their own courier
// bills and one tenant can never book on another tenant's account.
//
// Endpoints (https://biteship.com/id/docs/api):
//   POST /v1/rates/couriers   → price + ETA for grab:instant
//   POST /v1/orders           → book a driver
//   POST /v1/orders/:id/cancel
//
// "GRABEXPRESS" tenants use this provider with the courier pinned to grab.
// ============================================================

const BITESHIP_BASE_URL = "https://api.biteship.com";
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_ITEM_WEIGHT_GRAM = 500;

interface BiteshipPricing {
  courier_code?: string;
  courier_name?: string;
  courier_service_code?: string;
  courier_service_name?: string;
  price?: number | string;
  currency?: string;
  duration?: string | number;
}

interface BiteshipResponse {
  success?: boolean;
  error?: string;
  message?: string;
  pricing?: BiteshipPricing[];
  id?: string;
  status?: string;
  price?: number | string;
  courier?: {
    tracking_id?: string;
    waybill_id?: string;
    company?: string;
    type?: string;
    name?: string;
    phone?: string;
    plate_number?: string;
  };
  [key: string]: unknown;
}

/** "1 - 2 hours" / "2 jam" / "45 minutes" → [min, max] in minutes. */
function parseEtaMinutes(value: unknown): {
  min: number | null;
  max: number | null;
} {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { min: value, max: value };
  }
  if (typeof value !== "string") return { min: null, max: null };

  const text = value.toLowerCase();
  const range = text.match(/(\d+)\s*-\s*(\d+)\s*(hour|jam)/);
  if (range) {
    return {
      min: Number(range[1]) * 60,
      max: Number(range[2]) * 60,
    };
  }
  const hours = text.match(/(\d+)\s*(hour|jam)/);
  if (hours) {
    const minutes = Number(hours[1]) * 60;
    return { min: minutes, max: minutes };
  }
  const minutes = text.match(/(\d+)\s*(minute|menit|min)/);
  if (minutes) {
    return { min: Number(minutes[1]), max: Number(minutes[1]) };
  }
  return { min: null, max: null };
}

export class BiteshipDeliveryProvider implements DeliveryProviderClient {
  readonly code: string;
  private apiKey: string;
  private pinnedCourier: string | null;

  constructor(
    apiKey: string | null | undefined,
    options?: { code?: string; pinnedCourier?: string | null }
  ) {
    this.apiKey = (apiKey || "").trim();
    this.code = options?.code || "BITESHIP";
    this.pinnedCourier = options?.pinnedCourier ?? null;
  }

  private assertConfigured(): void {
    if (!this.apiKey) {
      throw new DeliveryError(
        "API key Biteship belum diisi. Lengkapi di Pengaturan → Pengiriman Instan."
      );
    }
  }

  private async request(
    path: string,
    init: { method: string; body?: unknown }
  ): Promise<BiteshipResponse> {
    this.assertConfigured();

    let response: Response;
    try {
      response = await fetch(`${BITESHIP_BASE_URL}${path}`, {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DeliveryError(
        `Gagal menghubungi Biteship: ${message.slice(0, 160)}`
      );
    }

    // Never call response.json() directly — the gateway may answer HTML or an
    // empty body on errors. Read text first, then parse.
    const rawText = await response.text();
    let payload: BiteshipResponse | null = null;
    try {
      payload = rawText.trim()
        ? (JSON.parse(rawText) as BiteshipResponse)
        : null;
    } catch {
      throw new DeliveryError(
        `Biteship mengembalikan respons non-JSON (HTTP ${response.status}).`
      );
    }

    if (!response.ok || !payload || payload.success === false) {
      const message =
        (payload && (payload.error || payload.message)) ||
        `HTTP ${response.status}`;
      throw new DeliveryError(`Biteship: ${String(message).slice(0, 200)}`);
    }

    return payload;
  }

  async getRates(
    origin: DeliveryOrigin,
    destination: DeliveryDestination,
    options?: DeliveryRateOptions
  ): Promise<DeliveryRate[]> {
    const courier = (
      options?.courierCode ||
      this.pinnedCourier ||
      "grab"
    ).trim();

    const payload = await this.request("/v1/rates/couriers", {
      method: "POST",
      body: {
        origin_latitude: origin.latitude,
        origin_longitude: origin.longitude,
        origin_postal_code: origin.postalCode || undefined,
        destination_latitude: destination.latitude,
        destination_longitude: destination.longitude,
        destination_postal_code: destination.postalCode || undefined,
        couriers: courier,
        items: [
          {
            name: "Pesanan restoran",
            description: "Makanan dan minuman",
            value: 50_000,
            quantity: 1,
            weight: DEFAULT_ITEM_WEIGHT_GRAM,
          },
        ],
      },
    });

    const pricing = Array.isArray(payload.pricing) ? payload.pricing : [];
    return pricing.map((row) => {
      const eta = parseEtaMinutes(row.duration);
      return {
        provider: this.code,
        courierCode: row.courier_code || courier,
        courierName: row.courier_name || courier,
        serviceType: row.courier_service_code || "instant",
        serviceName: row.courier_service_name || "Instant",
        fee: Math.max(0, Math.round(Number(row.price) || 0)),
        currency: row.currency || "IDR",
        etaMinMinutes: eta.min,
        etaMaxMinutes: eta.max,
      };
    });
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const { origin, destination } = input;

    const payload = await this.request("/v1/orders", {
      method: "POST",
      body: {
        shipper_contact_name: input.restaurantName,
        shipper_contact_phone: origin.contactPhone || "081000000000",
        shipper_contact_email: "no-reply@example.com",
        shipper_organization: input.restaurantName,
        origin_contact_name: origin.contactName || origin.name,
        origin_contact_phone: origin.contactPhone || "081000000000",
        origin_address: origin.address || origin.name,
        origin_postal_code: origin.postalCode || undefined,
        origin_latitude: origin.latitude,
        origin_longitude: origin.longitude,
        destination_contact_name: destination.contactName || "Pelanggan",
        destination_contact_phone:
          destination.contactPhone || "081000000000",
        destination_contact_email: "no-reply@example.com",
        destination_address: destination.address,
        destination_postal_code: destination.postalCode || undefined,
        destination_latitude: destination.latitude,
        destination_longitude: destination.longitude,
        destination_note: input.notes || undefined,
        courier_company: this.pinnedCourier || input.courierCode || "grab",
        courier_type: input.serviceType || "instant",
        courier_insurance: 0,
        delivery_type: "now",
        order_note: `Pesanan ${input.orderNumber}`,
        metadata: { orderNumber: input.orderNumber },
        items: input.items.map((item) => ({
          name: item.name,
          description: item.name,
          value: Math.max(0, Math.round(item.value)),
          quantity: item.quantity,
          weight: item.weightGram,
        })),
      },
    });

    const courier = payload.courier || {};
    return {
      externalShipmentId: payload.id || null,
      waybillId: courier.waybill_id || courier.tracking_id || null,
      status: "PICKING_UP",
      fee: input.fee,
      driverName: courier.name || null,
      driverPhone: courier.phone || null,
      driverPlate: courier.plate_number || null,
      trackingUrl: payload.id
        ? `https://track.biteship.com/${encodeURIComponent(payload.id)}`
        : null,
      rawResponse: payload,
    };
  }

  async cancelShipment(input: CancelShipmentInput): Promise<void> {
    if (!input.externalShipmentId) return;
    await this.request(
      `/v1/orders/${encodeURIComponent(input.externalShipmentId)}/cancel`,
      { method: "POST", body: {} }
    );
  }
}
