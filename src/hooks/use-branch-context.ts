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

  // Load session once.
  useEffect(() => {
    let alive = true;
    api
      .get("/auth/session")
      .then((res) => {
        if (!alive) return;
        const data = res.data?.data;
        if (data?.role) {
          setSession(data as SessionDto);
          // Restore last selected branch, but clamp it to the user's allowed
          // branches so a cross-user change never leaks the wrong branch.
          const stored = localStorage.getItem("admin_branch_id");
          const allowed = (data as SessionDto).branches.some(
            (b) => b.id === stored
          );
          if (stored && allowed) {
            setBranchIdState(stored);
          } else {
            setBranchIdState(null);
          }
        }
      })
      .catch(() => {
        // Not authenticated.
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
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