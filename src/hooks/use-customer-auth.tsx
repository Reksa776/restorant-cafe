"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import api from "@/lib/axios";

// ============================================================
// Customer auth (F3) — client-side context around the dedicated
// customer session (separate from the staff NextAuth session).
// ============================================================

export interface CustomerPublic {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface CustomerAuthContextType {
  customer: CustomerPublic | null;
  /** True once the initial /me lookup finished (customer may still be null). */
  isHydrated: boolean;
  login: (
    restaurantId: string,
    email: string,
    password: string
  ) => Promise<CustomerPublic>;
  register: (data: {
    restaurantId: string;
    name: string;
    phone?: string;
    email: string;
    password: string;
  }) => Promise<CustomerPublic>;
  logout: () => Promise<void>;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | undefined>(
  undefined
);

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<CustomerPublic | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Restore the session (httpOnly cookie) on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/public/customer/auth/me");
        if (!cancelled && res.data?.data?.customer) {
          setCustomer(res.data.data.customer);
        }
      } catch {
        // No valid session — stays logged out.
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (restaurantId: string, email: string, password: string) => {
      const res = await api.post("/public/customer/auth/login", {
        restaurantId,
        email,
        password,
      });
      const c = res.data.data.customer as CustomerPublic;
      setCustomer(c);
      return c;
    },
    []
  );

  const register = useCallback(
    async (data: {
      restaurantId: string;
      name: string;
      phone?: string;
      email: string;
      password: string;
    }) => {
      const res = await api.post("/public/customer/auth/register", data);
      const c = res.data.data.customer as CustomerPublic;
      setCustomer(c);
      return c;
    },
    []
  );

  const logout = useCallback(async () => {
    await api.post("/public/customer/auth/logout");
    setCustomer(null);
  }, []);

  return (
    <CustomerAuthContext.Provider
      value={{ customer, isHydrated, login, register, logout }}
    >
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const ctx = useContext(CustomerAuthContext);
  if (!ctx) {
    throw new Error("useCustomerAuth must be used within CustomerAuthProvider");
  }
  return ctx;
}