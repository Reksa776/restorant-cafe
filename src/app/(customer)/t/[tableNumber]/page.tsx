"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, ArrowRight, AlertCircle, Table2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { useCart } from "@/hooks/use-cart";
import { useBranding } from "@/hooks/use-branding";

// ============================================================
// Types
// ============================================================

interface TableInfo {
  tableId: string;
  tableNumber: number;
  tableName: string;
  capacity: number;
  status: string;
  restaurant: {
    id: string;
    name: string;
    branding?: {
      siteName: string;
      logoUrl: string | null;
      primaryColor: string;
      secondaryColor: string;
      accentColor: string;
    };
  };
}

// ============================================================
// Component
// ============================================================

export default function TableLandingPage({
  params,
}: {
  params: Promise<{ tableNumber: string }>;
}) {
  const router = useRouter();
  const { setTableContext } = useCart();
  const { applyBranding } = useBranding();
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visitorCount, setVisitorCount] = useState<string>("1");
  const [isContinuing, setIsContinuing] = useState(false);

  useEffect(() => {
    loadTableInfo();
  }, []);

  const loadTableInfo = async () => {
    try {
      const { tableNumber } = await params;
      const res = await api.get(`/public/tables/lookup?number=${tableNumber}`);
      setTableInfo(res.data.data);

      // Apply the tenant's website branding so the landing page (and the
      // menu we navigate to) already uses the right theme.
      const branding = res.data.data?.restaurant?.branding;
      if (branding) {
        applyBranding({
          siteName: branding.siteName,
          logoUrl: branding.logoUrl,
          primaryColor: branding.primaryColor,
          secondaryColor: branding.secondaryColor,
          accentColor: branding.accentColor,
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Meja tidak ditemukan";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinue = () => {
    const count = parseInt(visitorCount, 10);

    if (isNaN(count) || count < 1) {
      toast.error("Jumlah pengunjung minimal 1 orang");
      return;
    }

    if (count > 100) {
      toast.error("Jumlah pengunjung terlalu banyak");
      return;
    }

    if (!tableInfo) return;

    setIsContinuing(true);

    // Persist table context in cart
    setTableContext({
      tableId: tableInfo.tableId,
      tableNumber: tableInfo.tableNumber,
      tableName: tableInfo.tableName,
      restaurantId: tableInfo.restaurant.id,
      visitorCount: count,
    });

    // Navigate to menu
    router.push("/menu");
  };

  // ============================================================
  // Loading
  // ============================================================

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
        <p className="text-gray-500 font-medium">Memuat informasi meja...</p>
      </div>
    );
  }

  // ============================================================
  // Error
  // ============================================================

  if (error || !tableInfo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
          <AlertCircle className="h-8 w-8 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Meja Tidak Ditemukan</h1>
        <p className="text-gray-500 text-sm max-w-sm">
          {error || "QR code tidak valid atau meja tidak tersedia."}
        </p>
        <button
          onClick={() => router.push("/menu")}
          className="bg-brand-primary text-brand-primary-foreground px-6 py-2 rounded-lg font-medium hover:bg-brand-primary/90 transition-colors"
        >
          Lihat Menu
        </button>
      </div>
    );
  }

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
      {/* Welcome — website branding (logo + site name) */}
      <div className="text-center space-y-2">
        {tableInfo.restaurant.branding?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tableInfo.restaurant.branding.logoUrl}
            alt={tableInfo.restaurant.branding.siteName || tableInfo.restaurant.name}
            className="mx-auto h-14 w-14 object-contain"
            onError={(e) => {
              // Hide broken logos instead of showing the broken-image icon.
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <p className="text-sm text-gray-400">
          {tableInfo.restaurant.branding?.siteName || tableInfo.restaurant.name}
        </p>
        <h1 className="text-3xl font-bold text-brand-primary">
          Selamat Datang
        </h1>
        <span className="inline-flex items-center gap-1.5 bg-brand-primary text-brand-primary-foreground text-sm font-semibold px-3.5 py-1.5 rounded-full">
          <Table2 className="h-4 w-4" />
          Meja {tableInfo.tableNumber}
        </span>
        <p className="text-xs text-gray-400">
          Kapasitas meja: {tableInfo.capacity} orang
        </p>
      </div>

      {/* Divider */}
      <div className="w-16 h-px bg-gray-200" />

      {/* Visitor Count */}
      <div className="w-full max-w-xs space-y-3">
        <label className="block text-base font-semibold text-gray-900 text-center">
          Berapa orang yang makan?
        </label>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => {
              const current = parseInt(visitorCount, 10) || 1;
              if (current > 1) setVisitorCount(String(current - 1));
            }}
            className="w-12 h-12 rounded-full bg-brand-secondary flex items-center justify-center hover:bg-brand-accent transition-colors text-xl font-bold"
          >
            -
          </button>
          <input
            type="number"
            min="1"
            max="100"
            value={visitorCount}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "" || (parseInt(val, 10) >= 1 && parseInt(val, 10) <= 100)) {
                setVisitorCount(val);
              }
            }}
            className="w-20 text-center text-2xl font-bold border-b-2 border-brand-primary focus:outline-none focus:border-brand-primary bg-transparent py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={() => {
              const current = parseInt(visitorCount, 10) || 1;
              if (current < 100) setVisitorCount(String(current + 1));
            }}
            className="w-12 h-12 rounded-full bg-brand-secondary flex items-center justify-center hover:bg-brand-accent transition-colors text-xl font-bold"
          >
            +
          </button>
        </div>
        <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
          <Users className="h-3 w-3" />
          orang
        </p>
      </div>

      {/* Continue Button */}
      <button
        onClick={handleContinue}
        disabled={isContinuing}
        className="w-full max-w-xs bg-brand-primary text-brand-primary-foreground py-3 rounded-xl font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isContinuing ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <>
            Mulai Pesan
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}
