// ============================================================
// PHASE R1 — RESERVATION SLOT ENGINE (pure, dependency-free).
//
// This module is intentionally PURE:
//   - no Prisma / database access
//   - no request / session / route access
//   - no `new Date()` and no timezone conversion
//
// Time is expressed ONLY as `YYYY-MM-DD` date strings plus integer
// minute-of-day values, so every overlap / window decision is plain integer
// and lexicographic arithmetic. "Now" is always INJECTED by the caller as
// `{ today, nowMinutes }` — derived once at the request edge — which keeps the
// engine deterministic and unit-testable without fake timers.
//
// Interval convention: HALF-OPEN [startMinutes, startMinutes + durationMinutes).
//   10:00–11:30 and 11:30–13:00 → do NOT overlap (touching is allowed)
//   10:00–11:30 and 11:29–13:00 → DO overlap
// ============================================================

// ============================================================
// Window configuration (single source of truth for the slot grid)
// ============================================================

/** Opening time — 10:00 local, as minutes from midnight. */
export const RESERVATION_SLOT_START_MINUTES = 10 * 60;

/** Closing time — 22:00 local. A booking must END at or before this. */
export const RESERVATION_SLOT_END_MINUTES = 22 * 60;

/**
 * Duration used when the caller does not specify one. 90 minutes is the
 * conventional dine-in turn; it deliberately stays independent of
 * `RESERVATION_SLOT_STEP_MINUTES` (a 90-minute booking may start on any
 * hourly grid slot).
 */
export const RESERVATION_DEFAULT_DURATION_MINUTES = 90;

/**
 * Spacing of the selectable START times: hourly chips (10:00, 11:00, …).
 * This matches the existing admin report/peak-hour UI, which is also hourly,
 * and keeps the picker small enough to render as buttons on mobile.
 */
export const RESERVATION_SLOT_STEP_MINUTES = 60;

/** How far ahead a reservation may be made, in days. */
export const RESERVATION_MAX_HORIZON_DAYS = 60;

/** Accepted duration bounds, validated by `validateReservationWindow`. */
export const RESERVATION_MIN_DURATION_MINUTES = 15;
export const RESERVATION_MAX_DURATION_MINUTES = 240;

/** Durations must be a multiple of this (whole quarter-hours). */
export const RESERVATION_DURATION_STEP_MINUTES = 15;

export const RESERVATION_MINUTES_PER_DAY = 24 * 60;

// ============================================================
// Types
// ============================================================

export interface ReservationSlotConfig {
  slotStartMinutes: number;
  slotEndMinutes: number;
  slotStepMinutes: number;
  defaultDurationMinutes: number;
  maxHorizonDays: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  durationStepMinutes: number;
}

export const RESERVATION_SLOT_CONFIG: ReservationSlotConfig = {
  slotStartMinutes: RESERVATION_SLOT_START_MINUTES,
  slotEndMinutes: RESERVATION_SLOT_END_MINUTES,
  slotStepMinutes: RESERVATION_SLOT_STEP_MINUTES,
  defaultDurationMinutes: RESERVATION_DEFAULT_DURATION_MINUTES,
  maxHorizonDays: RESERVATION_MAX_HORIZON_DAYS,
  minDurationMinutes: RESERVATION_MIN_DURATION_MINUTES,
  maxDurationMinutes: RESERVATION_MAX_DURATION_MINUTES,
  durationStepMinutes: RESERVATION_DURATION_STEP_MINUTES,
};

/** A half-open interval on the local day, in minutes from midnight. */
export interface ReservationInterval {
  startMinutes: number;
  durationMinutes: number;
}

/** An existing reservation row, as far as capacity accounting is concerned. */
export interface ReservationCapacityRow extends ReservationInterval {
  partySize: number;
  status: string;
}

/** A selectable slot on the grid. */
export interface ReservationSlot {
  startMinutes: number;
  endMinutes: number;
  /** Display label, e.g. "10:00". Built here so server and client agree. */
  label: string;
}

/** Injected "current local time" — never read from the clock inside here. */
export interface ReservationNow {
  /** Today as `YYYY-MM-DD` in the application's local day. */
  today: string;
  /** Minutes from local midnight, 0..1439. */
  nowMinutes: number;
}

export interface ReservationWindowInput {
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
}

export const RESERVATION_WINDOW_ERROR_CODES = [
  "INVALID_DATE",
  "PAST_SLOT",
  "BEYOND_HORIZON",
  "DURATION_INVALID",
  "SLOT_NOT_ALIGNED",
  "BEFORE_OPENING",
  "AFTER_CLOSING",
  "EXCEEDS_CLOSING",
] as const;

export type ReservationWindowErrorCode =
  (typeof RESERVATION_WINDOW_ERROR_CODES)[number];

export type ReservationWindowValidation =
  | {
      ok: true;
      reservationDate: string;
      startMinutes: number;
      durationMinutes: number;
      endMinutes: number;
    }
  | { ok: false; code: ReservationWindowErrorCode; message: string };

// ============================================================
// Status semantics — which states still HOLD the slot
// ============================================================

/**
 * Statuses that occupy the slot. PENDING is included on purpose: an
 * unacknowledged online booking must never be double-sold. Only CANCELLED and
 * NO_SHOW release the slot.
 *
 * Mirrors the Prisma `ReservationStatus` enum (see prisma/schema.prisma).
 */
export const RESERVATION_HOLDING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "SEATED",
  "COMPLETED",
] as const;

/** Statuses that free the slot again. */
export const RESERVATION_RELEASING_STATUSES = ["CANCELLED", "NO_SHOW"] as const;

/** True when a reservation in this status still holds its slot. */
export function holdsCapacity(status: string): boolean {
  return (RESERVATION_HOLDING_STATUSES as readonly string[]).includes(status);
}

// ============================================================
// Date-only helpers (no timezone conversion)
// ============================================================

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a strict `YYYY-MM-DD` string into its parts, or null.
 * Rejects non-calendar dates (e.g. 2026-02-30) so a client cannot smuggle an
 * invalid day past validation.
 */
export function parseDateOnly(
  value: string
): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Day-of-month upper bound via UTC (calendar math only — UTC is used
  // purely as a timezone-free calendar, never as a local-time conversion).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** True when `value` is a strict, real `YYYY-MM-DD` calendar date. */
export function isValidDateOnly(value: unknown): value is string {
  return typeof value === "string" && parseDateOnly(value) !== null;
}

/**
 * Format a stored `@db.Date` value back to `YYYY-MM-DD`.
 *
 * Prisma returns a MySQL DATE as a Date at UTC midnight, so the UTC parts are
 * the canonical reading. This is NOT a timezone conversion — it is the
 * timezone-free round-trip of a date-only column.
 */
export function dateOnlyFromDb(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Add (or subtract) whole days to a `YYYY-MM-DD` string. */
export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const parts = parseDateOnly(dateOnly);
  if (!parts) {
    throw new Error(`Invalid date-only value: ${dateOnly}`);
  }
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days)
  );
  return dateOnlyFromDb(shifted);
}

/** Whole days from `fromDateOnly` to `toDateOnly` (may be negative). */
export function diffDaysBetweenDateOnly(
  fromDateOnly: string,
  toDateOnly: string
): number {
  const from = parseDateOnly(fromDateOnly);
  const to = parseDateOnly(toDateOnly);
  if (!from || !to) {
    throw new Error(
      `Invalid date-only value: ${!from ? fromDateOnly : toDateOnly}`
    );
  }
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / 86_400_000);
}

// ============================================================
// Minute-of-day helpers
// ============================================================

/** 600 → "10:00". Minutes outside a single day are clamped into range. */
export function minutesToLabel(minutes: number): string {
  const safe = Math.max(0, Math.min(RESERVATION_MINUTES_PER_DAY - 1, Math.trunc(minutes)));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** Half-open end of an interval, in minutes from midnight. */
export function intervalEndMinutes(interval: ReservationInterval): number {
  return interval.startMinutes + interval.durationMinutes;
}

// ============================================================
// Overlap
// ============================================================

/**
 * Half-open overlap: `a.start < b.end && a.end > b.start`.
 *
 * Touching intervals (a.end === b.start) do NOT overlap, and a zero/negative
 * duration never overlaps anything.
 */
export function overlaps(
  a: ReservationInterval,
  b: ReservationInterval
): boolean {
  if (a.durationMinutes <= 0 || b.durationMinutes <= 0) return false;
  return (
    a.startMinutes < intervalEndMinutes(b) &&
    intervalEndMinutes(a) > b.startMinutes
  );
}

// ============================================================
// Slot grid
// ============================================================

/**
 * True when `startMinutes` sits on the grid (anchored at opening time) and the
 * whole interval fits inside [opening, closing).
 */
export function isSlotInGrid(
  startMinutes: number,
  durationMinutes: number = RESERVATION_DEFAULT_DURATION_MINUTES,
  config: ReservationSlotConfig = RESERVATION_SLOT_CONFIG
): boolean {
  if (!Number.isInteger(startMinutes)) return false;
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return false;
  if (startMinutes < config.slotStartMinutes) return false;
  if (startMinutes >= config.slotEndMinutes) return false;
  if ((startMinutes - config.slotStartMinutes) % config.slotStepMinutes !== 0) {
    return false;
  }
  return startMinutes + durationMinutes <= config.slotEndMinutes;
}

/**
 * Build the selectable slot grid for a day.
 *
 * @param options.durationMinutes booking length (defaults to 90)
 * @param options.now             optional injected current time; when given,
 *                                slots that have already started are dropped
 * @param options.reservationDate the day being requested (required to apply
 *                                `now` correctly; defaults to `now.today`)
 */
export function buildSlots(options?: {
  durationMinutes?: number;
  now?: ReservationNow;
  reservationDate?: string;
  config?: ReservationSlotConfig;
}): ReservationSlot[] {
  const config = options?.config ?? RESERVATION_SLOT_CONFIG;
  const durationMinutes =
    options?.durationMinutes ?? config.defaultDurationMinutes;

  const slots: ReservationSlot[] = [];

  // A booking must END by closing time, so the last start is bounded by
  // `slotEndMinutes - durationMinutes`.
  for (
    let start = config.slotStartMinutes;
    start + durationMinutes <= config.slotEndMinutes;
    start += config.slotStepMinutes
  ) {
    slots.push({
      startMinutes: start,
      endMinutes: start + durationMinutes,
      label: minutesToLabel(start),
    });
  }

  if (!options?.now) return slots;

  const reservationDate = options.reservationDate ?? options.now.today;
  return slots.filter(
    (slot) =>
      !isPastSlot(
        { reservationDate, startMinutes: slot.startMinutes },
        options.now as ReservationNow
      )
  );
}

// ============================================================
// Capacity
// ============================================================

/**
 * Remaining seats for a table (or an area) at the requested interval:
 * capacity minus the party sizes of every still-holding reservation that
 * OVERLAPS the request.
 *
 * CANCELLED / NO_SHOW rows are ignored — they no longer occupy the slot.
 * The result may be negative when existing data already exceeds capacity;
 * callers should display `Math.max(0, remaining)` but must NOT use the clamp
 * for the accept/reject decision (`partySize <= remaining`).
 */
export function remainingCapacity(
  capacity: number,
  existing: readonly ReservationCapacityRow[],
  requested: ReservationInterval
): number {
  const held = existing.reduce((total, row) => {
    if (!holdsCapacity(row.status)) return total;
    if (!overlaps(row, requested)) return total;
    return total + row.partySize;
  }, 0);

  return capacity - held;
}

/**
 * Convenience predicate: does `partySize` fit in `capacity` given the
 * overlapping `existing` reservations?
 */
export function canAccommodate(
  capacity: number,
  existing: readonly ReservationCapacityRow[],
  requested: ReservationInterval & { partySize: number }
): boolean {
  return (
    requested.partySize > 0 &&
    requested.partySize <= remainingCapacity(capacity, existing, requested)
  );
}

// ============================================================
// Past / horizon
// ============================================================

/**
 * True when the slot has already started, judged against the caller-supplied
 * local "now". Pure string/integer comparison — no clock, no timezone.
 */
export function isPastSlot(
  input: { reservationDate: string; startMinutes: number },
  now: ReservationNow
): boolean {
  if (input.reservationDate < now.today) return true;
  if (input.reservationDate > now.today) return false;
  return input.startMinutes <= now.nowMinutes;
}

/**
 * Validate a requested booking window against opening hours, the slot grid,
 * the past and the booking horizon.
 *
 * Capacity is deliberately NOT checked here — that needs the table and its
 * existing reservations, so it belongs to `remainingCapacity` / the service.
 */
export function validateReservationWindow(
  input: ReservationWindowInput,
  now: ReservationNow,
  config: ReservationSlotConfig = RESERVATION_SLOT_CONFIG
): ReservationWindowValidation {
  if (!isValidDateOnly(input.reservationDate)) {
    return {
      ok: false,
      code: "INVALID_DATE",
      message: "Tanggal reservasi tidak valid (format YYYY-MM-DD)",
    };
  }

  // Horizon first: a far-future date should not be reported as "past".
  const daysAhead = diffDaysBetweenDateOnly(now.today, input.reservationDate);
  if (daysAhead > config.maxHorizonDays) {
    return {
      ok: false,
      code: "BEYOND_HORIZON",
      message: `Reservasi hanya dapat dibuat maksimal ${config.maxHorizonDays} hari ke depan`,
    };
  }

  if (isPastSlot(input, now)) {
    return {
      ok: false,
      code: "PAST_SLOT",
      message: "Waktu reservasi sudah lewat",
    };
  }

  const { startMinutes, durationMinutes } = input;

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < config.minDurationMinutes ||
    durationMinutes > config.maxDurationMinutes ||
    durationMinutes % config.durationStepMinutes !== 0
  ) {
    return {
      ok: false,
      code: "DURATION_INVALID",
      message: `Durasi reservasi harus kelipatan ${config.durationStepMinutes} menit antara ${config.minDurationMinutes} dan ${config.maxDurationMinutes} menit`,
    };
  }

  if (
    !Number.isInteger(startMinutes) ||
    (startMinutes - config.slotStartMinutes) % config.slotStepMinutes !== 0
  ) {
    return {
      ok: false,
      code: "SLOT_NOT_ALIGNED",
      message: "Jam reservasi harus sesuai pilihan slot yang tersedia",
    };
  }

  if (startMinutes < config.slotStartMinutes) {
    return {
      ok: false,
      code: "BEFORE_OPENING",
      message: `Reservasi dibuka mulai ${minutesToLabel(config.slotStartMinutes)}`,
    };
  }

  if (startMinutes >= config.slotEndMinutes) {
    return {
      ok: false,
      code: "AFTER_CLOSING",
      message: `Reservasi ditutup pada ${minutesToLabel(config.slotEndMinutes)}`,
    };
  }

  const endMinutes = startMinutes + durationMinutes;
  if (endMinutes > config.slotEndMinutes) {
    return {
      ok: false,
      code: "EXCEEDS_CLOSING",
      message: `Reservasi harus selesai sebelum ${minutesToLabel(config.slotEndMinutes)}`,
    };
  }

  return {
    ok: true,
    reservationDate: input.reservationDate,
    startMinutes,
    durationMinutes,
    endMinutes,
  };
}
