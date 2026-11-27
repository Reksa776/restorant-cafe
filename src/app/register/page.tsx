"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

// ============================================================
// /register — self-service merchant onboarding (SaaS signup).
//
// One form → one atomic POST /api/public/merchants/register that creates the
// tenant (restaurant + first branch + settings + admin user + default expense
// categories). On success the merchant is sent to /login with the email
// prefilled; they sign in with the password they just chose.
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

export default function RegisterPage() {
  const router = useRouter();
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
      toast.success(
        data?.subdomainUrl
          ? `Restoran terdaftar! Toko online Anda: ${data.subdomainUrl}`
          : data?.restaurant?.slug
            ? `Restoran terdaftar! Toko online Anda: /r/${data.restaurant.slug}`
            : "Restoran berhasil didaftarkan"
      );
      router.push(`/login?registered=1&email=${encodeURIComponent(form.email.trim())}`);
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Gagal mendaftarkan restoran";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold">🍽️ Daftarkan Restoran</CardTitle>
          <CardDescription>
            Buat akun SaaS untuk restoran atau cafe Anda — gratis, langsung siap
            dipakai.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
