"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, ArrowRight, Shield } from "lucide-react";

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  // Extract order reference from query params
  const ref = searchParams.get("ref") || searchParams.get("reference") || "";

  // CRITICAL: Never trust URL query params as proof of payment.
  // Actual payment state MUST come from server-side webhook/database.
  // The order tracking page polls the database for the real status.

  // Auto-redirect to order page after countdown
  useEffect(() => {
    if (!ref) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push(`/order/${ref}`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [ref, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      {/* Status Icon — always show "verifying" state */}
      <div className="mb-6">
        <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center">
          <Shield className="h-10 w-10 text-blue-500" />
        </div>
      </div>

      {/* Status Message — always neutral, never claims success */}
      <h1 className="text-xl font-bold mb-2">
        Pembayaran Sedang Diverifikasi
      </h1>

      <p className="text-gray-500 text-sm mb-6 max-w-sm">
        Pembayaran Anda sedang kami verifikasi. Status terakhir akan ditampilkan
        di halaman pesanan.
      </p>

      {/* Order Reference */}
      {ref && (
        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-6">
          <p className="text-xs text-gray-400">Nomor Pesanan</p>
          <p className="font-mono font-bold text-sm">{ref}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        {ref && (
          <Link
            href={`/order/${ref}`}
            className="flex items-center justify-center gap-2 bg-gray-900 text-white py-3 rounded-xl font-medium hover:bg-black transition-colors"
          >
            Lihat Status Pesanan
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}

        <Link
          href="/menu"
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Kembali ke Menu
        </Link>
      </div>

      {/* Auto-redirect indicator */}
      {ref && countdown > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-6">
          <Clock className="h-3 w-3" />
          <p>Mengalihkan dalam {countdown} detik...</p>
        </div>
      )}
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-gray-500">Memuat...</p>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
