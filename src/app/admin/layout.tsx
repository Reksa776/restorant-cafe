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
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";
import { useUserRole, type StaffRole } from "@/hooks/use-user-role";
import {
  AdminRealtimeProvider,
  useAdminRealtime,
  type RealtimeStatus,
} from "@/components/admin/realtime-provider";

interface NavItem {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles: StaffRole[];
}

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "CASHIER"] },
  { name: "Orders", href: "/admin/orders", icon: ShoppingCart, roles: ["ADMIN", "CASHIER"] },
  { name: "Payments", href: "/admin/payments", icon: CreditCard, roles: ["ADMIN", "CASHIER"] },
  { name: "Shifts", href: "/admin/shifts", icon: Clock, roles: ["ADMIN", "CASHIER"] },
  { name: "Users", href: "/admin/users", icon: Users, roles: ["ADMIN"] },
  { name: "Menu", href: "/admin/menu", icon: UtensilsCrossed, roles: ["ADMIN"] },
  { name: "Tables", href: "/admin/tables", icon: TableProperties, roles: ["ADMIN"] },
  { name: "Customers", href: "/admin/customers", icon: Users, roles: ["ADMIN"] },
  { name: "WhatsApp", href: "/admin/whatsapp", icon: MessageSquare, roles: ["ADMIN"] },
  { name: "Settings", href: "/admin/settings", icon: Settings, roles: ["ADMIN"] },
];

/**
 * Sidebar body shared by the desktop sidebar and the mobile drawer.
 * In the mobile drawer, `onNavigate` closes the drawer after a nav item
 * is selected.
 */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { role } = useUserRole();

  // Role-aware navigation (UI layer). Server-side API guards are the real
  // enforcement — hiding items here is UX only.
  const visibleNavigation = navigation.filter(
    (item) => !role || item.roles.includes(role)
  );

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center justify-center border-b border-gray-200">
        <span className="text-xl font-bold">🍽️ Restoran Bahagia</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {visibleNavigation.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
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
        <span className="truncate text-lg font-bold">
          🍽️ Restoran Bahagia
        </span>
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
          {children}
        </div>
      </main>
      </div>
      <RealtimeStatusPill />
    </AdminRealtimeProvider>
  );
}
