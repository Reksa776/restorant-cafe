// ============================================================
// INSTANT DELIVERY — provider abstraction.
//
// Mirrors the payment provider pattern (services/payment/providers): the
// service layer owns persistence/idempotency, a provider only talks to one
// courier API. Every tenant configures its own credentials (BYOK), so a
// provider instance is always constructed from THAT tenant's settings.
//
// Money is always an integer rupiah amount (fee: Int) — never a float that
// could drift from the amount charged on the order.
// ============================================================

export interface DeliveryOrigin {
  branchId: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  latitude: number;
  longitude: number;
}

export interface DeliveryDestination {
  address: string;
  latitude: number;
  longitude: number;
  contactName: string | null;
  contactPhone: string | null;
  postalCode?: string | null;
}

export interface DeliveryRate {
  provider: string;
  courierCode: string;
  courierName: string;
  serviceType: string;
  serviceName: string;
  /** Integer rupiah. */
  fee: number;
  currency: string;
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
}

export interface ShipmentItem {
  name: string;
  quantity: number;
  /** Unit value in rupiah (used by the courier for insurance/declaration). */
  value: number;
  weightGram: number;
}

export interface CreateShipmentInput {
  orderNumber: string;
  restaurantName: string;
  origin: DeliveryOrigin;
  destination: DeliveryDestination;
  /** Courier/service quoted at checkout (e.g. grab / instant). */
  courierCode: string;
  serviceType: string;
  items: ShipmentItem[];
  /** Fee already charged on the order (integer rupiah). */
  fee: number;
  notes: string | null;
}

export interface CreateShipmentResult {
  externalShipmentId: string | null;
  waybillId: string | null;
  status: string;
  fee: number;
  driverName: string | null;
  driverPhone: string | null;
  driverPlate: string | null;
  trackingUrl: string | null;
  rawResponse: unknown;
}

export interface CancelShipmentInput {
  externalShipmentId: string | null;
  waybillId: string | null;
}

export interface DeliveryRateOptions {
  courierCode?: string | null;
  serviceType?: string | null;
}

export interface DeliveryProviderClient {
  readonly code: string;
  getRates(
    origin: DeliveryOrigin,
    destination: DeliveryDestination,
    options?: DeliveryRateOptions
  ): Promise<DeliveryRate[]>;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  cancelShipment(input: CancelShipmentInput): Promise<void>;
}
