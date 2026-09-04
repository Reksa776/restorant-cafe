"use client";

import { useCallback, useEffect, useState } from "react";
import { userService } from "@/services/shift.service";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { toast } from "sonner";
import { Loader2, UserPlus, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "CASHIER";
  isActive: boolean;
  createdAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "CASHIER">("CASHIER");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await userService.listUsers();
      setUsers(res.items);
    } catch (err) {
      console.error("Failed to load users:", err);
      toast.error("Gagal memuat pengguna");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeListener(
    [REALTIME_EVENT_TYPES.USER_CREATED, REALTIME_EVENT_TYPES.USER_UPDATED],
    () => load()
  );

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      await userService.createUser({ name, email, password, role });
      toast.success("Pengguna berhasil dibuat");
      setDialogOpen(false);
      setName("");
      setEmail("");
      setPassword("");
      setRole("CASHIER");
      await load();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal membuat pengguna"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (user: StaffUser) => {
    try {
      await userService.setUserActive(user.id, !user.isActive);
      toast.success(user.isActive ? "Pengguna dinonaktifkan" : "Pengguna diaktifkan");
      await load();
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal memperbarui status"
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pengguna</h1>
          <p className="text-muted-foreground">
            Kelola staf — kasir dan admin
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <UserPlus className="h-4 w-4 mr-1" />
          Tambah Pengguna
        </Button>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex items-center justify-between gap-3 p-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                {u.role === "ADMIN" ? (
                  <ShieldCheck className="h-5 w-5 text-gray-600" />
                ) : (
                  <User className="h-5 w-5 text-gray-600" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium truncate">{u.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {u.email}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {u.role === "ADMIN" ? (
                <Badge className="bg-blue-100 text-blue-700 border-blue-200">
                  Admin
                </Badge>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                  Kasir
                </Badge>
              )}
              {!u.isActive && (
                <Badge variant="outline" className="text-red-600 border-red-200">
                  Nonaktif
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToggleActive(u)}
              >
                {u.isActive ? "Nonaktifkan" : "Aktifkan"}
              </Button>
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">
            Belum ada pengguna
          </p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tambah Pengguna</DialogTitle>
            <DialogDescription>
              Buat akun untuk kasir atau admin baru.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Nama</Label>
              <Input
                id="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama lengkap"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kasir@restoran.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-password">Password</Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={role === "CASHIER" ? "default" : "outline"}
                  onClick={() => setRole("CASHIER")}
                >
                  Kasir
                </Button>
                <Button
                  type="button"
                  variant={role === "ADMIN" ? "default" : "outline"}
                  onClick={() => setRole("ADMIN")}
                >
                  Admin
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || !name || !email || password.length < 6}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Buat Pengguna
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
