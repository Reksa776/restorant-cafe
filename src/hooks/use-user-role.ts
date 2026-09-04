"use client";

import { useEffect, useState } from "react";
import api from "@/lib/axios";

export type StaffRole = "ADMIN" | "CASHIER";

interface SessionInfo {
  userId: string;
  restaurantId: string;
  role: StaffRole;
}

/**
 * Fetch the authenticated restaurant staff role (client-safe /api/auth/session).
 * Returns null while loading / when not authenticated.
 */
export function useUserRole(): {
  role: StaffRole | null;
  session: SessionInfo | null;
  isLoading: boolean;
} {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .get("/auth/session")
      .then((res) => {
        if (!alive) return;
        const data = res.data?.data;
        if (data?.role) setSession(data as SessionInfo);
      })
      .catch(() => {
        // Not authenticated — role stays null.
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return {
    role: session?.role ?? null,
    session,
    isLoading,
  };
}
