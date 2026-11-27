import Link from "next/link";
import {
  ArrowRight,
  Check,
  LayoutGrid,
  QrCode,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  DEMO_STORE_PATH,
  EXAMPLE_STOREFRONT,
  TRIAL_LABEL,
  formatRupiah,
} from "./landing-data";

const TRUST_POINTS = [
  "POS & shift kasir",
  "QRIS + Virtual Account",
  "Stok bahan baku otomatis",
];

/**
 * Above-the-fold hero.
 *
 * The right-hand panel is an ILLUSTRATION of the product (hardcoded sample
 * numbers), not live data — hence `aria-hidden` on the mockup and the
 * "Ilustrasi" caption underneath.
 */
export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-slate-950">
      {/* Ambient glow + grid, purely decorative. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-emerald-200">
              <Sparkles className="h-3.5 w-3.5" />
              {TRIAL_LABEL} · tanpa biaya setup
            </span>

            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
              Kelola Kasir, QR Order Meja, &amp; Stok Bahan Baku Resto dalam{" "}
              <span className="text-emerald-300">Satu Platform</span>
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Daftar sekali, toko online resto Anda langsung aktif di{" "}
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-sm text-emerald-200">
                {EXAMPLE_STOREFRONT}
              </span>
              . Pembayaran QRIS &amp; Virtual Account terkonfirmasi otomatis,
              stok bahan baku terpotong sendiri — tanpa install aplikasi.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition-colors hover:bg-emerald-300"
              >
                Mulai Gratis Sekarang
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={DEMO_STORE_PATH}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                <QrCode className="h-4 w-4" />
                Lihat Demo Toko
              </Link>
            </div>

            <p className="mt-3 text-xs text-slate-400">
              Registrasi ±1 menit · Subdomain otomatis · Tanpa kartu kredit
            </p>

            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2">
              {TRUST_POINTS.map((point) => (
                <li
                  key={point}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-300"
                >
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Product illustration */}
          <div className="lg:col-span-6">
            <div aria-hidden className="relative">
              <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-tr from-emerald-400/20 via-sky-400/10 to-amber-300/20 blur-2xl" />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40">
                {/* Browser chrome */}
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <div className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] text-slate-500 ring-1 ring-slate-200">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate font-mono">{EXAMPLE_STOREFRONT}</span>
                  </div>
                </div>

                <div className="space-y-3 bg-white p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Ringkasan hari ini
                    </p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      <TrendingUp className="h-3 w-3" />
                      Live
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <p className="text-[11px] font-medium text-slate-500">
                        Penjualan
                      </p>
                      <p className="mt-0.5 text-lg font-bold text-slate-900">
                        {formatRupiah(4_850_000)}
                      </p>
                      <p className="text-[11px] text-emerald-600">+18% vs kemarin</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <p className="text-[11px] font-medium text-slate-500">
                        Transaksi
                      </p>
                      <p className="mt-0.5 text-lg font-bold text-slate-900">128</p>
                      <p className="text-[11px] text-slate-500">42 via QR meja</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-white">
                      <QrCode className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900">
                        QR Meja 12 — self order
                      </p>
                      <p className="text-[11px] text-slate-500">
                        3 pesanan baru masuk dapur
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      Aktif
                    </span>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        Paket Pro
                      </p>
                      <span className="text-[11px] font-medium text-slate-500">
                        26 hari tersisa
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full w-[72%] rounded-full bg-emerald-500" />
                    </div>
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
                      <LayoutGrid className="h-3 w-3" />
                      QR order, resep HPP, reservasi — aktif
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">
              Ilustrasi dashboard admin — data contoh.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
