"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquare, Upload, Trash2, Palette, Store, Loader2, MapPin } from "lucide-react";
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

// ============================================================
// Website Branding — Admin Settings
//
// Local state drives the form + live preview; NOTHING is persisted until
// "Save Changes" (a single PUT to /api/admin/settings/branding). Logo
// replacement deletes the old physical file server-side (path-guarded,
// tenant-confined). Colors are validated client-side AND server-side as
// strict #RRGGBB hex — arbitrary CSS never reaches the DOM.
// ============================================================

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
  primaryColor,
  secondaryColor,
  accentColor,
}: {
  siteName: string;
  logoUrl: string | null;
  logoFile: File | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}) {
  const [broken, setBroken] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const prevFileRef = useRef<File | null>(null);

  // Keep exactly one object URL per selected file (revoke on change/unmount).
  useEffect(() => {
    if (logoFile !== prevFileRef.current) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      blobUrlRef.current = logoFile ? URL.createObjectURL(logoFile) : null;
      prevFileRef.current = logoFile;
      setBroken(false);
    }
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
        blobUrlRef.current = null;
      }
    };
  }, [logoFile]);

  // Preview source: selected file > saved logo > none.
  const previewUrl = useMemo(() => {
    if (logoFile) return blobUrlRef.current;
    return logoUrl;
  }, [logoFile, logoUrl]);

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

  useEffect(() => {
    loadBranding();
  }, [loadBranding]);

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
        applyBranding({
          siteName: b.siteName,
          logoUrl: b.logoUrl,
          primaryColor: b.primaryColor,
          secondaryColor: b.secondaryColor,
          accentColor: b.accentColor,
        });
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ===== Website Branding ===== */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Website Branding
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