"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Boxes,
  Landmark,
  Package,
  Percent,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Undo2,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBranchContext } from "@/hooks/use-branch-context";
import { useUserRole } from "@/hooks/use-user-role";
import {
  reportService,
  type PurchaseReport,
  type SalesReport,
} from "@/services/report.service";
import {
  profitabilityService,
  type ProfitabilityReport,
} from "@/services/profitability.service";
import {
  normalizeApiError,
  isUnauthorized,
  type NormalizedApiError,
} from "@/lib/api-error-handler";
import {
  presetToReportParams,
  toLocalDay,
  type DashboardPeriodPreset,
} from "@/lib/report-periods";
import { AnalyticsPeriodFilter } from "@/components/admin/analytics/period-filter";
import { ChartFrame, MetricTile } from "@/components/admin/analytics/chart-frame";
import {
  BreakdownDonut,
  CategoryBarChart,
  PeakHoursChart,
  PurchasingTrendChart,
  SalesTrendChart,
} from "@/components/admin/analytics/charts";

// ============================================================
// Dashboard Analytics.
//
// This component is a COMPOSER, not an analytics engine: every number comes
// from the existing report services (`/api/reports/sales`,
// `/api/reports/purchases`, `/api/reports/profitability`), and all revenue /
// refund / COGS semantics live server-side in
// `src/services/report/report.service.ts` and
// `src/services/profitability/profitability.service.ts`. Nothing here
// recomputes a business metric from raw rows, and no order/item list is ever
// pulled into the browser.
//
// ROLE BOUNDARY
//   ADMIN  — everything (incl. purchasing + COGS/gross profit/margin)
//   CASHIER — sales overview, orders, best sellers/categories, payment
//             breakdown, order type, peak hours. NO purchasing, NO financial
//             profitability. The COGS/profit endpoints are ADMIN-only
//             server-side, so this is also enforced beyond the UI.
// ============================================================

const rupiah = (v: number | null | undefined) =>
  `Rp${Math.round(Number(v) || 0).toLocaleString("id-ID")}`;

const percent = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`;

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash (Kasir)",
  qris: "QRIS",
  va: "VA / Gateway",
  other: "Lainnya",
  unpaid: "Belum Dibayar",
  failed: "Gagal / Kedaluwarsa",
  refunded: "Refund",
  cancelled: "Dibatalkan",
};

/** Buckets that represent COLLECTED revenue (safe to chart as sales). */
const PAID_BUCKET_KEYS = ["cash", "qris", "va", "other"] as const;
/** Buckets that are activity only — never revenue. */
const ACTIVITY_BUCKET_KEYS = [
  "unpaid",
  "failed",
  "refunded",
  "cancelled",
] as const;

const ORDER_TYPE_LABELS: Record<string, string> = {
  DINE_IN: "Dine In",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

const PAYMENT_STATUS_BADGE: Record<string, string> = {
  unpaid: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
  refunded: "bg-orange-100 text-orange-800",
  cancelled: "bg-gray-200 text-gray-600",
};

export function DashboardAnalytics() {
  const { role, isLoading: roleLoading } = useUserRole();
  const { isLoading: branchCtxLoading, branchId } = useBranchContext();
  const isAdmin = role === "ADMIN";

  const [preset, setPreset] = useState<DashboardPeriodPreset>("today");
  const [startDate, setStartDate] = useState(() => toLocalDay(new Date()));
  const [endDate, setEndDate] = useState(() => toLocalDay(new Date()));

  const [sales, setSales] = useState<SalesReport | null>(null);
  const [purchases, setPurchases] = useState<PurchaseReport | null>(null);
  const [profit, setProfit] = useState<ProfitabilityReport | null>(null);

  const [salesError, setSalesError] = useState<NormalizedApiError | null>(null);
  const [purchasesError, setPurchasesError] =
    useState<NormalizedApiError | null>(null);
  const [profitError, setProfitError] = useState<NormalizedApiError | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const params = useMemo(
    () => presetToReportParams(preset, { startDate, endDate }),
    [preset, startDate, endDate]
  );

  const load = useCallback(async () => {
    if (roleLoading || !role || branchCtxLoading) return;
    setLoading(true);

    // A selected branch is passed EXPLICITLY as the existing `branchId`
    // service param. This matters for an ADMIN without UserBranch
    // assignments ("unrestricted"): for such a user `authorizedBranches()`
    // ignores the validated x-branch-id hint and returns `undefined` (all
    // branches), so the header alone cannot scope the report — an explicit
    // branchId is the documented winning path. Branch-scoped users get the
    // same result either way. When `branchId` is null ("Semua Cabang") the
    // param is omitted and the existing all-authorized-branches behaviour is
    // preserved.
    //
    // This is NOT a client-side authorization decision: the API re-validates
    // the value against the session's restaurant and the user's assignments
    // (a foreign branch still yields 403).
    const request = {
      period: params.period,
      startDate: params.startDate,
      endDate: params.endDate,
      branchId: branchId ?? undefined,
    };

    // Each section is settled independently: a failure in one (e.g. a 403 on
    // profitability) must not blank the sections that did load.
    const tasks: Array<Promise<void>> = [
      reportService
        .getSalesReport(request)
        .then((data) => {
          setSales(data);
          setSalesError(null);
        })
        .catch((error) => {
          if (isUnauthorized(error)) return; // handled by the axios interceptor
          console.error("Failed to load analytics sales report:", error);
          setSalesError(normalizeApiError(error));
        }),
    ];

    if (isAdmin) {
      tasks.push(
        reportService
          .getPurchaseReport(request)
          .then((data) => {
            setPurchases(data);
            setPurchasesError(null);
          })
          .catch((error) => {
            if (isUnauthorized(error)) return;
            console.error("Failed to load analytics purchase report:", error);
            setPurchasesError(normalizeApiError(error));
          }),
        profitabilityService
          .getProfitabilityReport(request)
          .then((data) => {
            setProfit(data);
            setProfitError(null);
          })
          .catch((error) => {
            if (isUnauthorized(error)) return;
            console.error("Failed to load analytics profitability:", error);
            setProfitError(normalizeApiError(error));
          })
      );
    }

    await Promise.all(tasks);
    setLoading(false);
  }, [params, isAdmin, role, roleLoading, branchCtxLoading, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  // No session at all (role never resolves): render nothing rather than a
  // permanent spinner. `/admin/*` is already auth-gated, this is belt-and-braces.
  const unauthenticated = !roleLoading && !role;

  const summary = sales?.summary;

  const rangeLabel = sales
    ? `${new Date(sales.range.start).toLocaleDateString("id-ID")} — ${new Date(
        sales.range.end
      ).toLocaleDateString("id-ID")}`
    : null;

  const salesTrend = sales?.dailySeries ?? [];
  const salesTrendEmpty =
    salesTrend.length === 0 ||
    salesTrend.every((d) => d.orders === 0 && d.sales === 0);

  const purchaseTrend = purchases?.dailySeries ?? [];
  const purchaseTrendEmpty =
    purchaseTrend.length === 0 ||
    purchaseTrend.every((d) => d.purchases === 0 && d.value === 0);

  // Paid buckets only — the non-paid buckets are activity, never revenue.
  const paymentDonut = useMemo(() => {
    if (!sales) return [];
    return PAID_BUCKET_KEYS.map((key) => ({
      name: PAYMENT_LABELS[key],
      value: Number(sales.paymentBreakdown[key]?.amount ?? 0),
    })).filter((b) => b.value > 0);
  }, [sales]);

  const paymentActivity = useMemo(() => {
    if (!sales) return [];
    return ACTIVITY_BUCKET_KEYS.map((key) => ({
      key,
      label: PAYMENT_LABELS[key],
      count: sales.paymentBreakdown[key]?.count ?? 0,
    })).filter((b) => b.count > 0);
  }, [sales]);

  const orderTypeBars = useMemo(() => {
    if (!sales) return [];
    return (["DINE_IN", "TAKEAWAY", "DELIVERY"] as const).map((key) => ({
      name: ORDER_TYPE_LABELS[key],
      value: Number(sales.orderType[key]?.amount ?? 0),
      count: sales.orderType[key]?.count ?? 0,
    }));
  }, [sales]);

  const orderTypeEmpty = orderTypeBars.every(
    (t) => t.value === 0 && t.count === 0
  );

  const peakHours = sales?.busiestHours ?? [];

  if (unauthenticated) return null;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Analitik</h2>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Ringkasan penjualan, pembelian, dan profitabilitas"
              : "Ringkasan penjualan dan performa produk"}
          </p>
        </div>
      </div>

      <AnalyticsPeriodFilter
        preset={preset}
        onPresetChange={setPreset}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onRefresh={load}
        loading={loading}
        rangeLabel={rangeLabel}
      />

      {/* ===== SALES OVERVIEW ===== */}
      <ChartFrame
        title="Sales Overview"
        subtitle="Metrik penjualan mengikuti semantik laporan penjualan (hanya pembayaran PAID yang dihitung sebagai penjualan)"
        state={salesError ? "error" : loading && !sales ? "loading" : "ready"}
        errorMessage={salesError?.message}
        retryable={salesError?.retryable}
        onRetry={load}
        empty={!sales}
        emptyMessage="Belum ada data penjualan pada periode ini"
        height={180}
      >
        {summary && (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="Total Penjualan"
              value={rupiah(summary.totalSales)}
              hint={`Gross revenue ${rupiah(summary.grossRevenue)}`}
              icon={TrendingUp}
            />
            <MetricTile
              label="Total Order"
              value={String(summary.totalOrders)}
              hint={`${summary.paidOrders} lunas`}
              icon={ShoppingCart}
            />
            <MetricTile
              label="Item Terjual"
              value={String(summary.totalItemsSold)}
              icon={Package}
            />
            <MetricTile
              label="Rata-rata Order"
              value={rupiah(summary.averageOrderValue)}
              hint="Per order lunas"
              icon={Banknote}
            />
            <MetricTile
              label="Total Diskon"
              value={rupiah(summary.totalDiscount)}
              icon={Percent}
            />
            <MetricTile label="Total Pajak" value={rupiah(summary.totalTax)} icon={Landmark} />
            <MetricTile
              label="Service Charge"
              value={rupiah(summary.totalServiceCharge)}
              icon={Landmark}
            />
            <MetricTile
              label="Refund"
              value={rupiah(summary.totalRefund)}
              hint={`Reversal ${rupiah(summary.refundReversal)}`}
              icon={Undo2}
              tone="negative"
            />
            <MetricTile
              label="Net Sales"
              value={rupiah(summary.netSales)}
              hint="Setelah refund, basis product revenue"
              icon={TrendingUp}
              tone="positive"
            />
          </div>
        )}
      </ChartFrame>

      {/* ===== SALES TREND ===== */}
      <ChartFrame
        title="Penjualan per Hari"
        subtitle="Penjualan dan jumlah order per hari"
        state={salesError ? "error" : loading && !sales ? "loading" : "ready"}
        errorMessage={salesError?.message}
        retryable={salesError?.retryable}
        onRetry={load}
        empty={salesTrendEmpty}
        emptyMessage="Belum ada penjualan pada periode ini"
      >
        <SalesTrendChart data={salesTrend} />
      </ChartFrame>

      {/* ===== BEST SELLERS ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Produk Terlaris"
          subtitle="Quantity sold & revenue per produk"
          state={salesError ? "error" : loading && !sales ? "loading" : "ready"}
          errorMessage={salesError?.message}
          retryable={salesError?.retryable}
          onRetry={load}
          empty={(sales?.bestSellingProducts.length ?? 0) === 0}
          emptyMessage="Belum ada produk terjual pada periode ini"
          height={240}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales?.bestSellingProducts.map((p, i) => (
                <TableRow key={p.productId}>
                  <TableCell className="text-xs text-gray-400">{i + 1}</TableCell>
                  <TableCell>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-gray-500">
                      {p.categoryName || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.quantitySold}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rupiah(p.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartFrame>

        <ChartFrame
          title="Kategori Terlaris"
          subtitle="Quantity sold & revenue per kategori"
          state={salesError ? "error" : loading && !sales ? "loading" : "ready"}
          errorMessage={salesError?.message}
          retryable={salesError?.retryable}
          onRetry={load}
          empty={(sales?.bestCategories.length ?? 0) === 0}
          emptyMessage="Belum ada kategori terjual pada periode ini"
          height={240}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales?.bestCategories.map((c, i) => (
                <TableRow key={c.name}>
                  <TableCell className="text-xs text-gray-400">{i + 1}</TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.quantitySold}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rupiah(c.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartFrame>
      </div>

      {/* ===== PAYMENT + ORDER TYPE ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Payment Breakdown"
          subtitle="Hanya pembayaran berstatus PAID yang dihitung sebagai penjualan"
          state={salesError ? "error" : loading && !sales ? "loading" : "ready"}
          errorMessage={salesError?.message}
          retryable={salesError?.retryable}
          onRetry={load}
          empty={paymentDonut.length === 0}
          emptyMessage="Belum ada pembayaran lunas pada periode ini"
        >
          <BreakdownDonut data={paymentDonut} />
          {paymentActivity.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
              <p className="text-xs text-muted-foreground">
                Bukan penjualan (aktivitas saja):
              </p>
              <div className="flex flex-wrap gap-2">
                {paymentActivity.map((a) => (
                  <Badge
                    key={a.key}
                    className={`text-xs ${PAYMENT_STATUS_BADGE[a.key] ?? ""}`}
                  >
                    {a.label}: {a.count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </ChartFrame>

        <ChartFrame
          title="Order Type Breakdown"
          subtitle="Nilai dan jumlah order per tipe"
          state={salesError ? "error" : loading && !sales ? "loading" : "ready"}
          errorMessage={salesError?.message}
          retryable={salesError?.retryable}
          onRetry={load}
          empty={orderTypeEmpty}
          emptyMessage="Belum ada order pada periode ini"
        >
          <CategoryBarChart data={orderTypeBars} />
          <div className="mt-2 flex flex-wrap justify-around gap-2 border-t border-gray-100 pt-3">
            {orderTypeBars.map((t) => (
              <div key={t.name} className="text-center">
                <p className="text-xs text-muted-foreground">{t.name}</p>
                <p className="text-sm font-semibold tabular-nums">
                  {t.count} order
                </p>
              </div>
            ))}
          </div>
        </ChartFrame>
      </div>

      {/* ===== PEAK HOURS ===== */}
      <ChartFrame
        title="Jam Tersibuk"
        subtitle="Order dan penjualan berdasarkan jam order"
        state={salesError ? "error" : loading && !sales ? "loading" : "ready"}
        errorMessage={salesError?.message}
        retryable={salesError?.retryable}
        onRetry={load}
        empty={peakHours.length === 0}
        emptyMessage="Belum ada order pada periode ini"
      >
        <PeakHoursChart data={peakHours} />
      </ChartFrame>

      {/* ===== ADMIN ONLY: PURCHASING ===== */}
      {isAdmin && (
        <>
          <ChartFrame
            title="Purchasing Overview"
            subtitle="Nilai pembelian (Purchase.total). Purchase tidak menyimpan status pembayaran, jadi Paid/Unpaid tidak tersedia."
            state={
              purchasesError
                ? "error"
                : loading && !purchases
                  ? "loading"
                  : "ready"
            }
            errorMessage={purchasesError?.message}
            retryable={purchasesError?.retryable}
            onRetry={load}
            empty={!purchases}
            emptyMessage="Belum ada data pembelian pada periode ini"
            height={180}
          >
            {purchases && (
              <div className="space-y-4">
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                  <MetricTile
                    label="Total Purchase"
                    value={rupiah(purchases.summary.totalValue)}
                    hint={`${purchases.summary.totalPurchases} pembelian`}
                    icon={Wallet}
                  />
                  <MetricTile
                    label="Purchase Count"
                    value={String(purchases.summary.totalPurchases)}
                    icon={Boxes}
                  />
                  <MetricTile
                    label="Received"
                    value={String(purchases.summary.totalReceived)}
                    hint="Barang sudah diterima"
                    icon={Package}
                    tone="positive"
                  />
                  <MetricTile
                    label="Cancelled"
                    value={String(purchases.summary.totalCancelled)}
                    icon={TrendingDown}
                    tone="negative"
                  />
                </div>
                <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-muted-foreground">
                  Rincian per bahan baku belum tersedia: agregasi item pada
                  laporan pembelian masih berbasis produk legacy
                  (PurchaseItem), sedangkan pembelian baru memakai
                  PurchaseIngredient. Total nilai di atas sudah mencakup
                  keduanya.
                </p>
              </div>
            )}
          </ChartFrame>

          <ChartFrame
            title="Pembelian per Hari"
            subtitle="Nilai pembelian dan jumlah pembelian per hari"
            state={
              purchasesError
                ? "error"
                : loading && !purchases
                  ? "loading"
                  : "ready"
            }
            errorMessage={purchasesError?.message}
            retryable={purchasesError?.retryable}
            onRetry={load}
            empty={purchaseTrendEmpty}
            emptyMessage="Belum ada pembelian pada periode ini"
          >
            <PurchasingTrendChart data={purchaseTrend} />
          </ChartFrame>

          <ChartFrame
            title="Profitabilitas"
            subtitle="Revenue, COGS historis (snapshot F.5), dan gross profit"
            state={profitError ? "error" : loading && !profit ? "loading" : "ready"}
            errorMessage={profitError?.message}
            retryable={profitError?.retryable}
            onRetry={load}
            empty={!profit}
            emptyMessage="Belum ada data profitabilitas pada periode ini"
            height={180}
          >
            {profit && (
              <div className="space-y-4">
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                  <MetricTile
                    label="Revenue"
                    value={rupiah(profit.summary.totalSales)}
                    hint={`Net sales ${rupiah(profit.summary.netSales)}`}
                    icon={TrendingUp}
                  />
                  <MetricTile
                    label="COGS"
                    value={rupiah(profit.summary.cogs)}
                    hint="HPP historis tersnapshot"
                    icon={Boxes}
                    tone="muted"
                  />
                  <MetricTile
                    label="Gross Profit"
                    value={
                      profit.summary.grossProfit === null
                        ? "—"
                        : rupiah(profit.summary.grossProfit)
                    }
                    icon={TrendingUp}
                    tone="positive"
                  />
                  <MetricTile
                    label="Gross Margin"
                    value={percent(profit.summary.grossMarginPct)}
                    hint={
                      profit.summary.foodCostPct === null
                        ? undefined
                        : `Food cost ${percent(profit.summary.foodCostPct)}`
                    }
                    icon={Percent}
                  />
                </div>
                {!profit.summary.coverageComplete && (
                  <p className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                    COGS belum lengkap untuk periode ini
                    {profit.summary.cogsState
                      ? ` (status: ${profit.summary.cogsState})`
                      : ""}
                    . Gross profit &amp; margin hanya mencerminkan item yang
                    biayanya sudah tersnapshot.
                  </p>
                )}
              </div>
            )}
          </ChartFrame>
        </>
      )}
    </section>
  );
}
