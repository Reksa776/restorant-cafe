"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, LogOut, ShoppingCart } from "lucide-react";
import { CartProvider, useCart } from "@/hooks/use-cart";
import { BrandingProvider, useBranding } from "@/hooks/use-branding";
import { BrandingSync } from "@/components/customer/branding-sync";
import {
  CustomerAuthProvider,
  useCustomerAuth,
} from "@/hooks/use-customer-auth";
import { CustomerAuthDialog } from "@/components/customer/auth-dialog";

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

/** Brand logo with graceful fallback: broken/missing logo → default emoji. */
function BrandLogo({ url, alt }: { url?: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return <span className="text-lg">🍽️</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className="h-6 w-6 rounded object-contain"
      onError={() => setBroken(true)}
    />
  );
}

function CustomerHeader() {
  const pathname = usePathname();
  const { branding } = useBranding();
  const { customer, isHydrated, logout } = useCustomerAuth();
  const { restaurantId } = useCart();
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link href="/menu" className="flex items-center gap-1.5">
          <BrandLogo url={branding.logoUrl} alt={branding.siteName} />
          <span className="font-bold text-base text-brand-primary">
            {branding.siteName}
          </span>
        </Link>
        <nav className="flex items-center gap-2.5">
          <Link
            href="/menu"
            className={`text-xs font-medium transition-colors py-1 ${
              pathname === "/menu"
                ? "text-brand-primary"
                : "text-gray-400 hover:text-brand-primary/70"
            }`}
          >
            Menu
          </Link>
          <Link
            href="/cart"
            className="relative text-gray-500 hover:text-brand-primary transition-colors p-1"
          >
            <ShoppingCart className="h-4.5 w-4.5" />
            <CartBadge />
          </Link>
          {isHydrated &&
            (customer ? (
              <div className="flex items-center gap-1">
                <span className="hidden sm:inline text-xs font-medium text-gray-700 max-w-[120px] truncate">
                  {customer.name || customer.email}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await logout();
                    } catch {
                      // Logout failure is not blocking.
                    }
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                  aria-label="Keluar"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-primary border border-brand-primary/30 rounded-full px-2.5 py-1 hover:bg-brand-secondary transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" />
                Masuk
              </button>
            ))}
        </nav>
      </div>

      <CustomerAuthDialog
        restaurantId={restaurantId}
        open={authOpen}
        onOpenChange={setAuthOpen}
      />
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
      <BrandingProvider>
        <CustomerAuthProvider>
          {/* Applies the restaurant's website branding as soon as the
              persisted restaurantId is known — covers hard refreshes on
              /cart, /checkout, /payment/*, /order/* and /pilih-cabang. */}
          <BrandingSync />
          <div className="min-h-screen bg-gray-50">
            <CustomerHeader />
            <main className="max-w-4xl mx-auto px-3 pt-3">{children}</main>
          </div>
        </CustomerAuthProvider>
      </BrandingProvider>
    </CartProvider>
  );
}
