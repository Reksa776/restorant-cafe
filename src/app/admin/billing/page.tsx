"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CreditCard,
  Loader2,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  billingService,
  type BillingCycleCode,
  type BillingInvoice,
  type BillingOverview,
  type PlanCode,
} from "@/services/billing.service";

// ============================================================
// /admin/billing — SaaS plan, branch add-ons and invoices.
//
// Every amount shown here is a PREVIEW; the server recomputes it from
// PLAN_CATALOG when the invoice is created (a client price is never trusted).
// ============================================================

const UPGRADE_PLANS: PlanCode[] = ["BASIC", "PRO", "ENTERPRISE"];

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  TRIAL: "Free Trial",
  ACTIVE: "Aktif",
  PAST_DUE: "Menunggu Pembayaran",
  CANCELLED: "Dibatalkan",
  EXPIRED: "Berakhir",
};

const INVOICE_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  PAID: "Lunas",
  EXPIRED: "Kedaluwarsa",
  FAILED: "Gagal",
};

const INVOICE_TYPE_LABEL: Record<string, string> = {
  PLAN_UPGRADE: "Upgrade Paket",
  BRANCH_ADDON: "Add-On Cabang",
  RENEWAL: "Perpanjangan",
};

function formatRupiah(value: number): string {
  return `Rp${Number(value || 0).toLocaleString("id-ID")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

export default function BillingPage() {
  const [data, setData] = useState<BillingOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cycle, setCycle] = useState<BillingCycleCode>("MONTHLY");
  const [addonQty, setAddonQty] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const overview = await billingService.getOverview();
      setData(overview);
      setCycle(overview.subscription.billingCycle);
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Gagal memuat data billing";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Deferred initial load (setState happens in the async continuation, never
  // synchronously in the effect body).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) void load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleCheckout = async (
    planCode: PlanCode,
    type: "PLAN_UPGRADE" | "BRANCH_ADDON",
    qty?: number
  ) => {
    const key = type === "BRANCH_ADDON" ? `addon-${qty}` : `plan-${planCode}`;
    setBusy(key);
    try {
      const result = await billingService.checkout({
        type,
        planCode,
        billingCycle: cycle,
        addonBranchesQty: type === "BRANCH_ADDON" ? qty : undefined,
      });

      if (result.paymentMode === "IPAYMU" && result.invoice.paymentUrl) {
        window.open(result.invoice.paymentUrl, "_blank", "noopener,noreferrer");
        toast.success("Invoice dibuat. Selesaikan pembayaran di tab baru.");
      } else {
        toast.success(
          "Mode simulasi: invoice dibuat. Klik 'Simulasi Lunas' pada riwayat invoice."
        );
      }
      await load();
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Gagal membuat tagihan";
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const handleConfirmMock = async (invoice: BillingInvoice) => {
    setBusy(`confirm-${invoice.id}`);
    try {
      await billingService.confirmMock(invoice.id);
      toast.success("Invoice lunas — paket langganan diperbarui.");
      await load();
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Gagal mengonfirmasi invoice";
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Paket &amp; Billing</h1>
        <p className="text-gray-500">
          Data billing tidak dapat dimuat. Muat ulang halaman ini.
        </p>
      </div>
    );
  }

  const { subscription, usage } = data;
  const currentPlan = data.catalog.find((p) => p.code === subscription.planCode);
  const isMock = data.paymentMode === "MOCK";
  const canConfirmMock =
    isMock || process.env.NODE_ENV !== "production";
  const addonUnitPrice =
    cycle === "YEARLY"
      ? (currentPlan?.addonBranchYearly ?? 0)
      : (currentPlan?.addonBranchMonthly ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Paket &amp; Billing</h1>
        <p className="text-gray-500">
          Kelola langganan, kuota cabang, dan riwayat tagihan restoran Anda.
        </p>
      </div>

      {/* ===== Status paket aktif ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Paket Aktif
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-2xl font-bold">{subscription.planName}</span>
            <Badge
              className={
                subscription.status === "ACTIVE" || subscription.status === "TRIAL"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }
            >
              {SUBSCRIPTION_STATUS_LABEL[subscription.status] ??
                subscription.status}
            </Badge>
            <span className="text-sm text-gray-500">
              {subscription.billingCycle === "YEARLY" ? "Tahunan" : "Bulanan"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Sisa masa aktif"
              value={`${subscription.daysRemaining} hari`}
              hint={`Berakhir ${formatDate(subscription.currentPeriodEnd)}`}
            />
            <Stat
              label="Kuota cabang"
              value={`${usage.branches.used} / ${usage.branches.limit} cabang`}
              hint={
                usage.branches.extra > 0
                  ? `Termasuk ${usage.branches.extra} add-on`
                  : "1 cabang utama"
              }
            />
            <Stat
              label="Transaksi bulan ini"
              value={
                usage.transactions.limit
                  ? `${usage.transactions.used} / ${usage.transactions.limit}`
                  : `${usage.transactions.used}`
              }
              hint={
                usage.transactions.limit
                  ? "Batas paket Starter"
                  : "Unlimited"
              }
            />
          </div>

          <p className="flex items-center gap-1.5 text-xs text-gray-500">
            <Users className="h-3.5 w-3.5" />
            Staf terpakai: {usage.staff.used}
            {usage.staff.limit ? ` / ${usage.staff.limit}` : " (unlimited)"}
          </p>

          {isMock && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Mode simulasi pembayaran aktif (kredensial iPaymu SaaS belum
              diset). Invoice bisa diselesaikan dengan tombol “Simulasi Lunas”.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== Upgrade paket ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Upgrade Paket</h2>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setCycle("MONTHLY")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              cycle === "MONTHLY"
                ? "bg-brand-primary text-brand-primary-foreground"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Bulanan
          </button>
          <button
            type="button"
            onClick={() => setCycle("YEARLY")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              cycle === "YEARLY"
                ? "bg-brand-primary text-brand-primary-foreground"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Tahunan
            <span className="ml-1 text-[10px] opacity-80">(Hemat 2 bulan)</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {data.catalog
          .filter((plan) => UPGRADE_PLANS.includes(plan.code))
          .map((plan) => {
            const price =
              cycle === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice;
            const isCurrent =
              subscription.planCode === plan.code &&
              subscription.status !== "EXPIRED";
            const currentIndex = data.catalog.findIndex(
              (p) => p.code === subscription.planCode
            );
            const targetIndex = data.catalog.findIndex(
              (p) => p.code === plan.code
            );
            const isDowngrade =
              targetIndex < currentIndex &&
              subscription.status !== "EXPIRED" &&
              subscription.status !== "CANCELLED";
            const busyKey = `plan-${plan.code}`;

            return (
              <Card
                key={plan.code}
                className={
                  plan.code === "PRO" ? "border-2 border-brand-primary" : ""
                }
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span>{plan.name}</span>
                    {plan.code === "PRO" && (
                      <Badge className="bg-brand-primary text-brand-primary-foreground">
                        Best Value
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-gray-500">{plan.tagline}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <span className="text-2xl font-bold">
                      {formatRupiah(price)}
                    </span>
                    <span className="text-sm text-gray-500">
                      /{cycle === "YEARLY" ? "tahun" : "bulan"}
                    </span>
                    {cycle === "YEARLY" && plan.monthlyPrice > 0 && (
                      <p className="text-[11px] text-emerald-600">
                        Setara {formatRupiah(Math.round(plan.yearlyPrice / 12))}
                        /bulan
                      </p>
                    )}
                  </div>

                  <ul className="space-y-1.5">
                    {plan.highlights.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-1.5 text-xs text-gray-600"
                      >
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        {item}
                      </li>
                    ))}
                  </ul>

                  <Button
                    type="button"
                    className="w-full"
                    variant={plan.code === "PRO" ? "default" : "outline"}
                    disabled={isCurrent || isDowngrade || busy !== null}
                    onClick={() => handleCheckout(plan.code, "PLAN_UPGRADE")}
                  >
                    {busy === busyKey ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isCurrent ? (
                      "Paket Aktif"
                    ) : isDowngrade ? (
                      "Downgrade tidak tersedia"
                    ) : (
                      `Upgrade ke ${plan.name}`
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
      </div>

      {/* ===== Add-On Cabang ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" /> Tambah Kuota Cabang (Add-On)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!currentPlan?.canBuyBranchAddon ? (
            <p className="text-sm text-gray-600">
              Paket Starter hanya mendukung 1 cabang utama. Upgrade ke Basic
              atau lebih tinggi untuk membeli Add-On Cabang Baru.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Setiap add-on menambah 1 kuota cabang baru di luar cabang utama.
                Harga per cabang untuk paket {subscription.planName}:{" "}
                <span className="font-semibold">
                  {formatRupiah(addonUnitPrice)}
                </span>
                /{cycle === "YEARLY" ? "tahun" : "bulan"}.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {[1, 2, 3].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => setAddonQty(qty)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      addonQty === qty
                        ? "border-brand-primary bg-brand-secondary text-brand-secondary-foreground"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    +{qty} cabang
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="text-sm">
                  Total:{" "}
                  <span className="text-lg font-bold">
                    {formatRupiah(addonUnitPrice * addonQty)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {" "}
                    /{cycle === "YEARLY" ? "tahun" : "bulan"}
                  </span>
                </p>
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    handleCheckout(
                      subscription.planCode,
                      "BRANCH_ADDON",
                      addonQty
                    )
                  }
                >
                  {busy === `addon-${addonQty}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Beli ${addonQty} Add-On Cabang`
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== Riwayat invoice ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Riwayat Invoice
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.invoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Belum ada invoice.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3">Invoice</th>
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2 pr-3">Jenis</th>
                    <th className="py-2 pr-3">Paket</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((invoice) => {
                    const canPay =
                      invoice.status === "PENDING" &&
                      !!invoice.paymentUrl &&
                      /^https?:\/\//i.test(invoice.paymentUrl);
                    return (
                      <tr key={invoice.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-3 font-mono text-xs">
                          {invoice.invoiceNumber}
                        </td>
                        <td className="py-2.5 pr-3 text-gray-600">
                          {formatDate(invoice.createdAt)}
                        </td>
                        <td className="py-2.5 pr-3 text-gray-600">
                          {INVOICE_TYPE_LABEL[invoice.type] ?? invoice.type}
                        </td>
                        <td className="py-2.5 pr-3 text-gray-600">
                          {invoice.targetPlanCode}
                          {invoice.addonBranchesQty > 0
                            ? ` · +${invoice.addonBranchesQty} cabang`
                            : ""}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-medium">
                          {formatRupiah(invoice.amount)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge
                            className={
                              invoice.status === "PAID"
                                ? "bg-emerald-100 text-emerald-800"
                                : invoice.status === "PENDING"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-gray-100 text-gray-600"
                            }
                          >
                            {INVOICE_STATUS_LABEL[invoice.status] ??
                              invoice.status}
                          </Badge>
                        </td>
                        <td className="py-2.5">
                          <div className="flex flex-wrap gap-2">
                            {canPay && (
                              <a
                                href={invoice.paymentUrl ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-medium text-brand-primary hover:underline"
                              >
                                Lanjut Bayar
                              </a>
                            )}
                            {invoice.status === "PENDING" && canConfirmMock && (
                              <button
                                type="button"
                                onClick={() => handleConfirmMock(invoice)}
                                disabled={busy !== null}
                                className="text-xs font-medium text-gray-600 hover:text-black disabled:opacity-50"
                              >
                                {busy === `confirm-${invoice.id}` ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  "Simulasi Lunas"
                                )}
                              </button>
                            )}
                            {invoice.status !== "PENDING" && !canPay && (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
