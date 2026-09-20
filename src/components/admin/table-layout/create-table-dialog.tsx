"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export interface CreateTableValues {
  number: number;
  name: string;
  capacity: number;
}

interface CreateTableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  /** Called with the parsed values; the editor performs tableService.createTable. */
  onSubmit: (values: CreateTableValues) => void;
}

/**
 * "Tambah Meja" entry point for the layout editor. This is NOT a new table
 * CRUD — it reuses the existing `tableService.createTable` + admin tables API
 * and only mirrors the small create form used on /admin/tables, so a staff
 * member can add a table and immediately place it on the canvas.
 */
export function CreateTableDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: CreateTableDialogProps) {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("4");

  const reset = () => {
    setNumber("");
    setName("");
    setCapacity("4");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = () => {
    const parsedNumber = parseInt(number, 10);
    const parsedCapacity = parseInt(capacity, 10) || 4;
    if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) return;
    onSubmit({ number: parsedNumber, name: name.trim(), capacity: parsedCapacity });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Meja</DialogTitle>
          <DialogDescription>
            Tambahkan meja baru. Setelah dibuat, meja muncul di daftar{" "}
            &quot;Belum Ditempatkan&quot; dan bisa ditarik ke canvas.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div>
            <Label htmlFor="layoutTableNumber">Nomor Meja</Label>
            <Input
              id="layoutTableNumber"
              type="number"
              min={1}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Nomor meja"
            />
          </div>
          <div>
            <Label htmlFor="layoutTableName">Nama Meja</Label>
            <Input
              id="layoutTableName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Table 01"
            />
          </div>
          <div>
            <Label htmlFor="layoutTableCapacity">Kapasitas</Label>
            <Input
              id="layoutTableCapacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Kapasitas"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}