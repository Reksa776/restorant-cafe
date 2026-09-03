import type { RealtimeEvent, RealtimeEventType } from "./types";

/**
 * Server-side realtime event bus (in-memory, single process).
 *
 * Subscribers are grouped by restaurantId — an event is only delivered to
 * subscribers whose restaurantId matches the event's restaurantId. The
 * restaurantId is always derived server-side from the authenticated admin
 * session (see the SSE route), never trusted from the client.
 *
 * NOTE: This bus is process-local. The app runs under PM2 as a single
 * instance (`next start`), so events published from the same process reach
 * all connected admin clients. If the deployment is ever scaled to multiple
 * Node.js instances, this module must be backed by a shared pub/sub
 * transport (e.g. Redis) — no schema or infrastructure change is required
 * for the current single-instance setup.
 */

export type RealtimeSink = (event: RealtimeEvent) => void;

const listenersByRestaurant = new Map<string, Set<RealtimeSink>>();

let sequence = 0;

/**
 * Subscribe a sink to every event belonging to `restaurantId`.
 * Returns an unsubscribe function.
 */
export function subscribeRealtime(
  restaurantId: string,
  sink: RealtimeSink
): () => void {
  let set = listenersByRestaurant.get(restaurantId);
  if (!set) {
    set = new Set();
    listenersByRestaurant.set(restaurantId, set);
  }
  set.add(sink);

  return () => {
    const current = listenersByRestaurant.get(restaurantId);
    if (!current) return;
    current.delete(sink);
    if (current.size === 0) {
      listenersByRestaurant.delete(restaurantId);
    }
  };
}

/** Number of subscribers for a restaurant (used by tests/diagnostics). */
export function countRealtimeListeners(restaurantId: string): number {
  return listenersByRestaurant.get(restaurantId)?.size ?? 0;
}

/**
 * Build a stable event id for de-duplication. Create/terminal events use
 * identity-based ids (e.g. `evt_order_created_<orderId>`) so a duplicated
 * delivery of the same write collapses into one event.
 */
export function makeEventId(
  type: RealtimeEventType,
  key: string
): string {
  return `evt_${type.toLowerCase().replace(/_/g, "-")}_${key}`;
}

/**
 * Publish an event to subscribers of the matching restaurant only.
 * Never throws — a faulty subscriber must not break business writes.
 */
export function publishRealtime(event: RealtimeEvent): void {
  const set = listenersByRestaurant.get(event.restaurantId);
  if (!set || set.size === 0) return;
  for (const sink of set) {
    try {
      sink(event);
    } catch {
      // Ignore subscriber errors (e.g. closed stream) — logging them here
      // would spam the log for a torn-down connection.
    }
  }
}

/**
 * Convenience builder: publish a typed event with a stable id.
 */
export function emitRealtime(
  restaurantId: string,
  type: RealtimeEventType,
  key: string,
  data?: Record<string, unknown>
): void {
  sequence += 1;
  publishRealtime({
    id: makeEventId(type, key),
    type,
    restaurantId,
    timestamp: new Date().toISOString(),
    data: {
      ...data,
      // Monotonic sequence helps consumers order events if ever needed.
      seq: sequence,
    },
  });
}
