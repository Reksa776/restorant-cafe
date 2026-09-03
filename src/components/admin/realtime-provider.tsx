"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  REALTIME_EVENT_TYPES,
  type RealtimeEvent,
} from "@/lib/realtime/types";

export type RealtimeStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

type RealtimeListener = (event: RealtimeEvent) => void;

interface AdminRealtimeContextValue {
  status: RealtimeStatus;
  /** Subscribe to all realtime events. Returns an unsubscribe function. */
  subscribe: (listener: RealtimeListener) => () => void;
}

const AdminRealtimeContext = createContext<AdminRealtimeContextValue | null>(
  null
);

const STREAM_URL = "/api/admin/realtime/stream";
const MAX_BACKOFF_ATTEMPTS = 10;
const SEEN_IDS_LIMIT = 400;
// Light fallback refresh cadence while the stream is fully offline.
const OFFLINE_POLL_INTERVAL_MS = 25_000;

function nextDelayMs(attempts: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempts);
  return base + Math.floor(Math.random() * 500);
}

/**
 * Owns ONE EventSource per page/app shell. Events are de-duplicated by id,
 * and listeners (admin pages) are notified in place. Reconnection uses
 * exponential backoff with jitter; after a hard failure cap the status
 * becomes "offline" and a light refetch cadence keeps data reasonably fresh
 * without polling the server aggressively.
 */
export function AdminRealtimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  const statusRef = useRef<RealtimeStatus>("connecting");
  const listenersRef = useRef<Set<RealtimeListener>>(new Set());
  const seenIdsRef = useRef<Set<string>>(new Set());
  const esRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  const updateStatus = useCallback((next: RealtimeStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const broadcast = useCallback((event: RealtimeEvent) => {
    const listeners = listenersRef.current;
    if (listeners.size === 0) return;
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // A broken listener must not break the connection.
      }
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(() => {
      if (statusRef.current !== "offline") {
        stopPolling();
        return;
      }
      broadcast({
        id: "evt_offline_poll",
        type: REALTIME_EVENT_TYPES.OFFLINE_POLL,
        restaurantId: "",
        timestamp: new Date().toISOString(),
      });
    }, OFFLINE_POLL_INTERVAL_MS);
  }, [broadcast, stopPolling]);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.onopen = null;
      esRef.current.onmessage = null;
      esRef.current.onerror = null;
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  // Lets the (stable) connect callback re-invoke itself on reconnection
  // without a self-referential temporal-dead-zone capture.
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (esRef.current) return;

    const es = new EventSource(STREAM_URL);
    esRef.current = es;

    es.onopen = () => {
      if (esRef.current !== es) return;
      attemptRef.current = 0;
      clearTimers();
      updateStatus("connected");
    };

    es.onmessage = (msg) => {
      if (esRef.current !== es) return;
      try {
        const event = JSON.parse(msg.data) as RealtimeEvent;
        if (!event || typeof event.type !== "string") return;

        // De-duplicate repeated deliveries of the same event.
        if (event.id) {
          if (seenIdsRef.current.has(event.id)) return;
          seenIdsRef.current.add(event.id);
          if (seenIdsRef.current.size > SEEN_IDS_LIMIT) {
            // Drop the oldest half to keep memory bounded.
            const toRemove = [...seenIdsRef.current].slice(
              0,
              SEEN_IDS_LIMIT / 2
            );
            toRemove.forEach((id) => seenIdsRef.current.delete(id));
          }
        }

        if (event.type === REALTIME_EVENT_TYPES.CONNECTION) {
          attemptRef.current = 0;
          clearTimers();
          updateStatus("connected");
        }
        broadcast(event);
      } catch {
        // Ignore malformed frames.
      }
    };

    es.onerror = () => {
      if (esRef.current !== es) return;
      disconnect();
      attemptRef.current += 1;

      if (!mountedRef.current) return;

      if (attemptRef.current >= MAX_BACKOFF_ATTEMPTS) {
        updateStatus("offline");
        startPolling();
        return;
      }

      // Reconnecting is only reported after a previously established stream;
      // the very first attempt keeps "connecting" until it succeeds or gives up.
      if (attemptRef.current > 1) updateStatus("reconnecting");

      const delay = nextDelayMs(attemptRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (mountedRef.current && !esRef.current) connectRef.current();
      }, delay);
    };
  }, [broadcast, clearTimers, disconnect, startPolling, updateStatus]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Initial connect + full cleanup.
  useEffect(() => {
    mountedRef.current = true;
    connectRef.current();

    // Reconnect promptly when the tab becomes visible again after a long
    // background period (browsers suspend SSE in background tabs).
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        !esRef.current &&
        attemptRef.current >= MAX_BACKOFF_ATTEMPTS
      ) {
        attemptRef.current = 0;
        updateStatus("connecting");
        connectRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimers();
      disconnect();
      // Drop all subscriptions when the shell unmounts.
      const listeners = listenersRef.current;
      listeners.clear();
    };
  }, [clearTimers, disconnect, updateStatus]);

  const subscribe = useCallback((listener: RealtimeListener) => {
    // Hold a stable reference to the Set so the returned unsubscribe does
    // not read the ref later (keeps the refs lint rule happy).
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <AdminRealtimeContext.Provider value={{ status, subscribe }}>
      {children}
    </AdminRealtimeContext.Provider>
  );
}

export function useAdminRealtime(): {
  status: RealtimeStatus;
  subscribe: (listener: RealtimeListener) => () => void;
} {
  const ctx = useContext(AdminRealtimeContext);
  if (!ctx) {
    // Not inside the admin shell — expose a no-op subscription so pages
    // never crash when rendered outside the provider.
    return {
      status: "offline",
      subscribe: () => () => {},
    };
  }
  return ctx;
}

/**
 * Convenience hook for admin pages: subscribe once, and invoke `onEvent`
 * (with the latest closure via a ref) whenever an event of one of the given
 * types arrives. A per-page cooldown collapses bursts of related events
 * into a single authoritative refetch. Include OFFLINE_POLL in `eventTypes`
 * to get the light fallback refresh cadence while the stream is down.
 */
export function useRealtimeListener(
  eventTypes: readonly string[],
  onEvent: (event: RealtimeEvent) => void,
  cooldownMs = 1500
): void {
  const { subscribe } = useAdminRealtime();

  const handlerRef = useRef(onEvent);
  const typesRef = useRef<ReadonlySet<string>>(new Set(eventTypes));
  const lastRunRef = useRef(0);

  // Keep the handler current without touching refs during render.
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    return subscribe((event) => {
      if (!typesRef.current.has(event.type)) return;
      const now = Date.now();
      if (now - lastRunRef.current >= cooldownMs) {
        lastRunRef.current = now;
        handlerRef.current(event);
      }
    });
  }, [subscribe, cooldownMs]);
}
