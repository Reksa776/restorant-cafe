# PHASE 9B-F3 — SCOPE CONFIRMATION & AUDIT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Type:** AUDIT ONLY — no source/schema/migration/seed/data change; no commit/push/deploy; no VPS/production.
**Date:** 2026-10-09
**Sources:** `PHASE9B-F2-F8-AUDIT.md` (F3 definition), `PHASE9B-F2-FIX-REPORT.md`,
`PHASE9B-F4-REVENUE-CONSOLIDATION-REPORT.md`, `PHASE9B-POST-F4-SEMANTIC-REVIEW.md`,
`PHASE9B-F5-CUSTOMER-REVENUE-ALIGNMENT-REPORT.md`, and current code.

---

## 1. Original F3 finding and acceptance criteria (verbatim scope)

From `PHASE9B-F2-F8-AUDIT.md` §F3:

- **Title:** Customer report includes period-created customers regardless of branch.
- **Severity:** LOW (branch-scope widening of the customer **identity** list; no cross-branch financial data).
- **Status (audit):** CONFIRMED — reproduced on current data. Remediation semantics are a **policy decision**.
- **Root cause:** `getCustomerReport` selects customers whose `activityOrNew` OR-clause includes
  “created in period” **without** the `branchWhere`, so a branch-scoped caller receives rows for customers
  created in the period even when they have no activity in the caller’s branch. Per-customer activity/revenue
  metrics are branch-scoped, so those rows show zero activity.
- **Exact file / function:** `src/services/report/report.service.ts` → `getCustomerReport`;
  `activityOrNew`:
  ```ts
  OR: [
    { createdAt: { gte: range.start, lte: range.end } },              // <- NOT branch-scoped
    { orders: { some: { status: { not: "CANCELLED" }, createdAt: {...}, ...branchWhere } } },
  ]
  ```
- **Branch-scoped metrics** (contrast): `activityRows` (`orderBranchSql`), `reservationRows` (`resvBranchSql`),
  and `computeCustomerRevenue({ branchFilters })`.
- **Evidence (audit):** `[MAIN]` → totalCustomers 35, zero-activity rows 20, newCustomers 35;
  `[PERUM-1]` → 35 / 23 / 35. The operational list (`customerService.getCustomers`) requires
  `orders.some.branchId in branchFilters`, so it would **not** return those zero-activity rows → the report is
  wider than the operational list for the same branch.
- **Impact:** a branch-scoped admin sees the name/phone/email of customers created in the period who never
  transacted in their branch (20/23 of 35), and `newCustomers=35` regardless of branch. **No cross-branch
  revenue or order count is exposed** (those stay branch-scoped). Identity/PII exposure + semantic mismatch,
  not a financial leak.
- **Rekomendasi minimal:** when `branchFilters` is set, require in-scope activity for the identity list too
  (drop the un-scoped `createdAt` branch, or AND it with `orders.some(branchWhere)`), **or** explicitly label
  the summary “customers created in period (restaurant-wide)” vs “active in branch”.
- **Tenant:** none (`restaurantId` scoped). **Branch:** the finding itself. **Migration:** none.
  **Regression risk:** LOW–MEDIUM (changes `totalCustomers`/`newCustomers` for branch-scoped callers only).

**Acceptance criteria (derived, as the audit left it as a policy choice):** for a branch-scoped caller, the
customer **identity list** (and its `totalCustomers`/`newCustomers` counts) must not include period-created
customers with **no in-scope activity** — either by widening the query scope, or by relabelling so the
restaurant-wide meaning is explicit.

---

## 2. Current implementation evidence (file / function references)

**File:** `src/services/report/report.service.ts` → `getCustomerReport` (line 2707).

- `branchFilters` (2718), `orderBranchSql` (2721), `resvBranchSql` (2724), `branchWhere` (2727).
- **`activityOrNew` (2735–2748) — still UNCHANGED:**
  ```ts
  const activityOrNew: Prisma.CustomerWhereInput = {
    OR: [
      { createdAt: { gte: range.start, lte: range.end } },   // <- still NOT branch-scoped
      { orders: { some: { status: { not: "CANCELLED" }, createdAt: {...}, ...branchWhere } } },
    ],
  };
  ```
- Customer select (2759–2771): allow-list `{id,name,phone,email,isActive,createdAt}`, `take: CUSTOMER_REPORT_MAX_ROWS` (5000).
- Branch-scoped metrics remain: `activityRows` (`orderBranchSql`), `reservationRows` (`resvBranchSql`),
  `computeCustomerRevenue({ branchFilters })`; `summary.totalCustomers = rows.length`,
  `summary.newCustomers = rows.filter(isNewCustomer).length`.

**Consumers:** `GET /api/reports/customers` (`src/app/api/reports/customers/route.ts` — `branchFilters =
branchIdParam ? [branchIdParam] : authorizedBranches(ctx)`); `.../export`; client wrapper
`reportService.getCustomerReport` (`src/services/report.service.ts`); UI
`src/app/admin/reports/customers/page.tsx` (cards “Total Pelanggan”, “Pelanggan Baru”, “Aktif”, “Tidak Aktif”;
row badge “Baru”).

**Read-only re-verification (this audit; `SELECT`-only script, deleted):** wide period 2000-01-01…2100-01-01:

| Call | totalCustomers | newCustomers | rows with `activityOrders === 0` | activeCustomers |
|---|---|---|---|---|
| `[MAIN]` | 35 | 35 | **20** | 15 |
| `[PERUM-1]` | 35 | 35 | **23** | 12 |
| `[MAIN, PERUM-1]` | 35 | 35 | 8 | 27 |
| no filter | 35 | 35 | 7 | 28 |

This reproduces the audit’s exact `[MAIN]` 35/20/35 and `[PERUM-1]` 35/23/35.

---

## 3. Status: **OUTSTANDING** (not fixed, not partial, not obsolete)

- **Not fixed / not partial:** the un-scoped `{ createdAt }` branch is present verbatim at line 2737; no
  branch predicate has been added to the identity list. The finding reproduces identically.
- **Not obsolete after F2/F4/F5:**
  - **F2** (`getReservationsForExport`) touches only the reservation CSV revenue path — no effect on
    `getCustomerReport`’s customer selection.
  - **F4** refactored the shared **revenue SQL fragments** (`computeRefundRevenue` / `computeCustomerRevenue`
    product halves, activity `CASE` predicates, funnel, export) — the identity list is a **Prisma
    `findMany`+`activityOrNew`**, not one of the refactored SQL sites; line 2737 is unchanged.
  - **F5** narrowed `computeCustomerRevenue`’s **refund** predicate — it changes per-customer **money**, not
    which customers are **selected**; `newCustomers`/`totalCustomers` are driven solely by `activityOrNew`.
  - No other PHASE 9B change touched `activityOrNew` (grep: the comment “<- NOT branch-scoped” behaviour is
    still in force).

Verdict on status: **OUTSTANDING**, exactly as the original audit left it, and still gated on a **policy
decision** (behavior change vs relabel).

---

## 4. Minimal implementation plan (only if the policy decision is to fix)

All options are in `src/services/report/report.service.ts` → `getCustomerReport` around the `activityOrNew`
construction (2735–2748). No schema/model/migration.

- **Option A — require in-scope activity for the identity list (data-scoping).**
  When `branchFilters?.length` is set, drop the un-scoped `createdAt` OR-branch so a customer is listed only
  via `orders.some({ non-cancelled, createdAt in period, ...branchWhere })`.
  - Effect: `[MAIN]` totalCustomers/newCustomers reduce to the in-scope set (e.g. 15 active; `newCustomers`
    becomes “created in period **and** active in branch”).
  - Minimal diff: make `activityOrNew` conditional on `branchFilters?.length` (one branch).
- **Option A′ — keep period-created but require branch-relationship.**
  AND the `createdAt` branch with `orders.some({ ...branchWhere })` (any time, not period-bound): a period-created
  customer appears only if they have *any* order in the caller’s branch.
  - Effect: narrows the identity list while preserving “new customer” intent for branch customers.
- **Option B — relabel only (no query change).**
  Update `src/app/admin/reports/customers/page.tsx` cards to make the restaurant-wide meaning explicit
  (“Total Pelanggan (semua cabang)”, “Pelanggan Baru (semua cabang)”) and note metrics are branch-scoped.
  - Effect: no count changes; the PII-for-zero-activity rows remain visible (labelled).
- **Option C — expose both** (a branch-scoped identity list plus an explicit restaurant-wide “new customers”
  count) — larger; not minimal.

**Recommendation:** decide the product meaning of “new customers” first. If the report must mirror the
operational list’s branch scoping, use **Option A** (simplest, strongest privacy posture); if the report is
intended to highlight restaurant-wide new sign-ups, use **Option B** (zero behavioural risk). A′ is a middle
ground if “created in period with a branch relationship” is desired.

---

## 5. Regression & security risks

- **Tenant isolation:** safe and unchanged. `restaurantId` scopes both the customer query and all metric
  queries; no cross-tenant exposure.
- **Branch scope:** this is the finding. Options A/A′ narrow the identity list (fewer rows) for branch-scoped
  callers only; non-scoped callers (`authorizedBranches` returns `undefined`) are unaffected. Option B changes
  no data.
- **Date scope:** the `createdAt ∈ range` basis for “new” is unchanged by any option except A (which drops it
  when branch-scoped) / A′ (which retains it but ANDs a branch relationship).
- **Finance semantics:** none. F3 affects **which customers are listed**, not revenue/refund math
  (`computeCustomerRevenue` unchanged; F5 not revisited). No effect on Sales/Reservation/Finance reports.
- **PII / security:** the current behaviour exposes restaurant-wide new-customer name/phone/email to a
  branch-scoped admin (same tenant). Options A/A′ reduce that exposure (a security improvement); Option B only
  labels it (exposure unchanged).
- **Regression risk:** **LOW–MEDIUM** for A/A′ (changes `totalCustomers`/`newCustomers` for branch-scoped
  callers; UI tests/screenshots may need updating); **LOW** for B (copy only). Guard with the existing
  operational-list comparison and a wide-period check.
- **Performance:** negligible; A/A′ add a branch predicate inside an existing relation filter.

---

## 6. PASS / WARN / BLOCKER verdict

| Item | Verdict | Rationale |
|---|---|---|
| F3 current status | **WARN** (OUTSTANDING) | Reproduced identically (`[MAIN]` 35/20/35, `[PERUM-1]` 35/23/35). Not fixed by F2/F4/F5; still gated on a policy decision. No financial impact, no cross-tenant leak; it is an intra-tenant PII/identity-list widening + semantic mismatch. |
| Reimplementation of F2/F4/F5 | **PASS (not needed)** | F3 is orthogonal to the reservation export (F2), the revenue SQL refactor (F4), and the customer refund predicate (F5); none touched the identity list. |
| Tenant/branch/date/finance safety | **PASS** | Tenant-safe; branch scoping is the (intended-to-be-fixed) gap; no revenue/refund semantics involved. |

**Overall:** No BLOCKER. F3 is **OUTSTANDING**, exactly as originally scoped, with a clear minimal fix
(one conditional in `getCustomerReport`’s `activityOrNew`) or a zero-risk relabel — the choice is a product
decision, not a code defect requiring urgent action.

---

## Integrity statement

- No `src/` file, schema, migration, seed, or data was modified. The read-only probe was `SELECT`-only and
  deleted (`ls _p9b*.ts` → none).
- All existing uncommitted work (F1, PHASE 9B, F2, F4, F5) is preserved.
- `git diff -- prisma/` empty; HEAD = `d7f29ac`; no commit/push/deploy.
