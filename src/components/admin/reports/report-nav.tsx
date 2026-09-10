"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/use-user-role";

// ============================================================
// Reports sub-navigation — pills that keep all report types one
// click away. Mirrors the period-pill styling used across the
// existing reports UI.
// ============================================================

const REPORTS = [
  { href: "/admin/reports", label: "Penjualan" },
  { href: "/admin/reports/products", label: "Produk" },
  { href: "/admin/reports/purchases", label: "Pembelian" },
  { href: "/admin/reports/inventory", label: "Inventory" },
  { href: "/admin/reports/shift-sales", label: "Per Shift" },
  { href: "/admin/reports/payments", label: "Pembayaran" },
  { href: "/admin/reports/multi-outlet", label: "Multi Outlet", adminOnly: true },
] as const;

export function ReportSubNav() {
  const pathname = usePathname();
  const { role } = useUserRole();
  return (
    <nav className="flex flex-wrap items-center gap-2">
      {REPORTS.map((r) => {
        // Hide admin-only links for non-admin users.
        if ("adminOnly" in r && r.adminOnly && role !== "ADMIN") return null;

        const isActive = pathname === r.href || (r.href !== "/admin/reports" && pathname.startsWith(r.href));
        return (
          <Link
            key={r.href}
            href={r.href}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium border transition-colors",
              isActive
                ? "bg-gray-900 text-white border-gray-900"
                : "border-gray-300 text-gray-600 hover:bg-gray-100"
            )}
          >
            {r.label}
          </Link>
        );
      })}
    </nav>
  );
}