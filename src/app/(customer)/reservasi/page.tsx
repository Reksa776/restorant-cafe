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
import { getErrorStatus, normalizeApiError } from "@/lib/api-error-handler";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import { RESERVATION_DEFAULT_DURATION_MINUTES } from "@/services/reservation/reservation.slots";
import {
  RESERVATION_CONFLICT_MESSAGE,
  RESERVATION_STATUS_LABELS,
  buildCandidateSlots,
  formatReservationDate,
  formatStartMinutes,
  formatTimeSlot,
  maxReservationDate,
  minReservationDate,
} from "./reservation-flow";

// ============================================================
// /reservasi — CUSTOMER RESERVATION WIZARD (PHASE R5).
//
// Single-page mobile-first flow:
//   1. Cabang → 2. Tanggal → 3. Jumlah orang → 4. Jam →
//   5. Meja → 6. Data tamu → 7. Review → 8. Submit → 9. Sukses.
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

type Step =
  | "branch"
  | "date"
  | "party"
  | "time"
  | "table"
  | "guest"
  | "review"
  | "success";

const STEP_LABELS: Record<Step, string> = {
  branch: "Pilih Cabang",
  date: "Pilih Tanggal",
  party: "Jumlah Orang",
  time: "Pilih Jam",
  table: "Pilih Meja",
  guest: "Data Tamu",
  review: "Review Reservasi",
  success: "Reservasi Berhasil",
};

const WIZARD_STEPS: Step[] = [
  "branch",
  "date",
  "party",
  "time",
  "table",
  "guest",
  "review",
];

const MAX_PARTY_SIZE = 100;

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

  // ---- Guest data ----
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [guestTried, setGuestTried] = useState(false);

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

  const availableTables = useMemo(() => {
    if (selectedStart == null) return [];
    const info = slotMap[selectedStart];
    if (!info) return [];
    return info.tables.filter((t) => t.available);
  }, [selectedStart, slotMap]);

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
    step === "guest" ||
    step === "review" ||
    (step === "date" && !branchLocked);

  const goBack = () => {
    switch (step) {
      case "party":
        setStep("date");
        break;
      case "time":
        setStep("party");
        break;
      case "table":
        setStep("time");
        break;
      case "guest":
        setStep("table");
        break;
      case "review":
        setStep("guest");
        break;
      case "date":
        if (!branchLocked) setStep("branch");
        break;
    }
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
    setStep("table");
  };

  const selectTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setSubmitError(null);
    setStep("guest");
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
        // The slot/table changed between availability and submit. Show the
        // stable customer message, refresh availability, and NEVER retry.
        setSubmitError(RESERVATION_CONFLICT_MESSAGE);
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

  const stepIndex = WIZARD_STEPS.indexOf(step); // -1 on success

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
              Langkah {stepIndex + 1} dari {WIZARD_STEPS.length}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {WIZARD_STEPS.map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                WIZARD_STEPS.indexOf(s) <= stepIndex
                  ? "bg-brand-primary"
                  : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-sm text-gray-500">{STEP_LABELS[step]}</p>
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

            {availableTables.length === 0 ? (
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
              <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2">
                {availableTables.map((table) => {
                  const selected = effectiveTableId === table.tableId;
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
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {selected ? "Dipilih" : "Pilih"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {availableTables.length > 0 && (
            <BottomBar
              onBack={goBack}
              onNext={() =>
                effectiveTableId
                  ? setStep("guest")
                  : toast.error("Silakan pilih meja")
              }
              nextLabel="Lanjut"
              nextDisabled={!effectiveTableId}
            />
          )}
        </div>
      )}

      {/* ==========================================================
          STEP 6 — GUEST DATA
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
                Nomor WhatsApp <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="081234567890"
                className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
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
                Data ini hanya digunakan untuk keperluan reservasi. Nomor
                WhatsApp tidak akan dibagikan.
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
          STEP 7 — REVIEW
      ========================================================== */}
      {step === "review" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
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
              <DetailRow label="Nama">{guestName}</DetailRow>
              <DetailRow label="WhatsApp">{guestPhone}</DetailRow>
              <DetailRow label="Catatan">{notes.trim() || "-"}</DetailRow>
            </dl>
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
          STEP 8 — SUCCESS
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