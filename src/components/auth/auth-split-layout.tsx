import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  BarChart3,
  QrCode,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  UtensilsCrossed,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { APP_NAME, EXAMPLE_STOREFRONT, formatRupiah } from "@/components/landing/landing-data";

// ============================================================
// SHARED AUTH SHELL — asymmetric split-screen.
//
// Left  (lg+): brand showcase — logo, product illustration, value props,
//              social proof. Hidden on small screens so the form is the first
//              and fastest thing a cashier sees on a phone.
// Right      : clean white form column with a back link and a quick switcher
//              between /login and /register.
//
// Purely presentational: no data fetching, no auth logic. Brand name and root
// domain come from the same env-driven constants as the marketing page
// (`landing-data.ts`), so the auth screens cannot drift from the landing.
//
// The dashboard preview is an ILLUSTRATION (fixed sample numbers) and is
// marked aria-hidden; there is no live data on a signed-out page.
// ============================================================

const ADVANTAGES: ReadonlyArray<{
  icon: LucideIcon;
  title: string;
  description: string;
}> = [
  {
    icon: Store,
    title: "Setup 1 Menit dengan Subdomain Toko Sendiri",
    description:
      "Toko online langsung aktif di alamat resto Anda, tanpa install dan tanpa biaya hosting tambahan.",
  },
  {
    icon: ShieldCheck,
    title: "Pembayaran QRIS & VA Terverifikasi Otomatis",
    description:
      "Status bayar masuk sendiri lewat webhook — kasir tidak perlu konfirmasi manual satu per satu.",
  },
  {
    icon: BarChart3,
    title: "Pantau Stok Bahan Baku & Laba Rugi Real-Time",
    description:
      "Stok terpotong saat terjual, HPP terhitung otomatis, dan margin per menu terlihat harian.",
  },
];

const FIELD_CLASS =
  "h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20";

/**
 * Text input with a leading Lucide icon (and an optional trailing control,
 * e.g. the show/hide password button). Shared by both auth forms so the field
 * styling stays identical.
 */
export function AuthField({
  icon: Icon,
  trailing,
  className,
  ...props
}: {
  icon: LucideIcon;
  trailing?: ReactNode;
} & ComponentProps<"input">) {
  return (
    <div className="relative">
      <Icon
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      />
      <Input
        className={cn(FIELD_CLASS, trailing && "pr-11", className)}
        {...props}
      />
      {trailing ? (
        <div className="absolute inset-y-0 right-1 flex items-center">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

interface AuthSplitLayoutProps {
  children: ReactNode;
  /** Quick switcher rendered at the top of the form column. */
  switchPrompt?: string;
  switchCta?: string;
  switchHref?: string;
}

export default function AuthSplitLayout({
  children,
  switchPrompt,
  switchCta,
  switchHref,
}: AuthSplitLayoutProps) {
  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[1.08fr_1fr]">
      {/* ============ Left: brand showcase ============ */}
      <aside className="relative hidden overflow-hidden bg-slate-950 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:p-10 xl:p-14">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-emerald-500/25 blur-3xl" />
          <div className="absolute right-[-6rem] top-1/3 h-72 w-72 rounded-full bg-teal-400/15 blur-3xl" />
          <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-amber-300/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_72%)]" />
        </div>

        <div className="relative flex flex-1 flex-col">
          <Link href="/" className="flex w-fit items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-400 text-slate-950">
              <UtensilsCrossed className="h-5 w-5" />
            </span>
            <span className="text-base font-bold tracking-tight text-white">
              {APP_NAME}
            </span>
          </Link>

          <div className="mt-10 max-w-md">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-emerald-200">
              <Sparkles className="h-3.5 w-3.5" />
              Platform operasional resto, all-in-one
            </span>
            <h2 className="mt-4 text-3xl font-bold leading-[1.15] tracking-tight text-white">
              Kasir, QR meja, dan stok bahan baku dalam{" "}
              <span className="text-emerald-300">satu dashboard</span>.
            </h2>
          </div>

          {/* Product illustration */}
          <div className="relative mt-8 max-w-md">
            <span className="absolute -top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2.5 py-1 text-[10px] font-bold text-emerald-100 backdrop-blur">
              <QrCode className="h-3 w-3" />
              Subdomain Otomatis &amp; QRIS Instan
            </span>

            <div
              aria-hidden
              className="overflow-hidden rounded-2xl border border-white/15 bg-white shadow-2xl shadow-black/40"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <div className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] text-slate-500 ring-1 ring-slate-200">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="truncate font-mono">{EXAMPLE_STOREFRONT}</span>
                </div>
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Ringkasan kasir hari ini
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    <TrendingUp className="h-3 w-3" />
                    Live
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                    <p className="text-[10px] font-medium text-slate-500">
                      Penjualan
                    </p>
                    <p className="mt-0.5 text-base font-bold text-slate-900">
                      {formatRupiah(4_850_000)}
                    </p>
                    <p className="text-[10px] text-emerald-600">+18% vs kemarin</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                    <p className="text-[10px] font-medium text-slate-500">
                      Transaksi
                    </p>
                    <p className="mt-0.5 text-base font-bold text-slate-900">
                      128
                    </p>
                    <p className="text-[10px] text-slate-500">42 via QR meja</p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 p-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-white">
                    <QrCode className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-slate-900">
                      QR Meja 12 — terisi
                    </p>
                    <p className="text-[10px] text-slate-500">
                      3 pesanan baru masuk dapur
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    Aktif
                  </span>
                </div>
              </div>
            </div>
          </div>

          <ul className="mt-8 max-w-md space-y-4">
            {ADVANTAGES.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug text-white">
                    {title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-10 max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-wrap items-center gap-1.5 text-amber-300">
            <span className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Star key={index} className="h-3.5 w-3.5 fill-current" />
              ))}
            </span>
            <span className="ml-1 text-xs font-bold text-white">4.9/5</span>
            <span className="text-[11px] font-medium text-slate-400">
              dari pengelola kafe &amp; resto modern
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            &ldquo;Kasir, QR meja, dan laporan stok jadi satu alur. Buka cabang
            baru tinggal tambah add-on — tidak perlu ganti aplikasi.&rdquo;
          </p>
          <p className="mt-2 text-[11px] font-medium text-slate-400">
            Ayu Prameswari — Owner Kopi Senja, 3 cabang
          </p>
        </div>
      </aside>

      {/* ============ Right: form column ============ */}
      <main className="flex min-h-screen flex-col bg-white px-5 py-6 sm:px-8 lg:min-h-0 lg:px-10 xl:px-14">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke Beranda
          </Link>

          {switchHref && switchCta ? (
            <p className="text-xs text-slate-500">
              {switchPrompt}{" "}
              <Link
                href={switchHref}
                className="font-semibold text-emerald-700 hover:underline"
              >
                {switchCta}
              </Link>
            </p>
          ) : null}
        </div>

        <div className="flex flex-1 items-center justify-center py-8 sm:py-10">
          <div className="w-full max-w-md">{children}</div>
        </div>

        <p className="text-center text-[10px] font-medium uppercase tracking-[0.16em] text-slate-300">
          POS · QR Order · Stok · Laporan
        </p>
      </main>
    </div>
  );
}
