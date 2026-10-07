import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  effectivePaymentStatus,
  formatCountdown,
  isTerminalPaymentStatus,
  shouldPoll,
} from "./reservation-payment-state";

// ============================================================
// PHASE 3 — pure reservation-payment UI state helpers.
//
// Covers the state machine the customer payment page renders from the backend
// DTO + the server-derived countdown. No DOM, no network — same node:test
// setup the project already uses.
//
// Run: npx tsx --test --test-force-exit src/app/(customer)/reservasi/reservation-payment-state.test.ts
// ============================================================

const NOW = new Date("2026-11-01T10:00:00.000Z").getTime();

describe("effectivePaymentStatus", () => {
  it("C: no payment intent → UNPAID", () => {
    assert.equal(effectivePaymentStatus(null, NOW), "UNPAID");
    assert.equal(
      effectivePaymentStatus({ payment: null, paymentStatus: "UNPAID" }, NOW),
      "UNPAID"
    );
  });

  it("D: PENDING with a future expiry → PENDING", () => {
    assert.equal(
      effectivePaymentStatus(
        {
          payment: { status: "PENDING", expiresAt: "2026-11-01T10:30:00.000Z" },
          paymentStatus: "PENDING",
        },
        NOW
      ),
      "PENDING"
    );
  });

  it("E: PAID → PAID", () => {
    assert.equal(
      effectivePaymentStatus({ payment: { status: "PAID" }, paymentStatus: "PAID" }, NOW),
      "PAID"
    );
  });

  it("F: PENDING past its expiry → EXPIRED (no reliance on a webhook)", () => {
    assert.equal(
      effectivePaymentStatus(
        {
          payment: { status: "PENDING", expiresAt: "2026-11-01T09:59:00.000Z" },
          paymentStatus: "PENDING",
        },
        NOW
      ),
      "EXPIRED"
    );
  });

  it("explicit EXPIRED / FAILED / CANCELLED / REFUNDED pass through", () => {
    for (const status of ["EXPIRED", "FAILED", "CANCELLED", "REFUNDED"]) {
      assert.equal(
        effectivePaymentStatus({ payment: { status }, paymentStatus: status }, NOW),
        status
      );
    }
  });

  it("derives from paymentStatus when no payment row exists yet", () => {
    assert.equal(
      effectivePaymentStatus({ payment: null, paymentStatus: "PENDING" }, NOW),
      "PENDING"
    );
  });
});

describe("formatCountdown", () => {
  it("is derived from the server expiresAt in HH:MM:SS", () => {
    assert.equal(
      formatCountdown("2026-11-01T10:15:30.000Z", NOW),
      "00:15:30"
    );
  });

  it("never goes negative", () => {
    assert.equal(
      formatCountdown("2026-11-01T09:00:00.000Z", NOW),
      "00:00:00"
    );
  });

  it("returns null when there is no/invalid expiry", () => {
    assert.equal(formatCountdown(null, NOW), null);
    assert.equal(formatCountdown(undefined, NOW), null);
    assert.equal(formatCountdown("not-a-date", NOW), null);
  });

  it("formats hours for long windows", () => {
    assert.equal(
      formatCountdown("2026-11-01T12:00:00.000Z", NOW),
      "02:00:00"
    );
  });
});

describe("polling + terminal rules", () => {
  it("polls ONLY a live PENDING payment (never PAID/FAILED/EXPIRED/CANCELLED)", () => {
    assert.equal(shouldPoll("PENDING"), true);
    for (const s of ["UNPAID", "PAID", "EXPIRED", "FAILED", "CANCELLED", "REFUNDED"]) {
      assert.equal(shouldPoll(s), false, `must not poll ${s}`);
    }
  });

  it("classifies terminal statuses", () => {
    for (const s of ["PAID", "EXPIRED", "FAILED", "CANCELLED", "REFUNDED"]) {
      assert.equal(isTerminalPaymentStatus(s), true);
    }
    assert.equal(isTerminalPaymentStatus("PENDING"), false);
    assert.equal(isTerminalPaymentStatus("UNPAID"), false);
  });
});
