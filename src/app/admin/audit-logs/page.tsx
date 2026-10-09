"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  auditLogService,
  type AuditLogView,
} from "@/services/audit.service";
import { userService } from "@/services/shift.service";
import { normalizeApiError } from "@/lib/api-error-handler";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  RefreshCw,
  Search,
} from "lucide-react";

const PAGE_SIZE = 25;

/** Timestamp → "17 Sep 2026, 08.30" (local, no seconds). */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2 last:border-0">
      <dt className="shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words">
        {children}
      </dd>
    </div>
  );
}

/**
 * Admin Audit Log viewer. Read-only over the existing AuditLog rows (single
 * audit engine — no new model/engine). Restaurant-scoped server-side; branch
 * filter is sent as an explicit, server-validated `branchId`. `details` is
 * already redacted by the API before it reaches this page.
 */
export default function AuditLogsPage() {
  const { branches, isLoading: branchCtxLoading } = useBranchContext();

  const [items, setItems] = useState<AuditLogView[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state — applied filters vs. the raw search input.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [userId, setUserId] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");

  // Picker options — loaded from existing tenant-scoped sources, never
  // hardcoded (a stale literal list would silently hide new audit actions).
  const [actions, setActions] = useState<string[]>([]);
  const [actors, setActors] = useState<
    Array<{ id: string; name: string; role: string }>
  >([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [detail, setDetail] = useState<AuditLogView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await auditLogService.list({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        action: action || undefined,
        entityType: entityType || undefined,
        entityId: entityId || undefined,
        userId: userId || undefined,
        branchId: branchFilter !== "all" ? branchFilter : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      setError(normalizeApiError(err).message);
      setItems([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    search,
    action,
    entityType,
    entityId,
    userId,
    branchFilter,
    dateFrom,
    dateTo,
  ]);

  // Wait for the branch context so a stale admin_branch_id is cleared before
  // the scoped request fires (mirrors the reservations/customers pages).
  useEffect(() => {
    if (branchCtxLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- established admin fetch pattern
    load();
  }, [branchCtxLoading, load]);

  // Action options — the distinct actions that actually exist in this admin's
  // tenant/branch scope (server-derived from the same scoped predicate as the
  // list, so the picker can never surface an out-of-scope action).
  useEffect(() => {
    if (branchCtxLoading) return;
    let alive = true;
    auditLogService
      .listActions({ branchId: branchFilter !== "all" ? branchFilter : undefined })
      .then((list) => {
        if (alive) setActions(list);
      })
      .catch(() => {
        // Convenience only — the viewer still works without the dropdown.
      });
    return () => {
      alive = false;
    };
  }, [branchCtxLoading, branchFilter]);

  // Actor options — the restaurant's own staff via the existing ADMIN-only
  // /api/users endpoint (restaurant-scoped server-side from the session).
  useEffect(() => {
    let alive = true;
    userService
      .listUsers()
      .then((res) => {
        if (!alive) return;
        setActors(
          (res.items || []).map((u) => ({
            id: u.id,
            name: u.name,
            role: u.role,
          }))
        );
      })
      .catch(() => {
        // Convenience only — the viewer still works without the dropdown.
      });
    return () => {
      alive = false;
    };
  }, []);

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setAction("");
    setEntityType("");
    setEntityId("");
    setUserId("");
    setBranchFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasActiveFilters =
    Boolean(search || action || entityType || entityId || userId) ||
    branchFilter !== "all" ||
    Boolean(dateFrom || dateTo);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-brand-primary" />
            Audit Logs
          </h1>
          <p className="text-gray-500">
            Riwayat aktivitas sensitif — hanya dapat dilihat oleh Admin
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => load()}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Muat Ulang
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="audit-search">Pencarian</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="audit-search"
                  placeholder="Cari action / entity..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSearch(searchInput.trim());
                      setPage(1);
                    }
                  }}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Action</Label>
              <Select
                value={action || "all"}
                onValueChange={(v) => {
                  setAction(v === "all" ? "" : (v ?? ""));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Semua Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Action</SelectItem>
                  {actions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-entity-type">Entity</Label>
              <Input
                id="audit-entity-type"
                placeholder="mis. Order"
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-entity-id">Entity ID</Label>
              <Input
                id="audit-entity-id"
                placeholder="ID entitas"
                value={entityId}
                onChange={(e) => {
                  setEntityId(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Aktor</Label>
              <Select
                value={userId || "all"}
                onValueChange={(v) => {
                  setUserId(v === "all" ? "" : (v ?? ""));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Semua Aktor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Aktor</SelectItem>
                  {actors.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.id} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Cabang</Label>
              <Select
                value={branchFilter}
                onValueChange={(v) => {
                  setBranchFilter(v || "all");
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Cabang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Cabang</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-date-from">Dari Tanggal</Label>
              <Input
                id="audit-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="audit-date-to">Sampai Tanggal</Label>
              <Input
                id="audit-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                size="sm"
                onClick={resetFilters}
                disabled={!hasActiveFilters}
              >
                Reset Filter
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Board */}
      <Card>
        <CardHeader>
          <CardTitle>Riwayat Audit</CardTitle>
        </CardHeader>
        <CardContent>
          {error && !loading ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-gray-600">{error}</p>
              <Button variant="outline" size="sm" onClick={() => load()}>
                Coba Lagi
              </Button>
            </div>
          ) : loading && items.length === 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {["Waktu", "Aktor", "Action", "Entity", "Cabang", "IP", ""].map(
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
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-40" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-8" />
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
                  ? "Tidak ada log audit untuk filter ini."
                  : "Belum ada log audit"}
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
                      <TableHead>Waktu</TableHead>
                      <TableHead>Aktor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="hidden md:table-cell">Entity</TableHead>
                      <TableHead className="hidden lg:table-cell">Cabang</TableHead>
                      <TableHead className="hidden xl:table-cell">IP</TableHead>
                      <TableHead className="text-right">Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-gray-600">
                          {formatTimestamp(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          {log.actor ? (
                            <>
                              <p className="font-medium">{log.actor.name || "-"}</p>
                              <p className="text-xs text-gray-500">
                                {log.actor.role}
                              </p>
                            </>
                          ) : (
                            <span className="text-gray-400">Sistem</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {log.action}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {log.entityType ? (
                            <>
                              <p className="whitespace-nowrap">{log.entityType}</p>
                              {log.entityId && (
                                <p className="text-xs text-gray-500 font-mono truncate max-w-[180px]">
                                  {log.entityId}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {log.branch ? (
                            log.branch.name
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell whitespace-nowrap text-gray-600">
                          {log.ipAddress || (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Detail ${log.action}`}
                            onClick={() => setDetail(log)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    {total} log · halaman {page} dari {totalPages}
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

      {/* Detail */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detail Log Audit</DialogTitle>
            <DialogDescription>
              Data sensitif (password/token/secret) sudah disamarkan.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="max-h-[60vh] overflow-y-auto">
              <DetailRow label="Waktu">
                {formatTimestamp(detail.createdAt)}
              </DetailRow>
              <DetailRow label="Aktor">
                {detail.actor
                  ? `${detail.actor.name || "-"} (${detail.actor.role})`
                  : "Sistem"}
              </DetailRow>
              <DetailRow label="Email">
                {detail.actor?.email || "-"}
              </DetailRow>
              <DetailRow label="Action">{detail.action}</DetailRow>
              <DetailRow label="Entity">{detail.entityType || "-"}</DetailRow>
              <DetailRow label="Entity ID">
                <span className="font-mono text-xs break-all">
                  {detail.entityId || "-"}
                </span>
              </DetailRow>
              <DetailRow label="Cabang">
                {detail.branch
                  ? `${detail.branch.name} (${detail.branch.code})`
                  : "-"}
              </DetailRow>
              <DetailRow label="IP">{detail.ipAddress || "-"}</DetailRow>
              <DetailRow label="Details">
                {detail.details ? (
                  <pre className="max-w-full overflow-x-auto rounded-md bg-gray-50 p-2 text-left text-xs text-gray-700">
                    {JSON.stringify(detail.details, null, 2)}
                  </pre>
                ) : (
                  "-"
                )}
              </DetailRow>
            </dl>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setDetail(null)}>
              Tutup
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
