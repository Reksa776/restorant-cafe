import { ChevronDown } from "lucide-react";
import { PLAN_CATALOG, STARTER_TRIAL_DAYS } from "@/lib/subscription";

const FAQS = [
  {
    question: "Apakah bisa dipakai di HP atau tablet?",
    answer:
      "Bisa. Dashboard admin, kasir POS, dan halaman pelanggan dibuat responsif untuk HP maupun tablet. Pelanggan juga tidak perlu install aplikasi — cukup pindai QR meja atau buka link toko dari browser.",
  },
  {
    question: "Bagaimana cara kerja pembayaran QRIS?",
    answer:
      "Setiap pesanan yang dibayar online membuat tagihan lewat gateway iPaymu, yang menampilkan QRIS dan Virtual Account. Setelah pelanggan membayar, status pembayaran diperbarui otomatis lewat webhook — kasir tidak perlu mencocokkan mutasi satu per satu. Untuk uji coba, pembayaran tunai/manual tetap tersedia.",
  },
  {
    question: "Bagaimana cara menambah cabang baru?",
    answer: `Setiap paket sudah termasuk 1 cabang utama. Untuk cabang tambahan, beli Add-On Cabang di menu Paket & Billing (tersedia pada paket ${PLAN_CATALOG.BASIC.name}, ${PLAN_CATALOG.PRO.name}, dan ${PLAN_CATALOG.ENTERPRISE.name}), lalu buat cabangnya di Pengaturan → Cabang. Paket ${PLAN_CATALOG.STARTER.name} perlu di-upgrade terlebih dahulu.`,
  },
  {
    question: "Apakah data setiap kafe aman dan terpisah?",
    answer:
      "Ya. Setiap merchant adalah tenant tersendiri dengan ID restoran dan subdomain sendiri. Seluruh data admin, pesanan, stok, dan laporan difilter berdasarkan restoran dari sesi login, sehingga satu kafe tidak bisa melihat atau mengubah data kafe lain.",
  },
  {
    question: `Apa yang terjadi setelah ${STARTER_TRIAL_DAYS} hari Free Trial berakhir?`,
    answer:
      "Data, menu, dan pengaturan tetap tersimpan. Transaksi baru serta fitur berbayar memerlukan paket aktif, jadi aktifkan langganan dari menu Paket & Billing sebelum masa trial habis — bisa bulanan atau tahunan (hemat 2 bulan).",
  },
];

/** Native `<details>` accordion — no client JS needed. */
export default function FaqSection() {
  return (
    <section
      id="faq"
      className="scroll-mt-20 border-t border-slate-200 bg-slate-50 py-16 sm:py-20"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
            FAQ
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Pertanyaan yang sering ditanyakan pemilik kafe
          </h2>
        </div>

        <div className="mt-8 space-y-3">
          {FAQS.map((faq) => (
            <details
              key={faq.question}
              className="group rounded-2xl border border-slate-200 bg-white px-5 py-4 open:shadow-sm"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-900 marker:hidden sm:text-base">
                {faq.question}
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
