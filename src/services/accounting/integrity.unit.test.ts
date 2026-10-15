import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_CUTOFF_MIGRATION,
  buildCutoffAmbiguityDisclosure,
  buildCutoffEvidence,
  buildSnapshotDisclosure,
  buildSnapshotMarker,
  carveWindow,
  classifyCompletionBucket,
  classifyCompletionBucketV2,
  completedWithoutSnapshotStatus,
  completedWithoutSnapshotStatusV3,
  deriveOverallStatus,
  deriveReconciliation,
  evidenceLevelFor,
  markerAllowsCarve,
  parseNaiveUtcDateTime,
  partitionViolations,
  reconciliationStatus,
  revenueWithoutItemsStatus,
  selectLegacyCutoff,
  selectSampleOrderIds,
  violationScope,
} from "./integrity.rules";
import * as integrityRules from "./integrity.rules";
import type {
  IntegrityMarkerObservation,
  LegacyCutoffLedgerRow,
} from "./integrity.rules";
import {
  IntegrityQuerySchema,
  INTEGRITY_SAMPLE_LIMIT_DEFAULT,
  INTEGRITY_SAMPLE_LIMIT_MAX,
} from "./integrity.types";

// ============================================================
// ACCOUNTING INTEGRITY MONITORING — unit tests (no DB required)
//
// Covers the safety-critical decisions:
//   * the proven legacy cutoff is the F.5 migration;
//   * classification NEVER guesses when the cutoff/time is unknown;
//   * severity never downgrades an anomaly;
//   * query params are coerced/validated and bounded;
//   * M2: the observed snapshot marker is a LOWER BOUND only — an EMPTY or
//     FAILED marker read never carves the anomaly bucket, and no evidence
//     field is ever an input to severity;
//   * 2C.5 / M-1: the ledger row that supplies the cutoff is chosen by an
//     explicit, deterministic rule (eligible + earliest + id tie-break) and
//     ambiguity is disclosed instead of hidden;
//   * 2C.5 / M-2: a naive DATETIME literal is parsed as UTC explicitly.
// ============================================================

const CUTOFF = new Date("2026-09-11T16:06:57.831Z");

describe("LEGACY_CUTOFF_MIGRATION", () => {
  it("is the F.5 snapshot migration (proven boundary)", () => {
    assert.equal(
      LEGACY_CUTOFF_MIGRATION,
      "20260911143644_f5_order_item_cost_snapshot"
    );
  });
});

describe("classifyCompletionBucket", () => {
  it("resolves to legacy when completed BEFORE the cutoff", () => {
    assert.equal(
      classifyCompletionBucket(new Date("2026-09-11T16:06:57.830Z"), CUTOFF),
      "legacyExpected"
    );
    assert.equal(
      classifyCompletionBucket("2026-09-01T00:00:00.000Z", CUTOFF),
      "legacyExpected"
    );
  });

  it("resolves to anomaly when completed AT/AFTER the cutoff", () => {
    assert.equal(classifyCompletionBucket(CUTOFF, CUTOFF), "anomaly");
    assert.equal(
      classifyCompletionBucket(new Date("2026-09-20T00:00:00.000Z"), CUTOFF),
      "anomaly"
    );
  });

  it("NEVER guesses when the cutoff is unresolved", () => {
    assert.equal(
      classifyCompletionBucket(new Date("2026-09-11T16:06:57.830Z"), null),
      "unknownCompletion"
    );
  });

  it("NEVER guesses when the completion time is missing/invalid", () => {
    assert.equal(classifyCompletionBucket(null, CUTOFF), "unknownCompletion");
    assert.equal(classifyCompletionBucket(undefined, CUTOFF), "unknownCompletion");
    assert.equal(classifyCompletionBucket("not-a-date", CUTOFF), "unknownCompletion");
  });
});

describe("deriveOverallStatus", () => {
  it("OK only when every check is OK", () => {
    assert.equal(deriveOverallStatus([]), "OK");
    assert.equal(deriveOverallStatus(["OK", "OK", "OK"]), "OK");
  });

  it("WARN for warn/unknown, CRITICAL dominates", () => {
    assert.equal(deriveOverallStatus(["OK", "WARN", "OK"]), "WARN");
    assert.equal(deriveOverallStatus(["OK", "UNKNOWN", "OK"]), "WARN");
    assert.equal(deriveOverallStatus(["OK", "WARN", "CRITICAL"]), "CRITICAL");
  });
});

describe("revenueWithoutItemsStatus (C1)", () => {
  it("is CRITICAL when any revenue order lacks items", () => {
    assert.equal(revenueWithoutItemsStatus(0), "OK");
    assert.equal(revenueWithoutItemsStatus(1), "CRITICAL");
    assert.equal(revenueWithoutItemsStatus(16), "CRITICAL");
  });
});

describe("completedWithoutSnapshotStatus (C2)", () => {
  it("anomaly is CRITICAL", () => {
    assert.equal(
      completedWithoutSnapshotStatus({ anomalyItems: 1, unknownItems: 0, cutoffResolved: true }),
      "CRITICAL"
    );
  });

  it("unclassified items are WARN when the cutoff is proven, UNKNOWN otherwise", () => {
    assert.equal(
      completedWithoutSnapshotStatus({ anomalyItems: 0, unknownItems: 3, cutoffResolved: true }),
      "WARN"
    );
    assert.equal(
      completedWithoutSnapshotStatus({ anomalyItems: 0, unknownItems: 3, cutoffResolved: false }),
      "UNKNOWN"
    );
  });

  it("expected legacy alone is OK (not an anomaly)", () => {
    assert.equal(
      completedWithoutSnapshotStatus({ anomalyItems: 0, unknownItems: 0, cutoffResolved: true }),
      "OK"
    );
  });
});

describe("reconciliationStatus (C3)", () => {
  it("is CRITICAL on any relational violation", () => {
    assert.equal(reconciliationStatus(0), "OK");
    assert.equal(reconciliationStatus(1), "CRITICAL");
  });
});

describe("IntegrityQuerySchema", () => {
  it("defaults sampleLimit and coerces numeric strings", () => {
    const def = IntegrityQuerySchema.parse({});
    assert.equal(def.sampleLimit, INTEGRITY_SAMPLE_LIMIT_DEFAULT);
    const parsed = IntegrityQuerySchema.parse({ sampleLimit: "25" });
    assert.equal(parsed.sampleLimit, 25);
  });

  it("bounds sampleLimit to 1..MAX", () => {
    assert.equal(IntegrityQuerySchema.safeParse({ sampleLimit: 0 }).success, false);
    assert.equal(IntegrityQuerySchema.safeParse({ sampleLimit: -1 }).success, false);
    assert.equal(
      IntegrityQuerySchema.safeParse({ sampleLimit: INTEGRITY_SAMPLE_LIMIT_MAX + 1 }).success,
      false
    );
    assert.equal(
      IntegrityQuerySchema.safeParse({ sampleLimit: INTEGRITY_SAMPLE_LIMIT_MAX }).success,
      true
    );
  });
});

// ============================================================
// F1–F4 regression tests
// ============================================================

describe("F1 — violation scope classification", () => {
  it("marks Order-relation invariants BRANCH_SCOPED and the rest TENANT_WIDE", () => {
    assert.equal(violationScope("SNAPSHOT_ORDER_MISMATCH"), "BRANCH_SCOPED");
    assert.equal(violationScope("SNAPSHOT_TENANT_MISMATCH"), "BRANCH_SCOPED");
    assert.equal(violationScope("SNAPSHOTS_EXCEED_ORDER_ITEMS"), "BRANCH_SCOPED");
    assert.equal(violationScope("ORPHAN_SNAPSHOT_ITEM"), "TENANT_WIDE");
    assert.equal(violationScope("SNAPSHOT_ORDER_MISSING"), "TENANT_WIDE");
    assert.equal(violationScope("DUPLICATE_SNAPSHOT_PER_ITEM"), "TENANT_WIDE");
    // An unknown code must default to the BROADER scope — never understate it.
    assert.equal(violationScope("SOMETHING_NEW"), "TENANT_WIDE");
  });

  it("partitions into clearly separated branch vs tenant groups", () => {
    const { branchScoped, tenantWide } = partitionViolations([
      { code: "SNAPSHOT_ORDER_MISMATCH", count: 2 },
      { code: "ORPHAN_SNAPSHOT_ITEM", count: 1 },
      { code: "SNAPSHOT_TENANT_MISMATCH", count: 3 },
      { code: "DUPLICATE_SNAPSHOT_PER_ITEM", count: 1 },
    ]);
    assert.deepEqual(
      branchScoped.map((v) => v.code),
      ["SNAPSHOT_ORDER_MISMATCH", "SNAPSHOT_TENANT_MISMATCH"]
    );
    assert.ok(branchScoped.every((v) => v.scope === "BRANCH_SCOPED"));
    assert.deepEqual(
      tenantWide.map((v) => v.code),
      ["ORPHAN_SNAPSHOT_ITEM", "DUPLICATE_SNAPSHOT_PER_ITEM"]
    );
    assert.ok(tenantWide.every((v) => v.scope === "TENANT_WIDE"));
  });
});

describe("F1 — sample id scoping", () => {
  it("a branch-scoped caller NEVER receives another branch's order ids", () => {
    const ids = selectSampleOrderIds({
      branchScopedOrderIds: ["A1", "A2"],
      tenantWideOrderIds: ["B1", "B2"],
      branchFilterActive: true,
      limit: 10,
    });
    assert.deepEqual(ids, ["A1", "A2"]);
    assert.ok(!ids.includes("B1") && !ids.includes("B2"));
  });

  it("a tenant-wide caller sees both groups, deduped and capped", () => {
    const ids = selectSampleOrderIds({
      branchScopedOrderIds: ["A1", "A1", "A2"],
      tenantWideOrderIds: ["T1", "A2", "T2"],
      branchFilterActive: false,
      limit: 3,
    });
    assert.deepEqual(ids, ["A1", "A2", "T1"]);
  });
});

describe("F4 — reconciliation verdicts", () => {
  it("reconciled is false whenever ANY invariant is non-zero", () => {
    assert.deepEqual(deriveReconciliation(0, 0), {
      branchReconciled: true,
      tenantReconciled: true,
      reconciled: true,
    });
    assert.deepEqual(deriveReconciliation(1, 0), {
      branchReconciled: false,
      tenantReconciled: true,
      reconciled: false,
    });
    assert.deepEqual(deriveReconciliation(0, 2), {
      branchReconciled: true,
      tenantReconciled: false,
      reconciled: false,
    });
    assert.deepEqual(deriveReconciliation(1, 1), {
      branchReconciled: false,
      tenantReconciled: false,
      reconciled: false,
    });
  });
});

describe("F2 — cutoff evidence states the deploy time is unproven", () => {
  it("always marks codeDeployUnproven, resolved or not", () => {
    const resolved = buildCutoffEvidence({
      migration: LEGACY_CUTOFF_MIGRATION,
      appliedAt: CUTOFF,
      resolved: true,
    });
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.codeDeployUnproven, true);
    assert.equal(resolved.appliedAt, "2026-09-11T16:06:57.831Z");

    const unresolved = buildCutoffEvidence({
      migration: LEGACY_CUTOFF_MIGRATION,
      appliedAt: null,
      resolved: false,
    });
    assert.equal(unresolved.resolved, false);
    assert.equal(unresolved.codeDeployUnproven, true);
    assert.equal(unresolved.appliedAt, null);
  });
});

describe("F2 — cutoff boundary (before / equal / after)", () => {
  it("before → legacyExpected; equal and after → anomaly", () => {
    const before = new Date(CUTOFF.getTime() - 1);
    assert.equal(classifyCompletionBucket(before, CUTOFF), "legacyExpected");
    assert.equal(classifyCompletionBucket(new Date(CUTOFF.getTime()), CUTOFF), "anomaly");
    assert.equal(classifyCompletionBucket(new Date(CUTOFF.getTime() + 1), CUTOFF), "anomaly");
  });

  it("the same boundary holds for a cutoff parsed from a ledger literal (M-2)", () => {
    const parsed = parseNaiveUtcDateTime("2026-10-14 07:52:58.220");
    assert.equal(parsed.toISOString(), "2026-10-14T07:52:58.220Z");
    assert.equal(classifyCompletionBucket(new Date(parsed.getTime() - 1), parsed), "legacyExpected");
    assert.equal(classifyCompletionBucket(new Date(parsed.getTime()), parsed), "anomaly");
    assert.equal(classifyCompletionBucket(new Date(parsed.getTime() + 1), parsed), "anomaly");
  });
});

// ============================================================
// STEP 2C.5 / M-2 — naive DATETIME literal → UTC instant
// ============================================================

describe("2C.5 / M-2 — parseNaiveUtcDateTime", () => {
  it("parses the naive literal as UTC, preserving millisecond precision", () => {
    const parsed = parseNaiveUtcDateTime("2026-10-14 07:52:58.220");
    assert.equal(parsed.toISOString(), "2026-10-14T07:52:58.220Z");
    // Absolute construction: TZ-independent by definition (never local parsing).
    assert.equal(parsed.getTime(), Date.UTC(2026, 9, 14, 7, 52, 58, 220));
    assert.equal(parsed.getUTCMilliseconds(), 220);
  });

  it("pads a short fraction and truncates a long one to milliseconds", () => {
    assert.equal(parseNaiveUtcDateTime("2026-10-14 07:52:58.2").getUTCMilliseconds(), 200);
    assert.equal(parseNaiveUtcDateTime("2026-10-14 07:52:58.22").getUTCMilliseconds(), 220);
    assert.equal(parseNaiveUtcDateTime("2026-10-14 07:52:58.2209").getUTCMilliseconds(), 220);
    assert.equal(parseNaiveUtcDateTime("2026-10-14 07:52:58.220500").getUTCMilliseconds(), 220);
  });

  it("accepts a second-precision literal, a 'T' separator and surrounding whitespace", () => {
    assert.equal(
      parseNaiveUtcDateTime("2026-10-14 07:52:58").toISOString(),
      "2026-10-14T07:52:58.000Z"
    );
    assert.equal(
      parseNaiveUtcDateTime("2026-10-14T07:52:58.220").toISOString(),
      "2026-10-14T07:52:58.220Z"
    );
    assert.equal(
      parseNaiveUtcDateTime("  2026-10-14 07:52:58.220  ").toISOString(),
      "2026-10-14T07:52:58.220Z"
    );
  });

  it("returns an invalid Date for anything unparseable — never a rolled-over guess", () => {
    for (const bad of [
      "",
      "   ",
      "2026-10-14",
      "not-a-date",
      "2026-13-01 00:00:00",   // month 13
      "2026-02-30 00:00:00",   // day out of range
      "2026-10-14 24:00:00",   // hour out of range
      "2026-10-14 07:60:00",   // minute out of range
      "2026-10-14 07:52:60",   // second out of range
      "2026-10-14 07:52:58.1234567", // too many fractional digits
    ]) {
      const parsed = parseNaiveUtcDateTime(bad);
      assert.ok(Number.isNaN(parsed.getTime()), `expected an invalid Date for ${JSON.stringify(bad)}`);
    }
  });

  it("never uses the process time zone (a shifted interpretation would differ)", () => {
    const parsed = parseNaiveUtcDateTime("2026-10-14 07:52:58.220");
    const localInterpretation = new Date(2026, 9, 14, 7, 52, 58, 220).getTime();
    assert.equal(parsed.getTime(), Date.parse("2026-10-14T07:52:58.220Z"));
    if (new Date().getTimezoneOffset() !== 0) {
      assert.notEqual(parsed.getTime(), localInterpretation);
    }
  });
});

// ============================================================
// STEP 2C.5 / M-1 — deterministic cutoff selection from the ledger
//
// Real ledgers can hold several rows for one migration name: a failed attempt
// has `finished_at = NULL`, a rolled-back attempt sets `rolled_back_at`, and a
// re-apply adds another row. `LIMIT 1` over an unordered result could pick any
// of them; `started_at` is never a valid fallback.
// ============================================================

const ledgerRow = (
  id: string,
  finishedAtLiteral: string | null,
  rolledBackAtLiteral: string | null = null
): LegacyCutoffLedgerRow => ({ id, finishedAtLiteral, rolledBackAtLiteral });

const SUCCESSFUL = ledgerRow("id-success", "2026-10-14 07:52:58.220");
const LATER_SUCCESS = ledgerRow("id-later", "2026-10-20 10:00:00.000");
const FAILED = ledgerRow("id-failed", null);
const ROLLED_BACK = ledgerRow(
  "id-rolled-back",
  "2026-10-14 07:52:58.220",
  "2026-10-14 08:02:00.000"
);

describe("2C.5 / M-1 — selectLegacyCutoff", () => {
  it("no matching migration → unresolved, no cutoff is manufactured", () => {
    const selection = selectLegacyCutoff([]);
    assert.equal(selection.appliedAt, null);
    assert.equal(selection.eligibleRows, 0);
    assert.equal(selection.rowsRead, 0);
  });

  it("one successful row → its apply instant, parsed as UTC", () => {
    const selection = selectLegacyCutoff([SUCCESSFUL]);
    assert.equal(selection.appliedAt?.toISOString(), "2026-10-14T07:52:58.220Z");
    assert.equal(selection.eligibleRows, 1);
    assert.equal(selection.rowsRead, 1);
  });

  it("several successful rows → the EARLIEST wins and the count is reported", () => {
    const forward = selectLegacyCutoff([SUCCESSFUL, LATER_SUCCESS]);
    const reversed = selectLegacyCutoff([LATER_SUCCESS, SUCCESSFUL]);
    assert.equal(forward.appliedAt?.toISOString(), "2026-10-14T07:52:58.220Z");
    assert.equal(reversed.appliedAt?.toISOString(), forward.appliedAt?.toISOString());
    assert.equal(forward.eligibleRows, 2);
    assert.equal(forward.rowsRead, 2);
  });

  it("a failed-only ledger never yields a cutoff (no started_at fallback)", () => {
    const selection = selectLegacyCutoff([FAILED]);
    assert.equal(selection.appliedAt, null);
    assert.equal(selection.eligibleRows, 0);
    assert.equal(selection.rowsRead, 1);
  });

  it("a rolled-back row is excluded even when it carries a finished_at", () => {
    const selection = selectLegacyCutoff([ROLLED_BACK]);
    assert.equal(selection.appliedAt, null);
    assert.equal(selection.eligibleRows, 0);
    assert.equal(selection.rowsRead, 1);
  });

  it("a failed attempt followed by a successful apply → the successful row, not ambiguous", () => {
    const selection = selectLegacyCutoff([FAILED, SUCCESSFUL]);
    assert.equal(selection.appliedAt?.toISOString(), "2026-10-14T07:52:58.220Z");
    assert.equal(selection.eligibleRows, 1);
    assert.equal(selection.rowsRead, 2);
  });

  it("a rolled-back attempt followed by a successful apply → the successful row, not ambiguous", () => {
    const selection = selectLegacyCutoff([ROLLED_BACK, SUCCESSFUL]);
    assert.equal(selection.appliedAt?.toISOString(), "2026-10-14T07:52:58.220Z");
    assert.equal(selection.eligibleRows, 1);
  });

  it("failed + rolled-back + successful rows → exactly one eligible row, still unambiguous", () => {
    const selection = selectLegacyCutoff([FAILED, ROLLED_BACK, SUCCESSFUL]);
    assert.equal(selection.eligibleRows, 1);
    assert.equal(selection.rowsRead, 3);
    assert.equal(selection.appliedAt?.toISOString(), "2026-10-14T07:52:58.220Z");
  });

  it("equal finished_at values are order-independent (deterministic id tie-break)", () => {
    const a = ledgerRow("id-a", "2026-10-14 07:52:58.220");
    const z = ledgerRow("id-z", "2026-10-14 07:52:58.220");
    const first = selectLegacyCutoff([a, z]);
    const second = selectLegacyCutoff([z, a]);
    assert.equal(first.appliedAt?.getTime(), second.appliedAt?.getTime());
    assert.equal(first.appliedAt?.toISOString(), "2026-10-14T07:52:58.220Z");
    assert.equal(first.eligibleRows, 2);
  });

  it("time dominates the id tie-break (an earlier row wins regardless of id order)", () => {
    const earlyBigId = ledgerRow("id-zzz", "2026-10-14 07:52:58.220");
    const lateSmallId = ledgerRow("id-aaa", "2026-10-15 00:00:00.000");
    for (const rows of [[earlyBigId, lateSmallId], [lateSmallId, earlyBigId]]) {
      assert.equal(
        selectLegacyCutoff(rows).appliedAt?.toISOString(),
        "2026-10-14T07:52:58.220Z"
      );
    }
  });

  it("an unparseable finished_at is not eligible (never a guessed instant)", () => {
    const selection = selectLegacyCutoff([
      ledgerRow("id-bad", "not-a-timestamp"),
      ledgerRow("id-bad-2", "2026-13-01 00:00:00"),
    ]);
    assert.equal(selection.appliedAt, null);
    assert.equal(selection.eligibleRows, 0);
    assert.equal(selection.rowsRead, 2);
  });

  it("is pure: the input array and its rows are not mutated", () => {
    const rows = [LATER_SUCCESS, SUCCESSFUL, FAILED];
    const snapshot = JSON.stringify(rows);
    selectLegacyCutoff(rows);
    assert.equal(JSON.stringify(rows), snapshot);
  });
});

// ============================================================
// STEP 2C.5 / M1-R — ambiguity disclosure (display-only metadata)
// ============================================================

describe("2C.5 / M1-R — buildCutoffAmbiguityDisclosure", () => {
  it("is silent for zero or one eligible row", () => {
    assert.equal(buildCutoffAmbiguityDisclosure(0), null);
    assert.equal(buildCutoffAmbiguityDisclosure(1), null);
  });

  it("states the eligible-row count for an ambiguous ledger", () => {
    const disclosure = buildCutoffAmbiguityDisclosure(2);
    assert.ok(disclosure);
    assert.equal(disclosure?.code, "LEGACY_CUTOFF_AMBIGUOUS");
    assert.ok(disclosure?.text.includes("2"), "the count must be stated");
    assert.ok(/AWAL/.test(disclosure?.text ?? ""), "the earliest-row rule must be stated");

    const five = buildCutoffAmbiguityDisclosure(5);
    assert.ok(five?.text.includes("5"));
  });

  it("never changes a severity: the same counts yield the same status", () => {
    // The disclosure is not an input to any severity rule (it has no parameter
    // for one). Asserted on the only statuses an ambiguous ledger can produce.
    const counts = { anomalyItems: 0, beforeFirstSnapshotItems: 0, unknownItems: 3 };
    assert.equal(
      completedWithoutSnapshotStatusV3({ ...counts, cutoffResolved: true }),
      "WARN"
    );
    assert.equal(
      completedWithoutSnapshotStatusV3({ ...counts, cutoffResolved: false }),
      "UNKNOWN"
    );
  });
});

// ============================================================
// M2 (Opsi 1) — observed snapshot marker = LOWER BOUND only
//
// The marker may only ever carve the unproven activation window out of the
// anomaly bucket. It must never move the cutoff, never turn an anomaly into OK,
// and never be activated by an EMPTY or FAILED marker read.
// ============================================================

const MARKER = new Date("2026-09-20T00:00:00.000Z");
const OBSERVED = {
  source: "SNAPSHOT_MIN_OBSERVED",
  population: 2,
  firstObservedSnapshotAt: MARKER,
} as const;
const OBSERVED_NULL_VALUE = {
  source: "SNAPSHOT_MIN_OBSERVED",
  population: 3,
  firstObservedSnapshotAt: null,
} as const;
const EMPTY = {
  source: "SNAPSHOT_POPULATION_EMPTY",
  population: 0,
  firstObservedSnapshotAt: null,
} as const;
const UNVERIFIED = {
  source: "SNAPSHOT_MARKER_UNVERIFIED",
  population: null,
  firstObservedSnapshotAt: null,
} as const;

/** Classification WITHOUT the marker, used as the anti-downgrade baseline. */
const cutoffOnlyStatus = (anomalyItems: number, unknownItems: number) =>
  completedWithoutSnapshotStatus({
    anomalyItems,
    unknownItems,
    cutoffResolved: true,
  });

describe("M2 — buildSnapshotMarker provenance", () => {
  it("observed only for a verified non-empty population", () => {
    const m = buildSnapshotMarker({
      population: 3,
      firstObservedSnapshotAt: MARKER,
    });
    assert.equal(m.source, "SNAPSHOT_MIN_OBSERVED");
    assert.equal(m.firstObservedSnapshotAt?.toISOString(), MARKER.toISOString());
    assert.equal(markerAllowsCarve(m), true);
  });

  it("a verified EMPTY population is not a failed read", () => {
    const m = buildSnapshotMarker({ population: 0, firstObservedSnapshotAt: null });
    assert.equal(m.source, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(m.firstObservedSnapshotAt, null);
    assert.equal(markerAllowsCarve(m), false);
  });

  it("a FAILED read is UNVERIFIED, never POPULATION_EMPTY", () => {
    const m = buildSnapshotMarker({ population: null, firstObservedSnapshotAt: null });
    assert.equal(m.source, "SNAPSHOT_MARKER_UNVERIFIED");
    assert.equal(markerAllowsCarve(m), false);
  });

  it("a non-empty population without a valid MIN is UNVERIFIED", () => {
    assert.equal(
      buildSnapshotMarker({ population: 5, firstObservedSnapshotAt: null }).source,
      "SNAPSHOT_MARKER_UNVERIFIED"
    );
    assert.equal(
      buildSnapshotMarker({ population: 5, firstObservedSnapshotAt: new Date("nope") })
        .source,
      "SNAPSHOT_MARKER_UNVERIFIED"
    );
  });

  it("a negative population is clamped to EMPTY (no carve)", () => {
    const m = buildSnapshotMarker({ population: -1, firstObservedSnapshotAt: MARKER });
    assert.equal(m.source, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(m.population, 0);
    assert.equal(markerAllowsCarve(m), false);
  });

  it("carries the verified population without inventing one", () => {
    assert.equal(buildSnapshotMarker({ population: 0, firstObservedSnapshotAt: null }).population, 0);
    assert.equal(
      buildSnapshotMarker({ population: null, firstObservedSnapshotAt: null }).population,
      null
    );
    assert.equal(
      buildSnapshotMarker({ population: 4, firstObservedSnapshotAt: MARKER }).population,
      4
    );
  });
});

describe("M2 — classifyCompletionBucketV2", () => {
  it("keeps legacy / anomaly behaviour and adds the observed window", () => {
    assert.equal(
      classifyCompletionBucketV2(new Date("2026-09-01T00:00:00.000Z"), CUTOFF, OBSERVED),
      "legacyExpected"
    );
    assert.equal(classifyCompletionBucketV2(CUTOFF, CUTOFF, OBSERVED), "beforeFirstSnapshot");
    assert.equal(
      classifyCompletionBucketV2(new Date("2026-09-15T00:00:00.000Z"), CUTOFF, OBSERVED),
      "beforeFirstSnapshot"
    );
    assert.equal(classifyCompletionBucketV2(MARKER, CUTOFF, OBSERVED), "anomaly");
    assert.equal(
      classifyCompletionBucketV2(new Date("2026-10-01T00:00:00.000Z"), CUTOFF, OBSERVED),
      "anomaly"
    );
  });

  it("EMPTY / UNVERIFIED variants never carve", () => {
    for (const marker of [EMPTY, UNVERIFIED, OBSERVED_NULL_VALUE]) {
      assert.equal(classifyCompletionBucketV2(CUTOFF, CUTOFF, marker), "anomaly");
      assert.equal(
        classifyCompletionBucketV2(new Date("2026-09-15T00:00:00.000Z"), CUTOFF, marker),
        "anomaly"
      );
      assert.equal(markerAllowsCarve(marker), false);
    }
  });

  it("never guesses when the cutoff or the completion time is unusable", () => {
    assert.equal(classifyCompletionBucketV2(CUTOFF, null, OBSERVED), "unknownCompletion");
    assert.equal(classifyCompletionBucketV2(null, CUTOFF, OBSERVED), "unknownCompletion");
    assert.equal(classifyCompletionBucketV2("bad", CUTOFF, OBSERVED), "unknownCompletion");
  });

  it("a marker OLDER than the cutoff is reported as-is and never widens legacy", () => {
    const stale = {
      source: "SNAPSHOT_MIN_OBSERVED",
      population: 1,
      firstObservedSnapshotAt: new Date("2026-09-01T00:00:00.000Z"),
    } as const;
    assert.equal(markerAllowsCarve(stale), true);
    // done >= cutoff but also >= stale marker → anomaly, not beforeFirstSnapshot,
    // and never legacyExpected (the cutoff is never re-set from the marker).
    assert.equal(classifyCompletionBucketV2(CUTOFF, CUTOFF, stale), "anomaly");
    assert.equal(
      classifyCompletionBucketV2(new Date("2026-08-01T00:00:00.000Z"), CUTOFF, stale),
      "legacyExpected"
    );
  });

  it("the 4 buckets partition the population (invariant, marker observed)", () => {
    const doneValues = [
      null,
      new Date("2026-09-01T00:00:00.000Z"),
      CUTOFF,
      new Date("2026-09-15T00:00:00.000Z"),
      MARKER,
      new Date("2026-10-01T00:00:00.000Z"),
    ];
    const buckets = {
      legacyExpected: 0,
      beforeFirstSnapshot: 0,
      anomaly: 0,
      unknownCompletion: 0,
    };
    const cutoffOnly = {
      legacyExpected: 0,
      beforeFirstSnapshot: 0,
      anomaly: 0,
      unknownCompletion: 0,
    };
    for (const done of doneValues) {
      buckets[classifyCompletionBucketV2(done, CUTOFF, OBSERVED)] += 1;
      cutoffOnly[classifyCompletionBucket(done, CUTOFF)] += 1;
    }
    const total =
      buckets.legacyExpected +
      buckets.beforeFirstSnapshot +
      buckets.anomaly +
      buckets.unknownCompletion;
    assert.equal(total, doneValues.length);
    // Carve only MOVES items: anomaly_new + beforeFirstSnapshot === anomaly_cutoffOnly.
    assert.equal(buckets.anomaly + buckets.beforeFirstSnapshot, cutoffOnly.anomaly);
    assert.equal(buckets.legacyExpected, cutoffOnly.legacyExpected);
    assert.equal(buckets.unknownCompletion, cutoffOnly.unknownCompletion);
  });
});

describe("M2 — completedWithoutSnapshotStatusV3 (E1–E7)", () => {
  const cutoffOnly = (anomalyItems: number, unknownItems: number) =>
    completedWithoutSnapshotStatus({
      anomalyItems,
      unknownItems,
      cutoffResolved: true,
    });

  it("E1 — full carve: cutoff-only CRITICAL becomes UNKNOWN → overall WARN", () => {
    const status = completedWithoutSnapshotStatusV3({
      anomalyItems: 0,
      beforeFirstSnapshotItems: 2,
      unknownItems: 0,
      cutoffResolved: true,
    });
    assert.equal(status, "UNKNOWN");
    assert.equal(cutoffOnly(2, 0), "CRITICAL");
    assert.equal(deriveOverallStatus([status, "OK", "OK"]), "WARN");
  });

  it("E2 — a partial carve keeps CRITICAL (severity never lowered)", () => {
    assert.equal(
      completedWithoutSnapshotStatusV3({
        anomalyItems: 2,
        beforeFirstSnapshotItems: 1,
        unknownItems: 0,
        cutoffResolved: true,
      }),
      "CRITICAL"
    );
  });

  it("E3 — verified EMPTY population keeps CRITICAL (no carve)", () => {
    const beforeFirstSnapshotItems = markerAllowsCarve(EMPTY) ? 1 : 0;
    assert.equal(
      completedWithoutSnapshotStatusV3({
        anomalyItems: 2,
        beforeFirstSnapshotItems,
        unknownItems: 0,
        cutoffResolved: true,
      }),
      "CRITICAL"
    );
    assert.equal(beforeFirstSnapshotItems, 0);
  });

  it("E4 — FAILED marker read keeps CRITICAL (identical to cutoff-only)", () => {
    const beforeFirstSnapshotItems = markerAllowsCarve(UNVERIFIED) ? 1 : 0;
    assert.equal(
      completedWithoutSnapshotStatusV3({
        anomalyItems: 2,
        beforeFirstSnapshotItems,
        unknownItems: 0,
        cutoffResolved: true,
      }),
      cutoffOnly(2, 0)
    );
    assert.equal(cutoffOnly(2, 0), "CRITICAL");
  });

  it("E5 — unresolved cutoff is UNKNOWN and overall WARN", () => {
    const status = completedWithoutSnapshotStatusV3({
      anomalyItems: 0,
      beforeFirstSnapshotItems: 0,
      unknownItems: 2,
      cutoffResolved: false,
    });
    assert.equal(status, "UNKNOWN");
    assert.equal(deriveOverallStatus([status, "OK", "OK"]), "WARN");
  });

  it("E6 — a marker older than the cutoff never carves: CRITICAL stays", () => {
    const stale = {
      source: "SNAPSHOT_MIN_OBSERVED",
      population: 1,
      firstObservedSnapshotAt: new Date("2026-09-01T00:00:00.000Z"),
    } as const;
    const beforeFirstSnapshotItems =
      classifyCompletionBucketV2(CUTOFF, CUTOFF, stale) === "beforeFirstSnapshot" ? 1 : 0;
    assert.equal(beforeFirstSnapshotItems, 0);
    assert.equal(
      completedWithoutSnapshotStatusV3({
        anomalyItems: 1,
        beforeFirstSnapshotItems,
        unknownItems: 0,
        cutoffResolved: true,
      }),
      "CRITICAL"
    );
  });

  it("E7 — only unclassified items with a proven cutoff stays WARN", () => {
    assert.equal(
      completedWithoutSnapshotStatusV3({
        anomalyItems: 0,
        beforeFirstSnapshotItems: 0,
        unknownItems: 3,
        cutoffResolved: true,
      }),
      "WARN"
    );
  });

  it("beforeFirstSnapshot alone is NEVER OK", () => {
    const status = completedWithoutSnapshotStatusV3({
      anomalyItems: 0,
      beforeFirstSnapshotItems: 1,
      unknownItems: 0,
      cutoffResolved: true,
    });
    assert.notEqual(status, "OK");
    assert.equal(status, "UNKNOWN");
  });

  it("only the legacy bucket is OK", () => {
    assert.equal(
      completedWithoutSnapshotStatusV3({
        anomalyItems: 0,
        beforeFirstSnapshotItems: 0,
        unknownItems: 0,
        cutoffResolved: true,
      }),
      "OK"
    );
  });
});

describe("M2 — evidence is never an input to severity", () => {
  it("every marker variant yields the same status as cutoff-only when not observed", () => {
    const variants = [EMPTY, UNVERIFIED, OBSERVED_NULL_VALUE];
    for (const marker of variants) {
      const beforeFirstSnapshotItems = markerAllowsCarve(marker) ? 7 : 0;
      const v3 = completedWithoutSnapshotStatusV3({
        anomalyItems: 4,
        beforeFirstSnapshotItems,
        unknownItems: 0,
        cutoffResolved: true,
      });
      // Evidence metadata may differ, the severity may not.
      assert.equal(v3, cutoffOnlyStatus(4, 0));
      assert.equal(v3, "CRITICAL");
      // ...and the disclosure/level metadata is produced but unused by severity.
      assert.notEqual(evidenceLevelFor(marker), "SNAPSHOT_OBSERVED");
    }
  });

  it("evidenceLevelFor reports SNAPSHOT_OBSERVED only for an observed marker", () => {
    assert.equal(evidenceLevelFor(OBSERVED), "SNAPSHOT_OBSERVED");
    assert.equal(evidenceLevelFor(EMPTY), "MIGRATION_ONLY");
    assert.equal(evidenceLevelFor(UNVERIFIED), "MIGRATION_ONLY");
  });

  it("disclosure separates verified-empty from unverified, and never claims health", () => {
    const empty = buildSnapshotDisclosure(EMPTY);
    const unverified = buildSnapshotDisclosure(UNVERIFIED);
    assert.equal(empty?.code, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(unverified?.code, "SNAPSHOT_MARKER_UNVERIFIED");
    assert.equal(buildSnapshotDisclosure(OBSERVED), null);
    for (const text of [empty?.text ?? "", unverified?.text ?? ""]) {
      assert.ok(text.length > 0);
      assert.ok(!/sehat|aman|tidak aktif/i.test(text));
    }
  });

  it("no exported symbol uses a forbidden activation-time name", () => {
    const forbidden = /engineLiveSince|ENGINE_LIVE|activationWindow/;
    for (const name of Object.keys(integrityRules)) {
      assert.ok(!forbidden.test(name), `forbidden export name: ${name}`);
    }
  });
});

// ============================================================
// M2 — SQL partition contract regression (FINAL REVIEW fix)
//
// The C2 bucket counts are produced by SQL in `integrity.service.ts`, not by
// the pure classifier. A DB-free test cannot execute that SQL (the service
// module instantiates the Prisma client at import time, and the query needs
// rows — creating fixtures would be a write, which is out of scope). What is
// testable here is the DECISION the SQL depends on: the carve window is now a
// single exported definition (`carveWindow`) that the service binds into its
// predicates. `sqlBuckets` below mirrors those predicates 1:1 using that same
// production function, so a regression in the carve decision fails here.
// ============================================================

/**
 * Mirrors the C2 predicates in `integrity.service.ts` (counts + anomaly sample)
 * FAITHFULLY: each bucket is an INDEPENDENT predicate over the same population,
 * exactly like the separate `SUM(CASE WHEN ...)` columns in the SQL — there is
 * NO else-if short circuit, so a bucket overlap really shows up as
 * `legacy + before + anomaly + unknown > totalItems`.
 */
function sqlBuckets(
  dones: Array<Date | null>,
  cutoff: Date | null,
  marker: IntegrityMarkerObservation
) {
  const carve = carveWindow(cutoff, marker);
  const has = (d: Date | null): d is Date => d !== null && cutoff !== null;
  const at = (d: Date): number => d.getTime();
  const cutoffMs = cutoff ? cutoff.getTime() : 0;
  const lower = carve ? at(carve) : cutoffMs;

  // Else-branch of the service: no proven cutoff -> everything unclassified.
  if (!cutoff) {
    return {
      legacy: 0,
      before: 0,
      anomaly: 0,
      unknown: dones.length,
      anomalyDones: [] as Date[],
      carve,
    };
  }

  const legacy = dones.filter((d) => has(d) && at(d) < cutoffMs).length;
  const before = carve
    ? dones.filter((d) => has(d) && at(d) >= cutoffMs && at(d) < at(carve)).length
    : 0;
  const anomalyDones = dones.filter((d) => has(d) && at(d) >= lower) as Date[];
  const unknown = dones.filter((d) => d === null).length;

  return { legacy, before, anomaly: anomalyDones.length, unknown, anomalyDones, carve };
}

const STALE_MARKER = {
  source: "SNAPSHOT_MIN_OBSERVED",
  population: 1,
  firstObservedSnapshotAt: new Date("2026-09-01T00:00:00.000Z"),
} as const;

// Population covering every interval, including `[marker, cutoff)`:
//   before marker · exactly marker · inside [marker, cutoff) · exactly cutoff ·
//   inside [cutoff, marker) · exactly marker · after marker · no completion row
describe("M2 — carveWindow: the single definition of the carve gate", () => {
  it("allows the carve ONLY for an observed marker strictly newer than the cutoff", () => {
    assert.equal(carveWindow(CUTOFF, OBSERVED)?.toISOString(), MARKER.toISOString());
    assert.equal(carveWindow(null, OBSERVED), null);
    assert.equal(carveWindow(CUTOFF, EMPTY), null);
    assert.equal(carveWindow(CUTOFF, UNVERIFIED), null);
    assert.equal(carveWindow(CUTOFF, OBSERVED_NULL_VALUE), null);
  });

  it("disables the carve when the marker is AT or BEFORE the cutoff", () => {
    const atCutoff = {
      source: "SNAPSHOT_MIN_OBSERVED",
      population: 1,
      firstObservedSnapshotAt: new Date(CUTOFF.getTime()),
    } as const;
    assert.equal(carveWindow(CUTOFF, atCutoff), null);
    assert.equal(carveWindow(CUTOFF, STALE_MARKER), null);
  });

  it("a marker one millisecond after the cutoff still carves", () => {
    const justAfter = {
      source: "SNAPSHOT_MIN_OBSERVED",
      population: 1,
      firstObservedSnapshotAt: new Date(CUTOFF.getTime() + 1),
    } as const;
    assert.equal(carveWindow(CUTOFF, justAfter)?.getTime(), CUTOFF.getTime() + 1);
  });
});

describe("M2 — SQL bucket partition (regression for the stale-marker overlap)", () => {
  const population = [
    new Date("2026-09-01T00:00:00.000Z"),
    new Date("2026-09-11T00:00:00.000Z"),
    new Date("2026-09-11T12:00:00.000Z"), // inside [staleMarker, cutoff)
    new Date(CUTOFF.getTime()),
    new Date("2026-09-15T00:00:00.000Z"),
    MARKER,
    new Date("2026-10-01T00:00:00.000Z"),
    null,
  ];

  it("stale marker → cutoff-only: no overlap and buckets sum to the total", () => {
    const b = sqlBuckets(population, CUTOFF, STALE_MARKER);
    assert.equal(b.carve, null);
    assert.equal(b.before, 0);
    assert.equal(b.legacy + b.before + b.anomaly + b.unknown, population.length);
    // The `[marker, cutoff)` interval is legacy here — never counted twice.
    assert.equal(b.legacy, 3); // 09-01, 09-11T00:00, 09-11T12:00
    assert.equal(b.anomaly, 4); // cutoff itself, 09-15, MARKER, 10-01
    assert.equal(b.unknown, 1);
    // Explicit non-overlap: no completion time may sit in two buckets.
    for (const done of population) {
      if (!done) continue;
      const inLegacy = done.getTime() < CUTOFF.getTime();
      const inAnomaly = done.getTime() >= CUTOFF.getTime();
      assert.notEqual(inLegacy, inAnomaly);
      assert.ok(!(inLegacy && b.anomalyDones.some((d) => d.getTime() === done.getTime())));
    }
  });

  it("stale marker buckets equal the marker-free (cutoff-only) buckets", () => {
    const stale = sqlBuckets(population, CUTOFF, STALE_MARKER);
    const noMarker = sqlBuckets(population, CUTOFF, UNVERIFIED);
    assert.deepEqual(
      [stale.legacy, stale.before, stale.anomaly, stale.unknown],
      [noMarker.legacy, noMarker.before, noMarker.anomaly, noMarker.unknown]
    );
  });

  it("a marker newer than the cutoff still carves, and the partition holds", () => {
    const b = sqlBuckets(population, CUTOFF, OBSERVED);
    assert.equal(b.carve?.toISOString(), MARKER.toISOString());
    assert.equal(b.legacy, 3); // 09-01, 09-11T00:00, 09-11T12:00 (< cutoff)
    assert.equal(b.before, 2); // cutoff itself and 09-15
    assert.equal(b.anomaly, 2); // MARKER and 10-01
    assert.equal(b.unknown, 1);
    assert.equal(b.legacy + b.before + b.anomaly + b.unknown, population.length);
  });

  it("marker boundaries: cutoff itself carves, the marker itself is an anomaly", () => {
    const b = sqlBuckets(
      [new Date(CUTOFF.getTime()), new Date(MARKER.getTime() - 1), MARKER],
      CUTOFF,
      OBSERVED
    );
    assert.equal(b.before, 2);
    assert.equal(b.anomaly, 1);
    assert.equal(b.anomalyDones[0].getTime(), MARKER.getTime());
  });

  it("EMPTY / UNVERIFIED markers never carve and never lower severity", () => {
    for (const marker of [EMPTY, UNVERIFIED, OBSERVED_NULL_VALUE]) {
      const b = sqlBuckets(population, CUTOFF, marker);
      assert.equal(b.carve, null);
      assert.equal(b.before, 0);
      assert.equal(b.legacy + b.anomaly + b.unknown, population.length);
      assert.equal(b.anomaly, 4);
      assert.equal(
        completedWithoutSnapshotStatusV3({
          anomalyItems: b.anomaly,
          beforeFirstSnapshotItems: b.before,
          unknownItems: b.unknown,
          cutoffResolved: true,
        }),
        cutoffOnlyStatus(4, 1)
      );
      assert.equal(cutoffOnlyStatus(4, 1), "CRITICAL");
    }
  });

  it("unresolved cutoff classifies everything as unknown (both SQL branches)", () => {
    const b = sqlBuckets(population, null, OBSERVED);
    assert.equal(b.unknown, population.length);
    assert.equal(b.legacy + b.before + b.anomaly, 0);
  });

  it("anomaly SAMPLE (same predicate as the anomaly count) excludes legacy items", () => {
    for (const marker of [STALE_MARKER, OBSERVED, EMPTY, UNVERIFIED]) {
      const b = sqlBuckets(population, CUTOFF, marker);
      assert.equal(b.anomalyDones.length, b.anomaly);
      for (const done of b.anomalyDones) {
        assert.ok(done.getTime() >= CUTOFF.getTime(), "sampled order is pre-cutoff (legacy)");
        // ...and the item is genuinely classified as an anomaly, not legacy.
        assert.equal(classifyCompletionBucketV2(done, CUTOFF, marker), "anomaly");
      }
    }
  });

  it("statusCutoffOnly is marker-independent in every marker state", () => {
    const reference = completedWithoutSnapshotStatus({
      anomalyItems: 4,
      unknownItems: 1,
      cutoffResolved: true,
    });
    assert.equal(reference, "CRITICAL");
    // The service computes it as `anomaly + beforeFirstSnapshot` (both are
    // cutoff-only anomalies). It must equal the marker-free reference no matter
    // which marker state produced the counts — the COUNT is asserted too, not
    // just the status string (two different counts can share a status).
    for (const marker of [STALE_MARKER, OBSERVED, EMPTY, UNVERIFIED, OBSERVED_NULL_VALUE]) {
      const b = sqlBuckets(population, CUTOFF, marker);
      assert.equal(
        b.anomaly + b.before,
        4,
        `marker ${marker.source} changed the cutoff-only anomaly count`
      );
      const statusCutoffOnly = completedWithoutSnapshotStatus({
        anomalyItems: b.anomaly + b.before,
        unknownItems: b.unknown,
        cutoffResolved: true,
      });
      assert.equal(statusCutoffOnly, reference, `marker state changed statusCutoffOnly`);
    }
  });

  it("the marker-aware status only drops to UNKNOWN when the carve is real", () => {
    const carved = sqlBuckets(population, CUTOFF, OBSERVED);
    const stale = sqlBuckets(population, CUTOFF, STALE_MARKER);
    // OBSERVED still has anomalies here -> CRITICAL, never silently OK.
    assert.equal(
      completedWithoutSnapshotStatusV3({
        anomalyItems: carved.anomaly,
        beforeFirstSnapshotItems: carved.before,
        unknownItems: carved.unknown,
        cutoffResolved: true,
      }),
      "CRITICAL"
    );
    assert.equal(
      completedWithoutSnapshotStatusV3({
        anomalyItems: stale.anomaly,
        beforeFirstSnapshotItems: stale.before,
        unknownItems: stale.unknown,
        cutoffResolved: true,
      }),
      "CRITICAL"
    );
  });
});
