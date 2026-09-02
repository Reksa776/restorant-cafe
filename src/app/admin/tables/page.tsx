"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Plus, Pencil, Trash2, QrCode } from "lucide-react";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-800",
  OCCUPIED: "bg-red-100 text-red-800",
  MAINTENANCE: "bg-yellow-100 text-yellow-800",
};

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
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);

  useEffect(() => {
    loadTables();
  }, []);

  const loadTables = async () => {
    setIsLoading(true);
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

  const handleGenerateQr = async (id: string) => {
    try {
      const qr = await tableService.generateQrCode(id);
      setQrCode(qr);
      setIsQrDialogOpen(true);
      loadTables();
    } catch (error) {
      console.error("Failed to generate QR code:", error);
      toast.error("Gagal generate QR code");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Meja</h1>
          <p className="text-gray-500">Kelola meja restoran</p>
        </div>
        <Button
          onClick={() => {
            setEditingTable(null);
            setForm({ number: "", name: "", capacity: "4" });
            setIsDialogOpen(true);
          }}
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
              {tables.map((table) => (
                <Card key={table.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{table.name}</CardTitle>
                      <Badge className={statusColors[table.status]}>
                        {table.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="text-sm text-gray-500">
                        Kapasitas: {table.capacity} orang
                      </p>
                      <div className="flex gap-2">
                        <Select
                          value={table.status}
                          onValueChange={(value) =>
                            handleStatusChange(
                              table.id,
                              value as "AVAILABLE" | "OCCUPIED" | "MAINTENANCE"
                            )
                          }
                        >
                          <SelectTrigger className="flex-1">
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
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleGenerateQr(table.id)}
                        >
                          <QrCode className="h-4 w-4 mr-1" />
                          QR
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
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(table.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
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

      {/* QR Code Dialog */}
      <Dialog open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QR Code Meja</DialogTitle>
            <DialogDescription>
              Scan QR code untuk melakukan pemesanan
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-4">
            {qrCode && (
              <img src={qrCode} alt="QR Code" className="w-64 h-64" />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsQrDialogOpen(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
