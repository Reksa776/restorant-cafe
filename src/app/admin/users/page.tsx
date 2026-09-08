"use client";

import { useCallback, useEffect, useState } from "react";
import { userService } from "@/services/shift.service";
import { branchService } from "@/services/branch.service";
import type { Branch } from "@/services/branch.service";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { toast } from "sonner";
import { Loader2, UserPlus, ShieldCheck, User, Store } from "lucide-react";
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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchAssignments, setBranchAssignments] = useState<
    Record<string, string[]>
  >({});

  // Branch assignment dialog state.
  const [branchDialogUser, setBranchDialogUser] = useState<StaffUser | null>(
    null
  );
  const [draftBranchIds, setDraftBranchIds] = useState<string[]>([]);
  const [savingBranches, setSavingBranches] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "CASHIER">("CASHIER");
  const [submitting, setSubmitting] = useState(false);

  const loadAssignments = useCallback(async (userId: string) => {
    try {
      const { branchIds } = await userService.getUserBranches(userId);
      setBranchAssignments((prev) => ({ ...prev, [userId]: branchIds }));
    } catch {
      // Non-fatal — the badge just won't render for this user.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, branchesRes] = await Promise.all([
        userService.listUsers(),
        branchService.getBranches().catch(() => [] as Branch[]),
      ]);
      setUsers(usersRes.items);
      setBranches(branchesRes);
      await Promise.all(usersRes.items.map((u) => loadAssignments(u.id)));
    } catch (err) {
      console.error("Failed to load users:", err);
      toast.error("Gagal memuat pengguna");
    } finally {
      setLoading(false);
    }
  }, [loadAssignments]);

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

  const openBranchDialog = (user: StaffUser) => {
    setBranchDialogUser(user);
    setDraftBranchIds(branchAssignments[user.id] ?? []);
  };

  const toggleDraftBranch = (branchId: string) => {
    setDraftBranchIds((prev) =>
      prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId]
    );
  };

  const handleSaveBranches = async () => {
    if (!branchDialogUser) return;
    setSavingBranches(true);
    try {
      await userService.setUserBranches(branchDialogUser.id, draftBranchIds);
      toast.success("Akses cabang pengguna diperbarui");
      setBranchAssignments((prev) => ({
        ...prev,
        [branchDialogUser.id]: draftBranchIds,
      }));
      setBranchDialogUser(null);
    } catch (err) {
      toast.error(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.message || "Gagal memperbarui cabang"
      );
    } finally {
      setSavingBranches(false);
    }
  };

  const assignmentLabel = (user: StaffUser) => {
    const ids = branchAssignments[user.id];
    if (!ids || ids.length === 0) return "Semua Cabang";
    return ids
      .map(
        (id) => branches.find((b) => b.id === id)?.name ?? id.slice(0, 8)
      )
      .join(", ");
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
          <div key={u.id}>
            <div className="flex items-center justify-between gap-3 p-4">
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
                  onClick={() => openBranchDialog(u)}
                >
                  <Store className="h-3.5 w-3.5 mr-1" />
                  Cabang
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleActive(u)}
                >
                  {u.isActive ? "Nonaktifkan" : "Aktifkan"}
                </Button>
              </div>
            </div>
            <div className="px-4 pb-3">
              <p className="text-xs text-muted-foreground">
                Akses cabang:{" "}
                <span className="font-medium text-gray-700">
                  {assignmentLabel(u)}
                </span>
              </p>
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

      <Dialog
        open={branchDialogUser !== null}
        onOpenChange={(open) => {
          if (!open) setBranchDialogUser(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Akses Cabang</DialogTitle>
            <DialogDescription>
              Atur cabang yang dapat diakses{" "}
              {branchDialogUser ? <b>{branchDialogUser.name}</b> : "-"}.{" "}
              {branches.length === 0
                ? "Cabang kosong — tambah cabang terlebih dahulu."
                : "Kosongkan semua ceklis = akses semua cabang."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={draftBranchIds.length === 0}
                onChange={() => setDraftBranchIds([])}
                className="h-4 w-4 accent-gray-900"
              />
              <span className="font-medium">Semua Cabang</span>
              <span className="text-xs text-muted-foreground">
                (tanpa pembatasan)
              </span>
            </label>
            {branches.map((b) => (
              <label
                key={b.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={draftBranchIds.includes(b.id)}
                  onChange={() => toggleDraftBranch(b.id)}
                  className="h-4 w-4 accent-gray-900"
                />
                <Store className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="font-medium">{b.name}</span>
                <span className="text-xs text-muted-foreground">({b.code})</span>
                {!b.isActive && (
                  <Badge variant="outline" className="text-red-600 border-red-200">
                    Nonaktif
                  </Badge>
                )}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBranchDialogUser(null)}
              disabled={savingBranches}
            >
              Batal
            </Button>
            <Button onClick={handleSaveBranches} disabled={savingBranches}>
              {savingBranches && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
