"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ShoppingCart,
  UtensilsCrossed,
  TableProperties,
  Users,
  CreditCard,
  MessageSquare,
  Settings,
  Wallet,
  Clock,
  BarChart3,
  Megaphone,
  Store,
  LogOut,
  Menu,
  X,
  Boxes,
  Receipt,
  Truck,
  Container,
  ClipboardList,
  ChefHat,
  Leaf,
  Calculator,
  TrendingUp,
  PieChart,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";
import { useUserRole, type StaffRole } from "@/hooks/use-user-role";
import { AdminBrandingProvider } from "@/hooks/use-admin-branding";
import { useBranding } from "@/hooks/use-branding";
import { BranchSelector } from "@/components/admin/branch-selector";
import {
  AdminRealtimeProvider,
  useAdminRealtime,
  type RealtimeStatus,
} from "@/components/admin/realtime-provider";

/** A single leaf navigation link. */
interface NavItem {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles: StaffRole[];
  /**
   * Exact-match only. Required when one href is a prefix of another item's
   * href, so a sub-route does not activate two items at once:
   *   - `/admin/reports` must not light up on `/admin/reports/products`
   *   - `/admin/settings` must not light up on `/admin/settings/branches`
   */
  exact?: boolean;
}

/** A collapsible group of navigation links. */
interface NavGroup {
  name: string;
  icon: typeof LayoutDashboard;
  children: NavItem[];
}

type NavEntry = NavItem | NavGroup;

function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

/**
 * Single source of truth for the admin sidebar.
 *
 * Only routes that actually exist are listed here — no placeholders. Some
 * features are tabs/dialogs inside a page (Recipes = the "Komposisi" tab of
 * /admin/menu, What-If Simulation = a dialog inside /admin/costing) and are
 * intentionally not separate entries.
 *
 * `roles` controls UI visibility only. Server-side API guards remain the real
 * authorization boundary.
 */
const navigation: NavEntry[] = [
  { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "CASHIER"] },
  {
    name: "Operasional",
    icon: ClipboardList,
    children: [
      { name: "Orders", href: "/admin/orders", icon: ShoppingCart, roles: ["ADMIN", "CASHIER"] },
      { name: "Kitchen", href: "/admin/kitchen", icon: ChefHat, roles: ["ADMIN", "CASHIER"] },
      { name: "Tables", href: "/admin/tables", icon: TableProperties, roles: ["ADMIN", "CASHIER"] },
      { name: "Customers", href: "/admin/customers", icon: Users, roles: ["ADMIN"] },
      { name: "Shifts", href: "/admin/shifts", icon: Clock, roles: ["ADMIN", "CASHIER"] },
    ],
  },
  {
    name: "Menu",
    icon: UtensilsCrossed,
    children: [
      { name: "Menu", href: "/admin/menu", icon: UtensilsCrossed, roles: ["ADMIN"] },
      { name: "Costing", href: "/admin/costing", icon: Calculator, roles: ["ADMIN"] },
    ],
  },
  {
    name: "Inventory",
    icon: Boxes,
    children: [
      { name: "Stok", href: "/admin/stock", icon: Boxes, roles: ["ADMIN", "CASHIER"] },
      { name: "Bahan Baku", href: "/admin/ingredients", icon: Leaf, roles: ["ADMIN"] },
      { name: "Stock Movement", href: "/admin/inventory", icon: ClipboardList, roles: ["ADMIN", "CASHIER"] },
      { name: "Pembelian", href: "/admin/purchasing/purchases", icon: Container, roles: ["ADMIN", "CASHIER"] },
      { name: "Supplier", href: "/admin/purchasing/suppliers", icon: Truck, roles: ["ADMIN", "CASHIER"] },
    ],
  },
  {
    name: "Finance",
    icon: Wallet,
    children: [
      { name: "Payments", href: "/admin/payments", icon: CreditCard, roles: ["ADMIN", "CASHIER"] },
      { name: "Riwayat Penjualan", href: "/admin/cashier/sales", icon: Receipt, roles: ["ADMIN", "CASHIER"] },
    ],
  },
  {
    name: "Reports",
    icon: BarChart3,
    children: [
      { name: "Laporan Penjualan", href: "/admin/reports", icon: BarChart3, roles: ["ADMIN", "CASHIER"], exact: true },
      { name: "Best Selling", href: "/admin/reports/products", icon: TrendingUp, roles: ["ADMIN", "CASHIER"] },
      { name: "Pembelian", href: "/admin/reports/purchases", icon: Container, roles: ["ADMIN", "CASHIER"] },
      { name: "Inventory", href: "/admin/reports/inventory", icon: ClipboardList, roles: ["ADMIN", "CASHIER"] },
      { name: "Pembayaran", href: "/admin/reports/payments", icon: CreditCard, roles: ["ADMIN", "CASHIER"] },
      { name: "Per Shift", href: "/admin/reports/shift-sales", icon: Clock, roles: ["ADMIN", "CASHIER"] },
      { name: "Multi Outlet", href: "/admin/reports/multi-outlet", icon: Store, roles: ["ADMIN"] },
      { name: "Profitabilitas", href: "/admin/profitability", icon: TrendingUp, roles: ["ADMIN"] },
      { name: "Menu Engineering", href: "/admin/menu-engineering", icon: PieChart, roles: ["ADMIN"] },
    ],
  },
  {
    name: "Marketing",
    icon: Megaphone,
    children: [
      { name: "Promosi", href: "/admin/marketing", icon: Megaphone, roles: ["ADMIN"] },
    ],
  },
  {
    name: "Outlet",
    icon: Store,
    children: [
      { name: "Cabang", href: "/admin/settings/branches", icon: Store, roles: ["ADMIN"] },
    ],
  },
  {
    name: "Settings",
    icon: Settings,
    children: [
      { name: "Website Branding", href: "/admin/settings", icon: Settings, roles: ["ADMIN"], exact: true },
      { name: "Users", href: "/admin/users", icon: Users, roles: ["ADMIN"] },
      { name: "WhatsApp", href: "/admin/whatsapp", icon: MessageSquare, roles: ["ADMIN"] },
    ],
  },
];

/** Brand logo with graceful fallback — same behavior as the customer header. */
function AdminBrandLogo({ url, alt }: { url?: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return <span className="text-xl">🍽️</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className="h-7 w-7 rounded object-contain"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * Sidebar body shared by the desktop sidebar and the mobile drawer.
 * In the mobile drawer, `onNavigate` closes the drawer after a nav item
 * is selected.
 */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { role } = useUserRole();
  const { branding } = useBranding();

  // Role-aware navigation (UI layer). Server-side API guards are the real
  // enforcement — hiding items here is UX only.
  const visibleNavigation: NavEntry[] = navigation
    .map((entry) =>
      isNavGroup(entry)
        ? {
            ...entry,
            children: entry.children.filter(
              (child) => !role || child.roles.includes(role)
            ),
          }
        : entry
    )
    // A group with no role-visible children is hidden entirely.
    .filter((entry) =>
      isNavGroup(entry)
        ? entry.children.length > 0
        : !role || entry.roles.includes(role)
    );

  // Groups start collapsed, except the one containing the current route.
  // Manual toggles win for the rest of the session (no reload, no storage).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/");

  return (
    <div className="flex h-full flex-col">
      {/* Logo + site name — from the SAME RestaurantSettings branding as
          the customer app (fallback: 🍽️ + "Restoran"). */}
      <div className="flex h-16 items-center justify-center gap-2 border-b border-gray-200 px-3">
        <AdminBrandLogo url={branding.logoUrl} alt={branding.siteName} />
        <span className="text-xl font-bold text-brand-primary truncate">
          {branding.siteName}
        </span>
      </div>

      {/* Navigation — only this area scrolls; brand header and the
          role chip / logout footer stay pinned. */}
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
        {visibleNavigation.map((entry) => {
          if (!isNavGroup(entry)) {
            const active = isActive(entry);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-secondary text-brand-primary"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <entry.icon className="h-5 w-5 shrink-0" />
                {entry.name}
              </Link>
            );
          }

          const hasActiveChild = entry.children.some((c) => isActive(c));
          const isOpen = openGroups[entry.name] ?? hasActiveChild;

          return (
            <div key={entry.name}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpenGroups((prev) => ({
                    ...prev,
                    [entry.name]: !isOpen,
                  }))
                }
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                  hasActiveChild
                    ? "text-brand-primary"
                    : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <entry.icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{entry.name}</span>
                <ChevronDown
                  className={cn(
                    "ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform",
                    !isOpen && "-rotate-90"
                  )}
                />
              </button>

              {isOpen && (
                <div className="mt-1 space-y-1">
                  {entry.children.map((child) => {
                    const active = isActive(child);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        className={cn(
                          "flex items-center gap-3 rounded-lg py-2 pl-10 pr-3 text-sm font-medium transition-colors",
                          active
                            ? "bg-brand-secondary text-brand-primary"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        )}
                      >
                        <child.icon className="h-4 w-4 shrink-0" />
                        {child.name}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Role chip (bottom, above logout) */}
      <div className="px-4 pb-2">
        {role && (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">
            <Wallet className="h-3 w-3 mr-1" />
            {role === "ADMIN" ? "Admin" : "Kasir"}
          </span>
        )}
      </div>

      {/* Logout */}
      <div className="border-t border-gray-200 p-4">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="mr-2 h-5 w-5" />
          Keluar
        </Button>
      </div>
    </div>
  );
}

const REALTIME_STATUS_CONFIG: Record<
  RealtimeStatus,
  { dot: string; label: string }
> = {
  connecting: { dot: "bg-yellow-400", label: "Menghubungkan…" },
  connected: { dot: "bg-green-500", label: "Realtime Connected" },
  reconnecting: { dot: "bg-yellow-400", label: "Reconnecting" },
  offline: { dot: "bg-red-500", label: "Offline" },
};

/**
 * Small, subtle connection indicator (bottom-right). Non-interactive, so it
 * never changes the layout or blocks clicks.
 */
function RealtimeStatusPill() {
  const { status } = useAdminRealtime();
  const cfg = REALTIME_STATUS_CONFIG[status];
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed right-2 bottom-2 z-40 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-gray-600 shadow-sm ring-1 ring-gray-200"
    >
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </div>
  );
}

/** Mobile top bar brand: logo + site name from the shared branding. */
function MobileBrand() {
  const { branding } = useBranding();
  return (
    <span className="flex items-center gap-2 min-w-0">
      <AdminBrandLogo url={branding.logoUrl} alt={branding.siteName} />
      <span className="truncate text-lg font-bold text-brand-primary">
        {branding.siteName}
      </span>
    </span>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);

  return (
    <AdminBrandingProvider>
    <AdminRealtimeProvider>
      <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar — unchanged (lg and up) */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 border-r border-gray-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar (< lg) */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 lg:hidden">
        <Button
          variant="ghost"
          className="h-10 w-10 shrink-0 px-0"
          onClick={() => setSidebarOpen(true)}
          aria-label="Buka menu navigasi"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <MobileBrand />
      </header>

      {/* Mobile drawer overlay (< lg) */}
      <div
        aria-hidden
        onClick={() => setSidebarOpen(false)}
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      {/* Mobile drawer (< lg) */}
      <aside
        aria-label="Menu navigasi admin"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-gray-200 bg-white shadow-xl transition-transform duration-200 lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Button
          variant="ghost"
          className="absolute top-3 right-3 z-10 h-10 w-10 px-0"
          onClick={() => setSidebarOpen(false)}
          aria-label="Tutup menu navigasi"
        >
          <X className="h-5 w-5" />
        </Button>
        <SidebarContent onNavigate={() => setSidebarOpen(false)} />
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:ml-64">
        <div className="p-4 pt-20 sm:p-6 sm:pt-20 lg:p-8 lg:pt-8">
          <div className="mb-4 flex items-center justify-end gap-2">
            <BranchSelector />
          </div>
          {children}
        </div>
      </main>
      </div>
      <RealtimeStatusPill />
    </AdminRealtimeProvider>
    </AdminBrandingProvider>
  );
}
