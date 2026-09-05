"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Link2, Image as ImageIcon, Trash2 } from "lucide-react";
import {
  PRODUCT_IMAGE_ALLOWED_MIME,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_MB,
  isAllowedImageMime,
} from "@/lib/product-image";

// ============================================================
// ProductImageValue — the single source of truth for the product
// form's image state. Parent keeps it in React state and resolves
// the final payload when the form is saved:
//
//   { kind: "empty" }              → no image (create) / remove (edit)
//   { kind: "saved", url }         → existing DB image, untouched (edit only)
//   { kind: "file", file }         → new local file, upload on save
//   { kind: "url", url }           → typed URL (validated on save)
// ============================================================

export type ProductImageValue =
  | { kind: "empty" }
  | { kind: "saved"; url: string }
  | { kind: "file"; file: File }
  | { kind: "url"; url: string };

export function isProductImageEmpty(v: ProductImageValue): boolean {
  return v.kind === "empty";
}

/** Build the initial state from a product's persisted imageUrl. */
export function productImageValueFromUrl(
  imageUrl?: string | null
): ProductImageValue {
  return imageUrl ? { kind: "saved", url: imageUrl } : { kind: "empty" };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============================================================
// Component
// ============================================================

interface ProductImageFieldProps {
  value: ProductImageValue;
  onChange: (next: ProductImageValue) => void;
  disabled?: boolean;
}

export function ProductImageField({
  value,
  onChange,
  disabled,
}: ProductImageFieldProps) {
  const [mode, setMode] = useState<"upload" | "url" | null>(
    value.kind === "file"
      ? "upload"
      : value.kind === "url"
        ? "url"
        : null
  );
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [broken, setBroken] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Cleanup any object URL we created when unmounting.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const hasImage = value.kind !== "empty";

  // Source shown in the preview. Only render valid http(s)/local URLs —
  // never data:/javascript: or malformed input.
  const previewUrl = useMemo(() => {
    if (value.kind === "saved") return value.url;
    if (value.kind === "url") {
      const u = value.url.trim();
      if (!u) return null;
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return null;
        }
        return u;
      } catch {
        return null;
      }
    }
    if (value.kind === "file") {
      if (!blobUrlRef.current) {
        blobUrlRef.current = URL.createObjectURL(value.file);
      }
      return blobUrlRef.current;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // When the value stops referencing the current blob, free it.
  useEffect(() => {
    if (value.kind !== "file" && blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (value.kind !== "file") setBroken(false);
  }, [value]);

  const resetError = () => setError(null);

  const validateAndSelectFile = useCallback(
    (file: File | undefined | null) => {
      resetError();
      if (!file) return;
      if (!isAllowedImageMime(file.type)) {
        setError(
          "Tipe file tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF."
        );
        return;
      }
      if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
        setError(
          `Ukuran file melebihi batas maksimal ${PRODUCT_IMAGE_MAX_MB} MB.`
        );
        return;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setBroken(false);
      onChange({ kind: "file", file });
    },
    [onChange]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    validateAndSelectFile(file);
    // Allow re-selecting the same file later.
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    validateAndSelectFile(e.dataTransfer.files?.[0]);
  };

  const handleUrlChange = (raw: string) => {
    resetError();
    setBroken(false);
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange({ kind: "empty" });
      return;
    }
    onChange({ kind: "url", url: raw });
  };

  const handleRemove = () => {
    resetError();
    onChange({ kind: "empty" });
  };

  const urlIsVisible = value.kind === "url" && value.url.trim().length > 0;
  const urlLooksInvalid = useMemo(() => {
    if (!urlIsVisible) return false;
    try {
      const parsed = new URL(value.url.trim());
      return parsed.protocol !== "http:" && parsed.protocol !== "https:";
    } catch {
      return true;
    }
  }, [urlIsVisible, value]);

  return (
    <div className="space-y-3">
      {/* Label */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Gambar Produk</span>
        {value.kind === "file" && (
          <span className="text-xs text-gray-500">
            {value.file.name} · {formatFileSize(value.file.size)}
          </span>
        )}
      </div>

      {/* Preview */}
      <div
        className={cn(
          "relative w-full aspect-[4/3] overflow-hidden rounded-lg border bg-gray-50 flex items-center justify-center",
          dragging && "border-blue-400 bg-blue-50"
        )}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {previewUrl && !broken ? (
          // Broken/remote previews fall back to the placeholder below.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Preview gambar produk"
            className="w-full h-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-gray-400 select-none">
            <ImageIcon className="h-8 w-8" strokeWidth={1.5} />
            <span className="text-xs">
              {previewUrl && broken
                ? "Gambar tidak dapat ditampilkan"
                : "Belum ada gambar"}
            </span>
          </div>
        )}
      </div>

      {/* Mode buttons */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "upload" ? "default" : "outline"}
          disabled={disabled}
          onClick={() => {
            resetError();
            setMode("upload");
            // Open the file picker right away.
            requestAnimationFrame(() => fileInputRef.current?.click());
          }}
        >
          <Upload className="h-4 w-4 mr-1.5" />
          {value.kind === "file" ? "Ganti Gambar" : "Upload Gambar"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "url" ? "default" : "outline"}
          disabled={disabled}
          onClick={() => {
            resetError();
            setMode("url");
            requestAnimationFrame(() => urlInputRef.current?.focus());
          }}
        >
          <Link2 className="h-4 w-4 mr-1.5" />
          Gunakan URL
        </Button>
        {hasImage && !disabled && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-red-500 hover:text-red-700 hover:bg-red-50 ml-auto"
            onClick={handleRemove}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Hapus Gambar
          </Button>
        )}
      </div>

      {/* Hidden file input + URL input panel */}
      {mode === "upload" && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={PRODUCT_IMAGE_ALLOWED_MIME.join(",")}
            className="hidden"
            disabled={disabled}
            onChange={handleFileChange}
          />
          {value.kind !== "file" ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 px-3 py-5 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
            >
              {dragging
                ? "Lepaskan file di sini…"
                : "Klik atau seret gambar ke sini untuk mengupload"}
            </button>
          ) : (
            <div className="flex items-center justify-between rounded-lg border bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <span className="truncate mr-2">File siap diupload</span>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Ganti
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-red-500 hover:text-red-700"
                  disabled={disabled}
                  onClick={handleRemove}
                >
                  Hapus
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "url" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              ref={urlInputRef}
              type="text"
              inputMode="url"
              placeholder="https://example.com/gambar.jpg"
              value={value.kind === "url" ? value.url : ""}
              disabled={disabled}
              aria-invalid={urlLooksInvalid || !!error}
              onChange={(e) => handleUrlChange(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          {!error && urlLooksInvalid && (
            <p className="text-xs text-red-500">
              URL tidak valid — hanya http/https yang diperbolehkan.
            </p>
          )}
          {!error && !urlLooksInvalid && urlIsVisible && (
            <p className="text-xs text-gray-400">
              URL disimpan langsung sebagai sumber gambar produk.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400">
        JPG, PNG, WEBP, atau GIF — maksimal {PRODUCT_IMAGE_MAX_MB} MB.
      </p>
    </div>
  );
}
