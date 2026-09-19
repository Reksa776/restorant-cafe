"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  reservationService,
  type ReservationTableView,
} from "@/services/reservation.service";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  getErrorStatus,
  getErrorMessage,
  isUnauthorized,
  normalizeApiError,
} from "@/lib/api-error-handler";
import { toast } from "sonner";
import { AlertCircle, ChevronLeft, ChevronRight, Eye, RefreshCw } from "lucide-react";
import {
  ReservationFilters,
  type BranchOption,
} from "@/components/admin/reservations/reservation-filters";
import { ReservationStatusBadge } from "@/components/admin/reservations/reservation-status-badge";
import { ReservationDetail } from "@/components/admin/reservations/reservation-detail";
import { ReservationCancelDialog } from "@/components/admin/reservations/reservation-cancel-dialog";
import {
  formatReservationDate,
  formatReservationDateTime,
  formatTimeSlot,
} from "@/components/admin/reservations/reservation-format";
import { formatPhoneDisplay } from "@/lib/phone";
import type { ReservationStatusValue } from "@/services/reservation/reservation.types";

const PAGE_SIZE = 15;

/** Primary (non-cancel) actions offered per current status — UX convenience
 *  only; the R2 service + R3 API stay authoritative (409 surfaced as-is). */
const STATUS_ACTIONS: Partial<
  Record<
    ReservationStatusValue,
    Array<{ target: ReservationStatusValue; label: string; confirm: string }>
  >
> = {
  PENDING: [
    { target: "CONFIRMED", label: "Konfirmasi", confirm: "Konfirmasi reservasi ini?" },
  ],
  CONFIRMED: [
    { target: "SEATED", label: "Seat", confirm: "Tandai reservasi ini sudah duduk?" },
    { target: "NO_SHOW", label: "No-show", confirm: "Tandai reservasi ini tidak hadir?" },
  ],
  SEATED: [
    { target: "COMPLETED", label: "Selesai", confirm: "Tandai reservasi ini selesai?" },
  ],
};

/** Cancel is offered on PENDING + CONFIRMED (matches the service transitions). */
function canCancel(status: string): boolean {
  return status === "PENDING" || status === "CONFIRMED";
}

/**
 * User-facing message for a failed action. The server's own message wins
 * (notably 409 conflict text); otherwise fall back to a status-class message.
 */
function statusErrorMessage(error: unknown): string {
  const serverMessage = getErrorMessage(error);
  if (serverMessage) return serverMessage;
  const status = getErrorStatus(error);
  switch (status) {
    case 400:
      return "Data yang dikirim tidak valid.";
    case 401:
      return "Sesi login sudah berakhir. Silakan login kembali.";
    case 403:
      return "Anda tidak memiliki akses untuk tindakan ini.";
    case 404:
      return "Reservasi tidak ditemukan.";
    case 409:
      return "Reservasi sudah berubah atau status tidak valid.";
    case 500:
      return "Terjadi kesalahan server. Silakan coba lagi.";
    default:
      return normalizeApiError(error).message;
  }
}

export default function ReservationsPage() {
  const { branches, isLoading: branchCtxLoading } = useBranchContext();

  const [items, setItems] = useState<ReservationTableView[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  // Detail / cancel dialogs
  const [detail, setDetail] = useState<{
    open: boolean;
    reservation: ReservationTableView | null;
  }>({ open: false, reservation: null });
  const [cancelTarget, setCancelTarget] =
    useState<ReservationTableView | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  // One in-flight mutation at a time (prevents double-click / double submit).
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);

  const hasActiveFilters =
    search !== "" ||
    statusFilter !== "all" ||
    branchFilter !== "all" ||
    dateFilter !== "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await reservationService.list({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        branchId: branchFilter === "all" ? undefined : branchFilter,
        date: dateFilter || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      // 401 is handled by the axios interceptor (redirect to login).
      if (isUnauthorized(err)) return;
      console.error("Failed to load reservations:", err);
      setError(normalizeApiError(err).message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, branchFilter, dateFilter]);

  // Wait for the branch context so a stale admin_branch_id is cleared before
  // the scoped request fires (mirrors orders/customers/tables). Branch
  // isolation then comes from the x-branch-id header (scoped users) and/or
  // the explicit branch filter above.
  useEffect(() => {
    if (branchCtxLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- established admin fetch pattern (see customers/tables/orders pages)
    load();
  }, [branchCtxLoading, load]);

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatusFilter("all");
    setBranchFilter("all");
    setDateFilter("");
    setPage(1);
  };

  const handleStatusAction = async (
    reservation: ReservationTableView,
    target: ReservationStatusValue
  ) => {
    const action = STATUS_ACTIONS[reservation.status]?.find(
      (a) => a.target === target
    );
    if (!action) return;
    if (mutatingKey) return;
    if (!window.confirm(action.confirm)) return;

    const key = `${target}:${reservation.id}`;
    setMutatingKey(key);
    try {
      const updated = await reservationService.updateStatus(reservation.id, target);
      toast.success(`Reservasi ${reservation.code} berhasil diupdate`);
      setDetail((prev) =>
        prev.open && prev.reservation?.id === reservation.id
          ? { ...prev, reservation: updated }
          : prev
      );
      await load();
    } catch (err) {
      toast.error(statusErrorMessage(err));
    } finally {
      setMutatingKey(null);
    }
  };

  const handleCancel = async (reason: string) => {
    const reservation = cancelTarget;
    if (!reservation || mutatingKey) return;

    const key = `cancel:${reservation.id}`;
    setMutatingKey(key);
    try {
      const updated = await reservationService.cancel(reservation.id, reason);
      toast.success(`Reservasi ${reservation.code} dibatalkan`);
      setCancelTarget(null);
      setCancelOpen(false);
      setDetail((prev) =>
        prev.open && prev.reservation?.id === reservation.id
          ? { ...prev, reservation: updated }
          : prev
      );
      await load();
    } catch (err) {
      toast.error(statusErrorMessage(err));
    } finally {
      setMutatingKey(null);
    }
  };

  const openDetail = (reservation: ReservationTableView) => {
    setDetail({ open: true, reservation });
  };

  const branchOptions: BranchOption[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reservasi</h1>
        <p className="text-gray-500">Kelola reservasi pelanggan</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <ReservationFilters
            search={searchInput}
            statusFilter={statusFilter}
            branchFilter={branchFilter}
            dateFilter={dateFilter}
            branches={branchOptions}
            onSearchChange={setSearchInput}
            onSearchSubmit={() => {
              setSearch(searchInput.trim());
              setPage(1);
            }}
            onStatusChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            onBranchChange={(v) => {
              setBranchFilter(v);
              setPage(1);
            }}
            onDateChange={(v) => {
              setDateFilter(v);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>

      {/* Board */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Daftar Reservasi</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => load()}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Muat Ulang
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && !loading ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-gray-600">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  load();
                }}
              >
                Coba Lagi
              </Button>
            </div>
          ) : loading && items.length === 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {["Kode", "Tamu", "Tanggal / Jam", "Jml", "Meja", "Status", "Aksi"].map(
                      (h) => (
                        <TableHead key={h}>{h}</TableHead>
                      )
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-8" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-24" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-gray-500">
                {hasActiveFilters
                  ? "Reservasi tidak ditemukan untuk filter ini."
                  : "Belum ada reservasi"}
              </p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Reset Filter
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kode</TableHead>
                      <TableHead>Tamu</TableHead>
                      <TableHead>Tanggal / Jam</TableHead>
                      <TableHead className="hidden sm:table-cell">Jml</TableHead>
                      <TableHead className="hidden md:table-cell">Meja</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden xl:table-cell">Dibuat</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {r.code}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{r.guestName}</p>
                          <p className="text-xs text-gray-500">
                            {formatPhoneDisplay(r.guestPhone)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="whitespace-nowrap">
                            {formatReservationDate(r.reservationDate)}
                          </p>
                          <p className="text-xs text-gray-500 whitespace-nowrap">
                            {formatTimeSlot(r.startMinutes, r.durationMinutes)}
                          </p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className="whitespace-nowrap">
                            {r.partySize} org
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell whitespace-nowrap">
                          {r.table
                            ? `Meja ${r.table.number}${
                                r.table.name ? ` · ${r.table.name}` : ""
                              }`
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <ReservationStatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="hidden xl:table-cell text-gray-500 whitespace-nowrap">
                          {formatReservationDateTime(r.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {(STATUS_ACTIONS[r.status] ?? []).map((a) => (
                              <Button
                                key={a.target}
                                variant="outline"
                                size="xs"
                                disabled={mutatingKey !== null}
                                onClick={() => handleStatusAction(r, a.target)}
                              >
                                {a.label}
                              </Button>
                            ))}
                            {canCancel(r.status) && (
                              <Button
                                variant="destructive"
                                size="xs"
                                disabled={mutatingKey !== null}
                                onClick={() => {
                                  setCancelTarget(r);
                                  setCancelOpen(true);
                                }}
                              >
                                Batal
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Detail ${r.code}`}
                              disabled={mutatingKey !== null}
                              onClick={() => openDetail(r)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    {total} reservasi · halaman {page} dari {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail + cancel */}
      <ReservationDetail
        open={detail.open}
        onOpenChange={(open) => setDetail((prev) => ({ ...prev, open }))}
        initial={detail.reservation}
      />
      <ReservationCancelDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        reservation={cancelTarget}
        pending={mutatingKey === `cancel:${cancelTarget?.id}`}
        onConfirm={handleCancel}
      />
    </div>
  );
}