"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type DraftLayoutZone,
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
  readOnly?: boolean;
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
  readOnly = false,
}: FloorLayoutEditorProps) {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [draft, setDraft] = useState<DraftTableItem[]>([]);
  const [savedItems, setSavedItems] = useState<DraftTableItem[]>([]);
  const [zones, setZones] = useState<DraftLayoutZone[]>([]);
  const [savedZones, setSavedZones] = useState<DraftLayoutZone[]>([]);
  const [inactiveItems, setInactiveItems] = useState<DraftTableItem[]>([]);
  const [version, setVersion] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
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
    () => !itemListsEqual(draft, savedItems) || JSON.stringify(zones) !== JSON.stringify(savedZones),
    [draft, savedItems, zones, savedZones]
  );

  /** Pure data fetch (no setState) — setState stays in the callers. */
  const fetchLayoutData = useCallback(async () => {
    const [tablesResult, layoutResult] = await Promise.all([
      // Scope the sidebar to THIS branch only — a table from another branch
      // is never offered for placement (the save endpoint also rejects it
      // server-side, so a cross-branch item can never be persisted).
      tableService.getTables({ branchId }),
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
      setZones(result.layout.zones ?? []);
      setSavedZones(result.layout.zones ?? []);
      setVersion(result.layout.version);
      setSelectedId(null);
      setSelectedZoneId(null);
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
      const result = await tableService.getTables({ branchId });
      setTables(result);
    } catch (error) {
      if (isUnauthorized(error)) return;
      toast.error("Gagal memuat daftar meja");
    }
  }, [branchId]);

  // ----------------------------------------------------------
  // Local draft mutations (no API calls)
  // ----------------------------------------------------------

  const handleSelect = useCallback((tableId: string | null) => {
    setSelectedId(tableId);
    if (tableId) setSelectedZoneId(null);
  }, []);

  const handleCreateZone = useCallback(() => {
    setZones((prev) => {
      const zone = { id: crypto.randomUUID(), name: `Area ${prev.length + 1}`, type: "NON_SMOKING" as const, x: 24 + (prev.length % 3) * 24, y: 24 + (prev.length % 3) * 24, width: 340, height: 220 };
      setSelectedZoneId(zone.id);
      return [...prev, zone];
    });
  }, []);

  const handleMoveZone = useCallback((zoneId: string, dx: number, dy: number) => {
    setZones((prev) => prev.map((zone) => zone.id === zoneId ? { ...zone, x: Math.max(0, Math.min(900 - zone.width, zone.x + dx)), y: Math.max(0, Math.min(600 - zone.height, zone.y + dy)) } : zone));
  }, []);

  const handleResizeZone = useCallback((zoneId: string, corner: ResizeCorner, dx: number, dy: number) => {
    setZones((prev) => prev.map((zone) => {
      if (zone.id !== zoneId) return zone;
      let { x, y, width, height } = zone;
      if (corner.includes("w")) { const next = Math.max(0, Math.min(x + width - 80, x + dx)); width += x - next; x = next; }
      if (corner.includes("e")) width = Math.max(80, Math.min(900 - x, width + dx));
      if (corner.includes("n")) { const next = Math.max(0, Math.min(y + height - 60, y + dy)); height += y - next; y = next; }
      if (corner.includes("s")) height = Math.max(60, Math.min(600 - y, height + dy));
      return { ...zone, x, y, width, height };
    }));
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
          areaType: null,
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

  const handleAreaTypeChange = useCallback(
    (tableId: string, areaType: DraftTableItem["areaType"]) => {
      setDraft((prev) =>
        prev.map((item) => (item.tableId === tableId ? { ...item, areaType } : item))
      );
    },
    []
  );

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
      setZones(layout.zones ?? []);
      setSavedZones(layout.zones ?? []);
      setVersion(layout.version);
      setSelectedId(null);
      setSelectedZoneId(null);
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
        zones,
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
  }, [branchId, version, draft, zones, tablesMap, applyServerLayout]);

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
    setZones(savedZones);
    setSelectedId(null);
    setResetConfirmOpen(false);
  }, [savedItems, savedZones]);

  // ----------------------------------------------------------
  // Table creation (existing Table CRUD — tableService + /api/tables)
  // ----------------------------------------------------------

  const handleCreateTable = useCallback(
    async (values: { number: number; name: string; capacity: number }) => {
      setIsCreatingTable(true);
      try {
        // Attach the new table to the branch whose layout is open so it is
        // immediately placeable (a branch-less table can never join a layout).
        await tableService.createTable({ ...values, branchId });
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
    [refreshTablesOnly, branchId]
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
      {!readOnly && <FloorLayoutToolbar
        dirty={dirty}
        isSaving={isSaving}
        onSave={handleSave}
        onReload={handleReloadRequest}
        onReset={handleResetRequest}
        onCreateTable={() => setAddDialogOpen(true)}
        onCreateZone={handleCreateZone}
        zoom={zoom}
        onZoomChange={setZoom}
      />}

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
            {!readOnly && <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Tambah Meja
            </Button>}
          </CardContent>
        </Card>
      ) : (
        <div className={readOnly ? "max-w-5xl" : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"}>
          <div className={readOnly ? "pointer-events-none select-none" : undefined} aria-label={readOnly ? "Tampilan review layout" : undefined}>
          <FloorLayoutCanvas
            zones={zones}
            selectedZoneId={selectedZoneId}
            onSelectZone={setSelectedZoneId}
            onMoveZone={handleMoveZone}
            onResizeZone={handleResizeZone}
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
          {!readOnly && <Card className="mt-4"><CardContent className="space-y-3 p-4"><h3 className="font-semibold">Area denah</h3><p className="text-xs text-gray-500">Klik area untuk memilih. Seret bagian tengah untuk memindahkan dan tarik handle sudut untuk mengubah ukuran.</p>{zones.map((zone) => <div key={zone.id} className={`grid grid-cols-2 gap-2 rounded-md p-2 md:grid-cols-7 ${zone.id === selectedZoneId ? "bg-gray-100" : ""}`}><Input aria-label="Nama area" placeholder="Nama area" value={zone.name} onFocus={() => setSelectedZoneId(zone.id)} onChange={(e) => setZones((prev) => prev.map((z) => z.id === zone.id ? { ...z, name: e.target.value } : z))} /><select aria-label="Jenis area" className="rounded-md border px-2 text-sm" value={zone.type} onFocus={() => setSelectedZoneId(zone.id)} onChange={(e) => setZones((prev) => prev.map((z) => z.id === zone.id ? { ...z, type: e.target.value as DraftLayoutZone["type"] } : z))}><option value="SMOKING">Merokok</option><option value="NON_SMOKING">Bebas asap</option><option value="TERRACE">Teras</option></select><Button variant="outline" onClick={() => { setZones((prev) => prev.filter((z) => z.id !== zone.id)); setSelectedZoneId((id) => id === zone.id ? null : id); }}>Hapus</Button></div>)}</CardContent></Card>}
          </div>
          {!readOnly && <FloorLayoutSidebar
            activeItems={draft}
            inactiveItems={inactiveItems}
            tables={tablesMap}
            selectedId={selectedId}
            onSelect={handleSelect}
            onPlace={handlePlace}
            onUnplace={handleUnplace}
            onShapeChange={handleShapeChange}
            onAreaTypeChange={handleAreaTypeChange}
            onRotate={handleRotate}
          />}
        </div>
      )}

      {/* Tambah Meja — reuses existing table service (create only). */}
      {!readOnly && <CreateTableDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        pending={isCreatingTable}
        onSubmit={handleCreateTable}
      />}

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
