/**
 * Shared realtime event vocabulary used by the server-side event bus,
 * the admin SSE stream and the admin client hook.
 *
 * Keep this file free of server-only imports so it is safe to import
 * from client components.
 */

export const REALTIME_EVENT_TYPES = {
  CONNECTION: "CONNECTION",
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_UPDATED: "ORDER_UPDATED",
  ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
  PAYMENT_CREATED: "PAYMENT_CREATED",
  PAYMENT_UPDATED: "PAYMENT_UPDATED",
  PAYMENT_STATUS_CHANGED: "PAYMENT_STATUS_CHANGED",
  CUSTOMER_CREATED: "CUSTOMER_CREATED",
  CUSTOMER_UPDATED: "CUSTOMER_UPDATED",
  PRODUCT_CREATED: "PRODUCT_CREATED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  PRODUCT_DELETED: "PRODUCT_DELETED",
  CATEGORY_CREATED: "CATEGORY_CREATED",
  CATEGORY_UPDATED: "CATEGORY_UPDATED",
  CATEGORY_DELETED: "CATEGORY_DELETED",
  TABLE_CREATED: "TABLE_CREATED",
  TABLE_UPDATED: "TABLE_UPDATED",
  TABLE_DELETED: "TABLE_DELETED",
  TABLE_STATUS_CHANGED: "TABLE_STATUS_CHANGED",
  DASHBOARD_UPDATED: "DASHBOARD_UPDATED",
  // Client-only pseudo event: emitted periodically while the SSE stream is
  // down so pages can do a light authoritative refetch (fallback mode).
  OFFLINE_POLL: "OFFLINE_POLL",
} as const;

export type RealtimeEventType =
  (typeof REALTIME_EVENT_TYPES)[keyof typeof REALTIME_EVENT_TYPES];

export interface RealtimeEvent {
  /** Stable identifier used by clients for de-duplication. */
  id: string;
  type: RealtimeEventType;
  /** Server-verified restaurant this event belongs to (isolation key). */
  restaurantId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}
