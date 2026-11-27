import crypto from "crypto";
import type {
  CreateShipmentInput,
  CreateShipmentResult,
  DeliveryDestination,
  DeliveryOrigin,
  DeliveryProviderClient,
  DeliveryRate,
} from "./delivery.interface";

// ============================================================
// MOCK DELIVERY PROVIDER
//
// Lets every tenant exercise the complete flow (quote → booking → driver →
// tracking → delivered) without a paid courier API key. Rates are realistic:
// Rp 10.000 base + Rp 2.500 per km (great-circle distance between the
// branch's origin and the customer's coordinates), rounded to Rp 500.
// ============================================================

const BASE_FEE = 10_000;
const PER_KM_FEE = 2_500;
const ROUNDING = 500;
const AVG_SPEED_KMH = 20;

const DRIVER_NAMES = [
  "Budi Santoso",
  "Agus Wijaya",
  "Rizky Pratama",
  "Dedi Kurniawan",
];
const DRIVER_PLATES = ["B 1234 XYZ", "B 8899 KJI", "D 4567 ABC", "F 7788 QWE"];

/** Great-circle distance in kilometres. */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function mockDeliveryFee(distanceKm: number): number {
  const raw = BASE_FEE + distanceKm * PER_KM_FEE;
  return Math.max(BASE_FEE, Math.round(raw / ROUNDING) * ROUNDING);
}

export class MockDeliveryProvider implements DeliveryProviderClient {
  readonly code = "MOCK";

  async getRates(
    origin: DeliveryOrigin,
    destination: DeliveryDestination
  ): Promise<DeliveryRate[]> {
    const km = haversineKm(origin, destination);
    const etaMin = Math.max(15, Math.round((km / AVG_SPEED_KMH) * 60) + 10);
    return [
      {
        provider: this.code,
        courierCode: "grab",
        courierName: "GrabExpress",
        serviceType: "instant",
        serviceName: "Instant",
        fee: mockDeliveryFee(km),
        currency: "IDR",
        etaMinMinutes: etaMin,
        etaMaxMinutes: etaMin + 15,
      },
    ];
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    // Deterministic-ish dummy driver so the UI can be exercised end-to-end.
    const suffix = crypto.randomInt(1000, 9999);
    const driverName = DRIVER_NAMES[suffix % DRIVER_NAMES.length];
    const driverPlate = DRIVER_PLATES[suffix % DRIVER_PLATES.length];
    const externalShipmentId = `MOCK-${input.orderNumber}-${suffix}`;

    return {
      externalShipmentId,
      waybillId: `GRAB-${suffix}${crypto.randomInt(10, 99)}`,
      status: "PICKING_UP",
      fee: input.fee,
      driverName,
      driverPhone: "0812-3456-7890",
      driverPlate,
      // The customer tracking page already exists and reads the shipment
      // status, so the mock "live tracking" link is internal.
      trackingUrl: `/order/${encodeURIComponent(input.orderNumber)}`,
      rawResponse: {
        mock: true,
        orderNumber: input.orderNumber,
        origin: { lat: input.origin.latitude, lng: input.origin.longitude },
        destination: {
          lat: input.destination.latitude,
          lng: input.destination.longitude,
        },
        distanceKm: Number(
          haversineKm(input.origin, input.destination).toFixed(2)
        ),
        bookedAt: new Date().toISOString(),
      },
    };
  }

  async cancelShipment(): Promise<void> {
    // Nothing to cancel on a simulated booking.
  }
}
