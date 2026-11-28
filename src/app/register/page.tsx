"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Store,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import AuthSplitLayout, { AuthField } from "@/components/auth/auth-split-layout";
import { toast } from "sonner";
import api from "@/lib/axios";
import { previewTenantSlug } from "@/lib/tenant-url";
import {
  PLAN_CATALOG,
  STARTER_TRIAL_DAYS,
  getPlan,
  isPlanCode,
  type PlanCode,
} from "@/lib/subscription";
import { formatRupiah } from "@/components/landing/landing-data";

// ============================================================
// /register — self-service merchant onboarding (SaaS signup).
//
// Two short sections → one atomic POST /api/public/merchants/register that
// creates the tenant (restaurant + "Cabang Pusat" + settings + the single
// OWNER/ADMIN user + STARTER trial subscription + wallet + expense
// categories). Staff accounts (Kasir/Dapur/Co-Admin) are added later from
// /admin/users, and QRIS/VA revenue is withdrawn from /admin/payouts.
//
// ?plan=BASIC|PRO|ENTERPRISE carries the plan the visitor picked on the
// landing page: it is shown as guidance only — the trial always starts on
// STARTER, and the paid plan is activated later in /admin/billing.
//
// On success the merchant sees their storefront URL + login email and gets a
// one-click hand-off to /login; they sign in with the password they just chose.
// ============================================================

interface RegisterResponse {
  restaurant: { slug: string; name: string };
  branch: { id: string; code: string; name: string };
  loginUrl: string;
  storeUrl: string;
  subdomainUrl?: string;
}

/** Root domain as configured at build time (empty → path fallback preview). */
const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "")
  .trim()
  .replace(/^[a-z]+:\/\//i, "")
  .replace(/\/+$/, "");

const STARTER = PLAN_CATALOG.STARTER;

const PASSWORD_METER = [
  { label: "Lemah", bar: "bg-rose-400", text: "text-rose-600" },
  { label: "Sedang", bar: "bg-amber-400", text: "text-amber-600" },
  { label: "Kuat", bar: "bg-emerald-500", text: "text-emerald-600" },
] as const;

/** 0 = empty, 1 = weak, 2 = medium, 3 = strong (3 bars in the form). */
function passwordScore(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  if (password.length < 8) return 1;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) =>
    rule.test(password)
  ).length;
  if (password.length >= 12 && variety >= 3) return 3;
  if (variety >= 2) return 2;
  return 1;
}

function SectionHeading({
  step,
  icon: Icon,
  title,
  description,
}: {
  step: number;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-white">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Bagian {step}
        </p>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <p className="text-[11px] leading-relaxed text-slate-500">
          {description}
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const [form, setForm] = useState({
    restaurantName: "",
    ownerName: "",
    email: "",
    password: "",
    phone: "",
    address: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Plan picked on the landing page (?plan=…), if any. */
  const [requestedPlan, setRequestedPlan] = useState<PlanCode | null>(null);
  /** Set after a successful registration → renders the hand-off screen. */
  const [registered, setRegistered] = useState<
    (RegisterResponse & { email: string }) | null
  >(null);

  // Read the query string from the browser (same pattern as /login) instead of
  // useSearchParams, so this page stays statically prerenderable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("plan");
    if (isPlanCode(plan?.toUpperCase())) {
      setRequestedPlan(plan!.toUpperCase() as PlanCode);
    }
  }, []);

  const update = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Live storefront address preview. Computed from the same slug rules the
  // server uses (reserved words get a `-resto` suffix); real uniqueness is
  // resolved server-side, so this is a preview, not a guarantee.
  const slugPreview = previewTenantSlug(form.restaurantName || "namakafe");
  const storePreview = ROOT_DOMAIN
    ? `${slugPreview}.${ROOT_DOMAIN}`
    : `/r/${slugPreview}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password.length < 8) {
      toast.error("Password minimal 8 karakter");
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.post("/public/merchants/register", {
        restaurantName: form.restaurantName.trim(),
        ownerName: form.ownerName.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
        address: form.address.trim() || undefined,
      });
      const data = res.data?.data as RegisterResponse | undefined;
      if (!data?.restaurant?.slug) {
        toast.error("Pendaftaran tidak mengembalikan data toko. Silakan masuk.");
        return;
      }
      // Show the onboarding hand-off (storefront URL + login email) instead of
      // bouncing straight to /login, so the owner can note/copy their address.
      setRegistered({ ...data, email: form.email.trim() });
      toast.success("Restoran berhasil didaftarkan");
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Gagal mendaftarkan restoran";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const copyStoreUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Alamat toko disalin");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Gagal menyalin. Salin manual dari teks di atas.");
    }
  };

  // ===== Success hand-off =====
  if (registered) {
    const storefrontUrl = registered.subdomainUrl || registered.storeUrl;
    const loginHref = `/login?registered=1&email=${encodeURIComponent(
      registered.email
    )}`;

    return (
      <AuthSplitLayout>
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
            {registered.restaurant.name} siap dipakai!
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
            Akun Owner dan toko online Anda sudah dibuat. Simpan informasi
            berikut sebelum masuk ke dashboard.
          </p>
        </div>

        <div className="mt-6 space-y-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Alamat Toko Online
            </p>
            <div className="mt-1.5 flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 break-all font-mono text-sm font-semibold text-emerald-700">
                {storefrontUrl.replace(/^https?:\/\//i, "")}
              </p>
              <button
                type="button"
                onClick={() => copyStoreUrl(storefrontUrl)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-emerald-400 hover:text-emerald-700"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    Tersalin!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Salin Link
                  </>
                )}
              </button>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Email Login
            </p>
            <p className="mt-1 break-all text-sm font-semibold text-slate-900">
              {registered.email}
            </p>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Paket Aktif
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
              <Sparkles className="h-3 w-3" />
              {STARTER.name} — Free Trial {STARTER_TRIAL_DAYS} hari
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Langkah pertama Anda
          </p>
          <p className="mt-3 text-xs leading-relaxed text-slate-600">
            Anda masuk sebagai <span className="font-semibold">Owner</span>.
            Dari dashboard, buat akun <span className="font-semibold">Kasir</span>{" "}
            dan <span className="font-semibold">Dapur</span> di menu Pengguna,
            lalu cairkan pendapatan QRIS/VA kapan saja di menu{" "}
            <span className="font-semibold">Saldo &amp; Pencairan</span> tanpa
            menunggu persetujuan manual.
          </p>
          <ul className="mt-3 space-y-2.5">
            {[
              "Simpan alamat toko online untuk dibagikan ke pelanggan.",
              `Masuk memakai email ${registered.email} dan password yang baru Anda buat.`,
              "Tambahkan akun Kasir & Dapur (lengkap dengan cabangnya) di menu Pengguna.",
              "Cairkan pendapatan QRIS & Virtual Account ke rekening bank di menu Saldo & Pencairan.",
            ].map((item, index) => (
              <li
                key={item}
                className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-600"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                  {index + 1}
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          <Button
            type="button"
            onClick={() => {
              window.location.href = loginHref;
            }}
            className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800"
          >
            Masuk ke Dashboard Sekarang
            <ArrowRight className="h-4 w-4" />
          </Button>
          <a
            href={storefrontUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Globe className="h-4 w-4" />
            Buka Toko Online Anda
          </a>
        </div>

                  <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
            Free trial aktif otomatis. Anda bisa upgrade ke paket berbayar kapan
            saja tanpa kehilangan data — atau menambah akun karyawan bila kuota
            paket masih tersedia.
          </p>
      </AuthSplitLayout>
    );
  }

  const selectedPlan = requestedPlan ? getPlan(requestedPlan) : null;
  const score = passwordScore(form.password);
  const meter = PASSWORD_METER[Math.max(0, score - 1)];

  return (
    <AuthSplitLayout
      switchPrompt="Sudah punya akun?"
      switchCta="Masuk"
      switchHref="/login"
    >
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
          <Sparkles className="h-3.5 w-3.5" />
          Free Trial {STARTER_TRIAL_DAYS} Hari · Tanpa Kartu Kredit
        </span>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">
          Buat Akun Toko Gratis
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Toko online, kasir, QR meja, dan stok bahan baku langsung aktif dalam
          satu dashboard.
        </p>

        {selectedPlan && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                Paket pilihan Anda
              </p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm font-bold text-slate-900">
                {selectedPlan.name}
                <span className="text-xs font-semibold text-slate-500">
                  {selectedPlan.monthlyPrice === 0
                    ? "· Gratis"
                    : `· ${formatRupiah(selectedPlan.monthlyPrice)}/bulan`}
                </span>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                Pendaftaran dimulai dengan Free Trial {STARTER_TRIAL_DAYS} hari
                (paket {STARTER.name}). Setelah itu aktifkan paket{" "}
                {selectedPlan.name} dari menu{" "}
                <span className="font-semibold">Paket &amp; Billing</span>.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-7 space-y-7">
          {/* ---------- Bagian 1: profil bisnis ---------- */}
          <section aria-labelledby="profil-bisnis" className="space-y-4">
            <div id="profil-bisnis">
              <SectionHeading
                step={1}
                icon={Store}
                title="Profil Bisnis"
                description="Nama kafe, alamat toko online, dan kontak yang tampil ke pelanggan."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="restaurantName">Nama Kafe / Resto</Label>
              <AuthField
                id="restaurantName"
                icon={Store}
                placeholder="Warung Bu Sri"
                value={form.restaurantName}
                onChange={(e) => update("restaurantName")(e.target.value)}
                minLength={2}
                maxLength={120}
                required
              />

              {/* Live subdomain preview — slug rules are the same as the server. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Alamat toko Anda
                  </span>
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600" />
                    </span>
                    Tersedia
                  </span>
                </div>
                <p className="mt-1.5 break-all font-mono text-xs font-semibold text-slate-900">
                  {ROOT_DOMAIN ? `https://${storePreview}` : storePreview}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                  Dibuat otomatis dari nama kafe. Ketersediaan akhir dicek saat
                  pendaftaran.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">No. WhatsApp</Label>
              <AuthField
                id="phone"
                icon={Phone}
                type="tel"
                placeholder="081234567890"
                value={form.phone}
                onChange={(e) => update("phone")(e.target.value)}
                minLength={8}
                maxLength={30}
                autoComplete="tel"
                required
              />
              <p className="text-[11px] text-slate-400">
                Dipakai untuk konfirmasi pesanan dan info tagihan.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">
                Alamat Singkat{" "}
                <span className="font-normal text-slate-400">(opsional)</span>
              </Label>
              <AuthField
                id="address"
                icon={MapPin}
                placeholder="Jl. Contoh No. 123, Jakarta"
                value={form.address}
                onChange={(e) => update("address")(e.target.value)}
                maxLength={300}
              />
            </div>
          </section>

          <div className="h-px bg-slate-100" />

          {/* ---------- Bagian 2: akun owner ---------- */}
          <section aria-labelledby="akun-owner" className="space-y-4">
            <div id="akun-owner">
              <SectionHeading
                step={2}
                icon={User}
                title="Akun Owner"
                description="Satu akun utama pemilik. Akun Kasir & Dapur dibuat setelah masuk dashboard."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ownerName">Nama Lengkap Pemilik</Label>
              <AuthField
                id="ownerName"
                icon={User}
                placeholder="Sri Wahyuni"
                value={form.ownerName}
                onChange={(e) => update("ownerName")(e.target.value)}
                minLength={2}
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Login</Label>
              <AuthField
                id="email"
                icon={Mail}
                type="email"
                placeholder="owner@warungbusri.id"
                value={form.email}
                onChange={(e) => update("email")(e.target.value)}
                maxLength={190}
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <AuthField
                id="password"
                icon={Lock}
                type={showPassword ? "text" : "password"}
                placeholder="Minimal 8 karakter"
                value={form.password}
                onChange={(e) => update("password")(e.target.value)}
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                required
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={
                      showPassword
                        ? "Sembunyikan password"
                        : "Tampilkan password"
                    }
                    aria-pressed={showPassword}
                    className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                }
              />

              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1" aria-hidden>
                  {[0, 1, 2].map((index) => (
                    <span
                      key={index}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        index < score ? meter.bar : "bg-slate-200"
                      }`}
                    />
                  ))}
                </div>
                <span
                  aria-live="polite"
                  className={`text-[10px] font-semibold ${
                    score > 0 ? meter.text : "text-slate-400"
                  }`}
                >
                  {score > 0 ? meter.label : "Min. 8 karakter"}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Gunakan campuran huruf dan angka agar akun kasir Anda lebih aman.
              </p>
            </div>
          </section>

          <div className="space-y-3">
            <Button
              type="submit"
              disabled={isLoading}
              className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Membuat akun toko…
                </>
              ) : (
                <>
                  Daftar Sekarang — Gratis {STARTER_TRIAL_DAYS} Hari
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-slate-400">
              Tanpa kartu kredit. Data hanya dipakai untuk menyiapkan toko dan
              mengirim informasi akun.{" "}
              <Link
                href="/"
                className="font-medium text-slate-500 hover:text-slate-800 hover:underline"
              >
                Kembali ke beranda
              </Link>
            </p>
          </div>
        </form>
      </div>
    </AuthSplitLayout>
  );
}
