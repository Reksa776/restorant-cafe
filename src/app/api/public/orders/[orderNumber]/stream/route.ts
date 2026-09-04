import { prisma } from "@/lib/prisma";
import { subscribeRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import type {
  RealtimeEvent,
  RealtimeEventType,
} from "@/lib/realtime/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeSse(event: RealtimeEvent): Uint8Array {
  return encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * Event types that matter to a customer watching their own order page.
 * Anything else (menu/table/customer bookkeeping) is dropped before the
 * stream is written.
 */
const CUSTOMER_EVENT_TYPES = new Set<RealtimeEventType>([
  // Connection hello is produced locally (never from the bus) so the client
  // can confirm the stream is live.
  REALTIME_EVENT_TYPES.CONNECTION,
  REALTIME_EVENT_TYPES.ORDER_STATUS_CHANGED,
  REALTIME_EVENT_TYPES.ORDER_UPDATED,
  REALTIME_EVENT_TYPES.PAYMENT_CREATED,
  REALTIME_EVENT_TYPES.PAYMENT_UPDATED,
  REALTIME_EVENT_TYPES.PAYMENT_STATUS_CHANGED,
]);

/**
 * GET /api/public/orders/[orderNumber]/stream
 *
 * Server-Sent Events channel for the CUSTOMER order page
 * (/order/[orderNumber]). No authentication — the order number itself is the
 * capability (same model as the existing public order GET endpoint), and the
 * stream is filtered server-side so a client only ever receives events for
 * THAT one order:
 *
 * - The order is looked up by orderNumber to learn its restaurantId + id.
 * - The stream subscribes to the in-memory realtime bus for that restaurant
 *   (same bus the admin dashboard uses — no second mechanism).
 * - Only events whose type is in CUSTOMER_EVENT_TYPES AND whose payload
 *   references this order (data.orderId === order.id, or data.orderNumber
 *   matches) are forwarded. All other orders of the same restaurant are
 *   filtered out before anything reaches the client.
 * - Payloads only carry light references (orderId/orderNumber/status); the
 *   customer page refetches authoritative order data from the public API.
 *
 * Reconnection: browsers auto-reconnect EventSource with native backoff; the
 * order page keeps its existing periodic refetch as a fallback, and refetches
 * on reconnect (open event) so nothing is missed while disconnected.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const { orderNumber } = await params;

  const order = await prisma.order.findFirst({
    where: { orderNumber },
    select: { id: true, restaurantId: true, orderNumber: true },
  });

  if (!order) {
    return new Response("Order not found", { status: 404 });
  }

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      controllerRef = null;
    },
  });

  const sink = (event: RealtimeEvent) => {
    // Type allowlist first.
    if (!CUSTOMER_EVENT_TYPES.has(event.type)) return;

    const data = event.data ?? {};
    // Only forward events that belong to the requested order.
    if (data.orderId !== undefined && data.orderId !== order.id) return;
    if (
      data.orderNumber !== undefined &&
      String(data.orderNumber) !== order.orderNumber
    ) {
      return;
    }
    // An event with neither identifier cannot be attributed — drop it.
    if (data.orderId === undefined && data.orderNumber === undefined) return;

    try {
      controllerRef?.enqueue(encodeSse(event));
    } catch {
      // Stream closed — ignore.
    }
  };

  const unsubscribe = subscribeRealtime(order.restaurantId, sink);

  // Hello lets the client confirm the stream is live before the first
  // business event (never carries order data beyond the requested number).
  sink({
    id: `evt_connection_${order.id}`,
    type: "CONNECTION",
    restaurantId: order.restaurantId,
    timestamp: new Date().toISOString(),
    data: { orderNumber: order.orderNumber },
  });

  // Periodic comment keeps proxies/PM2 from idling the connection out.
  const ping = setInterval(() => {
    try {
      controllerRef?.enqueue(encoder.encode(": ping\n\n"));
    } catch {
      // ignore
    }
  }, 20000);

  const cleanup = () => {
    clearInterval(ping);
    unsubscribe();
    controllerRef = null;
  };

  request.signal?.addEventListener("abort", cleanup, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
