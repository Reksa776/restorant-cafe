"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

// ============================================================
// /register — self-service merchant onboarding (SaaS signup).
//
// One form → one atomic POST /api/public/merchants/register that creates the
// tenant (restaurant + first branch + settings + admin user + STARTER trial
// subscription + default expense categories).
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

export default function RegisterPage() {
  const [form, setForm] = useState({
    restaurantName: "",
    branchName: "Cabang Utama",
    ownerName: "",
    email: "",
    password: "",
    phone: "",
    address: "",
  });
  const [isLoading, setIsLoading] = useState(false);
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
        branchName: form.branchName.trim(),
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
      toast.success("Alamat toko disalin");
    } catch {
      toast.error("Gagal menyalin. Salin manual dari teks di atas.");
    }
  };

  // ===== Success hand-off =====
  if (registered) {
    const storefrontUrl = registered.subdomainUrl || registered.storeUrl;
    const isAbsolute = /^https?:\/\//i.test(storefrontUrl);
    const loginHref = `/login?registered=1&email=${encodeURIComponent(
      registered.email
    )}`;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
        <Card className="w-full max-w-lg">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
              ✅
            </div>
            <CardTitle className="text-2xl font-bold">
              {registered.restaurant.name} siap dipakai!
            </CardTitle>
            <CardDescription>
              Akun admin dan toko online Anda sudah dibuat. Simpan informasi di
              bawah ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Alamat Toko Online
                </p>
                <p className="break-all font-mono text-sm font-semibold text-brand-primary">
                  {storefrontUrl.replace(/^https?:\/\//i, "")}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Email Login
                </p>
                <p className="break-all text-sm font-semibold text-gray-900">
                  {registered.email}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Paket Aktif
                </p>
                <p className="text-sm font-semibold text-gray-900">
                  {STARTER.name} — Free Trial {STARTER_TRIAL_DAYS} hari
                </p>
              </div>
              <p className="text-[11px] text-gray-500">
                Masuk memakai password yang baru saja Anda buat. Setelah masuk,
                buka menu <strong>Paket &amp; Billing</strong> untuk mengaktifkan
                paket berbayar atau membeli Add-On Cabang.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  window.location.href = loginHref;
                }}
              >
                Masuk ke Dashboard
              </Button>
              {isAbsolute ? (
                <a
                  href={storefrontUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Lihat Toko Online
                </a>
              ) : (
                <Link
                  href={storefrontUrl}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Lihat Toko Online
                </Link>
              )}
              <button
                type="button"
                onClick={() => copyStoreUrl(storefrontUrl)}
                className="text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                Salin alamat toko
              </button>
            </div>

            <p className="text-center text-xs text-gray-500">
              <Link href="/" className="font-medium text-brand-primary hover:underline">
                Kembali ke beranda
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedPlan = requestedPlan ? getPlan(requestedPlan) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold">🍽️ Daftarkan Restoran</CardTitle>
          <CardDescription>
            Buat akun SaaS untuk restoran atau cafe Anda — gratis{" "}
            {STARTER_TRIAL_DAYS} hari, langsung siap dipakai.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {selectedPlan && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
                Anda memilih paket{" "}
                <span className="font-bold uppercase">{selectedPlan.name}</span>{" "}
                — daftar sekarang untuk mulai Free Trial {STARTER_TRIAL_DAYS}{" "}
                hari, lalu aktifkan paket di menu{" "}
                <span className="font-semibold">Paket &amp; Billing</span>.
                {selectedPlan.code !== "STARTER" &&
                  " Paket Starter berlaku sampai paket berbayar diaktifkan."}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="restaurantName">Nama Restoran</Label>
                <Input
                  id="restaurantName"
                  placeholder="Warung Bu Sri"
                  value={form.restaurantName}
                  onChange={(e) => update("restaurantName")(e.target.value)}
                  minLength={2}
                  maxLength={120}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branchName">Nama Cabang Utama</Label>
                <Input
                  id="branchName"
                  placeholder="Cabang Utama"
                  value={form.branchName}
                  onChange={(e) => update("branchName")(e.target.value)}
                  minLength={2}
                  maxLength={120}
                  required
                />
              </div>
            </div>

            <p className="text-xs text-gray-500">
              Alamat toko online Anda:{" "}
              <span className="font-mono font-semibold text-brand-primary">
                {storePreview}
              </span>
            </p>

            <div className="space-y-2">
              <Label htmlFor="ownerName">Nama Pemilik</Label>
              <Input
                id="ownerName"
                placeholder="Sri Wahyuni"
                value={form.ownerName}
                onChange={(e) => update("ownerName")(e.target.value)}
                minLength={2}
                maxLength={120}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
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
                <Label htmlFor="phone">No. HP</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="081234567890"
                  value={form.phone}
                  onChange={(e) => update("phone")(e.target.value)}
                  minLength={8}
                  maxLength={30}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Minimal 8 karakter"
                value={form.password}
                onChange={(e) => update("password")(e.target.value)}
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">
                Alamat <span className="text-gray-400 font-normal">(opsional)</span>
              </Label>
              <Input
                id="address"
                placeholder="Jl. Contoh No. 123, Jakarta"
                value={form.address}
                onChange={(e) => update("address")(e.target.value)}
                maxLength={300}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Mendaftarkan..." : "Daftar Sekarang"}
            </Button>

            <p className="text-center text-xs text-gray-500">
              Sudah punya akun?{" "}
              <Link href="/login" className="font-medium text-brand-primary hover:underline">
                Masuk di sini
              </Link>
            </p>
            <p className="text-center text-xs text-gray-400">
              <Link href="/" className="hover:text-gray-600 hover:underline">
                Kembali ke beranda
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
