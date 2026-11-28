"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { userService } from "@/services/shift.service";
import { branchService } from "@/services/branch.service";
import type { Branch } from "@/services/branch.service";
import { billingService, type BillingOverview } from "@/services/billing.service";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { toast } from "sonner";
import {
  ArrowUpRight,
  ChefHat,
  CreditCard,
  Loader2,
  ShieldCheck,
  Store,
  UserPlus,
  Users,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

// ============================================================
// /admin/users — staff accounts of one tenant (Owner/ADMIN only).
//
// The owner creates the accounts the whole outlet runs on:
//   ADMIN   — co-admin (full access, including finance & settings)
//   CASHIER — kasir (POS, shifts, payments)
//   KITCHEN — dapur (kitchen board: view & advance orders)
// Each account can be assigned to one branch, and the plan quota from
// /api/admin/billing (2 on Starter, 5 on Basic, unlimited on Pro/Enterprise)
// is shown up-front so the owner never hits a surprise 403.
// ============================================================

type StaffRoleCode = "ADMIN" | "CASHIER" | "KITCHEN";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: StaffRoleCode;
  isActive: boolean;
  createdAt: string;
}

const ROLE_META: Record<
  StaffRoleCode,
  {
    label: string;
    short: string;
    description: string;
    icon: typeof ShieldCheck;
    badge: string;
  }
> = {
  ADMIN: {
    label: "Co-Admin",
    short: "Admin",
    description:
      "Akses penuh seperti Owner: laporan, keuangan, pengaturan, dan staf.",
    icon: ShieldCheck,
    badge: "bg-blue-100 text-blue-700 border-blue-200",
  },
  CASHIER: {
    label: "Kasir",
    short: "Kasir",
    description:
      "Transaksi POS, buka/tutup shift, dan terima pembayaran pelanggan.",
    icon: CreditCard,
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  KITCHEN: {
    label: "Dapur",
    short: "Dapur",
    description:
      "Layar dapur: lihat pesanan masuk dan perbarui status masakannya.",
    icon: ChefHat,
    badge: "bg-amber-100 text-amber-700 border-amber-200",
  },
};

const ROLE_ORDER: StaffRoleCode[] = ["CASHIER", "KITCHEN", "ADMIN"];

export default function UsersPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
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
  const [role, setRole] = useState<StaffRoleCode>("CASHIER");
  const [branchId, setBranchId] = useState("");
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
      const [usersRes, branchesRes, billingRes] = await Promise.all([
        userService.listUsers(),
        branchService.getBranches().catch(() => [] as Branch[]),
        billingService.getOverview().catch(() => null),
      ]);
      setUsers(usersRes.items);
      setBranches(branchesRes);
      setBilling(billingRes);
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

  const quota = billing?.usage.staff;
  const planName = billing?.subscription.planName ?? null;
  const quotaFull = quota != null && quota.limit !== null && quota.used >= quota.limit;
  const quotaPercent = useMemo(() => {
    if (!quota) return 0;
    if (quota.limit === null) return 100;
    if (quota.limit <= 0) return 100;
    return Math.min(100, Math.round((quota.used / quota.limit) * 100));
  }, [quota]);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("CASHIER");
    setBranchId("");
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      await userService.createUser({
        name,
        email,
        password,
        role,
        branchId: branchId || null,
      });
      toast.success(
        `Akun ${ROLE_META[role].label} berhasil dibuat`
      );
      setDialogOpen(false);
      resetForm();
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
    // NEVER render a database id in the UI: when the branch row is missing
    // (e.g. the user was assigned to a branch that was later deleted), fall
    // back to the branch code if available, else a generic label.
    return ids
      .map((id) => {
        const branch = branches.find((b) => b.id === id);
        if (branch?.name) return branch.name;
        if (branch?.code) return branch.code;
        return "Cabang tidak ditemukan";
      })
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Pengguna</h1>
          <p className="text-muted-foreground">
            Kelola akun karyawan — Kasir, Dapur, dan Co-Admin
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={quotaFull}
          title={
            quotaFull
              ? "Kuota akun paket Anda sudah penuh — upgrade paket untuk menambah staf."
              : undefined
          }
        >
          <UserPlus className="h-4 w-4 mr-1" />
          Tambah Pengguna
        </Button>
      </div>

      {/* Plan quota */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Kuota Akun Pengguna
              </p>
              <p className="text-xl font-bold text-gray-900">
                {quota
                  ? quota.limit === null
                    ? `${quota.used} akun · Unlimited`
                    : `${quota.used} / ${quota.limit} akun`
                  : "—"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {planName
                  ? `Paket aktif: ${planName} · ${
                      quota?.limit === null
                        ? "staf tanpa batas"
                        : `maksimal ${quota?.limit ?? "-"} akun`
                    }`
                  : "Paket aktif belum bisa dimuat."}
              </p>
            </div>
          </div>

          {quotaFull && (
            <Link href="/admin/billing">
              <Button variant="default">
                <ArrowUpRight className="mr-1 h-4 w-4" />
                Upgrade Paket
              </Button>
            </Link>
          )}
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              quotaFull ? "bg-amber-500" : "bg-emerald-500"
            )}
            style={{ width: `${quotaPercent}%` }}
          />
        </div>

        {quotaFull && (
          <p className="mt-2 text-xs text-amber-700">
            Kuota akun karyawan paket {planName ?? "aktif"} sudah penuh.
            Nonaktifkan akun yang tidak dipakai, atau upgrade paket di menu
            Paket &amp; Billing untuk menambah staf.
          </p>
        )}
      </div>

      <div className="rounded-xl border bg-card divide-y">
        {users.map((u) => {
          const meta = ROLE_META[u.role] ?? ROLE_META.CASHIER;
          const RoleIcon = meta.icon;
          return (
            <div key={u.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                    <RoleIcon className="h-5 w-5 text-gray-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{u.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {u.email}
                    </p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                  <Badge className={meta.badge}>{meta.label}</Badge>
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
          );
        })}
        {users.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">
            Belum ada pengguna
          </p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Akun Karyawan</DialogTitle>
            <DialogDescription>
              Buat akun Kasir, Dapur, atau Co-Admin dan tugaskan ke cabang.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Nama Lengkap</Label>
              <Input
                id="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama karyawan"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email Login</Label>
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
              <Label>Peran</Label>
              <div className="space-y-2">
                {ROLE_ORDER.map((code) => {
                  const meta = ROLE_META[code];
                  const RoleIcon = meta.icon;
                  const selected = role === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setRole(code)}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900"
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                          selected
                            ? "bg-gray-900 text-white"
                            : "bg-gray-100 text-gray-600"
                        )}
                      >
                        <RoleIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">
                          {meta.label}
                        </span>
                        <span className="block text-xs leading-relaxed text-muted-foreground">
                          {meta.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-branch">Cabang</Label>
              <select
                id="user-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Semua Cabang (tanpa pembatasan)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Pilih satu cabang untuk membatasi akses karyawan ke cabang
                tersebut.
              </p>
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
              Buat Akun
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
