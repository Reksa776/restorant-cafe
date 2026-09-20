"use client";

import type { RestaurantTable } from "@/services/table.service";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Circle,
  Minus,
  Square,
  Trash2,
  ArrowDownToLine,
} from "lucide-react";
import { normalizeRotation, type DraftTableItem, type EditorShape } from "./editor-geometry";

const statusColors: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-800",
  OCCUPIED: "bg-red-100 text-red-800",
  MAINTENANCE: "bg-yellow-100 text-yellow-800",
};

const statusLabels: Record<string, string> = {
  AVAILABLE: "Tersedia",
  OCCUPIED: "Terisi",
  MAINTENANCE: "Maintenance",
};

interface FloorLayoutSidebarProps {
  /** Active placed items (the editable draft). */
  activeItems: DraftTableItem[];
  /** Persisted items of inactive tables (muted, read-only until save). */
  inactiveItems: DraftTableItem[];
  tables: Map<string, RestaurantTable>;
  selectedId: string | null;
  onSelect: (tableId: string | null) => void;
  onPlace: (table: RestaurantTable) => void;
  onUnplace: (tableId: string) => void;
  onShapeChange: (tableId: string, shape: EditorShape) => void;
  onRotate: (tableId: string, angle: number) => void;
}

function TableRow({
  table,
  trailing,
  onClick,
  muted = false,
}: {
  table: RestaurantTable;
  trailing?: React.ReactNode;
  onClick?: () => void;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2",
        muted
          ? "border-gray-100 bg-gray-50/60"
          : onClick
            ? "cursor-pointer border-transparent hover:bg-gray-50"
            : "border-transparent"
      )}
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", muted ? "text-gray-400" : "text-gray-800")}>
          Meja {table.number}
          {table.name ? ` · ${table.name}` : ""}
        </p>
        <p className={cn("text-xs", muted ? "text-gray-400" : "text-gray-500")}>
          Kapasitas {table.capacity} org
        </p>
      </div>
      <Badge className={cn("shrink-0", statusColors[table.status])}>
        {statusLabels[table.status]}
      </Badge>
      {trailing}
    </div>
  );
}

/**
 * "Meja" sidebar: placed / unplaced / inactive tables + properties of the
 * selected table (shape, rotation, remove). Everything here edits the LOCAL
 * draft only — save/reload and the API stay in the editor.
 */
export function FloorLayoutSidebar({
  activeItems,
  inactiveItems,
  tables,
  selectedId,
  onSelect,
  onPlace,
  onUnplace,
  onShapeChange,
  onRotate,
}: FloorLayoutSidebarProps) {
  const placedIds = new Set(activeItems.map((item) => item.tableId));
  const inactivePlacedIds = new Set(inactiveItems.map((item) => item.tableId));
  const allTables = [...tables.values()];
  const activeTables = allTables.filter((table) => table.isActive);
  const inactiveTables = allTables.filter((table) => !table.isActive);

  const placedTables = activeTables.filter((t) => placedIds.has(t.id));
  const unplacedTables = activeTables.filter((t) => !placedIds.has(t.id));

  const selectedItem = activeItems.find((item) => item.tableId === selectedId) ?? null;
  const selectedTable = selectedId ? tables.get(selectedId) ?? null : null;

  const setRotation = (value: string) => {
    if (!selectedId) return;
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return;
    onRotate(selectedId, normalizeRotation(parsed));
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Meja</CardTitle>
        <p className="text-xs text-gray-500">
          {activeItems.length} ditempatkan · {unplacedTables.length} belum
          ditempatkan
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Selected table properties */}
        {selectedItem && selectedTable && (
          <section className="space-y-3 rounded-xl border border-brand-secondary/60 bg-brand-secondary/20 p-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">
                Meja {selectedTable.number}{" "}
                {selectedTable.name ? `· ${selectedTable.name}` : ""}
              </p>
              <p className="text-xs text-gray-500">
                Kapasitas {selectedTable.capacity} org ·{" "}
                {statusLabels[selectedTable.status]}
              </p>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-gray-600">Bentuk</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedItem.shape === "RECTANGLE" ? "default" : "outline"}
                  onClick={() => onShapeChange(selectedItem.tableId, "RECTANGLE")}
                  className="flex-1"
                >
                  <Square className="h-3.5 w-3.5 mr-1.5" />
                  Persegi
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedItem.shape === "CIRCLE" ? "default" : "outline"}
                  onClick={() => onShapeChange(selectedItem.tableId, "CIRCLE")}
                  className="flex-1"
                >
                  <Circle className="h-3.5 w-3.5 mr-1.5" />
                  Bundar
                </Button>
              </div>
            </div>

            <div>
              <label
                htmlFor="layout-rotation"
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Rotasi ({Math.round(selectedItem.rotation)}°)
              </label>
              <Input
                id="layout-rotation"
                type="number"
                min={0}
                max={359}
                value={Math.round(selectedItem.rotation)}
                onChange={(e) => setRotation(e.target.value)}
                className="h-8"
                aria-label="Rotasi meja dalam derajat"
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => onUnplace(selectedItem.tableId)}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Remove dari Layout
            </Button>
            <p className="text-[11px] leading-snug text-gray-400">
              Menghapus hanya mengubah layout lokal — meja, status, QR, pesanan,
              dan reservasi tidak terpengaruh. Tersimpan saat Simpan.
            </p>
          </section>
        )}

        {/* Placed tables */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-gray-400 uppercase">
            Ditempatkan ({placedTables.length})
          </h3>
          {placedTables.length === 0 ? (
            <p className="text-xs text-gray-400">
              Belum ada meja di canvas. Tempatkan meja dari daftar di bawah.
            </p>
          ) : (
            <div className="space-y-2">
              {placedTables.map((table) => (
                <TableRow
                  key={table.id}
                  table={table}
                  onClick={() => onSelect(table.id)}
                  trailing={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-gray-400 hover:text-red-600"
                      title="Hapus dari kanvas (lokal, belum tersimpan)"
                      aria-label={`Hapus meja ${table.number} dari layout`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnplace(table.id);
                      }}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </section>

        {/* Unplaced tables */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-gray-400 uppercase">
            Belum Ditempatkan ({unplacedTables.length})
          </h3>
          {unplacedTables.length === 0 ? (
            <p className="text-xs text-gray-400">
              Semua meja sudah di canvas.
              {allTables.length === 0 && " Tambah meja untuk mulai."}
            </p>
          ) : (
            <div className="space-y-2">
              {unplacedTables.map((table) => (
                <TableRow
                  key={table.id}
                  table={table}
                  trailing={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlace(table);
                      }}
                    >
                      <ArrowDownToLine className="h-3.5 w-3.5 mr-1" />
                      Tempatkan
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </section>

        {/* Inactive tables */}
        {inactiveTables.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-gray-400 uppercase">
              Meja Nonaktif ({inactiveTables.length})
            </h3>
            <div className="space-y-2">
              {inactiveTables.map((table) => {
                const stillOnLayout = inactivePlacedIds.has(table.id);
                return (
                  <TableRow
                    key={table.id}
                    table={table}
                    muted
                    trailing={
                      stillOnLayout ? (
                        <Badge className="shrink-0 bg-gray-100 text-gray-500">
                          di layout
                        </Badge>
                      ) : null
                    }
                  />
                );
              })}
            </div>
            <p className="text-[11px] leading-snug text-gray-400">
              Meja nonaktif tidak bisa ditempatkan dan tidak ikut tersimpan.
              Item lama di layout akan dihapus saat Simpan.
            </p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}