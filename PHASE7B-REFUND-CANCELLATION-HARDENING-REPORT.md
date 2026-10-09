# PHASE 7B — Refund & Cancellation Hardening — Final Report

**Scope:** fix the two issues found by `PHASE7-REFUND-CANCELLATION-AUDIT.md` — the **P0**
payment-integrity hole (direct cancellation of PAID orders) and the **P1** approval-workflow
gap (refund/cancellation queues fetched but never rendered) — using **only existing engines**.
**No new engine, no migration, no schema/seed change, no historical-data repair.**
**No commit / push / deploy.**

**Source of truth reused:** `PHASE7-REFUND-CANCELLATION-AUDIT.md` (no re-audit).

---

## 1. Existing functionality reused

Nothing new was created. Every change wires into what already existed:

| Reused artifact | Location | Used for |
|---|---|---|
| `OrderService.updateOrderStatus` | `src/services/order/order.service.ts` | The P0 guard + direct-cancel audit hook |
| `ApprovalService.decideCancellation` net-collected guard | `src/services/approval/approval.service.ts:757-760` | The **same** semantic the P0 guard reuses |
| `COLLECTED_PAYMENT_STATUSES` (now `export const`) | `approval.service.ts:32` | One collected-money basis |
| `round2`, `MONEY_EPSILON` | `src/lib/money.ts` | One money/epsilon basis |
| `auditService.log` + `requestIpAddress()` (PHASE 6B IP plumbing) | `src/services/audit/audit.service.ts` | Direct-cancel audit event |
| `listPendingForRestaurant` | `approval.service.ts:1119` | Refund/cancellation queues |
| `GET /api/refunds`, `GET /api/cancellations` | existing routes | Queue data (unchanged) |
| `POST /api/refunds/[refundId]/decide`, `POST /api/cancellations/[requestId]/decide` | existing routes | Decisions (unchanged) |
| `shiftService.decideRefund` / `decideCancellation` | `src/services/shift.service.ts` | UI → existing decide endpoints |
| Admin password dialog + `verifyAdminPassword` | `src/app/admin/shifts/page.tsx`, `src/lib/auth-helpers.ts` | Password re-confirmation (unchanged) |

## 2. P0 root cause

`PATCH /api/orders/[id]/status` → `orderService.updateOrderStatus()` validated **only the status
transition**. It contained **no `paymentStatus` guard, no payment void, no refund and no audit
log**. The orders card exposes it as a red trash button (`order-card.tsx`, PENDING only). All
**7/7** `CANCELLED` orders in the DB were cancelled through this direct path and **0**
`CancellationRequest` rows existed. Live damage — left **untouched** as evidence:
`ORD-20260908-HCOK1L` (Rp90.000 QRIS `PAID`) is `status=CANCELLED, paymentStatus=PAID`, 0 refunds.

The approval engine (`decideCancellation`) already blocked a paid order correctly; the **direct
path bypassed that engine entirely** — that is the hole.

## 3. P0 implementation

In `src/services/order/order.service.ts`, inside `updateOrderStatus`'s existing
`prisma.$transaction` (right after the conditional `order.updateMany` count check):

```ts
if (input.status === "CANCELLED") {
  const netCollected = await computeNetCollected(tx, id);
  if (netCollected > MONEY_EPSILON) {
    throw new ConflictError(ORDER_STILL_HOLDS_MONEY_MESSAGE);
  }
}
```

`computeNetCollected` is the **shared helper extracted from `decideCancellation`** (see §5) — one
formula, not a second predicate:

```
netCollected = Σ Payment.amount (status ∈ {PAID, REFUNDED}) − Σ Refund.amount (status = APPROVED)
```

- Read **inside the transaction**, so a concurrently-approved refund is observed; the throw rolls
  back the status flip.
- Reads **only the database**, scoped to the order id — never a client `paymentStatus`, amount,
  refund or `restaurantId`.
- `MONEY_EPSILON = 0.005` (existing) is the inclusive boundary.
- Tenant/branch scoping is unchanged: the pre-read `order` is `findFirst({ id, restaurantId,
  branchId: branchFilters?.length ? { in } : undefined })`, so a foreign order/branch is a
  `NotFoundError` **before** the guard runs.
- The existing COMPLETED/approved-refund guard is untouched and still runs.

## 4. UI behavior

`src/components/admin/orders/order-card.tsx` — the direct-cancel button is now **disabled** when
`order.paymentStatus === "PAID"` (data already on the DTO, **no extra fetch, no client money
math**), with a tooltip carrying the server's exact message. The server remains authoritative:
a stale client or any other caller still gets HTTP **409** with
`"Order sudah dibayar — selesaikan refund terlebih dahulu sebelum membatalkan"`.

The Order-Detail `ApprovalActions` path (`approval-actions.tsx`) is **unchanged** — it already
routes through the approval engine, whose own net-collected guard is authoritative.

## 5. Approval queue implementation

`src/app/admin/shifts/page.tsx` already **fetched** `pendingRes.refunds` / `pendingRes.cancellations`
and then **discarded** them. Now:

- New state `pendingRefunds` / `pendingCancellations`, populated in `load()` from the same
  `shiftService.listPendingApprovals()` payload (`GET /api/refunds`).
- New read-only queue cards render order number, amount (refund), requester/cashier, reason,
  and requested-at; approve/reject buttons per item.
- The shared admin password dialog `approveTarget` was widened from `kind:"override"` to
  `kind: "override" | "refund" | "cancellation"` and carries an optional multi-line `details`
  summary shown in the dialog body.
- `handleDecide()` dispatches by kind to the **existing** wrappers
  `shiftService.decideRefund(id, approve, adminPassword, decisionNote?)` /
  `decideCancellation(...)` / `decideOverride(...)`. Payloads remain
  `{ password, approve, decisionNote? }`. **No business logic moved into React.**
- `RefundRequest` / `CancellationRequest` types reused from `src/services/shift.service.ts`.
- **No new page and no new endpoint** were created.

Branch is not shown because the existing `GET /api/refunds` / `GET /api/cancellations` payload
does not include a branch field for refund/cancellation rows (only `order` + `requester`); per the
brief, "branch **jika tersedia**" — adding it would mean touching the service/API, so it was
intentionally left out of scope. Item allocations likewise are not in the list payload ("jika
tersedia").

## 6. Refund approval behavior

Admin **approve** → existing `POST /api/refunds/[refundId]/decide` → `ApprovalService.decideRefund`:
guarded `PENDING → APPROVED` `updateMany` (exactly-once), COGS reversal from immutable snapshots,
payment/order financial-state update, `REFUND_APPROVED` audit. Admin **reject** →
`PENDING → REJECTED`, **no payment mutation**, `REFUND_DENIED` audit. Both keep the existing
`FOR UPDATE` per-order lock and over-refund guard. Verified live (T13–T16, H4).

## 7. Cancellation approval behavior

Admin **approve** → existing `POST /api/cancellations/[requestId]/decide` →
`ApprovalService.decideCancellation`: guarded `PENDING → APPROVED`, the net-collected guard
(`computeNetCollected`), guarded order `updateMany`, table freed, live `UNPAID`/`PENDING`
payments voided, `ORDER_CANCELLED` audit. Admin **reject** → `REJECTED`, order unchanged.
Verified live (T17–T20).

## 8. Direct cancellation audit

In `updateOrderStatus`, **after** the transaction commits and **only** when the target status is
`CANCELLED`, a single `auditService.log({ action: "ORDER_CANCELLED", entityType: "Order",
entityId: id, branchId: order.branchId, userId: changedBy ?? null, details: { orderNumber,
reason: input.notes ?? null, previousStatus, newStatus: "CANCELLED", source:
"DIRECT_STATUS_UPDATE" } })` is written. This reuses the **same action string** the approval engine
uses, so the audit viewer stays consistent; the approval engine never calls this method, so the
event is **never duplicated**. IP is derived by the existing PHASE 6B
`requestIpAddress()` plumbing. A rejected/failed cancellation throws before this point and writes
**no** audit row (verified T10 = exactly 1; T12 = 0).

## 9. QRIS / webhook race decision

**Decision: leave the webhook semantics untouched and document the race as a remaining P1 product
decision.** Per the brief ("If the existing webhook has a legitimate case where a cancelled order
must still be reconciled, do not guess … Jangan mengarang business policy"), this is the
conservative, sanctioned outcome.

Reasoning:

- The exact race is real: `payment.service.ts` (~1125-1130) mirrors a PAID webhook onto the order
  with CAS `order.updateMany({ where: { id, paymentStatus: current.status }, data: { paymentStatus:
  "PAID" } })`. With the new P0 guard, an order with only a **PENDING** QRIS intent can still be
  legitimately cancelled (PENDING is not collected), so a **late** PAID callback can still flip a
  `CANCELLED` order to `CANCELLED + PAID`.
- But the business resolution is genuinely undefined: money **really arrived**, and the existing
  architecture (`order.paymentStatus`) is exactly the order-level flag the brief wants
  protected. Suppressing only the order mirror leaves the **payment row PAID while the order says
  UNPAID** and offers no refund path (cancelled orders are terminal in `ApprovalActions`), so the
  collected money would be hidden rather than reconciled. That is a policy choice, not a bug fix.
- Therefore: **not implemented**; **test 28 = NOT RUN / REMAINING P1 DECISION.**

Recorded recommendation for a future phase (explicit one-line change, once the policy is decided):
add `status: { not: "CANCELLED" }` to the order-mirror `updateMany` in the PAID branch. It is
revenue-neutral (`revenueWhere` already requires `status != CANCELLED`) and preserves payment
history; it must be paired with a decided refund/reconciliation path for late-paid cancelled
orders.

## 10. Files changed

PHASE 7B modified **exactly four source files**:

| File | Change |
|---|---|
| `src/services/approval/approval.service.ts` | `COLLECTED_PAYMENT_STATUSES` → `export const`; new exported `computeNetCollected()` + docblock; new exported `ORDER_STILL_HOLDS_MONEY_MESSAGE`; `decideCancellation` now calls the shared helper (one formula) |
| `src/services/order/order.service.ts` | `+import` `auditService`, `MONEY_EPSILON`, `{computeNetCollected, ORDER_STILL_HOLDS_MONEY_MESSAGE}`; P0 guard inside `updateOrderStatus`'s transaction; `ORDER_CANCELLED` audit after commit |
| `src/components/admin/orders/order-card.tsx` | Disable the direct-cancel button when `order.paymentStatus === "PAID"` (+ tooltip) |
| `src/app/admin/shifts/page.tsx` | Render refund/cancellation queues; widen `approveTarget` kinds; `handleDecide` dispatch |

No other source file was touched. `git diff --stat` for the four:
`shifts/page.tsx +227 / order-card.tsx +14 / approval.service.ts +62 / order.service.ts +68`
(335 insertions, 36 deletions — the 36 are the replaced inline `netPaid` block and the old
`approveTarget`/`handleDecide` bodies).

## 11. Database impact

**Source-only change.** No DDL, no DML on historical data, no seed, no `prisma migrate`,
`db push`, reset, truncate or delete. Runtime fixtures (temporary orders/payments/refunds/
cancellations) were created and fully removed; all 8 tracked counts returned to baseline
(§20).

## 12. Migration impact

**None.** No migration file created, `prisma/schema.prisma` untouched. No schema change was
required — the guard is a read + comparison over existing columns.

## 13. Security impact

- Server is authoritative: the guard reads only DB values inside the transaction; client
  `paymentStatus`/amount/refund/`restaurantId` are never trusted.
- No new endpoint, RBAC, auth, or password path; `verifyAdminPassword` and `requireAdmin` are
  reused unchanged. No secret was exposed.
- Direct-cancel now emits an audit row (closing an audit blind spot) with the session `userId`
  and server-derived `restaurantId`/`branchId`.
- Residual (unchanged, documented): no rate limit on the decide-password endpoint (pre-existing
  P2).
- The webhook race remains open by decision (§9), not by oversight.

## 14. Tenant isolation

Unchanged and verified. The pre-read order lookup is `findFirst({ id, restaurantId, ... })`;
a foreign-tenant order id yields `NotFoundError` (404) before any mutation or audit
(**T7 PASS**). `computeNetCollected(tx, id)` reads by order id only, and the order id came from a
tenant-scoped lookup. `decideRefund`/`decideCancellation` with a foreign `restaurantId` yield 404
(**T22 PASS**).

## 15. Branch isolation

Unchanged and verified. A branch-scoped caller whose `branchFilters` exclude the order's branch
gets 404 before mutation (**T8 PASS**). `decideRefund` with a foreign `branchFilters` list → 404
(**T23 PASS**). `listPendingForRestaurant` still applies `branchId: { in: branchFilters }`.

## 16. Runtime test matrix

Local only. Server: `npx next start -p 3000` (Next 16.3.3). Real MySQL. Fixtures were temporary
and cleaned. Service layer via `tsx`; HTTP via a real NextAuth credentials login (admin & kasir)
against the running server.

| ID | Test | Result |
|---|---|---|
| T1 | UNPAID order → CANCELLED allowed | PASS (`status=CANCELLED`) |
| T2 | PAID CASH → CANCELLED rejected 409 + exact message | PASS |
| T2b | PAID CASH order unchanged | PASS |
| T2c | PAID CASH payment unchanged (`PAID`) | PASS |
| T3 | PAID QRIS → CANCELLED rejected | PASS |
| T4 | PARTIALLY refunded (net > 0) → rejected | PASS |
| T5 | FULLY refunded (net ≤ ε) → cancellation allowed | PASS |
| T6 | FAILED / EXPIRED payment → cancellation preserved | PASS |
| T7 | Tenant isolation (foreign restaurant) → 404 | PASS |
| T8 | Branch isolation (foreign branch filter) → 404 | PASS |
| T9 | Already-CANCELLED → rejected by transition map | PASS |
| T10 | Successful direct cancel → **exactly one** `ORDER_CANCELLED` | PASS (`audits=1`) |
| T11 | Rejected cancellation → order/payment unchanged | PASS |
| T12a/b | Rejected cancellations → **no** audit rows | PASS (`audits=0`) |
| T13 | CASHIER refund request appears in `pendingRes.refunds` | PASS |
| T14 | ADMIN list exposes refund queue | PASS |
| T15 | ADMIN approve refund → `APPROVED` | PASS |
| T15b | Refund approval updates order financial state | PASS |
| T16 | ADMIN reject refund → `REJECTED` | PASS |
| T16b | Rejected refund leaves payment unchanged | PASS |
| T17 | CASHIER cancellation request appears in `pendingRes.cancellations` | PASS |
| T18 | ADMIN list exposes cancellation queue | PASS |
| T19 | ADMIN approve cancellation → order `CANCELLED` (Engine A) | PASS |
| T20 | ADMIN reject cancellation → `REJECTED`, order unchanged | PASS |
| T21 | Wrong admin password → 403 (`verifyAdminPassword`) | PASS |
| T22 | Cross-tenant refund decide → 404 | PASS |
| T23 | Cross-branch refund decide → 404 | PASS |
| H1 | **HTTP** PATCH cancel UNPAID → 200 | PASS |
| H2 | **HTTP** PATCH cancel PAID → 409 | PASS |
| H3 | **HTTP** PATCH cancel already-CANCELLED → 409 | PASS |
| H4 | **HTTP** refund decide wrong password → 403 | PASS |
| 24 | Order Detail refund/cancel behavior unchanged | PASS (T13–T20 exercise it) |
| 25 | Print Bill unchanged | Verified by diff — **not executed** |
| 26 | Sales Report unchanged | Verified by diff — **not executed** |
| 27 | Reservation unchanged | Verified by diff — **not executed** |
| 28 | Late QRIS webhook vs CANCELLED order | **NOT RUN — REMAINING P1 DECISION** (§9) |

**Total executed: 32/32 PASS.**

**What was NOT tested:** signature-verified iPaymu webhook E2E (test 28) — deliberately not
attempted because the business policy is undefined and forging a valid provider signature locally
is out of scope; Print Bill / Sales Report / Reservation runtime regressions (tests 25–27) — no
code in those areas was touched, so they were verified by diff only, not by execution.

## 17. tsc result

`npx tsc --noEmit` → **exit 0** (0 errors), both after each edit and after all edits.

## 18. build result

`npm run build` → **exit 0** (production build succeeded; all routes compiled). `next-env.d.ts`
was **not** modified by the build (`git diff --stat next-env.d.ts` empty).

## 19. diff-check result

`git diff --check` → **exit 0** (no whitespace errors / conflict markers).

## 20. DB before / after

Captured read-only immediately before the runtime run and again after cleanup:

| Table | Before | After |
|---|---|---|
| orders | 35 | 35 |
| orderItems | 1 | 1 |
| payments | 46 | 46 |
| paymentTransactions | 29 | 29 |
| refunds | 2 | 2 |
| refundItems | 0 | 0 |
| cancellationRequests | 0 | 0 |
| auditLogs | 44 | 44 |

All temporary fixtures were removed; no unrelated mutation. (Pre-run pending state: 1 refund
`PENDING`, 0 cancellations — unchanged by this phase.)

## 21. Historical order verification

`ORD-20260908-HCOK1L` was **not touched**:
before `{ status: "CANCELLED", paymentStatus: "PAID" }` → after the same. It remains as evidence,
as required. No historical repair was attempted.

## 22. Remaining P1 / P2 / P3 gaps

- **P1 (open, by decision):** QRIS/PAID webhook can still flip a `CANCELLED` order's
  `paymentStatus` to `PAID`; the correct reconciliation/refund policy must be defined (§9).
- **P2 (unchanged):** `Cashier Sales` `netSales` uses a different refund basis
  (`cashier-sales.service.ts:295-363`); quantity refunds (`RefundItem`) remain API-only;
  no per-request refund/cancellation history surface; no rate limit on decide-password.
- **P3 (unchanged):** no dedicated `/admin/refunds` or `/admin/cancellations` pages.
- **Branch display / item allocations** in the new queue are omitted because the existing list
  payload does not provide them (out of scope to change the service/API).

## 23. Regression assessment

- Only the two source areas in scope changed; the direct-cancel path now shares the approval
  engine's exact net-collected basis (no divergent formula).
- Revenue, dashboard, print bill, reservation, payment creation, QRIS creation, provider
  verification, cashier payment, order creation, promo, customer auth, WhatsApp, inventory and the
  audit engine were **not modified**.
- The P0 guard **tightens** behavior only for `CANCELLED` targets with collected money; all other
  transitions are untouched.
- `decideCancellation` was refactored to call the extracted helper — same inputs, same result
  (its tests were not run because that file contains DML; the helper's behavior is proven via the
  runtime harness T1–T12 and T19).

## 24. git status

```
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  modified:   src/app/admin/audit-logs/page.tsx            (PHASE 6B, pre-existing)
  modified:   src/app/admin/shifts/page.tsx                (PHASE 7B)
  modified:   src/app/api/admin/audit-logs/route.ts        (PHASE 6B, pre-existing)
  modified:   src/components/admin/orders/order-card.tsx   (PHASE 7B)
  modified:   src/components/admin/orders/print-bill-dialog.tsx (PHASE 4, pre-existing)
  modified:   src/services/approval/approval.service.ts    (PHASE 7B)
  modified:   src/services/audit.service.ts                (PHASE 6B, pre-existing)
  modified:   src/services/audit/audit.service.ts          (PHASE 6B, pre-existing)
  modified:   src/services/audit/audit.types.ts            (PHASE 6B, pre-existing)
  modified:   src/services/order/order.service.ts          (PHASE 7B)
  modified:   src/services/report/report.service.ts        (PHASE 5B, pre-existing)

Untracked: PHASE*/AUDIT* reports (including this one) + src/app/admin/audit-logs/layout.tsx
```

Temp harness files (`_p7b_baseline.ts`, `_p7b_runtime.ts`) were **deleted**. No `next-env.d.ts`
diff.

## 25. Commit / push / deploy status

**None.** Nothing was committed, pushed, or deployed. No VPS/production was touched. Work sits
uncommitted in the working tree, exactly as required.

---

### Summary

- **P0 fixed:** direct cancellation of a PAID (or partially refunded) order now returns **409** with
  the existing message, reusing `computeNetCollected`/`MONEY_EPSILON`; the PAY button is disabled in
  the UI and the server stays authoritative.
- **P1 fixed:** the refund and cancellation queues now render in `/admin/shifts`, and the shared
  admin password dialog dispatches to the existing `decideRefund` / `decideCancellation` endpoints
  (no new page/endpoint/engine).
- **P1 documented:** the QRIS/webhook race is left untouched as an explicit product decision.
- **Verified:** `tsc 0`, `build 0`, `diff --check 0`, runtime **32/32 PASS**, DB counts identical
  before/after, historical `ORD-20260908-HCOK1L` unchanged.
- **STOP.** No commit / push / deploy.
