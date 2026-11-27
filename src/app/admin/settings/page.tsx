"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MessageSquare,
  Upload,
  Trash2,
  Palette,
  Store,
  Loader2,
  MapPin,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import api from "@/lib/axios";
import {
  BRANDING_COLOR_REGEX,
  BRANDING_LOGO_ALLOWED_MIME,
  BRANDING_LOGO_MAX_BYTES,
  BRANDING_LOGO_MAX_MB,
  BRANDING_SITE_NAME_MAX_LENGTH,
  getContrastText,
  isAllowedBrandingLogoMime,
  normalizeBrandingColor,
} from "@/lib/branding";
import { useBranding } from "@/hooks/use-branding";

// Same key as use-admin-branding.tsx — cross-tab sync channel only (storage
// event). The database (RestaurantSettings) remains the source of truth.
const ADMIN_BRANDING_STORAGE_KEY = "admin.branding.latest";

// ============================================================
// Website Branding — Admin Settings
//
// Local state drives the form + live preview; NOTHING is persisted until
// "Save Changes" (a single PUT to /api/admin/settings/branding). Logo
// replacement deletes the old physical file server-side (path-guarded,
// tenant-confined). Colors are validated client-side AND server-side as
// strict #RRGGBB hex — arbitrary CSS never reaches the DOM.
// ============================================================

interface RestaurantProfile {
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  storeUrl?: string;
  /** `https://<slug>.<ROOT_DOMAIN>` (or the /r/<slug> fallback). */
  subdomainUrl?: string;
  /** False when the app is reached via raw IP / no root domain. */
  subdomainEnabled?: boolean;
}

interface DeliverySettings {
  deliveryEnabled: boolean;
  deliveryProvider: "MOCK" | "BITESHIP" | "GRABEXPRESS";
  deliveryApiKeyMasked: string | null;
  hasApiKey: boolean;
  deliveryAutoDispatchOn: "PAID" | "READY";
}

interface BrandingData {
  siteName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

interface BrandingColorName {
  key: "primaryColor" | "secondaryColor" | "accentColor";
  label: string;
  description: string;
}

const COLOR_FIELDS: BrandingColorName[] = [
  {
    key: "primaryColor",
    label: "Warna Utama",
    description: "Tombol utama, header, dan aksen brand",
  },
  {
    key: "secondaryColor",
    label: "Warna Pendukung",
    description: "Tombol sekunder dan latar",
  },
  {
    key: "accentColor",
    label: "Warna Aksen",
    description: "Hover dan penekanan interaktif",
  },
];

// ============================================================
// Logo state: existing URL, a new local file, or removal
// ============================================================

type LogoState =
  | { kind: "saved"; url: string }
  | { kind: "file"; file: File }
  | { kind: "none" }; // nothing, or explicitly removed

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============================================================
// Color input (native picker + validated hex text field)
// ============================================================

function ColorField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const handleText = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setError(null);
      onChange("");
      return;
    }
    if (!BRANDING_COLOR_REGEX.test(trimmed)) {
      setError("Format tidak valid — gunakan #RRGGBB (contoh: #111827)");
      return;
    }
    setError(null);
    onChange(normalizeBrandingColor(trimmed));
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="text-xs text-gray-400">{description}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="relative h-9 w-11 shrink-0 overflow-hidden rounded-md border border-gray-200">
          <input
            type="color"
            value={BRANDING_COLOR_REGEX.test(value) ? value : "#111827"}
            onChange={(e) => {
              setError(null);
              onChange(e.target.value);
            }}
            className="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] cursor-pointer border-0 bg-transparent p-0"
            aria-label={`Pilih warna ${label}`}
          />
        </div>
        <Input
          type="text"
          inputMode="text"
          maxLength={7}
          placeholder="#RRGGBB"
          value={value}
          aria-invalid={!!error}
          onChange={(e) => handleText(e.target.value)}
          className="w-32 font-mono"
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ============================================================
// Live preview — reflects UNSAVED local state only
// ============================================================

function BrandingPreview({
  siteName,
  logoUrl,
  logoFile,
  formLogoBlobUrl,
  primaryColor,
  secondaryColor,
  accentColor,
}: {
  siteName: string;
  logoUrl: string | null;
  logoFile: File | null;
  /** Object URL for `logoFile`, owned by the parent (created in its onChange
      event handler, revoked there / on unmount) — no effect-state juggling
      inside the preview component. */
  formLogoBlobUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}) {
  const [broken, setBroken] = useState(false);

  // Preview source: selected file (parent-owned object URL) > saved logo > none.
  const previewUrl = logoFile ? formLogoBlobUrl : logoUrl;

  const validPrimary = BRANDING_COLOR_REGEX.test(primaryColor);
  const validSecondary = BRANDING_COLOR_REGEX.test(secondaryColor);
  const validAccent = BRANDING_COLOR_REGEX.test(accentColor);
  const primary = validPrimary ? primaryColor : "#111827";
  const secondary = validSecondary ? secondaryColor : "#f3f4f6";
  const accent = validAccent ? accentColor : "#e5e7eb";
  const primaryFg = getContrastText(primary);
  const secondaryFg = getContrastText(secondary);

  return (
    <div className="overflow-hidden rounded-xl border-2" style={{ borderColor: primary }}>
      {/* Mock header */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-white px-4 py-2.5">
        {previewUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Preview logo"
            className="h-6 w-6 rounded object-contain"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="text-lg">🍽️</span>
        )}
        <span className="text-sm font-bold" style={{ color: primary }}>
          {siteName.trim() || "Nama Website"}
        </span>
      </div>
      {/* Mock content */}
      <div className="space-y-2 bg-gray-50 p-4">
        <div
          className="flex h-9 items-center justify-center rounded-lg text-xs font-semibold"
          style={{ backgroundColor: primary, color: primaryFg }}
        >
          Tombol Utama
        </div>
        <div
          className="flex h-9 items-center justify-center rounded-lg text-xs font-semibold transition-colors"
          style={{ backgroundColor: secondary, color: secondaryFg }}
        >
          Tombol Pendukung
        </div>
        <div
          className="flex h-6 items-center justify-center rounded-full text-[10px] font-medium"
          style={{ backgroundColor: accent, color: getContrastText(accent) }}
        >
          Aksen
        </div>
        <p className="pt-1 text-center text-[10px] text-gray-400">
          Pratinjau — perubahan tersimpan saat menekan Simpan
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Main page
// ============================================================

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [logo, setLogo] = useState<LogoState>({ kind: "none" });
  const [colors, setColors] = useState({
    primaryColor: "#111827",
    secondaryColor: "#f3f4f6",
    accentColor: "#e5e7eb",
  });
  const [restaurantName, setRestaurantName] = useState<string | null>(null);

  // Phase 2 — tenant profile (name / contact + immutable public slug).
  const [profile, setProfile] = useState<RestaurantProfile | null>(null);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  // Phase 3 — instant delivery (BYOK). The API key is write-only: GET returns
  // a masked value ("****1234"), never the secret.
  const [delivery, setDelivery] = useState<DeliverySettings | null>(null);
  const [isDeliverySaving, setIsDeliverySaving] = useState(false);

  // Same BrandingProvider context the admin shell renders from — a save
  // re-themes the whole admin UI instantly (no reload / no rebuild).
  const { applyBranding } = useBranding();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBranding = useCallback(async () => {
    try {
      const res = await api.get("/admin/settings/branding");
      const data = res.data?.data;
      if (data) {
        setRestaurantName(data.restaurantName ?? null);
        const b: BrandingData = data.branding;
        setSiteName(b.siteName ?? "");
        setLogo(b.logoUrl ? { kind: "saved", url: b.logoUrl } : { kind: "none" });
        setColors({
          primaryColor: b.primaryColor,
          secondaryColor: b.secondaryColor,
          accentColor: b.accentColor,
        });
      }
    } catch (error) {
      console.error("Failed to load branding:", error);
      toast.error("Gagal memuat pengaturan branding");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get("/admin/restaurant");
      setProfile(res.data?.data ?? null);
    } catch (error) {
      console.error("Failed to load restaurant profile:", error);
      toast.error("Gagal memuat profil restoran");
    }
  }, []);

  const loadDelivery = useCallback(async () => {
    try {
      const res = await api.get("/admin/settings/delivery");
      const data = res.data?.data;
      // Phase 4 — third-party couriers are temporarily hidden. A legacy
      // Biteship/GrabExpress configuration is displayed (and re-saved) as the
      // internal MOCK mode; the provider code itself is untouched.
      if (data && data.deliveryProvider !== "MOCK") {
        data.deliveryProvider = "MOCK";
      }
      setDelivery(data ?? null);
    } catch (error) {
      console.error("Failed to load delivery settings:", error);
      toast.error("Gagal memuat pengaturan pengiriman");
    }
  }, []);

  const saveDelivery = async () => {
    if (!delivery) return;
    setIsDeliverySaving(true);
    try {
      // Provider is fixed to the internal MOCK mode while third-party
      // couriers are hidden (the server enforces the same rule).
      const res = await api.patch("/admin/settings/delivery", {
        deliveryEnabled: delivery.deliveryEnabled,
        deliveryProvider: "MOCK",
        deliveryAutoDispatchOn: delivery.deliveryAutoDispatchOn,
      });
      setDelivery(res.data?.data ?? delivery);
      toast.success("Pengaturan pengiriman berhasil disimpan");
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || "Gagal menyimpan pengaturan pengiriman";
      toast.error(message);
    } finally {
      setIsDeliverySaving(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    if (profile.name.trim().length < 2) {
      toast.error("Nama restoran minimal 2 karakter");
      return;
    }
    setIsProfileSaving(true);
    try {
      const res = await api.patch("/admin/restaurant", {
        name: profile.name.trim(),
        address: profile.address?.trim() || null,
        phone: profile.phone?.trim() || null,
        email: profile.email?.trim() || null,
      });
      setProfile(res.data?.data ?? profile);
      toast.success("Profil restoran berhasil disimpan");
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || "Gagal menyimpan profil restoran";
      toast.error(message);
    } finally {
      setIsProfileSaving(false);
    }
  };

  /** Canonical storefront address (subdomain when available). */
  const storeUrl = profile
    ? profile.subdomainEnabled && profile.subdomainUrl
      ? profile.subdomainUrl
      : `/r/${profile.slug}`
    : "";

  const copyStoreUrl = async () => {
    if (!storeUrl) return;
    try {
      const absolute = storeUrl.startsWith("http")
        ? storeUrl
        : `${window.location.origin}${storeUrl}`;
      await navigator.clipboard.writeText(absolute);
      toast.success("Link toko disalin");
    } catch {
      toast.error("Gagal menyalin link");
    }
  };

  // Initial branding load — the setState calls all happen inside the async
  // loadBranding continuation (never synchronously in the effect body).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) {
        void loadBranding();
        void loadProfile();
        void loadDelivery();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBranding, loadProfile, loadDelivery]);

  const handleSave = async () => {
    // Client-side validation before touching the network.
    if (siteName.trim().length > BRANDING_SITE_NAME_MAX_LENGTH) {
      toast.error(`Nama website maksimal ${BRANDING_SITE_NAME_MAX_LENGTH} karakter`);
      return;
    }
    const colorEntries = Object.entries(colors) as Array<
      [keyof typeof colors, string]
    >;
    for (const [, value] of colorEntries) {
      if (!BRANDING_COLOR_REGEX.test(value)) {
        toast.error("Warna harus dalam format #RRGGBB (contoh: #111827)");
        return;
      }
    }

    setIsSaving(true);
    try {
      // 1. Upload a newly selected logo (if any) — server validates magic bytes.
      let logoUrl: string | null | undefined;
      if (logo.kind === "file") {
        const fd = new FormData();
        fd.append("file", logo.file);
        const up = await api.post("/admin/uploads/branding", fd, {
          headers: { "Content-Type": undefined },
        });
        logoUrl = up.data?.data?.url ?? null;
        if (!logoUrl) {
          throw new Error("Upload logo gagal");
        }
      } else if (logo.kind === "none") {
        // Explicitly removed (or never set): clear the stored logo.
        logoUrl = null;
      }

      // 2. Persist branding — replacing a logo deletes the old file server-side.
      const payload: Record<string, string | null> = {
        siteName: siteName.trim() || null,
        primaryColor: normalizeBrandingColor(colors.primaryColor),
        secondaryColor: normalizeBrandingColor(colors.secondaryColor),
        accentColor: normalizeBrandingColor(colors.accentColor),
      };
      if (logoUrl !== undefined) payload.logoUrl = logoUrl;

      const res = await api.put("/admin/settings/branding", payload);
      if (res.data?.data) {
        const b: BrandingData = res.data.data;
        setSiteName(b.siteName ?? "");
        setLogo(b.logoUrl ? { kind: "saved", url: b.logoUrl } : { kind: "none" });
        setColors({
          primaryColor: b.primaryColor,
          secondaryColor: b.secondaryColor,
          accentColor: b.accentColor,
        });
        // Live-apply to the WHOLE admin shell (sidebar, buttons, accents)
        // through the existing BrandingProvider context — no reload, no
        // rebuild, no second theme system. Customer pages pick the new
        // branding up on their next load via their existing sync.
        const savedBranding = {
          siteName: b.siteName,
          logoUrl: b.logoUrl,
          primaryColor: b.primaryColor,
          secondaryColor: b.secondaryColor,
          accentColor: b.accentColor,
        };
        applyBranding(savedBranding);
        // Sync every OTHER open tab (kasir/admin/dashboard share this
        // provider) via the storage event — no polling; localStorage is only
        // a sync channel, RestaurantSettings stays the source of truth.
        try {
          localStorage.setItem(
            ADMIN_BRANDING_STORAGE_KEY,
            JSON.stringify(savedBranding)
          );
        } catch {
          // Storage unavailable (private mode/quota) — tabs still converge on
          // their next load through the provider's initial fetch.
        }
      }
      toast.success("Branding website berhasil disimpan");
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || "Gagal menyimpan branding";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const logoPreviewUrl = logo.kind === "saved" ? logo.url : null;
  const logoFile = logo.kind === "file" ? logo.file : null;
  // Managed blob URL for the form preview — created/revoked with the file.
  const [formLogoBlobUrl, setFormLogoBlobUrl] = useState<string | null>(null);
  const formBlobCleanup = useRef<string | null>(null);

  const updateFormLogoBlob = (file: File | null) => {
    if (formBlobCleanup.current) {
      URL.revokeObjectURL(formBlobCleanup.current);
      formBlobCleanup.current = null;
    }
    if (file) {
      formBlobCleanup.current = URL.createObjectURL(file);
    }
    setFormLogoBlobUrl(file ? formBlobCleanup.current : null);
  };

  useEffect(() => {
    return () => {
      if (formBlobCleanup.current) {
        URL.revokeObjectURL(formBlobCleanup.current);
        formBlobCleanup.current = null;
      }
    };
  }, []);

  const handleFileSelect = (file: File | undefined | null) => {
    if (!file) return;
    if (!isAllowedBrandingLogoMime(file.type)) {
      toast.error("Tipe file tidak didukung. Gunakan PNG, JPEG, atau WebP.");
      return;
    }
    if (file.size > BRANDING_LOGO_MAX_BYTES) {
      toast.error(`Ukuran file melebihi batas maksimal ${BRANDING_LOGO_MAX_MB} MB.`);
      return;
    }
    setLogo({ kind: "file", file });
    updateFormLogoBlob(file);
  };

  const handleRemoveLogo = () => {
    setLogo({ kind: "none" });
    updateFormLogoBlob(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Pengaturan</h1>
        <p className="text-gray-500">Pengaturan sistem dan tampilan website</p>
      </div>

      {/* ===== Profil Restoran (multi-tenant) ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" /> Profil Restoran
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Nama Restoran</Label>
              <Input
                id="profile-name"
                value={profile?.name ?? ""}
                onChange={(e) =>
                  setProfile((prev) =>
                    prev ? { ...prev, name: e.target.value } : prev
                  )
                }
                maxLength={120}
                disabled={!profile}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-slug">URL Subdomain Toko</Label>
              <div className="flex gap-2">
                <Input
                  id="profile-slug"
                  value={
                    profile?.subdomainEnabled && profile.subdomainUrl
                      ? profile.subdomainUrl
                      : profile
                        ? `/r/${profile.slug}`
                        : ""
                  }
                  readOnly
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={copyStoreUrl}
                  disabled={!profile}
                >
                  Salin Link
                </Button>
                {profile?.subdomainEnabled && profile.subdomainUrl && (
                  <a
                    href={profile.subdomainUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Buka Toko
                  </a>
                )}
              </div>
              <p className="text-[11px] text-gray-500">
                {profile?.subdomainEnabled && profile.subdomainUrl ? (
                  <>
                    Link alternatif: <code>/r/{profile.slug}</code>.{" "}
                  </>
                ) : null}
                Slug bersifat permanen agar QR meja dan link yang sudah
                dibagikan tetap berlaku.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="profile-address">Alamat</Label>
              <Input
                id="profile-address"
                value={profile?.address ?? ""}
                onChange={(e) =>
                  setProfile((prev) =>
                    prev ? { ...prev, address: e.target.value } : prev
                  )
                }
                maxLength={300}
                placeholder="Jl. Contoh No. 123, Jakarta"
                disabled={!profile}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-phone">No. Telepon</Label>
              <Input
                id="profile-phone"
                type="tel"
                value={profile?.phone ?? ""}
                onChange={(e) =>
                  setProfile((prev) =>
                    prev ? { ...prev, phone: e.target.value } : prev
                  )
                }
                maxLength={30}
                placeholder="081234567890"
                disabled={!profile}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={profile?.email ?? ""}
                onChange={(e) =>
                  setProfile((prev) =>
                    prev ? { ...prev, email: e.target.value } : prev
                  )
                }
                maxLength={190}
                placeholder="info@resto.id"
                disabled={!profile}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSaveProfile}
              disabled={!profile || isProfileSaving}
            >
              {isProfileSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...
                </>
              ) : (
                "Simpan Profil"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== Pengiriman Instan (GrabExpress / Biteship) ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" /> Pengiriman Instan (GrabExpress / Biteship)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!delivery ? (
            <div className="flex items-center justify-center py-6 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Enable toggle */}
              <label className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3 cursor-pointer">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    Aktifkan Pengiriman Instan
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Pelanggan dapat memesan tipe Delivery dan memanggil kurir
                    otomatis. Setiap cabang wajib memiliki koordinat.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={delivery.deliveryEnabled}
                  onChange={(e) =>
                    setDelivery({ ...delivery, deliveryEnabled: e.target.checked })
                  }
                  className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="delivery-provider">Provider Kurir</Label>
                  <select
                    id="delivery-provider"
                    value={delivery.deliveryProvider}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        deliveryProvider: e.target.value as DeliverySettings["deliveryProvider"],
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  >
                    <option value="MOCK">Internal — simulasi ongkir &amp; driver</option>
                  </select>
                  <p className="text-[11px] text-gray-500">
                    Mode internal menghitung ongkir dan membuat driver
                    simulasi, sehingga alur bisa dites tanpa biaya.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="delivery-dispatch">Pemicu Panggil Driver</Label>
                  <select
                    id="delivery-dispatch"
                    value={delivery.deliveryAutoDispatchOn}
                    onChange={(e) =>
                      setDelivery({
                        ...delivery,
                        deliveryAutoDispatchOn: e.target.value as DeliverySettings["deliveryAutoDispatchOn"],
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  >
                    <option value="PAID">Saat Lunas (webhook pembayaran)</option>
                    <option value="READY">Saat Makanan Siap (status READY)</option>
                  </select>
                  <p className="text-[11px] text-gray-500">
                    Jika pemanggilan gagal, status pengiriman menjadi Gagal dan
                    kasir dapat menekan “Panggil Ulang Driver”.
                  </p>
                </div>
              </div>

              <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Integrasi kurir pihak ketiga (Biteship/GrabExpress) akan segera
                hadir. Saat ini pengiriman berjalan dengan mode internal
                (simulasi ongkir &amp; driver), tanpa API key.
              </p>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="text-[11px] text-gray-500">
                  Webhook status kurir: <code>/api/webhooks/delivery</code>
                  {" "}— set <code>DELIVERY_WEBHOOK_SECRET</code> di server untuk
                  provider nyata.
                </p>
                <Button
                  type="button"
                  onClick={() => saveDelivery()}
                  disabled={isDeliverySaving}
                >
                  {isDeliverySaving && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Simpan Pengiriman
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ===== Website Branding ===== */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Tampilan Website
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <>
                {/* Site name */}
                <div className="space-y-1.5">
                  <Label htmlFor="site-name">Nama Website / Restoran</Label>
                  <Input
                    id="site-name"
                    type="text"
                    maxLength={BRANDING_SITE_NAME_MAX_LENGTH}
                    value={siteName}
                    placeholder={restaurantName ?? "Nama website"}
                    onChange={(e) => setSiteName(e.target.value)}
                  />
                  <p className="text-xs text-gray-400">
                    Kosongkan untuk memakai nama restoran ({restaurantName ?? "-"}).
                  </p>
                </div>

                {/* Logo */}
                <div className="space-y-2">
                  <Label>Logo</Label>
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                      {logoPreviewUrl || logoFile ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logoFile ? formLogoBlobUrl || undefined : logoPreviewUrl!}
                          alt="Logo preview"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Store className="h-6 w-6 text-gray-300" />
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={BRANDING_LOGO_ALLOWED_MIME.join(",")}
                          className="hidden"
                          onChange={(e) => {
                            handleFileSelect(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="h-4 w-4 mr-1.5" />
                          {logo.kind === "file" ? "Ganti File" : "Upload Logo"}
                        </Button>
                        {(logo.kind === "saved" || logo.kind === "file") && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={handleRemoveLogo}
                          >
                            <Trash2 className="h-4 w-4 mr-1.5" />
                            Hapus
                          </Button>
                        )}
                      </div>
                      {logo.kind === "file" && (
                        <span className="text-xs text-gray-500">
                          {logo.file.name} · {formatFileSize(logo.file.size)} —
                          akan diupload saat Simpan
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    PNG, JPEG, atau WebP — maksimal {BRANDING_LOGO_MAX_MB} MB.
                  </p>
                </div>

                {/* Colors */}
                <div className="space-y-4">
                  <Label>Warna Tema</Label>
                  {COLOR_FIELDS.map((field) => (
                    <ColorField
                      key={field.key}
                      label={field.label}
                      description={field.description}
                      value={colors[field.key]}
                      onChange={(next) =>
                        setColors((prev) => ({ ...prev, [field.key]: next }))
                      }
                    />
                  ))}
                </div>

                {/* Save */}
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                  >
                    {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {isSaving ? "Menyimpan..." : "Simpan Perubahan"}
                  </Button>
                  <span className="text-xs text-gray-400">
                    Perubahan hanya tersimpan saat menekan Simpan
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ===== Side column: preview + WhatsApp ===== */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4" />
                Pratinjau
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <BrandingPreview
                  siteName={siteName}
                  logoUrl={logoPreviewUrl}
                  logoFile={logoFile}
                  formLogoBlobUrl={formLogoBlobUrl}
                  primaryColor={colors.primaryColor}
                  secondaryColor={colors.secondaryColor}
                  accentColor={colors.accentColor}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Cabang / Outlet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-500 mb-4">
                Kelola outlet dan kode cabang (untuk QR meja).
              </p>
              <Link href="/admin/settings/branches">
                <Button variant="outline" className="w-full">
                  Kelola Cabang
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                WhatsApp
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-500 mb-4">
                Kelola koneksi WhatsApp restoran.
              </p>
              <Link href="/admin/whatsapp">
                <Button variant="outline" className="w-full">
                  Kelola WhatsApp
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}