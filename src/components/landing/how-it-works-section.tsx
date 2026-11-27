import Link from "next/link";
import { ArrowRight, Receipt, Store, TrendingUp } from "lucide-react";
import { PLAN_CATALOG, STARTER_TRIAL_DAYS } from "@/lib/subscription";

const STEPS = [
  {
    icon: Store,
    title: "Daftar Gratis (1 Menit)",
    description: `Isi nama resto, email, dan password. Subdomain toko online Anda dibuat otomatis beserta ${STARTER_TRIAL_DAYS} hari Free Trial paket ${PLAN_CATALOG.STARTER.name}.`,
  },
  {
    icon: Receipt,
    title: "Atur Menu & Mulai Transaksi",
    description:
      "Tambahkan menu dan harga, lalu langsung jualan lewat kasir POS. Pembayaran QRIS/VA dan laporan harian sudah aktif sejak hari pertama.",
  },
  {
    icon: TrendingUp,
    title: "Upgrade Paket / Tambah Cabang",
    description:
      "Butuh QR meja, resep & HPP, atau cabang baru? Aktifkan sendiri dari menu Paket & Billing — fitur langsung terbuka tanpa downtime.",
  },
];

/** Three-step onboarding story. */
export default function HowItWorksSection() {
  return (
    <section
      id="cara-kerja"
      className="scroll-mt-20 border-y border-slate-200 bg-slate-50 py-16 sm:py-20"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
            Cara Kerja
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Dari daftar sampai transaksi pertama, tiga langkah saja
          </h2>
        </div>

        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="relative flex flex-col rounded-2xl border border-slate-200 bg-white p-6"
              >
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-3xl font-black text-slate-200">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {step.description}
                </p>
              </li>
            );
          })}
        </ol>

        <div className="mt-8">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Buat Akun Resto Sekarang
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
