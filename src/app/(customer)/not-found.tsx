import Link from "next/link";
import { Store } from "lucide-react";

/**
 * Friendly customer-side 404.
 *
 * Used when a storefront host does not exist (e.g. `ngasal.domainlo.com`) or
 * a table QR path is malformed — the customer gets a clear "not found"
 * message instead of a 500 / empty menu.
 */
export default function CustomerNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <Store className="h-7 w-7 text-gray-400" />
      </div>
      <h1 className="text-xl font-bold text-gray-900">
        Toko / Kafe tidak ditemukan
      </h1>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        Alamat toko yang Anda buka tidak terdaftar atau sedang tidak aktif.
        Periksa kembali link-nya, atau pindai QR meja yang tersedia di kafe.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary-foreground transition-colors hover:bg-brand-primary/90"
      >
        Ke Halaman Utama
      </Link>
    </div>
  );
}
