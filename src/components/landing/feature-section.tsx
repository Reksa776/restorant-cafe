import { PLAN_CATALOG } from "@/lib/subscription";
import {
  LANDING_FEATURES,
  TRIAL_LABEL,
  featureBadge,
} from "./landing-data";

/**
 * Feature grid with tier badges.
 *
 * Every badge is derived from PLAN_CATALOG (via `featureBadge`), so this page
 * can never advertise a capability on a plan that does not include it.
 */
export default function FeatureSection() {
  return (
    <section id="fitur" className="scroll-mt-20 bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
            Fitur Unggulan
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Mulai dari yang dasar, buka fitur lanjutan saat bisnis tumbuh
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            Akun baru otomatis mendapat paket{" "}
            <strong>{PLAN_CATALOG.STARTER.name}</strong> dengan {TRIAL_LABEL}.
            Fitur operasional yang lebih dalam terbuka setelah Anda berlangganan
            — tanpa migrasi data, tanpa ganti aplikasi.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LANDING_FEATURES.map((item) => {
            const badge = featureBadge(item);
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md hover:shadow-slate-900/5"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-sm font-bold leading-snug text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-600">
                  {item.description}
                </p>
                <span
                  className={`mt-4 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.className}`}
                >
                  {badge.label}
                </span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
