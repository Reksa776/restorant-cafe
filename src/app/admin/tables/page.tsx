"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  tableService,
  type RestaurantTable,
} from "@/services/table.service";
import { cn } from "@/lib/utils";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import {
  Plus,
  Pencil,
  Trash2,
  QrCode,
  Link2,
  Copy,
  ExternalLink,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

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

/**
 * Copy text to clipboard with a fallback for non-secure contexts.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function TablesPage() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(
    null
  );
  const [form, setForm] = useState({
    number: "",
    name: "",
    capacity: "4",
  });
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrTable, setQrTable] = useState<RestaurantTable | null>(null);
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);
  const [generatingQrId, setGeneratingQrId] = useState<string | null>(null);
  // Current origin (domain the admin is using). Customer links + QR payloads
  // are derived from it; empty on the server (cards only render after data
  // loads client-side, so no hydration mismatch).
  const [origin] = useState(() =>
    typeof window !== "undefined"
      ? window.location.origin.replace(/\/+$/, "")
      : ""
  );

  const loadTables = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const result = await tableService.getTables();
      setTables(result);
    } catch (error) {
      console.error("Failed to load tables:", error);
      toast.error("Gagal memuat data meja");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTables();
  }, []);

  // Realtime: table status/CRUD changes (e.g. an order occupying/freeing a
  // table, or another admin) → refresh cards without a page reload.
  useRealtimeListener(
    [
      REALTIME_EVENT_TYPES.TABLE_CREATED,
      REALTIME_EVENT_TYPES.TABLE_UPDATED,
      REALTIME_EVENT_TYPES.TABLE_DELETED,
      REALTIME_EVENT_TYPES.TABLE_STATUS_CHANGED,
      REALTIME_EVENT_TYPES.OFFLINE_POLL,
    ],
    () => {
      if (!isLoading) loadTables(true);
    }
  );

  const handleSave = async () => {
    try {
      const data = {
        number: parseInt(form.number),
        name: form.name,
        capacity: parseInt(form.capacity),
      };

      if (editingTable) {
        await tableService.updateTable(editingTable.id, data);
        toast.success("Meja berhasil diupdate");
      } else {
        await tableService.createTable(data);
        toast.success("Meja berhasil dibuat");
      }
      setIsDialogOpen(false);
      setEditingTable(null);
      setForm({ number: "", name: "", capacity: "4" });
      loadTables();
    } catch (error) {
      console.error("Failed to save table:", error);
      toast.error("Gagal menyimpan meja");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus meja ini?")) return;
    try {
      await tableService.deleteTable(id);
      toast.success("Meja berhasil dihapus");
      loadTables();
    } catch (error) {
      console.error("Failed to delete table:", error);
      toast.error("Gagal menghapus meja");
    }
  };

  const handleStatusChange = async (
    id: string,
    status: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE"
  ) => {
    try {
      await tableService.updateTableStatus(id, status);
      toast.success("Status meja berhasil diubah");
      loadTables();
    } catch (error) {
      console.error("Failed to update table status:", error);
      toast.error("Gagal mengubah status meja");
    }
  };

  /**
   * Customer (public) ordering URL for a table: {origin}/t/{tableNumber}
   */
  const customerUrl = (table: RestaurantTable): string =>
    origin ? `${origin}/t/${table.number}` : "";

  /**
   * Generate (or refresh) the QR for a table and show the detail modal.
   * The QR payload is the exact same customer URL shown in the UI.
   */
  const handleViewQr = async (table: RestaurantTable) => {
    setGeneratingQrId(table.id);
    try {
      const result = await tableService.generateQrCode(
        table.id,
        window.location.origin
      );
      setQrCode(result.qrCode);
      setQrTable(table);
      setIsQrDialogOpen(true);
      loadTables();
    } catch (error) {
      console.error("Failed to generate QR code:", error);
      toast.error("Gagal generate QR code");
    } finally {
      setGeneratingQrId(null);
    }
  };

  const handleCopyLink = async (table: RestaurantTable) => {
    const url = customerUrl(table);
    if (!url) return;
    const ok = await copyToClipboard(url);
    toast.success(ok ? "Link meja disalin" : "Gagal menyalin link");
  };

  const handleDownloadQr = () => {
    if (!qrCode || !qrTable) return;
    const a = document.createElement("a");
    a.href = qrCode;
    a.download = `qr-meja-${qrTable.number}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Meja</h1>
          <p className="text-gray-500">Kelola meja dan link QR restoran</p>
        </div>
        <Button
          onClick={() => {
            setEditingTable(null);
            setForm({ number: "", name: "", capacity: "4" });
            setIsDialogOpen(true);
          }}
          className="w-full sm:w-auto"
        >
          <Plus className="h-4 w-4 mr-2" />
          Tambah Meja
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-center text-gray-500 py-8">Loading...</p>
          ) : tables.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              Belum ada meja
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tables.map((table) => {
                const url = customerUrl(table);
                return (
                  <Card key={table.id} className="overflow-hidden">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-lg truncate">
                          {table.name}
                        </CardTitle>
                        <Badge className={statusColors[table.status]}>
                          {statusLabels[table.status]}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-400">
                        Meja Nomor {table.number} · Kapasitas {table.capacity}{" "}
                        orang
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* QR + customer link */}
                      <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                        {table.qrCode ? (
                          <img
                            src={table.qrCode}
                            alt={`QR Meja ${table.number}`}
                            className="w-14 h-14 rounded-md border border-gray-200 bg-white flex-shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-md border border-dashed border-gray-300 bg-white flex items-center justify-center flex-shrink-0">
                            <QrCode className="h-5 w-5 text-gray-300" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p
                            title={url || "Load halaman untuk melihat link"}
                            className="text-xs text-gray-600 font-mono truncate"
                          >
                            {url || "Memuat link…"}
                          </p>
                          <button
                            onClick={() => handleCopyLink(table)}
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-black transition-colors"
                          >
                            <Copy className="h-3 w-3" />
                            Copy Link
                          </button>
                        </div>
                      </div>

                      {/* Status */}
                      <Select
                        value={table.status}
                        onValueChange={(value) =>
                          handleStatusChange(
                            table.id,
                            value as "AVAILABLE" | "OCCUPIED" | "MAINTENANCE"
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AVAILABLE">Tersedia</SelectItem>
                          <SelectItem value="OCCUPIED">Terisi</SelectItem>
                          <SelectItem value="MAINTENANCE">
                            Maintenance
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Actions */}
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={generatingQrId === table.id}
                          onClick={() => handleViewQr(table)}
                        >
                          {generatingQrId === table.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <QrCode className="h-3.5 w-3.5" />
                          )}
                          {table.qrCode ? "Lihat QR" : "Buat QR"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyLink(table)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy Link
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingTable(table);
                            setForm({
                              number: table.number.toString(),
                              name: table.name,
                              capacity: table.capacity.toString(),
                            });
                            setIsDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(table.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table Form Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTable ? "Edit Meja" : "Tambah Meja"}
            </DialogTitle>
            <DialogDescription>
              {editingTable
                ? "Ubah informasi meja"
                : "Tambahkan meja baru"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="tableNumber">Nomor Meja</Label>
              <Input
                id="tableNumber"
                type="number"
                value={form.number}
                onChange={(e) =>
                  setForm({ ...form, number: e.target.value })
                }
                placeholder="Nomor meja"
              />
            </div>
            <div>
              <Label htmlFor="tableName">Nama Meja</Label>
              <Input
                id="tableName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Contoh: Table 01"
              />
            </div>
            <div>
              <Label htmlFor="tableCapacity">Kapasitas</Label>
              <Input
                id="tableCapacity"
                type="number"
                value={form.capacity}
                onChange={(e) =>
                  setForm({ ...form, capacity: e.target.value })
                }
                placeholder="Kapasitas"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleSave}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR / Link Dialog */}
      <Dialog open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {qrTable
                ? `${qrTable.name} — Meja ${qrTable.number}`
                : "QR Code Meja"}
            </DialogTitle>
            <DialogDescription>
              Scan QR atau bagikan link ini agar customer bisa memesan langsung
              dari meja.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              {qrCode ? (
                <img
                  src={qrCode}
                  alt={`QR Code Meja ${qrTable?.number ?? ""}`}
                  className="w-52 h-52"
                />
              ) : (
                <div className="w-52 h-52 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
                </div>
              )}
            </div>

            {/* Customer link */}
            {qrTable && (
              <div className="w-full flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <Link2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <span
                  className="text-xs text-gray-600 font-mono truncate flex-1"
                  title={customerUrl(qrTable)}
                >
                  {customerUrl(qrTable)}
                </span>
                <button
                  onClick={() => handleCopyLink(qrTable)}
                  className="text-xs font-medium text-gray-700 hover:text-black flex items-center gap-1 flex-shrink-0"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {qrTable && (
              <a
                href={customerUrl(qrTable)}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "outline" }), "w-full")}
              >
                <ExternalLink className="h-4 w-4 mr-1.5" />
                Buka Link
              </a>
            )}
            {qrTable && (
              <Button variant="outline" onClick={() => handleCopyLink(qrTable)}>
                <Copy className="h-4 w-4 mr-1.5" />
                Copy Link
              </Button>
            )}
            {qrCode && (
              <Button variant="default" onClick={handleDownloadQr}>
                <Download className="h-4 w-4 mr-1.5" />
                Download QR
              </Button>
            )}
            <Button variant="outline" onClick={() => setIsQrDialogOpen(false)}>
              Tutup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
