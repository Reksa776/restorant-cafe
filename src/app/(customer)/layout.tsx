"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { CartProvider, useCart } from "@/hooks/use-cart";

function CartBadge() {
  const { items, isHydrated } = useCart();

  // Don't render badge until hydration completes.
  // Server render: null. Client initial render: null.
  // After hydration: badge with real count.
  if (!isHydrated) return null;

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalItems === 0) return null;

  return (
    <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 rounded-full bg-red-500 text-[9px] flex items-center justify-center font-bold px-1 text-white">
      {totalItems}
    </span>
  );
}

function CustomerHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link href="/menu" className="flex items-center gap-1.5">
          <span className="text-lg">🍽️</span>
          <span className="font-bold text-base text-gray-900">Restoran</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/menu"
            className={`text-xs font-medium transition-colors py-1 ${
              pathname === "/menu"
                ? "text-gray-900"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            Menu
          </Link>
          <Link
            href="/cart"
            className="relative text-gray-500 hover:text-gray-700 transition-colors p-1"
          >
            <ShoppingCart className="h-4.5 w-4.5" />
            <CartBadge />
          </Link>
        </nav>
      </div>
    </header>
  );
}
export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CartProvider>
      <div className="min-h-screen bg-gray-50">
        <CustomerHeader />
        <main className="max-w-4xl mx-auto px-3 pt-3">{children}</main>
      </div>
    </CartProvider>
  );
}
