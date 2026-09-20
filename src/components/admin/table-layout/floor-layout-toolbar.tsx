"use client";

import { Button } from "@/components/ui/button";
import {
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  TriangleAlert,
} from "lucide-react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

interface FloorLayoutToolbarProps {
  dirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onReload: () => void;
  onReset: () => void;
  onCreateTable: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

/**
 * Toolbar: table creation, save/reload/reset and the zoom controls. No API
 * logic here — the editor owns the handlers. Save is disabled while nothing
 * changed or a save is in flight (no autosave; explicit only).
 */
export function FloorLayoutToolbar({
  dirty,
  isSaving,
  onSave,
  onReload,
  onReset,
  onCreateTable,
  zoom,
  onZoomChange,
}: FloorLayoutToolbarProps) {
  const step = (amount: number) =>
    onZoomChange(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + amount)));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={onCreateTable}>
        <Plus className="h-4 w-4 mr-1.5" />
        Tambah Meja
      </Button>

      <Button
        type="button"
        onClick={onSave}
        disabled={!dirty || isSaving}
        title={dirty ? "Simpan perubahan layout" : "Tidak ada perubahan untuk disimpan"}
      >
        {isSaving ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Save className="h-4 w-4 mr-1.5" />
        )}
        Simpan
      </Button>

      <Button type="button" variant="outline" onClick={onReload} title="Muat ulang layout terbaru dari server">
        <RefreshCw className="h-4 w-4 mr-1.5" />
        Muat Ulang
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={onReset}
        disabled={!dirty}
        title="Buang perubahan lokal (kembali ke layout tersimpan)"
      >
        <Undo2 className="h-4 w-4 mr-1.5" />
        Reset
      </Button>

      {dirty && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800" aria-live="polite">
          <TriangleAlert className="h-3.5 w-3.5" />
          Ada perubahan belum disimpan
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => step(-0.1)}
          title="Perkecil"
          aria-label="Perkecil zoom"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-14 text-center text-xs font-medium text-gray-600 tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => step(0.1)}
          title="Perbesar"
          aria-label="Perbesar zoom"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onZoomChange(1)}
          title="Kembalikan zoom ke 100% (fit canvas)"
          aria-label="Reset zoom canvas"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}