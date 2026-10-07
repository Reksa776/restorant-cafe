"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  RotateCw,
  ShoppingBag,
  StickyNote,
  Table2,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { useCart } from "@/hooks/use-cart";
import { useCustomerAuth } from "@/hooks/use-customer-auth";
import { useBranding } from "@/hooks/use-branding";
import {
  getErrorCode,
  getErrorStatus,
  normalizeApiError,
} from "@/lib/api-error-handler";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import { layoutService } from "@/services/layout.service";
import { ReservationFloorMap } from "@/components/customer/reservation/reservation-floor-map";
import {
  floorMapCacheBranch,
  floorMapErrorMessage,
  mergeFloorMap,
  resolveFloorMapView,
  shouldRefetchFloorLayout,
} from "@/components/customer/reservation/reservation-floor-map.helpers";
import type {
  FloorMapLayoutItem,
  FloorMapLoadStatus,
} from "@/components/customer/reservation/reservation-floor-map.helpers";
import { RESERVATION_DEFAULT_DURATION_MINUTES } from "@/services/reservation/reservation.slots";
import {
  PAYMENT_STATUS_LABELS,
  PURCHASE_EMPTY_MESSAGE,
  PURCHASE_STEP_SUBTITLE,
  PURCHASE_STEP_TITLE,
  RESERVATION_CONFLICT_MESSAGE,
  RESERVATION_PAYMENT_METHOD_LABELS,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STEP_LABELS,
  RESERVATION_WIZARD_STEPS,
  TABLE_NOT_AVAILABLE_MESSAGE,
  buildCandidateSlots,
  formatReservationDate,
  formatRupiah,
  formatStartMinutes,
  formatTimeSlot,
  maxReservationDate,
  minReservationDate,
  previousWizardStep,
  reservationPurchaseLineNotes,
  reservationPurchaseSubtotal,
  reservationQrPayload,
  toReservationOrderItems,
} from "./reservation-flow";
import type {
  ReservationPaymentMethod,
  ReservationPurchaseLine,
  ReservationWizardStep,
} from "./reservation-flow";
import { ReservationProductPicker } from "@/components/customer/reservation/reservation-product-picker";
import { QrCodeDisplay } from "@/components/qr-code-display";

// ============================================================
// /reservasi — CUSTOMER RESERVATION WIZARD (PHASE R5).
//
// Single-page mobile-first flow:
//   1. Cabang → 2. Tanggal → 3. Jumlah orang → 4. Jam → 5. Meja →
//   6. Pembelian (pilih produk DI DALAM wizard — tanpa redirect ke /menu) →
//   7. Data tamu (termasuk No. WhatsApp untuk follow-up) → 8. Review →
//   Submit → Sukses.
//
// Reservation + pemesanan + pembayaran adalah SATU flow: submit membuat
// Reservation + Order + OrderItem (+ Payment) secara atomik lewat engine
// existing. Tidak ada syarat "punya pembelian historis" dan tidak ada redirect
// keluar dari wizard.
//
// The server is ALWAYS authoritative:
//   - availability comes per-slot from GET /public/reservations/availability
//   - creation goes to POST /public/reservations
//   - tenant/branch/customer/status/code are decided server-side; the client
//     only sends `branchCode`, window, `partySize`, a server-provided
//     `tableId`, guest contact, notes — never customerId/status/payment.
//   - a 409 (slot taken meanwhile) refreshes availability and never retries.
//
// No internal database ids are shown as UI text; `tableId` is only ever the
// server-provided identifier passed back on submit.
// ============================================================

// Step order/labels are pure data in `reservation-flow.ts` so the flow order
// (table → purchase → guest) is unit-tested, not just visual.
type Step = ReservationWizardStep;

const MAX_PARTY_SIZE = 100;

/**
 * Customer-facing labels/colors for the server slot status. The customer
 * reservation surface is RESERVATION-ONLY: only AVAILABLE / RESERVED ever
 * arrive from the server (`Table.status` / order state is never exposed here).
 */
const TABLE_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Tersedia",
  RESERVED: "Dipesan",
};
const TABLE_STATUS_BADGE: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-700",
  RESERVED: "bg-amber-100 text-amber-700",
};

interface PublicBranch {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  isActive: boolean;
}

interface TableAvailability {
  tableId: string;
  number: number;
  name: string;
  capacity: number;
  remainingSeats: number;
  available: boolean;
  /** Reservation-only slot status from the server (AVAILABLE/RESERVED). */
  status?: string;
}

interface SlotAvailability {
  available: boolean;
  tableId: string | null;
  partySize: number;
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  tables: TableAvailability[];
}

interface CreatedReservation {
  code: string;
  status: string;
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  partySize: number;
  guestName: string;
  guestPhone: string;
  branch: { code: string; name: string } | null;
  table: { number: number; name: string } | null;
  createdAt: string;
  /**
   * The reservation's OWN purchase (server-priced) — the data the existing
   * payment flow needs. Null only for legacy reservations created before the
   * single-flow change.
   */
  order: {
    orderNumber: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string | null;
    subtotal: number;
    discount: number;
    tax: number;
    serviceCharge: number;
    grandTotal: number;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
  } | null;
}

// ============================================================
// Small presentational pieces
// ============================================================

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2.5 last:border-0">
      <dt className="shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words">
        {children}
      </dd>
    </div>
  );
}

function BottomBar({
  onBack,
  backLabel = "Kembali",
  onNext,
  nextLabel,
  nextDisabled = false,
  nextLoading = false,
}: {
  onBack?: () => void;
  backLabel?: string;
  onNext?: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
}) {
  return (
    <div className="mt-6 flex items-center gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || nextLoading}
        className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 px-4 font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {nextLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Memproses...
          </>
        ) : (
          nextLabel
        )}
      </button>
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export default function ReservationPage() {
  const {
    isHydrated,
    tableContext,
    customerBranch,
    restaurantId: cartRestaurantId,
  } = useCart();
  const { customer, isHydrated: authHydrated } = useCustomerAuth();
  const { applyBranding } = useBranding();

  const [step, setStep] = useState<Step>("branch");

  // ---- Branch list (owner of codes/names + tenant id) ----
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [branchLoadState, setBranchLoadState] = useState<
    "loading" | "success" | "error"
  >("loading");
  const [branchError, setBranchError] = useState<string | null>(null);
  const [reservationRestaurantId, setReservationRestaurantId] = useState<
    string | null
  >(null);

  // ---- Wizard selections ----
  const [branchCode, setBranchCode] = useState("");
  const [branchName, setBranchName] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [partySize, setPartySize] = useState<number | null>(null);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  // ---- Availability (server-provided, per slot) ----
  const [avLoading, setAvLoading] = useState(false);
  const [avError, setAvError] = useState<string | null>(null);
  const [avReloadKey, setAvReloadKey] = useState(0);
  const [slotMap, setSlotMap] = useState<Record<number, SlotAvailability>>({});

  // ---- Customer floor map (Phase 5) — public layout per branch ----
  const [floorLayoutStatus, setFloorLayoutStatus] =
    useState<FloorMapLoadStatus>("idle");
  const [floorLayoutItems, setFloorLayoutItems] = useState<
    FloorMapLayoutItem[]
  >([]);
  const [floorLayoutError, setFloorLayoutError] = useState<string | null>(null);
  const [floorLayoutRetryKey, setFloorLayoutRetryKey] = useState(0);
  const [floorViewPreference, setFloorViewPreference] =
    useState<"map" | "list">("map");
  const [tableNotice, setTableNotice] = useState<string | null>(null);
  // Branch already fetched (ready OR error) for the current wizard session.
  const floorLayoutResolvedFor = useRef<string | null>(null);
  // Latest selections, readable from the availability effect without re-running it.
  const selectedStartRef = useRef<number | null>(null);
  const selectedTableRef = useRef<string | null>(null);

  // ---- Guest data ----
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [guestTried, setGuestTried] = useState(false);

  // ---- Pembelian — LOCAL wizard cart (never the global useCart/localStorage)
  const [purchaseLines, setPurchaseLines] = useState<ReservationPurchaseLine[]>(
    []
  );
  // Payment intent for the reservation's own order (DINE_IN).
  const [paymentMethod, setPaymentMethod] =
    useState<ReservationPaymentMethod>("QRIS");

  // ---- Submit ----
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedReservation | null>(null);

  // One-shot init gate (QR table context / saved customer branch).
  const initRef = useRef(false);

  // A QR table fixes the branch; the generic customer branch does not.
  const branchLocked = Boolean(tableContext?.branchCode);

  // Persisted branch/party context fills the wizard until the customer
  // overrides it — the server remains authoritative for branch availability.
  const effectiveBranchCode =
    branchCode || tableContext?.branchCode || customerBranch?.branchCode || "";
  const effectiveBranchName =
    branchName || customerBranch?.branchName || null;
  const effectivePartySize =
    partySize ?? Math.max(1, tableContext?.visitorCount ?? 1);
  const prefilledTable = useMemo(
    () =>
      tableContext && tableContext.branchCode
        ? {
            tableId: tableContext.tableId,
            number: tableContext.tableNumber,
            name: tableContext.tableName,
          }
        : null,
    [tableContext]
  );

  const effectiveRestaurantId = useMemo(
    () =>
      reservationRestaurantId ??
      tableContext?.restaurantId ??
      customerBranch?.restaurantId ??
      cartRestaurantId ??
      null,
    [reservationRestaurantId, tableContext, customerBranch, cartRestaurantId]
  );

  // ============================================================
  // Load branch list (names + tenant id + branding)
  // ============================================================

  const loadBranches = useCallback(async () => {
    setBranchLoadState("loading");
    setBranchError(null);
    try {
      const res = await api.get("/public/branches", {
        params: effectiveRestaurantId
          ? { restaurantId: effectiveRestaurantId }
          : {},
      });
      const rid: string = res.data?.data?.restaurant?.id || "";
      if (rid) setReservationRestaurantId((prev) => prev || rid);
      const branding = res.data?.data?.restaurant?.branding;
      if (branding) {
        applyBranding({
          siteName: branding.siteName,
          logoUrl: branding.logoUrl,
          primaryColor: branding.primaryColor,
          secondaryColor: branding.secondaryColor,
          accentColor: branding.accentColor,
        });
      }
      const list: PublicBranch[] = res.data?.data?.branches || [];
      setBranches(list);
      if (list.length === 0) {
        setBranchError("Belum ada cabang yang tersedia.");
        setBranchLoadState("error");
        return;
      }
      setBranchLoadState("success");
    } catch (error) {
      const normalized = normalizeApiError(error);
      const message =
        normalized.status === 404
          ? "Cabang tidak ditemukan atau sudah tidak tersedia."
          : normalized.status === 429
            ? "Terlalu banyak permintaan. Coba lagi beberapa saat."
            : normalized.status !== null && normalized.status >= 500
              ? "Gagal memuat daftar cabang."
              : "Gagal memuat daftar cabang. Periksa koneksi Anda lalu coba lagi.";
      setBranchError(message);
      setBranchLoadState("error");
    }
  }, [effectiveRestaurantId, applyBranding]);

  // Initial routing, exactly once after cart hydration. Prefill values are
// derived from persisted context during render, so only the STARTING STEP
// is decided here (deferred, following the /pilih-cabang pattern).
  useEffect(() => {
    if (!isHydrated || initRef.current) return;
    initRef.current = true;

    const prefilledCode =
      tableContext?.branchCode ?? customerBranch?.branchCode ?? "";
    const timer = setTimeout(() => {
      loadBranches();
      if (prefilledCode) setStep("date");
      // else the user starts on the branch step.
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  const displayBranchName =
    effectiveBranchName ??
    branches.find((b) => b.code === effectiveBranchCode)?.name ??
    effectiveBranchCode;

  // ============================================================
  // Availability fetch (per-slot, server authoritative)
  // ============================================================

  useEffect(() => {
    const fetchAvailability = async () => {
      if (!effectiveBranchCode || !date || !effectivePartySize) return;

      const candidates = buildCandidateSlots(date);
      setSlotMap({});
      setAvLoading(candidates.length > 0);
      setAvError(null);
      if (candidates.length === 0) return;

      const baseParams: Record<string, unknown> = {
        branchCode: effectiveBranchCode,
        date,
        partySize: effectivePartySize,
        durationMinutes: RESERVATION_DEFAULT_DURATION_MINUTES,
      };
      if (effectiveRestaurantId) baseParams.restaurantId = effectiveRestaurantId;

      const results = await Promise.all(
        candidates.map((slot) =>
          api
            .get("/public/reservations/availability", {
              params: { ...baseParams, startMinutes: slot.startMinutes },
            })
            .then((res) => ({
              ok: true,
              start: slot.startMinutes,
              data: res.data?.data as SlotAvailability,
            }))
            .catch((error) => ({ ok: false, start: slot.startMinutes, error }))
        )
      );

      const succeeded = results.filter(
        (r): r is { ok: true; start: number; data: SlotAvailability } => r.ok
      );
      const map: Record<number, SlotAvailability> = {};
      for (const r of succeeded) map[r.start] = r.data;

      if (succeeded.length === 0) {
        const firstError = results.find(
          (r): r is { ok: false; start: number; error: unknown } => !r.ok
        )?.error;
        const normalized = normalizeApiError(firstError);
        const message =
          normalized.status === 404
            ? "Cabang tidak ditemukan."
            : normalized.status === 429
              ? "Terlalu banyak permintaan. Silakan coba lagi beberapa saat."
              : normalized.message;
        setAvError(message);
      } else {
        setAvError(null);
      }
      setSlotMap(map);
      setAvLoading(false);

      // Availability may have changed under the user (e.g. party size): drop
      // a stale slot selection so nobody submits a slot that is gone.
      setSelectedStart((cur) =>
        cur != null && !map[cur]?.available ? null : cur
      );

      // If the explicitly chosen table is no longer bookable in the selected
      // slot, clear it and tell the customer to pick again — the availability
      // engine is the only authority (map AND list share this state).
      const chosenStart = selectedStartRef.current;
      const chosenTable = selectedTableRef.current;
      if (chosenTable != null && chosenStart != null) {
        const stillAvailable =
          map[chosenStart]?.tables?.some(
            (t) => t.tableId === chosenTable && t.available
          ) ?? false;
        if (!stillAvailable) {
          setSelectedTableId(null);
          setTableNotice(
            "Meja yang dipilih sudah tidak tersedia. Silakan pilih meja lain."
          );
        }
      }
    };

    let alive = true;
    const timer = setTimeout(() => {
      fetchAvailability()
        .catch(() => {
          if (alive) {
            setAvLoading(false);
            setAvError("Gagal memuat ketersediaan. Silakan coba lagi.");
          }
        })
        .finally(() => {});
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [effectiveBranchCode, date, effectivePartySize, avReloadKey, effectiveRestaurantId]);

  // Mirror the latest selections into refs (read-only from the effect above,
  // without re-running it on every selection change).
  useEffect(() => {
    selectedStartRef.current = selectedStart;
  }, [selectedStart]);
  useEffect(() => {
    selectedTableRef.current = selectedTableId;
  }, [selectedTableId]);

  // ============================================================
  // Customer floor map (Phase 5)
  //   - ONE layout request per branch for the current wizard session.
  //   - Only fetched once the customer reaches the "Pilih Meja" step.
  //   - date / party size / slot changes do NOT reload it (branch-scoped
  //     geometry; only availability varies per slot).
  //   - A layout failure is NOT a wizard failure — the card list stays.
  //   - The request is addressed by branchCode ONLY (no restaurantId).
  // ============================================================

  useEffect(() => {
    const branch = floorMapCacheBranch(effectiveBranchCode);
    if (
      !shouldRefetchFloorLayout({
        stepIsTable: step === "table",
        branchCode: branch,
        resolvedBranch: floorLayoutResolvedFor.current,
      })
    ) {
      return;
    }
    let alive = true;
    Promise.resolve()
      .then(() => {
        if (!alive) return;
        setFloorLayoutStatus("loading");
        setFloorLayoutError(null);
      })
      .then(() => layoutService.getPublicBranchLayout(effectiveBranchCode))
      .then((data) => {
        if (!alive) return;
        floorLayoutResolvedFor.current = branch;
        setFloorLayoutItems(data.items);
        setFloorLayoutStatus("ready");
      })
      .catch((error) => {
        if (!alive) return;
        floorLayoutResolvedFor.current = branch;
        setFloorLayoutError(floorMapErrorMessage(normalizeApiError(error)));
        setFloorLayoutStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [step, effectiveBranchCode, floorLayoutRetryKey]);

  const retryFloorLayout = () => {
    floorLayoutResolvedFor.current = null;
    setFloorLayoutRetryKey((k) => k + 1);
  };

  // Merged map rows: public-layout geometry + authoritative availability for
  // the selected slot's tables.
  const floorMapTables = useMemo(
    () =>
      mergeFloorMap(
        floorLayoutItems,
        selectedStart != null ? (slotMap[selectedStart]?.tables ?? []) : []
      ),
    [floorLayoutItems, selectedStart, slotMap]
  );

  const showFloorMap =
    resolveFloorMapView(
      { status: floorLayoutStatus, itemCount: floorLayoutItems.length },
      floorViewPreference
    ) === "map";

  const floorLayoutUsable =
    floorLayoutStatus === "ready" && floorLayoutItems.length > 0;

  const floorMapNote =
    floorLayoutStatus === "error"
      ? floorLayoutError ?? "Denah meja tidak dapat ditampilkan."
      : floorLayoutStatus === "ready" && floorLayoutItems.length === 0
        ? "Denah meja belum tersedia untuk cabang ini."
        : null;

  const slotRows = useMemo(() => {
    if (!date) return [];
    return buildCandidateSlots(date).map((slot) => {
      const info = slotMap[slot.startMinutes];
      return {
        startMinutes: slot.startMinutes,
        available: Boolean(info?.available),
        tables: info?.tables ?? [],
      };
    });
  }, [date, slotMap]);

  const anySlotAvailable = slotRows.some((row) => row.available);

  // ALL branch tables for the selected slot (available or not). The list must
  // never hide an occupied/reserved/maintenance table — it must stay visible
  // and only become non-selectable.
  const slotTables = useMemo(() => {
    if (selectedStart == null) return [];
    return slotMap[selectedStart]?.tables ?? [];
  }, [selectedStart, slotMap]);

  const availableTables = useMemo(
    () => slotTables.filter((t) => t.available),
    [slotTables]
  );

  const defaultTableId = useMemo(() => {
    if (availableTables.length === 0) return null;
    if (
      prefilledTable &&
      availableTables.some((t) => t.tableId === prefilledTable.tableId)
    ) {
      return prefilledTable.tableId;
    }
    return availableTables[0].tableId;
  }, [availableTables, prefilledTable]);

  const effectiveTableId = selectedTableId ?? defaultTableId;

  const selectedTableLabel = useMemo(() => {
    if (selectedStart == null || !effectiveTableId) return null;
    const table = slotMap[selectedStart]?.tables?.find(
      (t) => t.tableId === effectiveTableId
    );
    if (!table) return null;
    return table.name
      ? `Meja ${table.number} · ${table.name}`
      : `Meja ${table.number}`;
  }, [selectedStart, effectiveTableId, slotMap]);

  // Prefill guest data from the logged-in customer account (F3) — name and
  // WhatsApp only; identity itself is derived server-side from the session.
  useEffect(() => {
    if (!authHydrated || !customer) return;
    const timer = setTimeout(() => {
      setGuestName((prev) => prev || customer.name || "");
      setGuestPhone((prev) => prev || customer.phone || "");
    }, 0);
    return () => clearTimeout(timer);
  }, [authHydrated, customer]);

  // ============================================================
  // Step transitions
  // ============================================================

  const canGoBack =
    step === "party" ||
    step === "time" ||
    step === "table" ||
    step === "purchase" ||
    step === "guest" ||
    step === "review" ||
    (step === "date" && !branchLocked);

  // Back navigation follows the ordered wizard steps, so every earlier step
  // keeps its state (purchase → table → time → party → date → branch).
  const goBack = () => {
    if (step === "date" && branchLocked) return;
    const previous = previousWizardStep(step);
    if (previous) setStep(previous);
  };

  const handleSelectBranch = (branch: PublicBranch) => {
    setBranchCode(branch.code);
    setBranchName(branch.name);
    setDate("");
    setPartySize(null);
    setSelectedStart(null);
    setSelectedTableId(null);
    setSlotMap({});
    setSubmitError(null);
    setTableNotice(null);
    // A different branch may sell a different catalogue — the local purchase
    // lines cannot be carried over.
    setPurchaseLines([]);
    setStep("date");
  };

  const today = minReservationDate();
  const maxDate = maxReservationDate();

  const handleDateChange = (value: string) => {
    if (!value) {
      setDate("");
      return;
    }
    // Guard the native picker (defensive — some browsers allow typed values).
    if (value < today || value > maxDate) {
      toast.error("Tanggal harus antara hari ini dan 60 hari ke depan.");
      return;
    }
    setDate(value);
    setSelectedStart(null);
    setSelectedTableId(null);
    setSlotMap({});
    setSubmitError(null);
    setTableNotice(null);
    setStep("party");
  };

  const changePartySize = (next: number) => {
    const clamped = Math.max(1, Math.min(MAX_PARTY_SIZE, next));
    if (clamped === effectivePartySize) return;
    setPartySize(clamped);
    // Availability for the new party size is refetched by the effect above.
  };

  const selectSlot = (startMinutes: number) => {
    setSelectedStart(startMinutes);
    setSelectedTableId(null);
    setSubmitError(null);
    setTableNotice(null);
    setStep("table");
  };

  const selectTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setSubmitError(null);
    setTableNotice(null);
    // "Pembelian" is its own step between the table and the guest data: the
    // customer picks products INSIDE the wizard (no redirect to /menu).
    setStep("purchase");
  };

  const guestNameValid =
    guestName.trim().length >= 1 && guestName.trim().length <= 100;
  const guestPhoneValid = normalizePhone(guestPhone) !== null;
  const notesValid = notes.length <= 200;

  const handleGuestNext = () => {
    setGuestTried(true);
    if (!guestNameValid) {
      toast.error("Nama wajib diisi");
      return;
    }
    if (!guestPhoneValid) {
      toast.error("Nomor WhatsApp tidak valid");
      return;
    }
    if (!notesValid) {
      toast.error("Catatan maksimal 200 karakter");
      return;
    }
    setStep("review");
  };

  // ============================================================
  // Submit — POST /public/reservations (server authoritative)
  // ============================================================

  const handleSubmit = async () => {
    if (isSubmitting || created) return;

    const start = selectedStart;
    if (start == null) {
      toast.error("Silakan pilih jam terlebih dahulu.");
      setStep("time");
      return;
    }
    if (!effectiveBranchCode || !date) {
      toast.error("Data reservasi belum lengkap.");
      return;
    }
    if (purchaseLines.length === 0) {
      toast.error(PURCHASE_EMPTY_MESSAGE);
      setStep("purchase");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const payload: Record<string, unknown> = {
      branchCode: effectiveBranchCode,
      reservationDate: date,
      startMinutes: start,
      durationMinutes: RESERVATION_DEFAULT_DURATION_MINUTES,
      partySize: effectivePartySize,
      tableId: effectiveTableId ?? null,
      guestName: guestName.trim(),
      guestPhone: guestPhone.trim(),
      notes: notes.trim() || undefined,
      // The purchase that BELONGS to this reservation. Only ids + quantities
      // cross the wire — the server re-prices everything from the database.
      items: toReservationOrderItems(purchaseLines),
      paymentMethod,
    };
    if (effectiveRestaurantId) payload.restaurantId = effectiveRestaurantId;

    try {
      const res = await api.post("/public/reservations", payload);
      if (res.status === 201 && res.data?.data) {
        setCreated(res.data.data as CreatedReservation);
        setStep("success");
      } else {
        setSubmitError("Gagal membuat reservasi. Silakan coba lagi.");
      }
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        // The slot/table changed between availability and submit. Refresh
        // availability and NEVER retry. A TABLE_NOT_AVAILABLE rejection is
        // table-specific, so send the customer back to the table step (all
        // earlier wizard state — branch/date/party/time/guest — is preserved)
        // with a clear notice; other 409s (slot/duplicate) stay on review.
        if (getErrorCode(error) === "TABLE_NOT_AVAILABLE") {
          setSelectedTableId(null);
          setTableNotice(TABLE_NOT_AVAILABLE_MESSAGE);
          setSubmitError(null);
          setStep("table");
        } else {
          setSubmitError(RESERVATION_CONFLICT_MESSAGE);
        }
        setAvReloadKey((k) => k + 1);
      } else {
        const normalized = normalizeApiError(error);
        setSubmitError(normalized.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============================================================
  // Header (wizard position)
  // ============================================================

  const stepIndex = RESERVATION_WIZARD_STEPS.indexOf(step); // -1 on success

  return (
    <div className="min-h-[70vh] pb-24">
      {/* Title row + wizard position */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-brand-primary" />
            Reservasi
          </h1>
          {step !== "success" && (
            <span className="text-xs text-gray-400">
              Langkah {stepIndex + 1} dari {RESERVATION_WIZARD_STEPS.length}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {RESERVATION_WIZARD_STEPS.map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                RESERVATION_WIZARD_STEPS.indexOf(s) <= stepIndex
                  ? "bg-brand-primary"
                  : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-sm text-gray-500">{RESERVATION_STEP_LABELS[step]}</p>
      </div>

      {canGoBack && (
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-brand-primary transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </button>
      )}

      {/* ==========================================================
          STEP 1 — BRANCH
      ========================================================== */}
      {step === "branch" && (
        <div>
          <div className="text-center pt-2 pb-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-secondary mb-3">
              <Building2 className="h-6 w-6 text-brand-primary" />
            </div>
            <p className="text-sm text-gray-500 max-w-sm mx-auto px-2">
              Silakan pilih cabang tempat Anda ingin reservasi.
            </p>
          </div>

          <div className="space-y-3">
            {branchLoadState === "loading" && branches.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin mb-2" />
                <p className="text-sm">Memuat daftar cabang…</p>
              </div>
            )}

            {branchLoadState === "error" && (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <p className="text-sm text-gray-600">{branchError}</p>
                <button
                  type="button"
                  onClick={() => loadBranches()}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                >
                  <RotateCw className="h-4 w-4" />
                  Coba Lagi
                </button>
              </div>
            )}

            {branchLoadState === "success" && (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => handleSelectBranch(branch)}
                    className="text-left w-full rounded-xl border border-gray-200 bg-white p-4 hover:border-brand-primary/50 hover:bg-brand-secondary/50 transition-colors min-w-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold text-gray-900 text-sm sm:text-base break-words">
                          {branch.name}
                        </h2>
                        <p className="text-[11px] font-medium text-gray-400 mt-0.5">
                          {branch.code}
                        </p>
                        {branch.address && (
                          <p className="flex items-start gap-1 text-xs text-gray-500 mt-2 leading-relaxed break-words">
                            <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span className="min-w-0">{branch.address}</span>
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-brand-primary text-brand-primary-foreground text-xs font-bold px-3 py-1.5">
                        Pilih
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/menu"
              className="text-xs font-medium text-gray-400 hover:text-brand-primary transition-colors"
            >
              Kembali ke Menu
            </Link>
          </div>
        </div>
      )}

      {/* ==========================================================
          STEP 2 — DATE
      ========================================================== */}
      {step === "date" && (
        <div className="space-y-4">
          {effectiveBranchCode && (
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="h-4 w-4 text-brand-primary shrink-0" />
                <span className="text-sm font-medium text-gray-900 truncate">
                  {branchLocked
                    ? `${displayBranchName}`
                    : `${displayBranchName} · ${effectiveBranchCode}`}
                </span>
              </div>
              {!branchLocked && (
                <button
                  type="button"
                  onClick={() => setStep("branch")}
                  className="shrink-0 text-xs font-medium text-brand-primary hover:underline"
                >
                  Ganti
                </button>
              )}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tanggal Reservasi
            </label>
            <input
              type="date"
              value={date}
              min={today}
              max={maxDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
            <p className="mt-2 text-xs text-gray-400">
              Minimal hari ini, maksimal 60 hari ke depan.
            </p>
          </div>

          <BottomBar
            onBack={branchLocked ? undefined : goBack}
            onNext={() =>
              date ? setStep("party") : toast.error("Silakan pilih tanggal")
            }
            nextLabel="Lanjut"
            nextDisabled={!date}
          />
        </div>
      )}

      {/* ==========================================================
          STEP 3 — PARTY SIZE
      ========================================================== */}
      {step === "party" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <label className="block text-base font-semibold text-gray-900 text-center mb-4">
              Berapa orang yang makan?
            </label>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => changePartySize(effectivePartySize - 1)}
                disabled={effectivePartySize <= 1}
                className="w-12 h-12 rounded-full bg-brand-secondary flex items-center justify-center hover:bg-brand-accent transition-colors text-xl font-bold disabled:opacity-40"
                aria-label="Kurangi jumlah orang"
              >
                -
              </button>
              <input
                type="number"
                min="1"
                max={MAX_PARTY_SIZE}
                value={effectivePartySize}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") return;
                  const num = parseInt(val, 10);
                  if (!Number.isNaN(num)) {
                    changePartySize(num);
                  }
                }}
                className="w-20 text-center text-2xl font-bold border-b-2 border-brand-primary focus:outline-none bg-transparent py-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                aria-label="Jumlah orang"
              />
              <button
                type="button"
                onClick={() => changePartySize(effectivePartySize + 1)}
                disabled={effectivePartySize >= MAX_PARTY_SIZE}
                className="w-12 h-12 rounded-full bg-brand-secondary flex items-center justify-center hover:bg-brand-accent transition-colors text-xl font-bold disabled:opacity-40"
                aria-label="Tambah jumlah orang"
              >
                +
              </button>
            </div>
            <p className="mt-4 text-center text-xs text-gray-400 flex items-center justify-center gap-1">
              <Users className="h-3 w-3" />
              Minimal 1 orang. Ketersediaan jam akan diperbarui otomatis.
            </p>
          </div>

          <BottomBar
            onBack={goBack}
            onNext={() => setStep("time")}
            nextLabel="Lanjut"
            nextDisabled={effectivePartySize < 1}
          />
        </div>
      )}

      {/* ==========================================================
          STEP 4 — TIME SLOT (server availability)
      ========================================================== */}
      {step === "time" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500 mb-1">
              {formatReservationDate(date)}
              <span className="text-gray-300 mx-1.5">·</span>
              {effectivePartySize} orang
              <span className="text-gray-300 mx-1.5">·</span>Durasi 90 menit
            </p>

            {avError ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
                <p className="text-sm text-gray-600">{avError}</p>
                <button
                  type="button"
                  onClick={() => setAvReloadKey((k) => k + 1)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                >
                  <RotateCw className="h-4 w-4" />
                  Coba Lagi
                </button>
              </div>
            ) : avLoading ? (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-11 rounded-xl bg-gray-100 animate-pulse"
                  />
                ))}
              </div>
            ) : slotRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <Clock className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-600">
                  Tidak ada jam yang tersedia untuk tanggal ini.
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Coba pilih tanggal lain atau jumlah orang berbeda.
                </p>
              </div>
            ) : !anySlotAvailable ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <AlertCircle className="h-8 w-8 text-amber-400 mb-2" />
                <p className="text-sm text-gray-600">
                  Tidak ada meja tersedia untuk {effectivePartySize} orang pada tanggal
                  tersebut.
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Coba tanggal lain atau jumlah orang berbeda.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slotRows.map((row) =>
                  row.available ? (
                    <button
                      key={row.startMinutes}
                      type="button"
                      onClick={() => selectSlot(row.startMinutes)}
                      className="rounded-xl bg-brand-primary text-brand-primary-foreground py-3 text-sm font-semibold hover:bg-brand-primary/90 transition-colors"
                    >
                      {formatStartMinutes(row.startMinutes)}
                    </button>
                  ) : (
                    <div
                      key={row.startMinutes}
                      className="rounded-xl bg-gray-100 text-gray-300 py-3 text-sm font-medium text-center line-through"
                    >
                      {formatStartMinutes(row.startMinutes)}
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          <BottomBar
            onBack={goBack}
            onNext={() =>
              selectedStart == null
                ? toast.error("Silakan pilih jam yang tersedia")
                : setStep("table")
            }
            nextLabel="Lanjut"
            nextDisabled={selectedStart == null}
          />
        </div>
      )}

      {/* ==========================================================
          STEP 5 — TABLE (server availability)
      ========================================================== */}
      {step === "table" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500 mb-3">
              {formatReservationDate(date)}
              <span className="text-gray-300 mx-1.5">·</span>
              {selectedStart != null
                ? formatTimeSlot(
                    selectedStart,
                    RESERVATION_DEFAULT_DURATION_MINUTES
                  )
                : "-"}
              <span className="text-gray-300 mx-1.5">·</span>
              {effectivePartySize} orang
            </p>

            {slotTables.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <AlertCircle className="h-8 w-8 text-amber-400 mb-2" />
                <p className="text-sm text-gray-600">
                  Meja tidak tersedia pada jam tersebut.
                </p>
                <button
                  type="button"
                  onClick={() => setStep("time")}
                  className="mt-4 text-sm font-medium text-brand-primary hover:underline"
                >
                  Pilih jam lain
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {floorLayoutUsable && (
                  <div
                    role="group"
                    aria-label="Tampilan meja"
                    className="grid w-full grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-sm"
                  >
                    <button
                      type="button"
                      onClick={() => setFloorViewPreference("map")}
                      aria-pressed={showFloorMap}
                      className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
                        showFloorMap
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      Denah
                    </button>
                    <button
                      type="button"
                      onClick={() => setFloorViewPreference("list")}
                      aria-pressed={!showFloorMap}
                      className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
                        !showFloorMap
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      Daftar Meja
                    </button>
                  </div>
                )}

                {tableNotice && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800 leading-relaxed">
                      {tableNotice}
                    </p>
                  </div>
                )}

                {showFloorMap ? (
                  <>
                    <ReservationFloorMap
                      tables={floorMapTables}
                      selectedTableId={effectiveTableId}
                      onSelectTable={selectTable}
                    />
                    <p className="text-center">
                      <button
                        type="button"
                        onClick={() => setFloorViewPreference("list")}
                        className="text-sm font-medium text-brand-primary hover:underline"
                      >
                        Tampilkan daftar meja
                      </button>
                    </p>
                  </>
                ) : (
                  <>
                    {floorMapNote && (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs text-gray-500 leading-relaxed">
                          {floorMapNote}
                        </p>
                        {floorLayoutStatus === "error" && (
                          <button
                            type="button"
                            onClick={retryFloorLayout}
                            className="shrink-0 text-xs font-medium text-brand-primary hover:underline"
                          >
                            Coba Lagi
                          </button>
                        )}
                      </div>
                    )}
                    <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2">
                      {slotTables.map((table) => {
                        const selectable = table.available;
                        const selected = selectable && effectiveTableId === table.tableId;
                        const statusKey = table.status ?? "AVAILABLE";
                        const card = (
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
                                <Table2 className="h-4 w-4 text-brand-primary shrink-0" />
                                Meja {table.number}
                              </p>
                              {table.name && (
                                <p className="text-xs text-gray-500 mt-0.5 break-words">
                                  {table.name}
                                </p>
                              )}
                              <p className="text-[11px] font-medium text-gray-400 mt-1.5">
                                Kapasitas {table.capacity} orang
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full text-xs font-bold px-3 py-1 ${
                                selected
                                  ? "bg-brand-primary text-brand-primary-foreground"
                                  : selectable
                                    ? "bg-gray-100 text-gray-500"
                                    : (TABLE_STATUS_BADGE[statusKey] ??
                                      "bg-gray-100 text-gray-500")
                              }`}
                            >
                              {selected
                                ? "Dipilih"
                                : selectable
                                  ? "Pilih"
                                  : (TABLE_STATUS_LABEL[statusKey] ?? "Tidak tersedia")}
                            </span>
                          </div>
                        );
                        if (!selectable) {
                          return (
                            <div
                              key={table.tableId}
                              aria-disabled="true"
                              aria-label={`Meja ${table.number}, ${
                                TABLE_STATUS_LABEL[statusKey] ?? "tidak tersedia"
                              }, tidak dapat dipilih`}
                              className="text-left w-full rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 opacity-80 min-w-0"
                            >
                              {card}
                            </div>
                          );
                        }
                        return (
                          <button
                            key={table.tableId}
                            type="button"
                            onClick={() => selectTable(table.tableId)}
                            className={`text-left w-full rounded-xl border p-4 transition-colors min-w-0 ${
                              selected
                                ? "border-brand-primary bg-brand-secondary ring-2 ring-brand-primary/40"
                                : "border-gray-200 bg-white hover:border-brand-primary/50 hover:bg-brand-secondary/50"
                            }`}
                          >
                            {card}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {slotTables.length > 0 && (
            <BottomBar
              onBack={goBack}
              onNext={() =>
                effectiveTableId
                  ? setStep("purchase")
                  : toast.error("Silakan pilih meja")
              }
              nextLabel="Lanjut"
              nextDisabled={!effectiveTableId}
            />
          )}
        </div>
      )}

      {/* ==========================================================
          STEP 6 — PEMBELIAN (produk dipilih DI DALAM wizard)

          Reservation + pemesanan produk adalah SATU flow: pelanggan memilih
          produk di sini (tanpa redirect ke /menu), lalu submit membuat
          Reservation + Order + OrderItem (+ Payment) secara atomik lewat
          engine existing. Semua harga/validasi tetap server-side.
      ========================================================== */}
      {step === "purchase" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-center pt-1 pb-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-secondary mb-3">
                <ShoppingBag className="h-6 w-6 text-brand-primary" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">
                {PURCHASE_STEP_TITLE}
              </h2>
              <p className="mt-1 text-xs text-gray-500 max-w-sm mx-auto px-2">
                {PURCHASE_STEP_SUBTITLE}
              </p>
            </div>

            <ReservationProductPicker
              restaurantId={effectiveRestaurantId}
              branchCode={effectiveBranchCode}
              lines={purchaseLines}
              onChange={setPurchaseLines}
            />
          </div>

          {purchaseLines.length === 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed">
                {PURCHASE_EMPTY_MESSAGE}
              </p>
            </div>
          )}

          <BottomBar
            onBack={goBack}
            onNext={() => setStep("guest")}
            nextLabel="Lanjutkan Reservasi"
            nextDisabled={purchaseLines.length === 0}
          />
        </div>
      )}

      {/* ==========================================================
          STEP 7 — GUEST DATA
      ========================================================== */}
      {step === "guest" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nama <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Nama Anda"
                className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
              {guestTried && !guestNameValid && (
                <p className="mt-1 text-xs text-red-500">
                  Nama wajib diisi (maksimal 100 karakter)
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                No. WhatsApp untuk Follow-up{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="081234567890"
                className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-400">
                Nomor aktif yang dapat dihubungi untuk follow-up reservasi pada
                hari-H. Boleh berbeda dari nomor yang dipakai saat memesan.
              </p>
              {guestTried && !guestPhoneValid && (
                <p className="mt-1 text-xs text-red-500">
                  Nomor WhatsApp tidak valid
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Catatan{" "}
                <span className="text-gray-400 font-normal">(opsional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Contoh: kursi bayi, meja dekat jendela, dll."
                rows={3}
                maxLength={200}
                className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent resize-none"
              />
              <p className="mt-1 text-right text-[11px] text-gray-400">
                {notes.length}/200
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 p-3">
              <StickyNote className="h-4 w-4 text-brand-primary shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500 leading-relaxed">
                Nomor WhatsApp digunakan untuk notifikasi dan follow-up
                reservasi pada hari-H. Nomor tidak akan dibagikan.
              </p>
            </div>
          </div>

          <BottomBar
            onBack={goBack}
            onNext={handleGuestNext}
            nextLabel="Lanjut"
            nextDisabled={!guestNameValid || !guestPhoneValid}
          />
        </div>
      )}

      {/* ==========================================================
          STEP 8 — REVIEW
      ========================================================== */}
      {step === "review" && (
        <div className="space-y-4">
          {/* RESERVASI */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">
              Reservasi
            </p>
            <dl>
              <DetailRow label="Cabang">{displayBranchName}</DetailRow>
              <DetailRow label="Tanggal">
                {formatReservationDate(date)}
              </DetailRow>
              <DetailRow label="Jam">
                {selectedStart != null
                  ? formatTimeSlot(
                      selectedStart,
                      RESERVATION_DEFAULT_DURATION_MINUTES
                    )
                  : "-"}
              </DetailRow>
              <DetailRow label="Durasi">
                {RESERVATION_DEFAULT_DURATION_MINUTES} menit
              </DetailRow>
              <DetailRow label="Jumlah orang">{effectivePartySize} orang</DetailRow>
              <DetailRow label="Meja">
                {selectedTableLabel ?? "Belum ditentukan"}
              </DetailRow>
            </dl>
          </div>

          {/* FOLLOW-UP */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">
              Follow-up
            </p>
            <dl>
              <DetailRow label="Nama">{guestName}</DetailRow>
              <DetailRow label="No. WhatsApp">{guestPhone}</DetailRow>
              <DetailRow label="Catatan">{notes.trim() || "-"}</DetailRow>
            </dl>
          </div>

          {/* PEMBELIAN */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
              Pembelian
            </p>
            {purchaseLines.length === 0 ? (
              <p className="text-sm text-amber-700">{PURCHASE_EMPTY_MESSAGE}</p>
            ) : (
              <div className="space-y-2">
                {purchaseLines.map((line) => {
                  const choices = reservationPurchaseLineNotes(line);
                  return (
                    <div
                      key={line.lineId}
                      className="flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 break-words">
                          {line.name}
                        </p>
                        {choices && (
                          <p className="text-xs text-gray-500 break-words">
                            {choices}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatRupiah(line.unitPrice)} × {line.quantity}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-gray-900">
                        {formatRupiah(line.unitPrice * line.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <dl className="mt-3 border-t border-gray-100 pt-2">
              <DetailRow label="Subtotal">
                {formatRupiah(reservationPurchaseSubtotal(purchaseLines))}
              </DetailRow>
              <DetailRow label="Diskon">-</DetailRow>
              <DetailRow label="Pajak">-</DetailRow>
              <DetailRow label="Service Charge">-</DetailRow>
              <DetailRow label="Grand Total">
                <span className="font-bold text-brand-primary">
                  {formatRupiah(reservationPurchaseSubtotal(purchaseLines))}
                </span>
              </DetailRow>
            </dl>
          </div>

          {/* PAYMENT */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
              Pembayaran
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["QRIS", "KASIR"] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  aria-pressed={paymentMethod === method}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    paymentMethod === method
                      ? "border-brand-primary bg-brand-secondary text-brand-primary"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {RESERVATION_PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Status pembayaran: belum dibayar — pembayaran diselesaikan setelah
              reservasi dibuat.
            </p>
          </div>

          {submitError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-700">
                  Reservasi Gagal
                </p>
                <p className="text-xs text-red-600 mt-0.5">{submitError}</p>
              </div>
            </div>
          )}

          <BottomBar
            onBack={goBack}
            onNext={handleSubmit}
            nextLabel="Konfirmasi Reservasi"
            nextDisabled={isSubmitting}
            nextLoading={isSubmitting}
          />
        </div>
      )}

      {/* ==========================================================
          STEP 9 — SUCCESS
      ========================================================== */}
      {step === "success" && created && (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-9 w-9 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">
              Reservasi Berhasil
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Simpan kode reservasi berikut untuk keperluan konfirmasi.
            </p>
            <div className="mt-4 inline-block rounded-xl bg-white border border-green-200 px-6 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Kode Reservasi
              </p>
              <p className="text-2xl font-bold text-brand-primary tracking-wider">
                {created.code}
              </p>
            </div>
          </div>

          {/* QR Reservasi — payload is ONLY the reservation code (no PII). */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-center">
            <p className="text-sm font-semibold text-gray-900">QR Reservasi</p>
            <div className="mt-3 flex justify-center">
              <QrCodeDisplay
                value={reservationQrPayload(created.code)}
                size={200}
                ariaLabel={`QR reservasi ${created.code}`}
              />
            </div>
            <p className="mt-3 font-mono text-lg font-bold tracking-wider text-brand-primary">
              {created.code}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Tunjukkan QR ini ke kasir saat datang
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <dl>
              <DetailRow label="Status">
                <span className="rounded-full bg-green-50 text-green-600 border border-green-200 text-[10px] font-bold px-2 py-0.5">
                  {RESERVATION_STATUS_LABELS[created.status] ?? created.status}
                </span>
              </DetailRow>
              <DetailRow label="Cabang">
                {created.branch ? created.branch.name : displayBranchName}
              </DetailRow>
              <DetailRow label="Tanggal">
                {formatReservationDate(created.reservationDate)}
              </DetailRow>
              <DetailRow label="Jam">
                {formatTimeSlot(
                  created.startMinutes,
                  created.durationMinutes
                )}
              </DetailRow>
              <DetailRow label="Durasi">
                {created.durationMinutes} menit
              </DetailRow>
              <DetailRow label="Jumlah orang">
                {created.partySize} orang
              </DetailRow>
              <DetailRow label="Meja">
                {created.table
                  ? created.table.name
                    ? `Meja ${created.table.number} · ${created.table.name}`
                    : `Meja ${created.table.number}`
                  : "Belum ditentukan"}
              </DetailRow>
              <DetailRow label="Nama">{created.guestName}</DetailRow>
              <DetailRow label="WhatsApp">
                {formatPhoneDisplay(created.guestPhone)}
              </DetailRow>
            </dl>
          </div>

          {created.order && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
                Pembelian
              </p>
              <div className="space-y-2">
                {created.order.items.map((item, index) => (
                  <div
                    key={`${item.name}-${index}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 break-words">
                        {item.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatRupiah(item.unitPrice)} × {item.quantity}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-gray-900">
                      {formatRupiah(item.totalPrice)}
                    </span>
                  </div>
                ))}
              </div>
              <dl className="mt-3 border-t border-gray-100 pt-2">
                <DetailRow label="Subtotal">
                  {formatRupiah(created.order.subtotal)}
                </DetailRow>
                {created.order.discount > 0 && (
                  <DetailRow label="Diskon">
                    -{formatRupiah(created.order.discount)}
                  </DetailRow>
                )}
                {created.order.tax > 0 && (
                  <DetailRow label="Pajak">
                    {formatRupiah(created.order.tax)}
                  </DetailRow>
                )}
                {created.order.serviceCharge > 0 && (
                  <DetailRow label="Service Charge">
                    {formatRupiah(created.order.serviceCharge)}
                  </DetailRow>
                )}
                <DetailRow label="Grand Total">
                  <span className="font-bold text-brand-primary">
                    {formatRupiah(created.order.grandTotal)}
                  </span>
                </DetailRow>
                <DetailRow label="No. Pesanan">
                  {created.order.orderNumber}
                </DetailRow>
                <DetailRow label="Pembayaran">
                  <span className="rounded-full bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-bold px-2 py-0.5">
                    {PAYMENT_STATUS_LABELS[created.order.paymentStatus] ??
                      created.order.paymentStatus}
                  </span>
                </DetailRow>
              </dl>
              {/* Payment CTA — reuses the EXISTING payment/order pages. */}
              {created.order.paymentStatus !== "PAID" &&
                created.order.status !== "CANCELLED" && (
                  <Link
                    href={
                      paymentMethod === "KASIR"
                        ? `/order/${created.order.orderNumber}`
                        : `/payment/${created.order.orderNumber}`
                    }
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 px-4 font-semibold hover:bg-brand-primary/90 transition-colors"
                  >
                    {paymentMethod === "KASIR"
                      ? "Lihat Pesanan & Bayar di Kasir"
                      : "Bayar Sekarang (QRIS)"}
                  </Link>
                )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {authHydrated && customer && (
              <Link
                href="/account"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 px-4 font-medium hover:bg-brand-primary/90 transition-colors"
              >
                <User className="h-4 w-4" />
                Reservasi Saya
              </Link>
            )}
            <Link
              href="/menu"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white text-gray-700 py-3 px-4 font-medium hover:bg-gray-50 transition-colors"
            >
              Kembali ke Menu
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}