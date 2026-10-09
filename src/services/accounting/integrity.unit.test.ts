import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_CUTOFF_MIGRATION,
  buildCutoffEvidence,
  classifyCompletionBucket,
  completedWithoutSnapshotStatus,
  deriveOverallStatus,
  deriveReconciliation,
  partitionViolations,
  reconciliationStatus,
  revenueWithoutItemsStatus,
  selectSampleOrderIds,
  violationScope,
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
//   * query params are coerced/validated and bounded.
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
});
