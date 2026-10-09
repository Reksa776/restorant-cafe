# PHASE 9B-F6 — SCOPE CONFIRMATION & AUDIT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Type:** AUDIT ONLY — no source/schema/migration/seed/data change; no commit/push/deploy; no VPS/production.
**Date:** 2026-10-09
**Sources:** `PHASE9B-F2-F8-AUDIT.md` (F6 definition), `PHASE9B-F2-FIX-REPORT.md`,
`PHASE9B-F4-REVENUE-CONSOLIDATION-REPORT.md`, `PHASE9B-F5-CUSTOMER-REVENUE-ALIGNMENT-REPORT.md`,
`PHASE9B-F3-FIX-REPORT.md`, and current code/schema.

---

## 1. Original F6 finding and acceptance criteria (verbatim scope)

From `PHASE9B-F2-F8-AUDIT.md` §F6:

- **Title:** No-show has no dedicated timestamp.
- **Severity:** INFO (data-model limitation).
- **Status (audit):** CONFIRMED (schema fact).
- **Root cause:** the reservation funnel derives stages from the current `status` column plus
  `confirmedAt/seatedAt/completedAt`, but there is **no `noShowAt`** column (and no `ReservationStatusHistory`),
  so NO_SHOW can only be counted as a current-status snapshot, with `updatedAt` as the only (implicit) time
  signal.
- **Exact file / query:**
  - `prisma/schema.prisma` → `model Reservation`: has `confirmedAt, seatedAt, completedAt, cancelledAt` but
    **no `noShowAt`**.
  - `src/services/report/report.service.ts` → `getReservationReport` funnel SQL:
    `SUM(r.status = 'NO_SHOW') AS noShow` (status-based, not time-ordered).
- **Evidence (audit):** schema confirms absence; funnel output `noShow: 0` for the single CONFIRMED reservation.
- **Impact:** cannot do time-ordered no-show/drop-off analysis. Counts/rates (current status) are correct and
  sufficient for the implemented static funnel.
- **Rekomendasi minimal (verbatim):** “None for the current static funnel; document the limitation. Only if
  time-ordered no-show analytics is required: add an **additive** `noShowAt DateTime?` (or a history table,
  larger change). Not recommended now.”
- **Tenant:** N/A. **Branch:** N/A. **Migration:** None now; additive column/history table only if the analytics
  are ever required. **Regression risk:** LOW.

**Acceptance criteria (as the audit framed it):** for the current static funnel, **document the limitation** and
make **no code/schema change**. A `noShowAt` column (or history table) is required **only if** the business asks
for time-ordered no-show/drop-off analytics.

---

## 2. Current implementation evidence

**Schema — `prisma/schema.prisma` → `model Reservation` (line 661):** fields include
`confirmedAt, seatedAt, completedAt, cancelledAt, cancelReason, createdAt, updatedAt`; **no `noShowAt`**.
`grep -rn "noShowAt\|no_show_at" prisma/ src/` → **NONE FOUND**.

**Read-only DB evidence (this audit; `SELECT`-only script, deleted):**
- `information_schema.COLUMNS` for `reservation` → 23 columns, **no `noShowAt`** (`has noShowAt column: false`);
  timestamps present: `confirmedAt, seatedAt, completedAt, cancelledAt, createdAt, updatedAt`.
- History tables in the schema/DB: only `orderstatushistory` — **no `ReservationStatusHistory`**.
- Reservations by status: `{CONFIRMED: 1}`; no-show aggregate: `noShow = 0` of 1.

**Funnel / no-show computation — `src/services/report/report.service.ts`:**
- `getReservationReport` funnel SQL → `SUM(r.\`status\` = 'NO_SHOW') AS noShow` (line 3140) — a **current-status
  snapshot**, no timestamp ordering.
- by-date SQL → `SUM(r.\`status\` = 'NO_SHOW') AS noShow` (line 3169).
- summary → `const noShow = statusCount("NO_SHOW")` (line 3231), `noShowRate` (3259), `funnel.noShow`
  (3281), `byDate[].noShow` (3321).
- Customer report → per-customer `reservations.noShow` from `SUM(r.\`status\` = 'NO_SHOW')` (line 2870, used at 2978).

**Affected files / functions / consumers:**
- `src/services/report/report.service.ts`: `getReservationReport` (funnel, byDate, summary) and
  `getCustomerReport` (per-customer reservation breakdown).
- API: `GET /api/reports/reservations` (`ReservationReport.funnel.noShow`, `summary.noShow/noShowRate`,
  `byDate[].noShow`) and `GET /api/reports/customers` (`reservations.noShow`).
- UI: `src/app/admin/reports/reservations/page.tsx` — funnel stage “Tidak Hadir” (line 328–330), summary card
  “Tidak Hadir” with `noShowRate` (line 162), and the by-date “Tidak Hadir” column (440/454); status label
  `NO_SHOW: "Tidak Hadir"` (line 60).
- Finance side: none — `noShow` is a **count**, not revenue; it is not on the revenue set and does not touch
  `computeRefundRevenue`/`computeCustomerRevenue`.

**Relevant tenant/branch/date rules:** the funnel/date queries are scoped by `restaurantId`, the reservation
`branchSql` (`r.branchId IN branchFilters`), and `reservationDate ∈ range`; the no-show term is a pure
status snapshot within that scope. No tenant/branch/date semantics are affected by F6.

---

## 3. Status: **OUTSTANDING** (confirmed data-model limitation; intentionally deferred)

- **Not fixed / not partial:** there is still **no `noShowAt`** column and no reservation status-history table;
  the funnel still counts `status = 'NO_SHOW'` as a snapshot.
- **Not obsolete after F2/F3/F4/F5:**
  - **F2** touched only `getReservationsForExport` (revenue) — no no-show/funnel change.
  - **F3** touched only `getCustomerReport`’s `activityOrNew` (customer identity list) — no no-show change.
  - **F4** refactored the funnel query, but **only** its `paid` predicate (now `revenueSetSql("o")`); the
    `SUM(r.status = 'NO_SHOW')` terms at lines 3140/3169/2870 are **unchanged**.
  - **F5** changed `computeCustomerRevenue`’s refund half — no relation to no-show counts.
- **Design-intent:** the original audit explicitly recommended **no change now** and only an additive
  `noShowAt`/history if the business ever needs time-ordered no-show analytics. So F6 is correctly deferred,
  not regressed.

Status label: **OUTSTANDING** as a capability gap, with the audit’s acceptance criteria (“document; no change”)
**satisfied** by `PHASE9B-F2-F8-AUDIT.md` and this report.

---

## 4. Minimal implementation plan (only if time-ordered no-show analytics is required)

No change is recommended for the current static funnel. If the business asks for time-ordered no-show/drop-off:

- **Option A (smallest, additive):** add `noShowAt DateTime?` to `model Reservation`; set it in the reservation
  write path on the transition to `NO_SHOW`; then the funnel/by-date can attribute no-shows by timestamp.
  - Files: `prisma/schema.prisma` (+ one additive migration), the reservation service write path
    (`src/services/reservation/*`), and `getReservationReport` funnel/by-date SQL.
  - Requires a **schema + migration** change → **out of scope now**.
- **Option B (no schema):** approximate the timestamp from `updatedAt` when `status = 'NO_SHOW'` (imprecise;
  only meaningful for the latest transition). Not recommended.
- **Option C (recommended now):** **no code** — document the limitation in the UI/report wording (e.g. a hint
  that “Tidak Hadir” is a current-status snapshot) if in-product clarity is wanted.

---

## 5. Tenant, branch, date, finance, and regression risks

- **Tenant:** none — the funnel is `restaurantId`-scoped; F6 changes nothing here.
- **Branch:** none — funnel/by-date are reservation-branch-scoped (`r.branchId IN branchFilters`); no-show is a
  status snapshot within scope.
- **Date:** the funnel date scope is `Reservation.reservationDate ∈ range`; because there is no `noShowAt`, the
  no-show count **cannot** be attributed to the date the no-show actually occurred (only to the reserved date /
  current status). This is the limitation itself.
- **Finance:** none — count only, not on the revenue set; no revenue/refund formula involved.
- **Regression risk:** **LOW** for doing nothing / documenting (Option C). Option A is LOW risk **if** additive
  and migration-reviewed, but it is a schema/write-path change and must be a separately-approved phase.

---

## 6. PASS / WARN / BLOCKER verdict

| Item | Verdict | Rationale |
|---|---|---|
| F6 current status | **WARN** (OUTSTANDING, deferred) | Confirmed data-model limitation: no `noShowAt` (schema + DB verified) and no reservation history table. Counts/rates are correct but not time-ordered. The original acceptance criterion (document, no change) is met; no correctness or finance impact. |
| Redundancy after F2/F3/F4/F5 | **PASS (none)** | F4 touched only the funnel’s `paid` predicate; the no-show terms are unchanged. F2/F3/F5 are orthogonal. F6 is neither fixed nor made obsolete. |
| Tenant/branch/date/finance safety | **PASS** | Restaurant/branch/date scoping unchanged; count-only, no revenue semantics involved. |

**Overall:** No BLOCKER. F6 remains **OUTSTANDING** as an acknowledged, intentionally deferred data-model
limitation; the smallest safe next step is **no code** (documentation only), unless the business explicitly
requests time-ordered no-show analytics, in which case add an **additive** `noShowAt DateTime?` in a separate,
approved phase.

---

## Integrity statement

- No `src/` file, schema, migration, seed, or data was modified. The read-only probe was `SELECT`-only and
  deleted (`ls _p9b*.ts` → none).
- All existing uncommitted work (F1, PHASE 9B, F2, F3, F4, F5) is preserved.
- `git diff -- prisma/` empty; HEAD = `d7f29ac`; no commit/push/deploy.
