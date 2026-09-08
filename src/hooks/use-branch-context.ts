"use client";

import { useEffect, useState } from "react";
import api from "@/lib/axios";

export interface BranchDto {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
}

interface SessionDto {
  userId: string;
  restaurantId: string;
  role: "ADMIN" | "CASHIER";
  branches: BranchDto[];
  branchId: string | null;
  branchScoped: boolean;
}

const refreshListeners = new Set<() => void>();

export function refreshBranchContext() {
  refreshListeners.forEach((listener) => listener());
}

export function useBranchContext(): {
  session: SessionDto | null;
  branchId: string | null;
  branches: BranchDto[];
  isLoading: boolean;
  setBranchId: (id: string | null) => void;
} {
  const [session, setSession] = useState<SessionDto | null>(null);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    const load = () => {
      api
        .get("/auth/session")
        .then((res) => {
          if (!alive) return;
          const data = res.data?.data;
          if (data?.role) {
            setSession(data as SessionDto);
            const stored = localStorage.getItem("admin_branch_id");
            const allowed = (data as SessionDto).branches.some(
              (b) => b.id === stored
            );
            if (stored && !allowed) {
              // A leftover admin_branch_id from a previous session (or a
              // branch this user no longer has access to) must be REMOVED,
              // not just ignored in React state. The axios interceptor reads
              // localStorage synchronously on every request, so a stale value
              // would keep reaching the server as x-branch-id and trigger 403
              // for an otherwise-valid user (e.g. a single-branch Main Outlet
              // cashier). Clearing it fixes the false 403 without weakening
              // server-side authorization.
              localStorage.removeItem("admin_branch_id");
            }
            setBranchIdState(stored && allowed ? stored : null);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setIsLoading(false);
        });
    };

    load();
    refreshListeners.add(load);

    return () => {
      alive = false;
      refreshListeners.delete(load);
    };
  }, []);

  const setBranchId = (id: string | null) => {
    setBranchIdState(id);
    if (id) {
      localStorage.setItem("admin_branch_id", id);
    } else {
      localStorage.removeItem("admin_branch_id");
    }
  };

  return {
    session,
    branchId,
    branches: session?.branches ?? [],
    isLoading,
    setBranchId,
  };
}