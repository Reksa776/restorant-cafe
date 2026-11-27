"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles, Store } from "lucide-react";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  addonBranchPrice,
  planPrice,
  type BillingCycleCode,
  type PlanCode,
} from "@/lib/subscription";
import { formatRupiah, formatRupiahShort } from "./landing-data";

// ============================================================
// PRICING — interactive monthly/yearly toggle.
//
// Every number on this section is read from PLAN_CATALOG through the
// `planPrice` / `addonBranchPrice` helpers, exactly like /admin/billing. No
// price, limit or add-on amount is hardcoded in this component.
//
// Prices shown here are marketing PREVIEWS; the invoice amount is always
// recomputed server-side from the same catalog.
// ============================================================

const ADDON_PLANS: PlanCode[] = ["BASIC", "PRO", "ENTERPRISE"];

export default function PricingSection() {
  const [cycle, setCycle] = useState<BillingCycleCode>("MONTHLY");
  const isYearly = cycle === "YEARLY";

  return (
    <section id="harga" className="scroll-mt-20 bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
              Harga Paket
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Harga transparan, tanpa biaya tersembunyi
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
              Semua paket sudah termasuk 1 cabang utama. Tambah cabang baru
              lewat Add-On kapan saja dari menu Paket &amp; Billing.
            </p>
          </div>

          <div
            className="inline-flex w-fit items-center rounded-xl border border-slate-200 bg-slate-50 p-1"
            role="group"
            aria-label="Siklus penagihan"
          >
            <button
              type="button"
              onClick={() => setCycle("MONTHLY")}
              aria-pressed={!isYearly}
              className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                !isYearly
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Bulanan
            </button>
            <button
              type="button"
              onClick={() => setCycle("YEARLY")}
              aria-pressed={isYearly}
              className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                isYearly
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Tahunan
              <span className="ml-1.5 text-[10px] font-bold text-emerald-600">
                Hemat 2 bulan
              </span>
            </button>
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((code) => {
            const plan = PLAN_CATALOG[code];
            const price = planPrice(code, cycle);
            const isPro = code === "PRO";
            const isFree = price === 0;
            const monthlyEquivalent =
              isYearly && plan.yearlyPrice > 0
                ? Math.round(plan.yearlyPrice / 12)
                : null;
            const savings =
              isYearly && plan.monthlyPrice > 0
                ? plan.monthlyPrice * 12 - plan.yearlyPrice
                : 0;

            return (
              <article
                key={code}
                className={`relative flex flex-col rounded-2xl border bg-white p-5 ${
                  isPro
                    ? "border-2 border-slate-900 shadow-lg shadow-slate-900/10"
                    : "border-slate-200"
                }`}
              >
                {isPro && (
                  <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                    <Sparkles className="h-3 w-3" />
                    Paling Laris
                  </span>
                )}

                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  {plan.name}
                </h3>
                <p className="mt-1 min-h-8 text-xs leading-relaxed text-slate-500">
                  {plan.tagline}
                </p>

                <div className="mt-4">
                  {isFree ? (
                    <p className="text-3xl font-bold tracking-tight text-slate-900">
                      Gratis
                    </p>
                  ) : (
                    <p className="text-3xl font-bold tracking-tight text-slate-900">
                      {formatRupiah(price)}
                      <span className="ml-1 text-xs font-medium text-slate-500">
                        /{isYearly ? "tahun" : "bulan"}
                      </span>
                    </p>
                  )}

                  {isFree ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-600">
                      Free Trial 14 hari
                    </p>
                  ) : monthlyEquivalent ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-600">
                      Setara {formatRupiah(monthlyEquivalent)}/bulan
                      {savings > 0 && ` · hemat ${formatRupiah(savings)}`}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Tagihan bulanan, berhenti kapan saja
                    </p>
                  )}
                </div>

                <dl className="mt-4 space-y-1 border-y border-slate-100 py-3 text-[11px] text-slate-600">
                  <div className="flex items-center justify-between gap-2">
                    <dt>Transaksi</dt>
                    <dd className="font-semibold text-slate-900">
                      {plan.maxTransactionsPerMonth === null
                        ? "Unlimited"
                        : `${plan.maxTransactionsPerMonth}/bulan`}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt>Akun staf</dt>
                    <dd className="font-semibold text-slate-900">
                      {plan.maxStaff === null ? "Unlimited" : `${plan.maxStaff} akun`}
                    </dd>
                  </div>
                </dl>

                <ul className="mt-4 flex-1 space-y-2">
                  {plan.highlights.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-600"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      {item}
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/register?plan=${code}`}
                  className={`mt-5 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-colors ${
                    isPro
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "border border-slate-300 text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  {isFree ? "Mulai Gratis" : `Pilih ${plan.name}`}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </article>
            );
          })}
        </div>

        {/* Branch add-on — amounts straight from PLAN_CATALOG. */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Store className="h-4 w-4" />
                Add-On Tambah Cabang Baru
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Satu add-on = satu kuota cabang baru, di luar cabang utama.
                Dapat dibeli setelah berlangganan Basic ke atas.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {ADDON_PLANS.map((code) => {
              const plan = PLAN_CATALOG[code];
              const addon = addonBranchPrice(code, cycle);
              return (
                <div
                  key={code}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                >
                  <p className="text-[11px] font-medium text-slate-500">
                    Paket {plan.name}
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    +{formatRupiah(addon)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    per cabang / {isYearly ? "tahun" : "bulan"}
                  </p>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-[11px] text-slate-500">
            Paket {PLAN_CATALOG.STARTER.name} hanya mendukung 1 cabang utama —
            upgrade dulu untuk membeli add-on. Contoh: {PLAN_CATALOG.PRO.name}{" "}
            +1 cabang = {formatRupiahShort(PLAN_CATALOG.PRO.monthlyPrice)} +{" "}
            {formatRupiahShort(PLAN_CATALOG.PRO.addonBranchMonthly)} /
            bulan.
          </p>
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Harga di atas adalah pratinjau. Nominal tagihan selalu dihitung ulang
          oleh server dari katalog paket saat invoice dibuat.
        </p>
      </div>
    </section>
  );
}
