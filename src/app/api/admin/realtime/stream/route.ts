import { requireAdmin } from "@/lib/auth-helpers";
import { subscribeRealtime } from "@/lib/realtime/bus";
import type { RealtimeEvent } from "@/lib/realtime/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeSse(event: RealtimeEvent): Uint8Array {
  return encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * GET /api/admin/realtime/stream
 *
 * Server-Sent Events channel for the ADMIN dashboard.
 *
 * Security:
 * - Requires an authenticated ADMIN session (401 otherwise).
 * - The restaurantId is derived server-side from the session and used to
 *   subscribe to the event bus — this admin only ever receives events for
 *   their own restaurant. Nothing from the client is trusted.
 * - No order/customer/payment data is included in events (only light
 *   references); clients refetch authoritative data from the normal APIs.
 */
export async function GET(request: Request) {
  // Auth first — no stream is opened for non-admins.
  let restaurantId: string;
  try {
    const ctx = await requireAdmin();
    restaurantId = ctx.restaurantId;
  } catch {
    return new Response("Unauthorized", { status: 401 });
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
    try {
      controllerRef?.enqueue(encodeSse(event));
    } catch {
      // Stream closed — ignore.
    }
  };

  const unsubscribe = subscribeRealtime(restaurantId, sink);

  // Connection hello lets the client confirm it is wired to the right
  // restaurant without receiving any business data.
  sink({
    id: `evt_connection_${restaurantId}`,
    type: "CONNECTION",
    restaurantId,
    timestamp: new Date().toISOString(),
    data: { restaurantId },
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
