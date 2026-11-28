"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Calculator,
  CheckCircle2,
  ChefHat,
  Clock,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  Mail,
  MapPin,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/components/landing/landing-data";

// ============================================================
// /login — TWO hosts, TWO experiences.
//
//   Root domain      → OWNER PORTAL (dark slate/indigo executive split screen,
//                      SaaS branding, /register link, staff are told to use
//                      their store subdomain).
//   Tenant subdomain → STORE PORTAL (light emerald/warm storefront, prominent
//                      store identity, 3 staff-role cards, live clock, no SaaS
//                      marketing and no self-service registration).
//
// The host is resolved server-side by GET /api/public/tenant-by-host, because
// the browser cannot reliably know whether it is on the root domain or a
// tenant subdomain (and the API must stay the single source of truth for
// tenant identity).
// ============================================================

// Seeded demo account (prisma/seed.ts). Disable with
// NEXT_PUBLIC_ENABLE_DEMO_HINT="false" in production.
const DEMO_HINT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_HINT !== "false";
const DEMO_EMAIL = "admin@restobahagia.com";
const DEMO_PASSWORD = "admin123";

interface TenantIdentity {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  address: string | null;
}

interface HostInfo {
  isRootDomain: boolean;
  tenant: TenantIdentity | null;
  notFound: boolean;
}

// ------------------------------------------------------------
// Shared login form (same API, different palette)
// ------------------------------------------------------------

const TONES = {
  owner: {
    field:
      "h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/20",
    icon: "text-slate-400",
    eye:
      "grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40",
    button:
      "h-11 w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-500",
    hint: "text-slate-400",
  },
  store: {
    field:
      "h-11 rounded-xl border-emerald-100 bg-emerald-50/40 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20",
    icon: "text-emerald-600/70",
    eye:
      "grid h-9 w-9 place-items-center rounded-lg text-emerald-700/60 transition-colors hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
    button:
      "h-11 w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-colors hover:bg-emerald-500",
    hint: "text-slate-400",
  },
} as const;

function LoginForm({
  tone,
  buttonLabel,
  initialEmail = "",
  notice,
  demo,
}: {
  tone: keyof typeof TONES;
  buttonLabel: string;
  initialEmail?: string;
  notice?: ReactNode;
  demo?: { email: string; password: string };
}) {
  const palette = TONES[tone];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        data?: { redirectUrl?: string };
      } | null;

      if (!response.ok) {
        toast.error(
          payload?.message || "Login gagal. Periksa email dan password Anda."
        );
        return;
      }

      toast.success("Login berhasil");
      const target = payload?.data?.redirectUrl || "/admin/dashboard";
      // Full navigation: the session cookie was just set by this response and
      // the owner destination may be another subdomain.
      window.location.assign(target);
    } catch {
      toast.error("Tidak dapat menghubungi server. Periksa koneksi Anda.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {notice}

      <div className="space-y-2">
        <Label htmlFor={`${tone}-email`} className="text-slate-700">
          Email
        </Label>
        <div className="relative">
          <Mail
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2",
              palette.icon
            )}
          />
          <Input
            id={`${tone}-email`}
            type="email"
            placeholder="nama@bisnisanda.id"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            className={palette.field}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${tone}-password`} className="text-slate-700">
          Password
        </Label>
        <div className="relative">
          <Lock
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2",
              palette.icon
            )}
          />
          <Input
            id={`${tone}-password`}
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            className={cn(palette.field, "pr-11")}
          />
          <div className="absolute inset-y-0 right-1 flex items-center">
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={
                showPassword ? "Sembunyikan password" : "Tampilkan password"
              }
              aria-pressed={showPassword}
              className={palette.eye}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <Button type="submit" disabled={isLoading} className={palette.button}>
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Memproses…
          </>
        ) : (
          buttonLabel
        )}
      </Button>

      {demo && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-3.5">
          <p className="text-xs font-semibold text-slate-700">
            Ingin mencoba tanpa mengetik?
          </p>
          <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">
            {demo.email} · {demo.password}
          </p>
          <button
            type="button"
            onClick={() => {
              setEmail(demo.email);
              setPassword(demo.password);
              setShowPassword(false);
              toast.success("Akun demo terisi. Klik Masuk.");
            }}
            className="mt-2.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-indigo-400 hover:text-indigo-700"
          >
            Isi Akun Demo ({demo.email})
          </button>
        </div>
      )}
    </form>
  );
}

// ------------------------------------------------------------
// Shared pieces
// ------------------------------------------------------------

function RegisteredNotice() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3.5"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <div>
        <p className="text-sm font-semibold text-emerald-900">
          Pendaftaran berhasil!
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-emerald-800">
          Silakan masuk menggunakan akun owner yang baru Anda buat.
        </p>
      </div>
    </div>
  );
}

function BootScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-300">
          <UtensilsCrossed className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-white">{APP_NAME}</p>
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Memeriksa alamat toko…
        </p>
      </div>
    </div>
  );
}

/** Root portal URL for the "back" action on an unknown store subdomain. */
function rootPortalUrl(): string {
  if (typeof window === "undefined") return "/";
  const configured = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "")
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/+$/, "");
  if (configured) return `${window.location.protocol}//${configured}`;

  const { hostname, port, protocol } = window.location;
  const labels = hostname.split(".");
  const rootHostname = labels.length > 2 ? labels.slice(1).join(".") : hostname;
  return `${protocol}//${rootHostname}${port ? `:${port}` : ""}`;
}

function TenantNotFoundScreen() {
  const [host, setHost] = useState("");

  useEffect(() => {
    setHost(window.location.host);
  }, []);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 px-5 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/70 p-8 text-center shadow-2xl shadow-black/40">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-400/15 text-amber-300">
          <Store className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-xl font-bold text-white">
          Toko Tidak Ditemukan
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Alamat{" "}
          <span className="break-all font-mono text-slate-300">
            {host || "subdomain ini"}
          </span>{" "}
          belum terdaftar sebagai toko pada platform ini, atau tokonya sudah
          tidak aktif.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Periksa kembali link subdomain dari pemilik toko Anda.
        </p>
        <a
          href={rootPortalUrl()}
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Portal Utama
        </a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// A — OWNER PORTAL (root domain)
// ------------------------------------------------------------

const OWNER_FEATURES = [
  {
    icon: Store,
    title: "Kontrol multi-cabang",
    description:
      "Satu login owner untuk semua outlet — menu, staf, meja, shift, dan laporan per cabang.",
  },
  {
    icon: Calculator,
    title: "Laporan akuntansi & HPP",
    description:
      "Laba rugi, arus kas, dan HPP per menu terhitung otomatis dari transaksi kasir.",
  },
  {
    icon: Wallet,
    title: "Pencairan dana mandiri",
    description:
      "Tarik saldo QRIS & VA kapan saja lewat portal owner, tanpa menunggu admin platform.",
  },
] as const;

function OwnerPortal({
  justRegistered,
  initialEmail,
}: {
  justRegistered: boolean;
  initialEmail: string;
}) {
  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[1.06fr_1fr]">
      {/* Left — executive SaaS branding */}
      <aside className="relative hidden overflow-hidden bg-slate-950 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:p-10 xl:p-14">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-28 -top-24 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
          <div className="absolute right-[-7rem] top-1/3 h-80 w-80 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:52px_52px] [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_75%)]" />
        </div>

        <div className="relative flex flex-1 flex-col">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500 text-white">
              <UtensilsCrossed className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <p className="text-base font-bold tracking-tight text-white">
                {APP_NAME}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-indigo-300">
                Business Control Platform
              </p>
            </div>
          </div>

          <div className="mt-12 max-w-md">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/25 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold text-indigo-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Portal Pemilik Bisnis / Owner
            </span>
            <h1 className="mt-4 text-3xl font-bold leading-[1.15] tracking-tight text-white xl:text-[2.35rem]">
              Satu portal untuk{" "}
              <span className="text-indigo-300">seluruh bisnis resto</span>{" "}
              Anda.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Pantau performa semua cabang, kendalikan biaya, dan cairkan
              pendapatan — tanpa berpindah aplikasi.
            </p>
          </div>

          <ul className="mt-10 max-w-md space-y-5">
            {OWNER_FEATURES.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-indigo-300">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-10 max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-indigo-200">
            <BarChart3 className="h-3.5 w-3.5" />
            Data setiap toko terisolasi
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            Tiap cabang berjalan di subdomain tokonya sendiri. Portal ini hanya
            untuk pemilik bisnis — staf operasional masuk lewat subdomain toko.
          </p>
        </div>
      </aside>

      {/* Right — owner sign-in */}
      <main className="flex min-h-screen flex-col bg-slate-50 px-5 py-6 sm:px-8 lg:min-h-0 lg:px-10 xl:px-14">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke Beranda
          </Link>
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-700">
            Owner
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center py-8 sm:py-10">
          <div className="w-full max-w-md">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
              <Sparkles className="h-3.5 w-3.5" />
              Portal Pemilik Bisnis
            </span>

            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">
              Masuk sebagai Owner
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Kelola seluruh cabang, laporan keuangan, dan pencairan dana bisnis
              Anda.
            </p>

            <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-amber-900">
                Kasir &amp; Staf Dapur silakan masuk melalui alamat subdomain
                toko masing-masing.
              </p>
            </div>

            <div className="mt-6">
              <LoginForm
                tone="owner"
                buttonLabel="Masuk sebagai Owner"
                initialEmail={initialEmail}
                notice={justRegistered ? <RegisteredNotice /> : null}
                demo={
                  DEMO_HINT_ENABLED
                    ? { email: DEMO_EMAIL, password: DEMO_PASSWORD }
                    : undefined
                }
              />
            </div>

            <p className="mt-6 text-center text-xs text-slate-500">
              Belum punya akun bisnis?{" "}
              <Link
                href="/register"
                className="inline-flex items-center gap-0.5 font-semibold text-indigo-600 hover:underline"
              >
                Daftar sekarang
                <ArrowRight className="h-3 w-3" />
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-[10px] font-medium uppercase tracking-[0.16em] text-slate-300">
          Multi-cabang · Akuntansi · Pencairan Dana
        </p>
      </main>
    </div>
  );
}

// ------------------------------------------------------------
// B — STORE PORTAL (tenant subdomain)
// ------------------------------------------------------------

const STORE_ROLES = [
  {
    icon: ShoppingCart,
    title: "Kasir POS",
    description: "Buat pesanan, terima pembayaran, cetak struk.",
  },
  {
    icon: ChefHat,
    title: "Layar Dapur / KDS",
    description: "Pantau dan proses antrean pesanan dapur.",
  },
  {
    icon: ShieldCheck,
    title: "Admin Toko",
    description: "Kelola menu, staf, stok, dan laporan cabang.",
  },
] as const;

function storeInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "T"
  );
}

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 text-white">
          <Clock className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-100/80">
            Waktu Operasional
          </p>
          <p className="text-sm font-semibold text-white">
            {now
              ? now.toLocaleDateString("id-ID", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : "Memuat tanggal…"}
          </p>
        </div>
      </div>
      <p className="font-mono text-2xl font-bold tabular-nums text-white">
        {now ? now.toLocaleTimeString("id-ID", { hour12: false }) : "--:--:--"}
      </p>
    </div>
  );
}

function StorePortal({
  tenant,
  initialEmail,
}: {
  tenant: TenantIdentity;
  initialEmail: string;
}) {
  return (
    <div className="min-h-screen bg-[#f6faf7]">
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-400"
      />

      <div className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-8 lg:py-12">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm shadow-emerald-900/5">
              {tenant.logoUrl ? (
                // Tenant-uploaded logo (local /uploads path) — not routed
                // through next/image because hosts are tenant-defined.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tenant.logoUrl}
                  alt={`Logo ${tenant.name}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-lg font-black tracking-tight text-emerald-700">
                  {storeInitials(tenant.name)}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">
                Portal Operasional Toko
              </p>
              <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">
                {tenant.name}
              </h1>
              {tenant.address ? (
                <p className="mt-0.5 flex items-start gap-1 text-xs text-slate-500">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                  <span className="line-clamp-1">{tenant.address}</span>
                </p>
              ) : null}
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-800">
            <Store className="h-3.5 w-3.5" />
            Portal Login Kasir, Dapur &amp; Admin Toko
          </span>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          {/* Store identity + roles + clock */}
          <section className="space-y-5">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-6 shadow-xl shadow-emerald-900/15 sm:p-7">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-amber-300/20 blur-2xl"
              />
              <div className="relative">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/15 text-base font-black text-white ring-1 ring-white/20">
                    {tenant.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tenant.logoUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      storeInitials(tenant.name)
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-100/80">
                      Toko Aktif
                    </p>
                    <p className="truncate text-lg font-bold text-white">
                      {tenant.name}
                    </p>
                  </div>
                </div>

                {tenant.address ? (
                  <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-emerald-50/90">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {tenant.address}
                  </p>
                ) : null}

                <div className="mt-5">
                  <LiveClock />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {STORE_ROLES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm shadow-emerald-900/5"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-sm font-bold text-slate-900">
                    {title}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {description}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-100 bg-white/70 p-3.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-xs leading-relaxed text-slate-600">
                Halaman ini khusus staf internal{" "}
                <span className="font-semibold text-slate-800">
                  {tenant.name}
                </span>
                . Akun toko lain tidak dapat digunakan di sini.
              </p>
            </div>
          </section>

          {/* Staff sign-in */}
          <section className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-xl shadow-emerald-900/5 sm:p-8">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
              <ShieldCheck className="h-3.5 w-3.5" />
              Akses Staf Toko
            </span>

            <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
              Masuk ke Dashboard Toko
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              Gunakan akun kasir, dapur, atau admin yang diberikan oleh pemilik{" "}
              {tenant.name}.
            </p>

            <div className="mt-6">
              <LoginForm
                tone="store"
                buttonLabel="Masuk ke Dashboard Toko"
                initialEmail={initialEmail}
              />
            </div>

            <p className="mt-5 text-[11px] leading-relaxed text-slate-400">
              Lupa password? Hubungi admin atau pemilik toko Anda — reset akun
              dilakukan dari dalam dashboard toko.
            </p>
          </section>
        </div>

        <footer className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-emerald-100 pt-5 text-[11px] text-slate-400 sm:flex-row">
          <span>
            {tenant.name} · Portal operasional kasir, dapur &amp; admin toko
          </span>
          <span className="font-mono">
            {process.env.NEXT_PUBLIC_ROOT_DOMAIN
              ? `${tenant.slug}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
              : tenant.slug}
          </span>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function LoginPage() {
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [justRegistered, setJustRegistered] = useState(false);
  const [emailParam, setEmailParam] = useState("");

  // Merchant onboarding hands off here with ?registered=1&email=… — read the
  // query string from the browser so the page stays statically prerenderable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get("email");
    const timer = setTimeout(() => {
      if (params.get("registered") === "1") setJustRegistered(true);
      if (email) setEmailParam(email);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // The host decides WHICH portal this page is.
  useEffect(() => {
    let active = true;

    fetch("/api/public/tenant-by-host", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | {
              isRootDomain?: boolean;
              notFound?: boolean;
              tenant?: TenantIdentity | null;
            }
          | null;

        if (!active) return;

        if (response.status === 404 || payload?.notFound) {
          setHostInfo({ isRootDomain: false, tenant: null, notFound: true });
          return;
        }

        setHostInfo({
          isRootDomain: payload?.isRootDomain !== false,
          tenant: payload?.tenant ?? null,
          notFound: false,
        });
      })
      .catch(() => {
        if (active) {
          setHostInfo({ isRootDomain: true, tenant: null, notFound: false });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (!hostInfo) return <BootScreen />;
  if (hostInfo.notFound) return <TenantNotFoundScreen />;
  if (hostInfo.isRootDomain || !hostInfo.tenant) {
    return (
      <OwnerPortal
        justRegistered={justRegistered}
        initialEmail={emailParam}
      />
    );
  }
  return <StorePortal tenant={hostInfo.tenant} initialEmail={emailParam} />;
}
