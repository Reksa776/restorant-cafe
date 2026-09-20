"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { tableService, type RestaurantTable } from "@/services/table.service";
import { layoutService, type BranchLayoutView } from "@/services/layout.service";
import {
  getErrorCode,
  getErrorMessage,
  getErrorStatus,
  isUnauthorized,
  normalizeApiError,
} from "@/lib/api-error-handler";
import {
  findFreeSpot,
  itemListsEqual,
  moveTable,
  normalizeRotation,
  resizeTable,
  type DraftTableItem,
  type EditorShape,
  type ResizeCorner,
} from "./editor-geometry";
import { FloorLayoutCanvas } from "./floor-layout-canvas";
import { FloorLayoutSidebar } from "./floor-layout-sidebar";
import { FloorLayoutToolbar } from "./floor-layout-toolbar";
import { ConfirmDialog } from "./confirm-dialog";
import { CreateTableDialog } from "./create-table-dialog";

const DEFAULT_PLACED_SIZE = { width: 110, height: 70 };

function toDraftItem(item: {
  tableId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: "RECTANGLE" | "CIRCLE";
}): DraftTableItem {
  return {
    tableId: item.tableId,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    rotation: normalizeRotation(item.rotation),
    shape: item.shape as EditorShape,
  };
}

/** Split persisted layout items into editable (active table) vs muted (inactive). */
function splitItemsByActivity(
  items: DraftTableItem[],
  tables: Map<string, RestaurantTable>
): { active: DraftTableItem[]; inactive: DraftTableItem[] } {
  const active: DraftTableItem[] = [];
  const inactive: DraftTableItem[] = [];
  for (const item of items) {
    if (tables.get(item.tableId)?.isActive) {
      active.push(item);
    } else {
      inactive.push(item);
    }
  }
  return { active, inactive };
}

interface FloorLayoutEditorProps {
  branchId: string;
  branchCode: string;
  branchName: string;
}

/**
 * Admin/Cashier floor layout editor for ONE branch.
 *
 * State model (the API stays authoritative):
 *   - `version`      → the server layout version (from the last GET/save).
 *   - `savedItems`   → snapshot of the ACTIVE placed items as of last load/save.
 *   - `draft`        → local working copy (only ACTIVE tables; inactive items
 *                     are kept read-only in `inactiveItems`).
 *   - `dirty`        → draft != savedItems (there are unsaved local changes).
 *
 * All edits (place/remove/drag/resize/rotate/shape) mutate `draft` locally and
 * NEVER hit the API. Saving is explicit and full-state; on success the server
 * DTO replaces local state. On 409 the local draft is preserved and the editor
 * only reloads after the user asks for it.
 */
export function FloorLayoutEditor({
  branchId,
  branchCode,
  branchName,
}: FloorLayoutEditorProps) {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [draft, setDraft] = useState<DraftTableItem[]>([]);
  const [savedItems, setSavedItems] = useState<DraftTableItem[]>([]);
  const [inactiveItems, setInactiveItems] = useState<DraftTableItem[]>([]);
  const [version, setVersion] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [zoom, setZoom] = useState(1);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [isCreatingTable, setIsCreatingTable] = useState(false);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [inactiveSaveOpen, setInactiveSaveOpen] = useState(false);

  const tablesMap = useMemo(
    () => new Map(tables.map((table) => [table.id, table])),
    [tables]
  );

  const dirty = useMemo(
    () => !itemListsEqual(draft, savedItems),
    [draft, savedItems]
  );

  /** Pure data fetch (no setState) — setState stays in the callers. */
  const fetchLayoutData = useCallback(async () => {
    const [tablesResult, layoutResult] = await Promise.all([
      tableService.getTables(),
      layoutService.getAdminBranchLayout(branchId),
    ]);
    return { tables: tablesResult, layout: layoutResult };
  }, [branchId]);

  const applyLoadResult = useCallback(
    (result: { tables: RestaurantTable[]; layout: BranchLayoutView }) => {
      const { active, inactive } = splitItemsByActivity(
        result.layout.items.map(toDraftItem),
        new Map(result.tables.map((t) => [t.id, t]))
      );
      setLoadError(null);
      setTables(result.tables);
      setDraft(active);
      setSavedItems(active);
      setInactiveItems(inactive);
      setVersion(result.layout.version);
      setSelectedId(null);
      setIsLoading(false);
    },
    []
  );

  const reload = useCallback(async () => {
    try {
      applyLoadResult(await fetchLayoutData());
    } catch (error) {
      if (isUnauthorized(error)) return;
      console.error("Failed to load layout:", error);
      setIsLoading(false);
      setLoadError(normalizeApiError(error).message);
    }
  }, [fetchLayoutData, applyLoadResult]);

  // Initial load — setState only inside promise callbacks (keeps the
  // react-hooks/set-state-in-effect lint clean).
  useEffect(() => {
    let cancelled = false;
    fetchLayoutData()
      .then((result) => {
        if (cancelled) return;
        applyLoadResult(result);
      })
      .catch((error) => {
        if (cancelled) return;
        if (isUnauthorized(error)) return;
        console.error("Failed to load layout:", error);
        setIsLoading(false);
        setLoadError(normalizeApiError(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchLayoutData, applyLoadResult]);

  const refreshTablesOnly = useCallback(async () => {
    try {
      const result = await tableService.getTables();
      setTables(result);
    } catch (error) {
      if (isUnauthorized(error)) return;
      toast.error("Gagal memuat daftar meja");
    }
  }, []);

  // ----------------------------------------------------------
  // Local draft mutations (no API calls)
  // ----------------------------------------------------------

  const handleSelect = useCallback((tableId: string | null) => {
    setSelectedId(tableId);
  }, []);

  const handlePlace = useCallback(
    (table: RestaurantTable) => {
      if (!table.isActive) return;
      const spot = findFreeSpot(draft, DEFAULT_PLACED_SIZE);
      setDraft((prev) => [
        ...prev,
        {
          tableId: table.id,
          x: spot.x,
          y: spot.y,
          width: DEFAULT_PLACED_SIZE.width,
          height: DEFAULT_PLACED_SIZE.height,
          rotation: 0,
          shape: "RECTANGLE",
        },
      ]);
      setSelectedId(table.id);
    },
    [draft]
  );

  const handleUnplace = useCallback((tableId: string) => {
    setDraft((prev) => prev.filter((item) => item.tableId !== tableId));
    setSelectedId((prev) => (prev === tableId ? null : prev));
  }, []);

  const handleMove = useCallback((tableId: string, dx: number, dy: number) => {
    setDraft((prev) =>
      prev.map((item) => (item.tableId === tableId ? moveTable(item, dx, dy) : item))
    );
  }, []);

  const handleResize = useCallback(
    (tableId: string, corner: ResizeCorner, dx: number, dy: number) => {
      setDraft((prev) =>
        prev.map((item) =>
          item.tableId === tableId ? resizeTable(item, corner, dx, dy) : item
        )
      );
    },
    []
  );

  const handleRotate = useCallback((tableId: string, angle: number) => {
    const normalized = normalizeRotation(angle);
    setDraft((prev) =>
      prev.map((item) =>
        item.tableId === tableId ? { ...item, rotation: normalized } : item
      )
    );
  }, []);

  const handleShapeChange = useCallback((tableId: string, shape: EditorShape) => {
    setDraft((prev) =>
      prev.map((item) => (item.tableId === tableId ? { ...item, shape } : item))
    );
  }, []);

  // ----------------------------------------------------------
  // Save / reload / reset / conflict
  // ----------------------------------------------------------

  const applyServerLayout = useCallback(
    (layout: BranchLayoutView, tablesSnapshot: Map<string, RestaurantTable>) => {
      const { active, inactive } = splitItemsByActivity(
        layout.items.map(toDraftItem),
        tablesSnapshot
      );
      setDraft(active);
      setSavedItems(active);
      setInactiveItems(inactive);
      setVersion(layout.version);
      setSelectedId(null);
    },
    []
  );

  const doSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Geometry ONLY — table semantics (number/name/capacity/status) are
      // never sent; the server re-validates every tableId.
      const result = await layoutService.saveAdminBranchLayout(branchId, {
        version,
        items: draft.map(({ tableId, x, y, width, height, rotation, shape }) => ({
          tableId,
          x,
          y,
          width,
          height,
          rotation,
          shape,
        })),
      });
      applyServerLayout(result, tablesMap);
      toast.success("Layout berhasil disimpan");
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        // Never overwrite local changes — keep the draft and let the user
        // decide. Showing the reload path is the explicit overwrite action.
        setConflictOpen(true);
        return;
      }
      console.error("Failed to save layout:", error);
      toast.error(normalizeApiError(error).message);
    } finally {
      setIsSaving(false);
    }
  }, [branchId, version, draft, tablesMap, applyServerLayout]);

  const handleSave = useCallback(() => {
    if (!dirty || isSaving) return;
    // Saving is full-state replace; the server refuses inactive tables, so
    // warn (non-silently) that they will be dropped from the layout on save.
    if (inactiveItems.length > 0) {
      setInactiveSaveOpen(true);
      return;
    }
    doSave();
  }, [dirty, isSaving, inactiveItems, doSave]);

  const handleReloadRequest = useCallback(() => {
    if (dirty) {
      setReloadConfirmOpen(true);
      return;
    }
    reload();
  }, [dirty, reload]);

  const handleResetRequest = useCallback(() => {
    if (dirty) setResetConfirmOpen(true);
  }, [dirty]);

  const handleResetConfirm = useCallback(() => {
    setDraft(savedItems);
    setSelectedId(null);
    setResetConfirmOpen(false);
  }, [savedItems]);

  // ----------------------------------------------------------
  // Table creation (existing Table CRUD — tableService + /api/tables)
  // ----------------------------------------------------------

  const handleCreateTable = useCallback(
    async (values: { number: number; name: string; capacity: number }) => {
      setIsCreatingTable(true);
      try {
        await tableService.createTable(values);
        toast.success("Meja berhasil dibuat");
        setAddDialogOpen(false);
        await refreshTablesOnly();
      } catch (error) {
        if (isUnauthorized(error)) return;
        console.error("Failed to create table:", error);
        if (getErrorCode(error) === "CONFLICT") {
          toast.error(getErrorMessage(error) ?? "Nomor meja sudah digunakan");
        } else {
          toast.error(normalizeApiError(error).message);
        }
      } finally {
        setIsCreatingTable(false);
      }
    },
    [refreshTablesOnly]
  );

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Memuat layout…
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-gray-600">{loadError}</p>
          <Button variant="outline" onClick={reload}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Muat Ulang
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <FloorLayoutToolbar
        dirty={dirty}
        isSaving={isSaving}
        onSave={handleSave}
        onReload={handleReloadRequest}
        onReset={handleResetRequest}
        onCreateTable={() => setAddDialogOpen(true)}
        zoom={zoom}
        onZoomChange={setZoom}
      />

      {tables.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-20 text-center">
            <p className="text-base font-medium text-gray-800">
              Belum ada meja di cabang ini.
            </p>
            <p className="max-w-md text-sm text-gray-500">
              Tambahkan meja terlebih dahulu. Setelah dibuat, meja muncul di
              panel &quot;Meja&quot; dan dapat ditempatkan di canvas.
            </p>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Tambah Meja
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <FloorLayoutCanvas
            items={draft}
            inactiveItems={inactiveItems}
            tables={tablesMap}
            selectedId={selectedId}
            zoom={zoom}
            onSelect={handleSelect}
            onMove={handleMove}
            onResize={handleResize}
            onRotate={handleRotate}
            onUnplace={handleUnplace}
          />
          <FloorLayoutSidebar
            activeItems={draft}
            inactiveItems={inactiveItems}
            tables={tablesMap}
            selectedId={selectedId}
            onSelect={handleSelect}
            onPlace={handlePlace}
            onUnplace={handleUnplace}
            onShapeChange={handleShapeChange}
            onRotate={handleRotate}
          />
        </div>
      )}

      {/* Tambah Meja — reuses existing table service (create only). */}
      <CreateTableDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        pending={isCreatingTable}
        onSubmit={handleCreateTable}
      />

      {/* Reload with unsaved changes → confirm discard. */}
      <ConfirmDialog
        open={reloadConfirmOpen}
        onOpenChange={setReloadConfirmOpen}
        title="Muat Ulang Layout?"
        description="Ada perubahan yang belum disimpan. Muat ulang akan membuang perubahan lokal dan mengambil versi terbaru dari server."
        confirmLabel="Muat Ulang"
        onConfirm={() => {
          setReloadConfirmOpen(false);
          reload();
        }}
      />

      {/* Reset local changes → confirm discard. */}
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset Perubahan Lokal?"
        description="Perubahan yang belum disimpan akan dibatalkan dan layout kembali ke versi terakhir yang tersimpan."
        confirmLabel="Reset"
        destructive
        onConfirm={handleResetConfirm}
      />

      {/* 409 version conflict — local changes are PRESERVED. */}
      <ConfirmDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        title="Layout Sudah Diubah di Perangkat Lain"
        description="Layout sudah diubah dari perangkat lain. Muat ulang layout terlebih dahulu untuk mengambil versi terbaru — perubahan lokal Anda saat ini tidak ditimpa."
        confirmLabel="Muat Ulang"
        cancelLabel="Tetap di Sini"
        onConfirm={() => {
          setConflictOpen(false);
          reload();
        }}
      />

      {/* Inactive tables in the persisted layout are dropped on a full-state
          save (the server refuses inactive items) — make that explicit. */}
      <ConfirmDialog
        open={inactiveSaveOpen}
        onOpenChange={setInactiveSaveOpen}
        title="Meja Nonaktif di Layout"
        description={`${inactiveItems.length} meja di layout sekarang nonaktif dan tidak dapat disimpan. Item lama tersebut akan dihapus dari layout saat Simpan. Lanjutkan?`}
        confirmLabel="Lanjutkan Simpan"
        onConfirm={() => {
          setInactiveSaveOpen(false);
          doSave();
        }}
      />

      <p className="text-xs text-gray-400">
        Cabang aktif: {branchName} ({branchCode})
      </p>
    </div>
  );
}