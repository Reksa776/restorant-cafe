import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVATION_DEFAULT_DURATION_MINUTES,
  RESERVATION_MAX_HORIZON_DAYS,
  RESERVATION_SLOT_END_MINUTES,
  RESERVATION_SLOT_START_MINUTES,
  addDaysToDateOnly,
  buildSlots,
  canAccommodate,
  dateOnlyFromDb,
  diffDaysBetweenDateOnly,
  holdsCapacity,
  intervalEndMinutes,
  isPastSlot,
  isSlotInGrid,
  isValidDateOnly,
  minutesToLabel,
  overlaps,
  parseDateOnly,
  remainingCapacity,
  validateReservationWindow,
  type ReservationCapacityRow,
  type ReservationNow,
} from "./reservation.slots";

// ============================================================
// PHASE R1 — RESERVATION SLOT ENGINE UNIT TESTS
//
// Pure-module tests: no Prisma, no database, no clock. "Now" is always
// injected, so every assertion is deterministic.
//
// Run with: npx tsx --test src/services/reservation/reservation.unit.test.ts
// ============================================================

/** 10:00–11:30 (the opening slot). */
const TEN_OCLOCK = { startMinutes: 10 * 60, durationMinutes: 90 };
/** 11:00–12:30 — straddles the previous interval. */
const ELEVEN_OCLOCK = { startMinutes: 11 * 60, durationMinutes: 90 };
/** 11:30–13:00 — starts exactly when the first ends. */
const HALF_PAST_ELEVEN = { startMinutes: 11 * 60 + 30, durationMinutes: 90 };
/** 14:00–15:30 — a clearly separate booking. */
const TWO_PM = { startMinutes: 14 * 60, durationMinutes: 90 };

/** Fixed local day used by every window assertion. */
const TODAY = "2026-09-15";
/** 09:00 local — before opening, so nothing from opening onward is "past". */
const MORNING_NOW: ReservationNow = { today: TODAY, nowMinutes: 9 * 60 };
/**
 * 00:00 local. Needed when asserting the BEFORE_OPENING branch, because at
 * 09:00 the 09:00 slot itself already counts as started (PAST_SLOT wins).
 */
const MIDNIGHT_NOW: ReservationNow = { today: TODAY, nowMinutes: 0 };

function row(
  interval: { startMinutes: number; durationMinutes: number },
  partySize: number,
  status: string
): ReservationCapacityRow {
  return { ...interval, partySize, status };
}

// ============================================================
// 1–5. Overlap (half-open interval)
// ============================================================

describe("overlaps — half-open interval", () => {
  it("1. returns true for genuinely overlapping intervals", () => {
    assert.equal(overlaps(TEN_OCLOCK, ELEVEN_OCLOCK), true);
    assert.equal(overlaps(ELEVEN_OCLOCK, TEN_OCLOCK), true);
  });

  it("2. returns false for disjoint intervals", () => {
    assert.equal(overlaps(TEN_OCLOCK, TWO_PM), false);
    assert.equal(overlaps(TWO_PM, TEN_OCLOCK), false);
  });

  it("3. boundary: one interval ending exactly when the next starts does NOT overlap", () => {
    // 10:00–11:30 and 11:30–13:00 — touching, therefore free.
    assert.equal(intervalEndMinutes(TEN_OCLOCK), HALF_PAST_ELEVEN.startMinutes);
    assert.equal(overlaps(TEN_OCLOCK, HALF_PAST_ELEVEN), false);
    assert.equal(overlaps(HALF_PAST_ELEVEN, TEN_OCLOCK), false);
  });

  it("3b. boundary: one minute of intrusion DOES overlap", () => {
    // 10:00–11:30 and 11:29–13:00.
    const intruding = { startMinutes: 11 * 60 - 1, durationMinutes: 90 };
    assert.equal(intruding.startMinutes, 659);
    assert.equal(overlaps(TEN_OCLOCK, intruding), true);
    assert.equal(overlaps(intruding, TEN_OCLOCK), true);
  });

  it("4. detects partially overlapping intervals", () => {
    const lateStart = { startMinutes: 10 * 60 + 30, durationMinutes: 90 }; // 10:30–12:00
    assert.equal(overlaps(TEN_OCLOCK, lateStart), true);
    assert.equal(overlaps(lateStart, TEN_OCLOCK), true);
  });

  it("5. detects nested intervals (either direction)", () => {
    const wide = { startMinutes: 10 * 60, durationMinutes: 180 }; // 10:00–13:00
    const narrow = { startMinutes: 11 * 60, durationMinutes: 30 }; // 11:00–11:30
    assert.equal(narrow.startMinutes > wide.startMinutes, true);
    assert.equal(
      narrow.startMinutes + narrow.durationMinutes <
        wide.startMinutes + wide.durationMinutes,
      true
    );
    assert.equal(overlaps(wide, narrow), true);
    assert.equal(overlaps(narrow, wide), true);
  });

  it("never overlaps a zero/negative duration", () => {
    const zero = { startMinutes: 10 * 60 + 10, durationMinutes: 0 };
    assert.equal(overlaps(TEN_OCLOCK, zero), false);
    assert.equal(overlaps(zero, TEN_OCLOCK), false);
  });
});

// ============================================================
// 6–11. Capacity accounting (which statuses hold the slot)
// ============================================================

describe("remainingCapacity / canAccommodate", () => {
  const CAPACITY = 4;

  it("6. accepts a party that exactly fits the table capacity", () => {
    const remaining = remainingCapacity(CAPACITY, [], TEN_OCLOCK);
    assert.equal(remaining, CAPACITY);
    assert.equal(
      canAccommodate(CAPACITY, [], { ...TEN_OCLOCK, partySize: 4 }),
      true
    );
  });

  it("7. rejects a party larger than the remaining capacity", () => {
    assert.equal(
      canAccommodate(CAPACITY, [], { ...TEN_OCLOCK, partySize: 5 }),
      false
    );

    const held: ReservationCapacityRow[] = [row(TEN_OCLOCK, 4, "CONFIRMED")];
    const remaining = remainingCapacity(CAPACITY, held, TEN_OCLOCK);
    assert.equal(remaining, 0);
    assert.equal(
      canAccommodate(CAPACITY, held, { ...TEN_OCLOCK, partySize: 1 }),
      false
    );
  });

  it("8. CANCELLED reservations do not consume capacity", () => {
    const cancelled = [row(TEN_OCLOCK, 4, "CANCELLED")];
    assert.equal(holdsCapacity("CANCELLED"), false);
    assert.equal(remainingCapacity(CAPACITY, cancelled, TEN_OCLOCK), CAPACITY);
    assert.equal(
      canAccommodate(CAPACITY, cancelled, { ...TEN_OCLOCK, partySize: 4 }),
      true
    );
  });

  it("9. NO_SHOW reservations do not consume capacity", () => {
    const noShow = [row(TEN_OCLOCK, 4, "NO_SHOW")];
    assert.equal(holdsCapacity("NO_SHOW"), false);
    assert.equal(remainingCapacity(CAPACITY, noShow, TEN_OCLOCK), CAPACITY);
    assert.equal(
      canAccommodate(CAPACITY, noShow, { ...TEN_OCLOCK, partySize: 4 }),
      true
    );
  });

  it("10. CONFIRMED reservations do consume capacity", () => {
    const confirmed = [row(TEN_OCLOCK, 3, "CONFIRMED")];
    assert.equal(holdsCapacity("CONFIRMED"), true);
    assert.equal(remainingCapacity(CAPACITY, confirmed, TEN_OCLOCK), 1);
    assert.equal(
      canAccommodate(CAPACITY, confirmed, { ...TEN_OCLOCK, partySize: 1 }),
      true
    );
    assert.equal(
      canAccommodate(CAPACITY, confirmed, { ...TEN_OCLOCK, partySize: 2 }),
      false
    );
  });

  it("11. PENDING reservations do consume capacity (never double-sold)", () => {
    const pending = [row(TEN_OCLOCK, 3, "PENDING")];
    assert.equal(holdsCapacity("PENDING"), true);
    assert.equal(remainingCapacity(CAPACITY, pending, TEN_OCLOCK), 1);
    assert.equal(
      canAccommodate(CAPACITY, pending, { ...TEN_OCLOCK, partySize: 2 }),
      false
    );
  });

  it("11b. SEATED and COMPLETED also hold their slot", () => {
    assert.equal(holdsCapacity("SEATED"), true);
    assert.equal(holdsCapacity("COMPLETED"), true);
    assert.equal(
      remainingCapacity(CAPACITY, [row(TEN_OCLOCK, 2, "SEATED")], TEN_OCLOCK),
      2
    );
    assert.equal(
      remainingCapacity(
        CAPACITY,
        [row(TEN_OCLOCK, 2, "COMPLETED")],
        TEN_OCLOCK
      ),
      2
    );
  });

  it("11c. only OVERLAPPING holdings are counted", () => {
    const existing = [
      row(TWO_PM, 4, "CONFIRMED"), // different time — irrelevant
      row(HALF_PAST_ELEVEN, 4, "CONFIRMED"), // touching — irrelevant
    ];
    assert.equal(remainingCapacity(CAPACITY, existing, TEN_OCLOCK), CAPACITY);
  });

  it("11d. sums every overlapping holding", () => {
    const existing = [
      row(TEN_OCLOCK, 2, "CONFIRMED"),
      row(ELEVEN_OCLOCK, 1, "PENDING"),
      row(HALF_PAST_ELEVEN, 4, "CANCELLED"), // ignored
    ];
    // 10:00–11:30 and 11:00–12:30 both overlap the request → 2 + 1 held.
    assert.equal(remainingCapacity(CAPACITY, existing, TEN_OCLOCK), 1);
  });

  it("11e. an unknown status never holds capacity (fail-open is explicit)", () => {
    assert.equal(holdsCapacity("LEGACY_UNKNOWN"), false);
  });
});

// ============================================================
// Slot grid
// ============================================================

describe("slot grid", () => {
  it("builds hourly starts that finish by closing time", () => {
    const slots = buildSlots();

    assert.equal(slots.length, 11);
    assert.equal(slots[0].startMinutes, RESERVATION_SLOT_START_MINUTES);
    assert.equal(slots[0].label, "10:00");
    assert.equal(slots[0].endMinutes, 10 * 60 + RESERVATION_DEFAULT_DURATION_MINUTES);
    assert.equal(slots.at(-1)?.label, "20:00");
    assert.equal(slots.at(-1)?.endMinutes, 21 * 60 + 30);

    // Every slot must end at or before closing.
    for (const slot of slots) {
      assert.equal(slot.endMinutes <= RESERVATION_SLOT_END_MINUTES, true);
    }
    // Never past the last grid start (20:00 with a 90-minute default).
    assert.equal(slots.at(-1)?.startMinutes, 20 * 60);
  });

  it("drops slots that already started when `now` is supplied", () => {
    const midday: ReservationNow = { today: TODAY, nowMinutes: 12 * 60 };
    const slots = buildSlots({
      now: midday,
      reservationDate: TODAY,
      durationMinutes: 90,
    });

    // 10:00, 11:00 and 12:00 have started (inclusive) → 11 - 3 = 8 remain.
    assert.equal(slots.length, 8);
    assert.equal(slots[0].label, "13:00");
  });

  it("is deterministic — no clock is read", () => {
    assert.deepEqual(buildSlots(), buildSlots());
    assert.deepEqual(buildSlots({ durationMinutes: 60 }), buildSlots({ durationMinutes: 60 }));
  });

  it("isSlotInGrid requires alignment anchored at opening time", () => {
    assert.equal(isSlotInGrid(10 * 60), true);
    assert.equal(isSlotInGrid(10 * 60 + 30), false); // off the hourly grid
    assert.equal(isSlotInGrid(9 * 60), false); // before opening
    assert.equal(isSlotInGrid(21 * 60 + 30), false); // 90 min would pass closing
    assert.equal(isSlotInGrid(20 * 60), true); // fits exactly
  });

  it("minutesToLabel renders HH:MM", () => {
    assert.equal(minutesToLabel(0), "00:00");
    assert.equal(minutesToLabel(10 * 60), "10:00");
    assert.equal(minutesToLabel(12 * 60 + 5), "12:05");
    assert.equal(minutesToLabel(RESERVATION_SLOT_END_MINUTES), "22:00");
  });
});

// ============================================================
// 12–16. Window validation
// ============================================================

describe("validateReservationWindow", () => {
  it("accepts a valid booking and echoes the resolved window", () => {
    const result = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 10 * 60, durationMinutes: 90 },
      MORNING_NOW
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.reservationDate, TODAY);
      assert.equal(result.startMinutes, 600);
      assert.equal(result.endMinutes, 690);
    }
  });

  it("12. rejects a slot that starts before opening", () => {
    // 09:00 sits on the grid (anchored at opening) but precedes opening.
    // Judged from midnight so "past" cannot mask the opening-hours rule.
    const result = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 9 * 60, durationMinutes: 90 },
      MIDNIGHT_NOW
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "BEFORE_OPENING");
  });

  it("12b. rejects an unaligned start time", () => {
    const result = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 10 * 60 + 15, durationMinutes: 90 },
      MORNING_NOW
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SLOT_NOT_ALIGNED");
  });

  it("13. rejects a slot that starts at or after closing", () => {
    for (const startMinutes of [22 * 60, 23 * 60]) {
      const result = validateReservationWindow(
        { reservationDate: TODAY, startMinutes, durationMinutes: 90 },
        MORNING_NOW
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "AFTER_CLOSING");
    }
  });

  it("14. rejects a duration that runs past closing", () => {
    const result = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 20 * 60, durationMinutes: 180 },
      MORNING_NOW
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EXCEEDS_CLOSING");
  });

  it("14b. accepts a booking that ends exactly at closing", () => {
    // 20:30 is not on the hourly grid → alignment is checked first.
    const offGrid = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 20 * 60 + 30, durationMinutes: 90 },
      MORNING_NOW
    );
    assert.equal(offGrid.ok, false);
    if (!offGrid.ok) assert.equal(offGrid.code, "SLOT_NOT_ALIGNED");

    // On-grid start whose interval lands exactly on closing: 20:00 + 120.
    const onGrid = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 20 * 60, durationMinutes: 120 },
      MORNING_NOW
    );
    assert.equal(onGrid.ok, true);
    if (onGrid.ok) assert.equal(onGrid.endMinutes, RESERVATION_SLOT_END_MINUTES);
  });

  it("rejects an invalid or non-calendar date", () => {
    for (const reservationDate of [
      "2026-02-30",
      "15-09-2026",
      "2026-9-15",
      "2026-09-15T10:00:00.000Z",
      "not-a-date",
    ]) {
      const result = validateReservationWindow(
        { reservationDate, startMinutes: 10 * 60, durationMinutes: 90 },
        MORNING_NOW
      );
      assert.equal(result.ok, false, `expected ${reservationDate} to fail`);
      if (!result.ok) assert.equal(result.code, "INVALID_DATE");
    }
  });

  it("rejects an out-of-step duration", () => {
    const result = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 10 * 60, durationMinutes: 95 },
      MORNING_NOW
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DURATION_INVALID");
  });

  it("15. rejects a date beyond the 60-day horizon", () => {
    const beyond = addDaysToDateOnly(TODAY, RESERVATION_MAX_HORIZON_DAYS + 1);
    assert.equal(diffDaysBetweenDateOnly(TODAY, beyond), RESERVATION_MAX_HORIZON_DAYS + 1);

    const result = validateReservationWindow(
      { reservationDate: beyond, startMinutes: 10 * 60, durationMinutes: 90 },
      MORNING_NOW
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "BEYOND_HORIZON");
  });

  it("15b. accepts the last day inside the horizon", () => {
    const lastDay = addDaysToDateOnly(TODAY, RESERVATION_MAX_HORIZON_DAYS);
    const result = validateReservationWindow(
      { reservationDate: lastDay, startMinutes: 10 * 60, durationMinutes: 90 },
      MORNING_NOW
    );
    assert.equal(result.ok, true);
  });

  it("16. rejects a slot that already started today", () => {
    const result = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 10 * 60, durationMinutes: 90 },
      { today: TODAY, nowMinutes: 12 * 60 }
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PAST_SLOT");

    // The current slot itself counts as past (inclusive boundary).
    const exact = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 12 * 60, durationMinutes: 90 },
      { today: TODAY, nowMinutes: 12 * 60 }
    );
    assert.equal(exact.ok, false);
    if (!exact.ok) assert.equal(exact.code, "PAST_SLOT");
  });

  it("16b. rejects any slot on a previous day", () => {
    const yesterday = addDaysToDateOnly(TODAY, -1);
    const result = validateReservationWindow(
      { reservationDate: yesterday, startMinutes: 20 * 60, durationMinutes: 90 },
      MORNING_NOW
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PAST_SLOT");
  });

  it("16c. isPastSlot compares date-only strings and injected minutes", () => {
    assert.equal(
      isPastSlot({ reservationDate: TODAY, startMinutes: 12 * 60 }, MORNING_NOW),
      false
    );
    assert.equal(
      isPastSlot(
        { reservationDate: TODAY, startMinutes: 10 * 60 },
        { today: TODAY, nowMinutes: 10 * 60 }
      ),
      true
    );
    assert.equal(
      isPastSlot(
        { reservationDate: addDaysToDateOnly(TODAY, 1), startMinutes: 0 },
        MORNING_NOW
      ),
      false
    );
  });
});

// ============================================================
// 17. Date-only integrity
// ============================================================

describe("date-only handling", () => {
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

  it("17. keeps date strings date-only (never converts to a timestamp)", () => {
    assert.equal(isValidDateOnly(TODAY), true);
    assert.equal(isValidDateOnly("2026-09-15T00:00:00.000Z"), false);

    const parts = parseDateOnly(TODAY);
    assert.deepEqual(parts, { year: 2026, month: 9, day: 15 });

    const shifted = addDaysToDateOnly(TODAY, 1);
    assert.equal(shifted, "2026-09-16");
    assert.match(shifted, DATE_ONLY);
    assert.equal(shifted.includes("T"), false);

    // Month/year rollover stays date-only too.
    assert.equal(addDaysToDateOnly("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysToDateOnly("2026-01-01", -1), "2025-12-31");

    // Validation echoes the string unchanged — no Date round-trip.
    const result = validateReservationWindow(
      { reservationDate: TODAY, startMinutes: 10 * 60, durationMinutes: 90 },
      MORNING_NOW
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.reservationDate, TODAY);
      assert.match(result.reservationDate, DATE_ONLY);
    }
  });

  it("17b. rejects malformed date strings", () => {
    for (const value of ["", "2026/09/15", "20260915", "2026-13-01", "2026-00-10"]) {
      assert.equal(isValidDateOnly(value), false, `expected ${value} to fail`);
    }
  });

  it("17c. diffDaysBetweenDateOnly is pure calendar arithmetic", () => {
    assert.equal(diffDaysBetweenDateOnly("2026-09-15", "2026-09-15"), 0);
    assert.equal(diffDaysBetweenDateOnly("2026-09-15", "2026-09-16"), 1);
    assert.equal(diffDaysBetweenDateOnly("2026-09-16", "2026-09-15"), -1);
    assert.equal(diffDaysBetweenDateOnly("2026-02-28", "2026-03-01"), 1);
  });
});

// ============================================================
// 18. No timezone conversion inside the engine
// ============================================================

describe("timezone safety", () => {
  it("18. reads stored DATE values through UTC parts only", () => {
    // Prisma returns a MySQL DATE as a Date at UTC midnight. Under any local
    // offset, local getters would shift this to the previous/next day; the
    // engine must return the calendar day that was stored.
    assert.equal(dateOnlyFromDb(new Date("2026-09-15T00:00:00.000Z")), "2026-09-15");
    assert.equal(dateOnlyFromDb(new Date("2026-01-01T00:00:00.000Z")), "2026-01-01");
    assert.equal(dateOnlyFromDb(new Date("2026-12-31T00:00:00.000Z")), "2026-12-31");

    // Round-trip: date-only string → stored day → same date-only string.
    for (const value of ["2026-03-31", "2026-06-01", "2026-11-30"]) {
      const asStored = new Date(`${value}T00:00:00.000Z`);
      assert.equal(dateOnlyFromDb(asStored), value);
    }
  });

  it("18b. never consults the real clock — the injected 'now' always wins", () => {
    // Direction A: with an injected "now" far in the future, a 2026 date is
    // PAST. Reading the real clock would have produced a horizon/ok verdict
    // instead (2026 is not in the past of the system clock).
    const farFuture: ReservationNow = { today: "2199-01-01", nowMinutes: 9 * 60 };
    const past = validateReservationWindow(
      { reservationDate: "2026-09-15", startMinutes: 10 * 60, durationMinutes: 90 },
      farFuture
    );
    assert.equal(past.ok, false);
    if (!past.ok) assert.equal(past.code, "PAST_SLOT");

    // Direction B: a date ~26,000 days beyond the real clock, but only 45
    // days ahead of the INJECTED "now", is accepted. Reading the real clock
    // would have returned BEYOND_HORIZON.
    const farNow: ReservationNow = { today: "2099-01-01", nowMinutes: 9 * 60 };
    const withinInjectedHorizon = addDaysToDateOnly(farNow.today, 45);
    assert.equal(diffDaysBetweenDateOnly("2026-09-15", withinInjectedHorizon) > 1000, true);

    const accepted = validateReservationWindow(
      {
        reservationDate: withinInjectedHorizon,
        startMinutes: 10 * 60,
        durationMinutes: 90,
      },
      farNow
    );
    assert.equal(accepted.ok, true);
  });

  it("18c. the grid is offset-independent (pure integer arithmetic)", () => {
    // The window is expressed in minutes-from-midnight, so it cannot be
    // shifted by the host offset: opening is always exactly 600.
    assert.equal(RESERVATION_SLOT_START_MINUTES, 600);
    assert.equal(RESERVATION_SLOT_END_MINUTES, 1320);
    assert.equal(buildSlots()[0].label, "10:00");
    assert.equal(buildSlots().at(-1)?.label, "20:00");
  });
});
