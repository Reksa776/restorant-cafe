"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, MapPin, RotateCw } from "lucide-react";
import api from "@/lib/axios";
import { useCart } from "@/hooks/use-cart";
import { normalizeApiError } from "@/lib/api-error-handler";
import { toast } from "sonner";

// ============================================================
// /pilih-cabang — customer branch selector (mobile-first).
//
// Flow: "/" routes here when there is no valid customer branch
// context (or the saved one failed server validation). The user
// picks a branch → saved as customer_branch_context → /menu.
//
// The server re-validates the branch on every order; this page
// only stores the selection (never drives authorization).
// ============================================================

interface BranchCard {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  isActive: boolean;
}

type LoadState = "loading" | "success" | "empty" | "error";

export default function PilihCabangPage() {
  const router = useRouter();
  const { isHydrated, tableContext, setCustomerBranch } = useCart();
  const [branches, setBranches] = useState<BranchCard[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [retryCount, setRetryCount] = useState(0);
  const restaurantIdRef = useRef<string>("");

  // Defensive: if the customer arrived here WITH a QR table context, the
  // table already resolves restaurant + branch — skip the selector entirely
  // (consistent with the "/" routing decision).
  useEffect(() => {
    if (!isHydrated) return;
    if (tableContext) {
      router.replace("/menu");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, tableContext]);

  const loadBranches = useCallback(async () => {
    setState("loading");
    setErrorMessage("");
    try {
      const res = await api.get("/public/branches");
      const rid: string = res.data?.data?.restaurant?.id || "";
      const list: BranchCard[] = res.data?.data?.branches || [];
      restaurantIdRef.current = rid;
      if (list.length === 0) {
        setState("empty");
        return;
      }
      setBranches(list);
      setState("success");
    } catch (error) {
      // Do not expose a raw AxiosError — map to a stable user-facing message
      // and always offer "Coba Lagi" (every failure path is retryable here).
      const normalized = normalizeApiError(error);
      const message =
        normalized.status === 404
          ? "Cabang tidak ditemukan atau sudah tidak tersedia."
          : normalized.status === 429
            ? "Terlalu banyak permintaan. Coba lagi beberapa saat."
            : normalized.status !== null && normalized.status >= 500
              ? "Gagal memuat daftar cabang."
              : "Gagal memuat daftar cabang. Periksa koneksi Anda lalu coba lagi.";
      setErrorMessage(message);
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    // Defer so setState (loading flag) is not called synchronously in the
    // effect body (same pattern as the menu page).
    const timer = setTimeout(() => {
      loadBranches();
    }, 0);
    return () => clearTimeout(timer);
  }, [isHydrated, loadBranches, retryCount]);

  const handleSelect = (branch: BranchCard) => {
    const restaurantId = restaurantIdRef.current;
    if (!restaurantId) {
      toast.error("Gagal menyimpan pilihan cabang. Silakan coba lagi.");
      return;
    }
    // Persist the customer's branch context so the menu loads with the
    // correct BranchProduct stock / availability / priceOverride.
    setCustomerBranch({
      restaurantId,
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
    });
    router.push("/menu");
  };

  return (
    <div className="min-h-[70vh] flex flex-col">
      <div className="text-center pt-6 pb-2">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-secondary mb-3">
          <Building2 className="h-6 w-6 text-brand-primary" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          Pilih Cabang
        </h1>
        <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto px-2">
          Silakan pilih cabang restoran untuk melihat menu, stok, dan harga
          yang tersedia di lokasi Anda.
        </p>
      </div>

      <div className="mt-4 space-y-3 min-w-0">
        {state === "loading" && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mb-2" />
            <p className="text-sm">Memuat daftar cabang…</p>
          </div>
        )}

        {state === "empty" && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-gray-500 text-sm font-medium">
              Belum ada cabang yang tersedia.
            </p>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <p className="text-sm text-gray-600">{errorMessage}</p>
            <button
              type="button"
              onClick={() => setRetryCount((c) => c + 1)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              <RotateCw className="h-4 w-4" />
              Coba Lagi
            </button>
          </div>
        )}

        {state === "success" && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {branches.map((branch) => (
              <button
                key={branch.id}
                type="button"
                onClick={() => handleSelect(branch)}
                className="text-left w-full rounded-xl border border-gray-200 bg-white p-4 hover:border-brand-primary/50 hover:bg-brand-secondary/50 transition-colors min-w-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900 text-sm sm:text-base break-words">
                      {branch.name}
                    </h2>
                    <p className="text-[11px] font-medium text-gray-400 mt-0.5">
                      {branch.code}
                    </p>
                    {branch.address && (
                      <p className="flex items-start gap-1 text-xs text-gray-500 mt-2 leading-relaxed break-words">
                        <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span className="min-w-0">{branch.address}</span>
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-brand-primary text-brand-primary-foreground text-xs font-bold px-3 py-1.5">
                    Pilih
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}