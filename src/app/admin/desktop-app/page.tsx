"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Keyboard,
  Loader2,
  Monitor,
  Printer,
  ShieldCheck,
  Store,
} from "lucide-react";
import api from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ============================================================
// Aplikasi Kasir Desktop — download & setup guide
//
// The installer is built by .github/workflows/build-desktop.yml (Windows
// runner) and published to GitHub Releases. `NEXT_PUBLIC_DESKTOP_WIN_URL`
// only points at the resulting .exe — no Electron code ships in this bundle.
// ============================================================

const INSTALLER_URL = (process.env.NEXT_PUBLIC_DESKTOP_WIN_URL ?? "").trim();
const RELEASES_URL = "https://github.com/Reksa776/restorant-cafe/releases";

interface RestaurantProfile {
  slug: string;
  name: string;
  subdomainUrl?: string;
  subdomainEnabled?: boolean;
}

const FEATURES = [
  {
    icon: Printer,
    title: "Silent Print Struk Thermal",
    description:
      "Struk 58 mm / 80 mm langsung tercetak ke printer thermal pilihan — tanpa dialog cetak Windows.",
  },
  {
    icon: Keyboard,
    title: "Shortcut Keyboard Kasir",
    description:
      "F11 untuk layar penuh, Ctrl+Shift+S untuk ganti toko & printer, F5 untuk memuat ulang layar kasir.",
  },
  {
    icon: ShieldCheck,
    title: "Sesi Login Persisten",
    description:
      "Login sekali saat shift dimulai. Sesi tersimpan aman di perangkat, jadi kasir tidak login berulang.",
  },
  {
    icon: Monitor,
    title: "Satu Aplikasi, Semua Toko",
    description:
      "Ganti kode subdomain untuk berpindah outlet. Cocok untuk operasional multi-cabang.",
  },
];

const STEPS = [
  {
    title: "Unduh & pasang installer",
    description:
      "Klik Unduh Installer Windows, lalu jalankan file .exe. Windows SmartScreen mungkin meminta konfirmasi karena installer belum ditandatangani secara digital — pilih “More info” → “Run anyway”.",
  },
  {
    title: "Masukkan kode toko",
    description:
      "Buka aplikasi, tempel Kode Toko Anda di layar Koneksi Toko. Alamat layar kasir akan muncul otomatis, lalu tekan Buka Layar Kasir.",
  },
  {
    title: "Pilih printer & tes cetak",
    description:
      "Pilih printer thermal dari daftar printer terpasang, aktifkan Silent Print, lalu tekan Tes Cetak Struk sebelum menerima pesanan pertama.",
  },
];

export default function DesktopAppPage() {
  const [profile, setProfile] = useState<RestaurantProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get("/admin/restaurant");
      setProfile(res.data?.data ?? null);
    } catch (error) {
      console.error("Failed to load restaurant profile:", error);
      toast.error("Gagal memuat kode toko");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) void loadProfile();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const copyStoreCode = async () => {
    if (!profile?.slug) return;
    try {
      await navigator.clipboard.writeText(profile.slug);
      setCopied(true);
      toast.success("Kode toko disalin");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Gagal menyalin kode toko");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Aplikasi Kasir Desktop</h1>
          <p className="text-gray-500">
            Aplikasi native untuk kasir: cetak struk thermal otomatis, shortcut
            keyboard, dan sesi login yang tetap tersimpan.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600">
          <Monitor className="h-3.5 w-3.5" />
          Windows 10/11 · 64-bit
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Installer */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" /> Unduh Installer Windows (.exe)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              Installer berisi aplikasi kasir RestoPOS lengkap dengan dukungan
              printer thermal. Ukuran unduhan ±80–120 MB, tidak perlu memasang
              Node.js atau komponen tambahan.
            </p>

            {INSTALLER_URL ? (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={INSTALLER_URL}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-primary px-5 text-sm font-semibold text-brand-primary-foreground shadow-sm transition-opacity hover:opacity-90"
                >
                  <Download className="h-4 w-4" />
                  Unduh Installer Windows
                </a>
                <span className="text-xs text-gray-500">
                  Versi terbaru · NSIS installer · 64-bit
                </span>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-900">
                  Installer belum dipublikasikan
                </p>
                <p className="text-xs leading-relaxed text-amber-800">
                  Build installer dijalankan otomatis lewat GitHub Actions
                  (workflow <code>build-desktop.yml</code>) pada runner Windows.
                  Setelah build pertama selesai, salin tautan file{" "}
                  <code>.exe</code> ke variabel <code>NEXT_PUBLIC_DESKTOP_WIN_URL</code>{" "}
                  agar tombol unduh aktif di sini.
                </p>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 underline underline-offset-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Buka halaman rilis GitHub
                </a>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs leading-relaxed text-gray-600">
                <span className="font-semibold text-gray-700">Catatan instalasi:</span>{" "}
                installer belum ditandatangani sertifikat code-signing, sehingga
                Windows dapat menampilkan peringatan SmartScreen. Pilih{" "}
                <span className="font-medium">More info → Run anyway</span>.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Store code */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" /> Kode Subdomain Toko
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">
              Masukkan kode ini saat pertama kali membuka aplikasi desktop.
            </p>

            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">
                    Kode Toko Anda
                  </p>
                  <p className="mt-1 break-all font-mono text-xl font-bold text-brand-primary">
                    {profile?.slug || "—"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={copyStoreCode}
                  disabled={!profile?.slug}
                >
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" /> Tersalin
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" /> Salin Kode Toko
                    </>
                  )}
                </Button>
                {profile?.subdomainEnabled && profile.subdomainUrl && (
                  <a
                    href={profile.subdomainUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {profile.subdomainUrl}
                  </a>
                )}
                <p className="text-[11px] leading-relaxed text-gray-400">
                  Kode toko bersifat permanen dan sama dengan alamat subdomain
                  toko Anda.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle>Keunggulan Kasir Desktop</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="flex gap-3 rounded-lg border border-gray-200 p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-secondary text-brand-primary">
                  <feature.icon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{feature.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Steps + shortcuts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Panduan Penggunaan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {STEPS.map((step, index) => (
              <div key={step.title} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-brand-primary-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs leading-relaxed text-blue-800">
                <span className="font-semibold">Pindah toko atau ganti printer:</span>{" "}
                tekan <kbd className="rounded border border-blue-300 bg-white px-1">Ctrl</kbd>{" "}
                + <kbd className="rounded border border-blue-300 bg-white px-1">Shift</kbd>{" "}
                + <kbd className="rounded border border-blue-300 bg-white px-1">S</kbd>{" "}
                di dalam aplikasi untuk kembali ke layar Koneksi Toko.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" /> Shortcut Kasir
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { keys: "F11", label: "Layar penuh / keluar" },
              { keys: "F5", label: "Muat ulang layar kasir" },
              { keys: "Ctrl + R", label: "Muat ulang layar kasir" },
              { keys: "Ctrl + Shift + S", label: "Ganti toko / printer" },
            ].map((shortcut) => (
              <div
                key={shortcut.keys}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
              >
                <span className="text-xs text-gray-600">{shortcut.label}</span>
                <kbd className="shrink-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
