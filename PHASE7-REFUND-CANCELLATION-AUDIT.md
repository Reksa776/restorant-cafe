# PHASE 7 — REFUND & CANCELLATION BACKOFFICE AUDIT

**Mode:** AUDIT ONLY — no source change, no schema change, no migration, no DB write, no commit/push/deploy.
**HEAD:** `d7f29ac` (unchanged). **Read-only verification** (SELECT / static analysis / `tsc` / `git diff --check`).
**Scope:** refund + cancellation engines, APIs, UI, authorization, payment-state machine, race safety, reports, audit logging.

**Verification summary:** `npx tsc --noEmit` → **exit 0**. `git diff --check` → **exit 0**. `npm run build` **not run** (no source modified, so not required). No table was written to: every DB access in this phase was a `SELECT`/`groupBy`/`count`; `git status --short` is byte-identical to the pre-audit state.

---

## 1. Executive Summary

**The engines already exist and are mature.** Refunds and cancellations are both implemented in a single existing service — `ApprovalService` (`src/services/approval/approval.service.ts`, 1152 lines) — with a real approval workflow, server-computed amounts, over-refund guards, COGS reversal, stock restore, race protection and audit logging. There is **no need for a new refund/cancellation/payment/order/approval engine.**

| Question | Answer |
|---|---|
| Refund engine exists? | **YES** — `requestRefund` / `decideRefund` + `RefundItem` allocations |
| Cancellation engine exists? | **YES — but TWO of them** (see below) |
| Partial refund exists? | **YES** — amount-based (UI) *and* quantity-based via `RefundItem` (API-only) |
| Approval/rejection exists? | **YES** — `RequestStatus.PENDING/APPROVED/REJECTED` + admin password re-confirmation |
| Dedicated backoffice page? | **NO** — but refund/cancel *actions* exist in Order Detail + Orders card |
| Migration needed? | **NO** |

**Headline findings (evidence-backed, none fixed — audit only):**

* **P0 — a PAID order can be cancelled with no financial event.** `PATCH /api/orders/[id]/status` (ADMIN **and** CASHIER) → `orderService.updateOrderStatus` (`src/services/order/order.service.ts:1591`) validates only the *status transition* — it contains **no `paymentStatus` guard, no payment void, no refund and no audit log**. The orders page exposes this as a **red trash button** on PENDING orders (`src/components/admin/orders/order-card.tsx:372`). **Live production damage already exists:** `ORD-20260908-HCOK1L` (Rp90.000, QRIS `PAID`) is `status=CANCELLED, paymentStatus=PAID`, **0 refunds**, cancelled by **kasir@restobahagia.com (CASHIER)** with a null-note history row (the direct-path signature). All **7 / 7** CANCELLED orders in the DB were cancelled through this direct path; **0** `CancellationRequest` rows exist.
* **P1 — no UI can approve a cashier-submitted refund/cancellation.** `GET /api/refunds` + `GET /api/cancellations` (ADMIN) return the queues and `/admin/shifts` fetches them, but the page **only renders `overrides`** (`src/app/admin/shifts/page.tsx:149`; approve dialog supports `kind: "override"` only, lines 120/621/636). The Order-Detail dialog can only *create* a request (and, for ADMIN, create+approve in one step) — an existing PENDING request is undecidable from any UI. **Live evidence:** a PENDING refund of Rp30.000 on `ORD-20260909-SOSJRL` has been stuck since **2026-09-09**.
* **P2 — the refund UI is amount-only**, so the quantity-based path (`RefundItem`, exact COGS reversal) has never been used: `refunditem` = **0 rows**.
* **P2 — the refund/cancel dialog offers actions the server always rejects** (cancel is offered on paid orders; the approval engine refuses with *"Order sudah dibayar — selesaikan refund terlebih dahulu"*).
* **Good news:** the approval engine is genuinely well built — `SELECT … FOR UPDATE` per-order locking, guarded `updateMany` transitions (exactly-once side effects), cumulative over-refund guard over **all** payments, `COLLECTED = PAID|REFUNDED`, COGS frozen from an immutable snapshot, stock restore, 6 audit events, password re-confirmation, tenant + branch scoping. **That engine is not the problem — the *second*, unguarded cancellation path is.**

**Two separate cancellation engines (the core of this audit):**

| | Engine A — approval workflow | Engine B — direct status transition |
|---|---|---|
| File | `src/services/approval/approval.service.ts` (`requestCancellation` 569, `decideCancellation` 660) | `src/services/order/order.service.ts` (`updateOrderStatus` 1591) |
| Entry | `POST /api/cancellations` + `POST /api/cancellations/[requestId]/decide` | `PATCH /api/orders/[id]/status` |
| Paid-order guard | **YES** (H3.7, lines ~712-730) | **NONE** |
| Voids live payments | **YES** (UNPAID/PENDING → FAILED) | **NO** |
| Frees table | YES | YES |
| Restores stock | YES (if the order was COMPLETED) | **NO** (no restore for CANCELLED) |
| Audit log | `CANCELLATION_REQUESTED` / `ORDER_CANCELLED` / `CANCELLATION_REJECTED` | **NONE** |
| Ever used in this DB | **0 rows** | **7 / 7 CANCELLED orders** |

---

## 2. Existing Refund Functionality

Engine: `src/services/approval/approval.service.ts` · `ApprovalService` (exported singleton `approvalService`).

| Capability | Where | Notes |
|---|---|---|
| Request a refund | `requestRefund` (line 72) | ADMIN **or** CASHIER (`POST /api/refunds`) |
| Approve / reject | `decideRefund` (line 352) | ADMIN only + admin-password re-confirmation |
| Quantity-based (partial-per-item) refund | `resolveRefundAllocations` (line 273) | prices come from the DB only; `RefundItem` rows |
| Amount-based refund | `requestRefund` fallback branch | `amount > 0` and `<= refundableAmount` |
| Partial refund | YES | any amount ≤ remaining refundable |
| Full refund | YES | when `netPaid <= MONEY_EPSILON` → payments `PAID → REFUNDED`, order `paymentStatus → UNPAID` |
| Over-refund guard | lines 121-138 | `refundable = Σ(PAID+REFUNDED payments) − Σ(APPROVED refunds)` |
| Over-refund guard (per item) | `resolveRefundAllocations` | `purchased qty − Σ APPROVED RefundItem qty` |
| Only one PENDING refund per order | lines ~196-212 | inside a `SELECT … FOR UPDATE` transaction |
| Shift/drawer linkage | lines ~174-186 | `shiftId = collectingPayment.shiftId` (fallback: requester's open shift) |
| Immutable refund ledger | `decideRefund` | `PaymentTransaction { type: "refund", status: "REFUNDED", amount: -amount }` |
| COGS reversal | `decideRefund` (H3.3) | `RefundItem.reversedCogs = OrderItemCostSnapshot.hppUnit × qty` (frozen; `NULL` when uncovered — never 0) |
| Stock restore | `restoreStockForRefund` (line 875) + `reverseHistoricalIngredientConsumption` (line 1050) | only when order `COMPLETED` **and** `branchId` **and** item allocations exist |
| Real-time events | `REFUND_REQUESTED`, `REFUND_DECIDED`, `DASHBOARD_UPDATED` | `emitRealtime` |
| Audit events | `REFUND_REQUESTED`, `REFUND_APPROVED` / `REFUND_DENIED` | see §15 |

**Refund statuses:** `RequestStatus = PENDING | APPROVED | REJECTED` (`prisma/schema.prisma:26-30`). There is **no** `PROCESSING` / `FAILED` / `COMPLETED` refund state, and no provider/gateway refund call anywhere in the codebase — refunds are an internal cash-drawer/ledger operation, which matches the schema (no provider/reference column).

**Refund eligibility basis:** `COLLECTED_PAYMENT_STATUSES = ["PAID", "REFUNDED"]` (`approval.service.ts:34`) — PENDING/FAILED/EXPIRED/CANCELLED/UNPAID are never refundable. This is the **same basis** as revenue recognition (§14).

---

## 3. Existing Cancellation Functionality

The cancellation feature exists twice (see §1). Per-scenario results, all derived from code + the live DB:

| # | Scenario | Engine A (approval) | Engine B (direct status) | Verified |
|---|---|---|---|---|
| A | Unpaid order → cancel | Order `CANCELLED`, history note, table freed, live UNPAID/PENDING payments → `FAILED` | Order `CANCELLED`, history note `null`, table freed, **payments untouched** | `ORD-20260907-*` (3 orders) via B |
| B | Paid order → cancel | **BLOCKED**: `ConflictError "Order sudah dibayar — selesaikan refund terlebih dahulu sebelum membatalkan"` (H3.7) | **ALLOWED** → status `CANCELLED`, payment stays `PAID`, no refund, no audit | **edge order via B (P0)** |
| C | Pending payment → cancel | Payment (`UNPAID`/`PENDING`) → `FAILED` | Payment left as-is → a later webhook can still flip the order to PAID | code |
| D | QRIS pending → cancel | same as C | same as C | code |
| E | QRIS paid → cancel | blocked (netPaid > 0) | allowed, QRIS payment stays PAID | **ORD-20260908-HCOK1L** |
| F | CASH paid → cancel | blocked (netPaid > 0) | allowed, KASIR payment stays PAID | code |
| G | Already cancelled → cancel again | `cancel(["COMPLETED","CANCELLED"].includes(status))` → `ConflictError`; request path also blocks a duplicate PENDING request | transition map `CANCELLED: []` → `ConflictError "Cannot transition from CANCELLED to CANCELLED"` | code |
| H | Refunded → cancel | blocked while `netPaid > 0`; **after a full refund** (`netPaid = 0`) cancellation is allowed → `status=CANCELLED` on an `UNPAID` order (consistent, no money held) | READY/PROCESSING → CANCELLED allowed; `paymentStatus` untouched | `ORD-20260907-BAF3ZT` is `PROCESSING/UNPAID` with a full refund approved (not cancelled) |
| I | Cancel + refund | Deliberately NOT auto-composed: the code never auto-creates a refund on cancellation (explicit comment, `decideCancellation`). The operator must refund first, then cancel | n/a (no refund at all) | code |
| J | Cross-tenant cancellation | `restaurantId` comes from the session only; `findFirst({ id, restaurantId })` → foreign order = `NotFoundError` | same (`restaurantId` from ctx, order lookup scoped) | code |
| K | Unauthorized cancellation | request: ADMIN+CASHIER; decide: ADMIN + password. CASHIER cannot decide | ADMIN + CASHIER can cancel **directly** — this is the P0 | code |

**Ordering consequence (not a bug, but a design fact):** cancellation and refund are **two separate engines with no orchestration**. Engine A is refund-aware only in the negative sense (it refuses when money is held); it never triggers Engine 1 (refunds).

---

## 4. Refund Schema

`prisma/schema.prisma:418-457` — `model Refund` (`@@map("refund")`):

| Field | Type | Note |
|---|---|---|
| `id` | String cuid | PK |
| `restaurantId` | String | FK → Restaurant; **always** the session tenant |
| `branchId` | String? | copied from the **order's** branch (indexed, no FK) |
| `orderId` | String | FK → Order (indexed) |
| `paymentId` | String? | the collecting (KASIR) payment when known (indexed) |
| `shiftId` | String? | drawer that must absorb the cash (indexed) |
| `amount` | Decimal(12,2) | server-computed |
| `reason` | Text | ≥ 5 chars |
| `status` | `RequestStatus` | `PENDING` default |
| `requestedByCashierId` | String | FK `RefundRequester` → User |
| `approvedByAdminId` | String? | FK `RefundApprover` |
| `rejectedByAdminId` | String? | FK `RefundRejecter` |
| `decisionNote` | Text? | |
| `requestedAt` / `decidedAt` / `approvedAt` | DateTime | `createdAt` / `updatedAt` also present |
| `items` | `RefundItem[]` | quantity allocations |

**Indexes:** `restaurantId`, `branchId`, `orderId`, `paymentId`, `status`, `shiftId`.
**Missing (deliberate, see §17):** no `rejectedAt`, no `refundedAt`, no `provider` / `providerRef` / gateway transaction id, no unique constraint for “one PENDING per order”, no `refundedByAdminId` distinct from `approvedByAdminId`.

`model RefundItem` (`prisma/schema.prisma:472-489`, `@@map("refunditem")`): `refundId`, `orderItemId`, `quantity`, `amount`, `reversedCogs` (nullable, immutable historical financial data), with `@@unique([refundId, orderItemId])` and cascade deletes from `Refund` and `OrderItem`.
Live data: **`refund` = 2 rows, `refunditem` = 0 rows.**

---

## 5. Cancellation Schema / State

`prisma/schema.prisma:491-520` — `model CancellationRequest` (`@@map("cancellationrequest")`): `restaurantId`, `branchId?`, `orderId`, `reason` (Text), `status RequestStatus`, `requestedByCashierId`, `approvedByAdminId?`, `rejectedByAdminId?`, `decisionNote?`, `requestedAt`, `decidedAt?`, `approvedAt?`, `createdAt`, `updatedAt`; relations to Restaurant / Order / requester / approver / rejecter; indexes on `restaurantId`, `branchId`, `orderId`, `status`.
**No `items`, no refund link, no `cancelledAt`.** Live data: **0 rows**.

Order-side state used by cancellation:

* `Order.status OrderStatus` = `PENDING|CONFIRMED|PROCESSING|READY|COMPLETED|CANCELLED` (`schema.prisma:32-39`).
* `Order.paymentStatus PaymentStatus` = `UNPAID|PENDING|PAID|FAILED|EXPIRED|REFUNDED|CANCELLED` (`schema.prisma:95-103`).
* `OrderStatusHistory` — written by **both** engines: Engine A note `"Dibatalkan — {decisionNote || reason}"` with `changedBy = adminId`; Engine B note `= input.notes ?? null` with `changedBy = session userId`. **This difference is the forensic signature used in §1/§13 to prove which path cancelled the 7 live orders.**
* Transition map (Engine B) — `order.service.ts:36-43`: `PENDING→[CONFIRMED,CANCELLED]`, `CONFIRMED→[PROCESSING,CANCELLED]`, `PROCESSING→[READY,CANCELLED]`, `READY→[COMPLETED]`, `COMPLETED→[]`, `CANCELLED→[]`.

---

## 6. Refund Service Flow

`approvalService.requestRefund({ restaurantId, userId, orderId, amount, reason, items?, branchFilters? })`:

1. `reason.trim().length >= 5`, else `ValidationError`.
2. Load the order **restaurant-scoped**, including **collected** payments (`status in [PAID, REFUNDED]`) and its items (id/productId/quantity/unitPrice/totalPrice).
3. Branch guard: `branchFilters` set and the order's `branchId` not in it → `NotFoundError` (deliberately indistinguishable from “not found”).
4. `status === "CANCELLED"` → `ConflictError "Order sudah dibatalkan — tidak bisa refund"`.
5. No collected payment → `ConflictError "Belum ada pembayaran lunas untuk order ini"`.
6. `refundable = Σ collected payments − Σ APPROVED refunds`; `<= MONEY_EPSILON` → `ConflictError "Order ini sudah direfund penuh"`.
7. Amount branch: `Number.isFinite && > 0`, and `<= refundable + eps` else `ConflictError "Jumlah refund melebihi sisa yang dapat direfund (Rp…)"`. Allocation branch: `resolveRefundAllocations` prices every line from `OrderItem.totalPrice / OrderItem.quantity` (so line discounts are respected), rejects duplicate/foreign items and over-quantity, and subtracts already-APPROVED `RefundItem` quantities.
8. Drawer linkage: if a `KASIR` payment exists → `shiftId = payment.shiftId` (fallback: requester's open shift).
9. `prisma.$transaction`: `SELECT id FROM \`order\` WHERE id = … FOR UPDATE` → reject an existing PENDING refund → `refund.create({ status: PENDING, … })` (+ nested `items`).
10. `emitRealtime(REFUND_REQUESTED …)`, `emitRealtime(DASHBOARD_UPDATED …)`.
11. `auditService.log({ action: "REFUND_REQUESTED", entityType: "Refund", entityId, details: { orderNumber, amount, reason, shiftId, itemAllocations } })`.

`approvalService.decideRefund({ restaurantId, adminId, refundId, approve, decisionNote?, branchFilters? })`:

1. Read the refund **restaurant + branch scoped**, `status: PENDING`, with order/payment/items.
2. Transaction → **guarded** `tx.refund.updateMany({ where: { id, status: PENDING }, data: { status: APPROVED|REJECTED, decidedAt, approvedAt, approvedByAdminId|rejectedByAdminId, decisionNote } })`; `count === 0` → `ConflictError "Permintaan refund sudah diproses"` (double-click / concurrent approval loses the race).
3. On approval: freeze `RefundItem.reversedCogs` from `OrderItemCostSnapshot` (`SNAPSHOTTED` only, else `NULL`).
4. Recompute `totalPaid` over **all** collected payments and `cumulativeRefunded`; `netPaid = totalPaid − cumulativeRefunded`.
5. Insert the immutable ledger row: `PaymentTransaction { type: "refund", status: "REFUNDED", amount: -amount, rawData: { refundId, reason, approvedBy, approvedAt } }` on `refund.payment ?? first PAID payment ?? first collected`.
6. `netPaid <= eps` → `payment.updateMany(status: PAID → REFUNDED)`.
7. `order.update({ paymentStatus: netPaid > eps ? "PAID" : "UNPAID" })` — the order's **fulfillment** status is never touched.
8. If the refund has items **and** the order is `COMPLETED` with a `branchId` → `restoreStockForRefund`.
9. `emitRealtime(REFUND_DECIDED + DASHBOARD_UPDATED)` → `auditService.log({ action: approve ? "REFUND_APPROVED" : "REFUND_DENIED", details: { orderNumber, amount, reason, decisionNote } })`.

## 7. Cancellation Service Flow

**Engine A — approval workflow**

`requestCancellation` (line 569): reason ≥ 5 chars → order restaurant-scoped → branch guard → `["COMPLETED","CANCELLED"].includes(status)` → `ConflictError` → `$transaction` with `FOR UPDATE` on the order + “one PENDING request” check → `cancellationRequest.create({ status: PENDING, branchId: order.branchId })` → realtime → `auditService.log("CANCELLATION_REQUESTED")`.

`decideCancellation` (line 660): read request restaurant+branch scoped `PENDING` with the order → if the order is already `COMPLETED`/`CANCELLED` → `ConflictError "Order sudah berada di status akhir"` → transaction:

1. **Guarded** `cancellationRequest.updateMany({ id, status: PENDING } → APPROVED|REJECTED)`, `count === 0` → `ConflictError`.
2. **H3.7 paid-order guard (approval only):** `netPaid = Σ collected payments − Σ APPROVED refunds`; `netPaid > eps` → `ConflictError "Order sudah dibayar — selesaikan refund terlebih dahulu sebelum membatalkan"`. It never auto-creates a refund.
3. **Guarded** `order.updateMany({ id, status: { notIn: [COMPLETED, CANCELLED] } } → CANCELLED)`, `count === 0` → `ConflictError "Status order sudah berubah …"`.
4. `orderStatusHistory.create({ status: CANCELLED, notes: "Dibatalkan — …", changedBy: adminId })`.
5. Free the table (`table.status = AVAILABLE`) when `order.tableId`.
6. Void live intents: `payment.updateMany({ orderId, status in [UNPAID, PENDING] } → FAILED)` (history preserved). Note: **`order.paymentStatus` is not normalised** here.
7. If the order was `COMPLETED` and has a `branchId` → `restoreStockForCancellation`.
8. Realtime (`CANCELLATION_DECIDED`, `ORDER_STATUS_CHANGED`, `TABLE_STATUS_CHANGED`, `DASHBOARD_UPDATED`) → `auditService.log(approve ? "ORDER_CANCELLED" : "CANCELLATION_REJECTED")`.

**Engine B — direct order-status transition (no approval)**

`orderService.updateOrderStatus(id, { status, notes }, restaurantId, changedBy, branchFilters)` (line 1591): order restaurant+branch scoped → `VALID_STATUS_TRANSITIONS` check → `$transaction` → **conditional** `order.updateMany({ id, status: currentStatus } → newStatus)` (`count === 0` → `ConflictError "Status pesanan telah berubah"`) → refuse `→ COMPLETED` when an APPROVED refund exists (H3.6) → `orderStatusHistory.create` → consume ingredients / free table for `COMPLETED|CANCELLED`.
**Absent here:** any `paymentStatus` check, any payment void, any refund creation, any `auditService.log`, and any confirmation password. This is the P0 bypass.

---

## 8. API Inventory

| Route | Method | Auth | Body / query | Calls |
|---|---|---|---|---|
| `src/app/api/refunds/route.ts` | `GET` | `requireRoles(["ADMIN"], branchHint)` + `authorizedBranches` | — | `approvalService.listPendingForRestaurant` (refunds only in practice, but returns all three queues) |
| `src/app/api/refunds/route.ts` | `POST` | `requireRoles(["ADMIN","CASHIER"], branchHint)` | `{ orderId, amount, reason, items? }` | `requestRefund` |
| `src/app/api/refunds/[refundId]/decide/route.ts` | `POST` | `requireAdmin(branchHint)` **+ `verifyAdminPassword`** | `{ password, approve, decisionNote? }` | `decideRefund` |
| `src/app/api/cancellations/route.ts` | `GET` | `requireRoles(["ADMIN"])` | — | `listPendingForRestaurant` |
| `src/app/api/cancellations/route.ts` | `POST` | `requireRoles(["ADMIN","CASHIER"])` | `{ orderId, reason }` | `requestCancellation` |
| `src/app/api/cancellations/[requestId]/decide/route.ts` | `POST` | `requireAdmin` **+ `verifyAdminPassword`** | `{ password, approve, decisionNote? }` | `decideCancellation` |
| `src/app/api/orders/[id]/status/route.ts` | `PATCH` | `requireRoles(["ADMIN","CASHIER"])` | `{ status ∈ CONFIRMED\|PROCESSING\|READY\|COMPLETED\|**CANCELLED**, notes? }` | `updateOrderStatus` **(Engine B — no password, no payment guard)** |

There is **no** detail endpoint (`GET /api/refunds/[id]`) and **no** `/api/orders/[id]/cancel`. Both refund and cancellation queues share one service method (`listPendingForRestaurant`, line 1115).

## 9. Backoffice UI Inventory

**There is no dedicated `/admin/refunds` or `/admin/cancellations` page** — and, per the audit brief, that alone is *not* a gap if Order Detail already provides the workflow. It does, partly:

| Surface | File | What it offers | Connected? |
|---|---|---|---|
| Orders card | `src/components/admin/orders/order-card.tsx:362-432` | Confirm / **Cancel (trash, PENDING only)** / Process / Ready / Complete | ✅ direct (Engine B) |
| Order Detail actions | `src/components/admin/orders/approval-actions.tsx` (1-260) | **Refund** button (`canRefund = paymentStatus === "PAID"`) + **Batalkan Pesanan** (`canCancel = status not terminal`) → dialog with amount, reason, admin password; ADMIN = request+approve in one call; CASHIER = request only | ✅ (creates requests) |
| Order Detail gate | `src/components/admin/orders/order-detail.tsx:505-519`, `src/app/admin/orders/[orderNumber]/page.tsx:281` | renders `ApprovalActions` when `status not in (COMPLETED, CANCELLED)` and (`paymentStatus === PAID` or `status === PENDING`) | ✅ |
| Pending-approval queue | `src/app/admin/shifts/page.tsx:144-149`, `588-640` | renders **only `pendingOverrides`**; `pendingRes.refunds` / `pendingRes.cancellations` are fetched and **discarded**; realtime listens to `REFUND_REQUESTED` / `CANCELLATION_REQUESTED` but the approve dialog only supports `kind: "override"` (lines 120/621/636) | ❌ **queue invisible** |
| Review-history | — | none | ❌ |
| Refund/cancel history | `src/app/admin/shifts/[shiftId]/page.tsx:266-268`, `src/app/admin/cashier/sales/page.tsx:304-306` | only **totals** (`refunds`, `summary.totalRefund`) — no per-request list or status | ❌ |
| Admin Payments | `src/app/admin/payments/page.tsx` | no refund/cancel affordance | ❌ |

Client wrappers (all in `src/services/shift.service.ts`): `requestRefund` (169), `decideRefund` (174), `requestCancellation` (185), `decideCancellation` (194), `listPendingApprovals` (212 → `GET /refunds`).

**Classified as:** refund/cancellation *actions* = available (Order Detail); refund/cancellation *history & approval queue* = **API-only**; **`resolveRefundAllocations` (quantity refunds) = API-only, never sent by any UI**.

## 10. Authorization

| Actor | Request refund | Decide refund | Request cancel | Decide cancel | Direct cancel (Engine B) |
|---|---|---|---|---|---|
| ADMIN | ✅ | ✅ + password | ✅ | ✅ + password | ✅ |
| CASHIER | ✅ | ❌ 403 | ✅ | ❌ 403 | ✅ **(P0)** |
| Branch-scoped admin | ✅ own branches only | ✅ own branches only | ✅ | ✅ | ✅ (order lookup is branch-filtered) |
| Customer / public | ❌ no route | ❌ | ❌ | ❌ | ❌ |

Helpers reused (no new RBAC): `requireAuth`, `requireRestaurantContext`, `requireRoles`, `requireAdmin`, `branchHintFrom`, `authorizedBranches`, `assertBranchInScope`, `verifyAdminPassword` (`src/lib/auth-helpers.ts:309-334`, bcrypt compare against an active ADMIN **of the same restaurant**, `ForbiddenError "Password admin salah"`).

## 11. Tenant / Branch Isolation

| Check | Implementation | Verdict |
|---|---|---|
| `restaurantId` authority | always `ctx.restaurantId` (session); never from query/body | ✅ |
| Order lookup | `findFirst({ id, restaurantId })` in both engines | ✅ |
| Refund/cancel lookup | `findFirst({ id, restaurantId, … })` (+ `branchId: { in: branchFilters }` when scoped) | ✅ |
| Branch scope on request | `input.branchFilters` not containing the order's branch → `NotFoundError` (no existence leak) | ✅ |
| Branch scope on decide | `branchId: { in: branchFilters }` → foreign branch = `NotFoundError` | ✅ |
| Engine B branch scope | `where: { id, restaurantId, branchId: branchFilters?.length ? { in } : undefined }` | ✅ |
| Item ownership | `resolveRefundAllocations` rejects any `orderItemId` not on **this** order | ✅ |
| Approval queue | `listPendingForRestaurant(restaurantId, branchFilters)` | ✅ |
| IDOR | no `[id]` GET route exists; decide uses `POST` with scoped lookups | ✅ |

---

## 12. Payment State Machine

Derived **only** from the code above (no invented states). `eps = MONEY_EPSILON`.

| Action | Order.status | Order.paymentStatus | Payment.status | PaymentTransaction | Refund |
|---|---|---|---|---|---|
| Unpaid order cancelled (Engine A) | `→ CANCELLED` | unchanged (`UNPAID`) | live `UNPAID`/`PENDING` → `FAILED` | — | — |
| Unpaid order cancelled (Engine B) | `→ CANCELLED` | unchanged | **untouched** | — | — |
| Paid CASH order cancelled (Engine A) | **blocked** (`netPaid > eps`) | — | — | — | — |
| Paid CASH order cancelled (Engine B) | `→ CANCELLED` | stays `PAID` | stays `PAID` | — | **none** |
| Paid QRIS order cancelled (Engine A) | **blocked** | — | — | — | — |
| Paid QRIS order cancelled (Engine B) | `→ CANCELLED` | stays `PAID` | stays `PAID` | — | **none** ← live: `ORD-20260908-HCOK1L` |
| Pending QRIS cancelled (Engine A) | `→ CANCELLED` | **unchanged** (may stay `PENDING`) | `PENDING` → `FAILED` | — | — |
| Pending QRIS cancelled (Engine B) | `→ CANCELLED` | unchanged | unchanged → a late webhook can still set `PAID` | — | — |
| Full refund approved | unchanged (`COMPLETED` stays) | `→ UNPAID` (`netPaid <= eps`) | collected `PAID` → `REFUNDED` | `{ type: "refund", status: "REFUNDED", amount: -amount }` | `APPROVED`, `approvedAt` set |
| Partial refund approved | unchanged | stays `PAID` | stay `PAID` | same negative ledger row | `APPROVED` |
| Already fully refunded | — | — | — | — | new request **blocked**: `"Order ini sudah direfund penuh"` |
| Duplicate / concurrent refund | — | — | — | — | 2nd PENDING blocked under `FOR UPDATE`; 2nd decide → `"Permintaan refund sudah diproses"` |
| Failed refund | **state does not exist** (`RequestStatus` has no `FAILED`; no provider call) | — | — | — | — |
| Rejected refund | unchanged | unchanged | unchanged | none | `REJECTED`, `rejectedByAdminId`, `decidedAt` |
| Refund requested (pending) | unchanged | unchanged | unchanged | none | `PENDING` |
| Cancellation rejected | unchanged | unchanged | unchanged | — | — |

Key invariant (matches §14): **revenue recognition is driven by `paymentStatus`/payment rows, never by `Order.status`** — which is exactly why Engine B’s silent `CANCELLED` on a paid order removes collected money from revenue without any financial record.

## 13. Refund / Cancel Race Safety

| Mechanism | Where | Assessment |
|---|---|---|
| Per-order row lock | `SELECT id FROM \`order\` WHERE id = … FOR UPDATE` inside `requestRefund` / `requestCancellation` | ✅ serialises “one PENDING per order” |
| Guarded decision transition | `updateMany({ id, status: PENDING })`; `count === 0` → `ConflictError` | ✅ exactly-once approval; double-click safe |
| Conditional order transition | `updateMany({ id, status: { notIn: [COMPLETED, CANCELLED] } })` (A) and `{ id, status: currentStatus }` (B) | ✅ lost-update safe |
| Conditional webhook mirror | `order.updateMany({ id, paymentStatus: current.status })` (payment.service.ts:1125-1130) | ✅ no backward drag |
| Unique constraint | `RefundItem @@unique([refundId, orderItemId])` | ✅ |
| Cumulative over-refund | recomputed from DB at request **and** approval | ✅ |
| Idempotent side effects | stock restore / COGS freeze gated behind the guarded transition | ✅ |
| **No DB unique for “one PENDING per order”** | only lock + check | ⚠️ acceptable, but a partial index would harden it |
| **Cancellation vs payment webhook** | cancellation does not lock the order and does not touch `order.paymentStatus`; the webhook CAS keys off `order.paymentStatus` | ⚠️ **P1 race:** a QRIS webhook arriving after a cancellation can set `paymentStatus = PAID` on a `CANCELLED` order → the live `CANCELLED + PAID` edge case (audit PHASE 5B, Rp90.000) |
| **Engine B vs everything** | Engine B has no lock beyond its own CAS and no payment interaction | ❌ **P0:** it can cancel concurrently with a payment/refund with nothing to reconcile it |
| Refund vs cancellation race | `decideCancellation` re-reads collected payments **inside** the transaction, so an already-approved refund blocks cancellation | ✅ (approval path only) |

## 14. Revenue / Report Impact

Single source of truth: `revenueWhere` / `revenueScopeWhere` / `computeRefundRevenue` in `src/services/report/report.service.ts`.

* `revenueWhere` (line 199) = `reportBaseWhere` (which requires `status != CANCELLED`) **AND** (`paymentStatus = PAID` **OR** `payments.some(status = REFUNDED)`).
* `revenueScopeWhere` (line 220) = the same revenue set **without** the order-date bound, used to attribute a refund to its **approval** period.
* `computeRefundRevenue` (line 274) = SQL that computes `refundRevenue = refundedAmount × productRevenue / grandTotal` (refund attributed by approval date) — the H3 fix that prevents negative net sales when tax/service charge is present.

| Report | Refund aware? | Predicate / evidence | Verdict |
|---|---|---|---|
| Sales (`getSalesReport` 1017) | ✅ | `revenueWhere` (1026) + `revenueScopeWhere` (1077) + `computeRefundRevenue` (1167) | ✅ |
| Dashboard (`order.service.ts:1980`) | ✅ | reuses `revenueWhere` (PHASE 5B) | ✅ |
| Profitability (349) | ✅ | `computeRefundRevenue` + `refund.aggregate` (156) + per-branch refunds (263) | ✅ |
| Menu Engineering (341/376/501) | ✅ | `EXISTS (payment REFUNDED)` scope + **retained** (refund-aware) COGS | ✅ |
| Product report (`getProductReport` 1518) | ✅ | `revenueWhere` (1534) | ✅ |
| Multi-outlet (2112) | ✅ | `computeRefundRevenue` (2273) | ✅ |
| Payment report (`getPaymentReport` 1865) | ⚠️ partial | payment-centric with status buckets; `paidAgg` only counts `PAID`, so a fully refunded order’s payment appears only in the `REFUNDED` bucket and no refund total is reported | ℹ️ different basis from Sales (payment-centric vs revenue-centric), **not a bug** |
| Cashier Sales (`cashier-sales.service.ts:295-363`) | ⚠️ **mismatch** | `salesWhere.status = "PAID"` (so `REFUNDED` payments are excluded) while `totalRefund` sums all APPROVED refunds, then `netSales = totalSales − totalRefund` (line 354) — the exact naive basis the H3 patch calls out as able to go negative for fully refunded orders | **GAP (P2):** inconsistent refund semantics across reports |
| Shift reconciliation (`shift/shift.service.ts:46-71`) | ✅ | `expectedCash = openingCash + cashSales − refunds` (refunds in that shift) | ✅ |
| Cashier-sales `totalRefund` UI | ✅ | `src/app/admin/cashier/sales/page.tsx:304-306` | ✅ |

**Confirmed semantics:** `CANCELLED ≠ revenue` (base where), `PAID = revenue`, `REFUND` = a separate reversal line (gross stays, refund subtracted via `computeRefundRevenue` / `totalRefund`). **No change was made in this phase.**

---

## 15. Audit Log Impact

The audit engine (`auditService.log`) is **not** modified; these are the events the refund/cancellation code actually writes:

| Action | Written by | Actor | Entity | Details |
|---|---|---|---|---|
| `REFUND_REQUESTED` | `requestRefund` | requester (`ctx.userId`) | `Refund` | `{ orderNumber, amount, reason, shiftId, itemAllocations }` |
| `REFUND_APPROVED` | `decideRefund` (approve) | admin | `Refund` | `{ orderNumber, amount, reason, decisionNote }` |
| `REFUND_DENIED` | `decideRefund` (reject) | admin | `Refund` | same |
| `CANCELLATION_REQUESTED` | `requestCancellation` | requester | `CancellationRequest` | `{ orderNumber, reason }` |
| `ORDER_CANCELLED` | `decideCancellation` (approve) | admin | `CancellationRequest` | `{ orderNumber, reason, decisionNote }` |
| `CANCELLATION_REJECTED` | `decideCancellation` (reject) | admin | `CancellationRequest` | same |

Each row carries `restaurantId`; `branchId = order.branchId` (refund: `order.branchId` / `refund.branchId`; cancellation: `order.branchId` / `request.branchId`); `ipAddress` is now request-derived (PHASE 6B).

**Not present anywhere:** `REFUND_COMPLETED`, `REFUND_FAILED`, `PAYMENT_CANCELLED`, `PAYMENT_VOIDED`, and **any audit event for a direct (Engine B) order cancellation**. Live data (read-only counts, `auditlog` total = 44, unchanged by this phase) confirms the asymmetry: only the refund actions have ever fired — `REFUND_REQUESTED` = 2, `REFUND_APPROVED` = 1 — while **`REFUND_DENIED` = 0, `CANCELLATION_REQUESTED` = 0, `ORDER_CANCELLED` = 0, `CANCELLATION_REJECTED` = 0**, i.e. **no audit row exists for any of the 7 cancellations**, which were all performed through Engine B (unnamed in the audit trail).

## 16. Security Findings

| Check | Result | Evidence |
|---|---|---|
| Refund amount computed server-side | ✅ | `refundableAmount` from DB aggregates; allocation prices from `OrderItem.totalPrice / quantity` |
| Client `amount` trusted? | ❌ never | only used as a **request**, validated `> 0` and `<= refundableAmount` |
| Client `items` quantity trusted? | ❌ | must be an integer `> 0`, `<= purchased − already refunded`, and belong to this order |
| Client can set refund status / `approvedByAdminId`? | ❌ no path | decide route only accepts `{ password, approve, decisionNote }` |
| Client `restaurantId` / `userId` trusted? | ❌ | always from the session context |
| Client can set `Order.paymentStatus`? | ❌ no route | status route schema has no payment fields |
| **Client can bypass the paid-order guard** | **✅ YES — Engine B** | `PATCH /api/orders/[id]/status { status: "CANCELLED" }` succeeds on a `PAID` order |
| Admin password re-confirmation on decide | ✅ | bcrypt compare, active ADMIN of the same restaurant |
| Brute-force protection on that password | ❌ **none** | no rate limit / lockout / attempt counter on either decide route (`rate-limit.ts` is not imported) — **P2** |
| Tenant isolation | ✅ | §11 |
| Secrets in payloads | ✅ | no password/token/provider credential is written to `Refund` / `CancellationRequest` / audit `details`; the audit read-path still redacts (`redactAuditDetails`) |

## 17. Database / Migration Impact

**Migration diperlukan? NO.** Reasons, from the actual schema:

1. Both engines already have everything they need: `Refund` + `RefundItem` (+ unique `[refundId, orderItemId]`), `CancellationRequest`, `RequestStatus`, `OrderStatusHistory`, six indexes on `Refund` and four on `CancellationRequest`, and `PaymentStatus.REFUNDED` / `CANCELLED` already exist.
2. Nothing implemented in PHASE 7B (see §20) requires a new column: the P0 fix is a **guard** inside existing code; the P1 fix is **UI only**; the P2 fixes are UI/validation only.
3. The only *optional* hardenings are non-essential: a partial unique index for “one PENDING refund/cancellation per order”, a composite `[restaurantId, status, requestedAt]` index for the queue, and columns such as `rejectedAt` / refund-provider reference **only if** real gateway refunds are ever required (today refunds are deliberately internal: no provider field exists and none is used).

No schema file, migration, seed or row was touched in this phase.

---

## 18. Existing Functionality Matrix

| Functionality | Existing | Location | Connected | Gap |
|---|---|---|---|---|
| Refund engine | ✅ | `src/services/approval/approval.service.ts:72,352` | ✅ API + Order Detail | — |
| Partial refund | ✅ | amount branch (line ~168) + `resolveRefundAllocations` 273 | amount ✅ / quantity ❌ | P2 no UI for item allocations |
| Full refund | ✅ | `decideRefund` `netPaid <= eps` | ✅ | — |
| Refund approval | ✅ | `decideRefund` + `verifyAdminPassword` | ✅ new request only; ❌ existing PENDING | **P1** |
| Refund rejection | ✅ | `decideRefund(approve=false)` | ❌ no UI | **P1** |
| Cancellation engine (approval) | ✅ | `requestCancellation` 569 / `decideCancellation` 660 | ✅ request, ❌ decide | **P1** |
| Cancel unpaid (Engine A) | ✅ | guarded transition | via request only | — |
| Cancel unpaid (Engine B) | ✅ | `order-card.tsx:372` → `updateOrderStatus` | ✅ | — |
| Cancel paid | ⚠️ | Engine A blocks / **Engine B allows** | ✅ via orders card | **P0** |
| Cancel pending payment | ✅ | Engine A voids `UNPAID`/`PENDING` | ✅ | — |
| Refund history | ⚠️ totals only | `shift/[shiftId]/page.tsx`, `cashier/sales/page.tsx` | partial | **P2** no per-request list |
| Cancellation history | ❌ | — | ❌ | **P2** |
| Admin UI | ✅ | order-card, approval-actions, order-detail | ✅ | queue missing → P1 |
| Cashier UI | ✅ | request-only flows | ✅ | — |
| Audit log | ✅ 6 events | §15 | ✅ Engine A / ❌ Engine B | **P1** (no audit for direct cancel) |
| Reports | ✅ | `revenueWhere`, `computeRefundRevenue` | ✅ | P2 cashier-sales basis |
| Tenant isolation | ✅ | §11 | ✅ | — |
| Branch isolation | ✅ | §11 | ✅ | — |
| Race protection | ✅ Engine A | §13 | ✅ | P1 cancel-vs-webhook, P0 Engine B |

## 19. GAP Classification

**P0 — payment integrity / data loss**
1. **Direct cancellation of a PAID order.** `PATCH /api/orders/[id]/status` + the orders-card trash button cancel a paid order with no refund, no payment void, no audit row — real damage exists (`ORD-20260908-HCOK1L`, Rp90.000 QRIS, cancelled by a CASHIER).

**P1 — broken / missing workflow**
2. **No UI can decide a pending refund** (live: since 2026-09-09).
3. **No UI can decide a pending cancellation** (no live data, but the same dead end).
4. **Direct cancellation is unaudited** (no `auditService.log` anywhere in `order.service.ts`).
5. **Cancellation vs payment-webhook race** can produce/maintan `CANCELLED + paymentStatus=PAID` with collected money (also the source of the PHASE 5B `CANCELLED+PAID` edge case).

**P2 — UX / consistency**
6. Quantity-based refunds have no UI (`refunditem` = 0 rows) although the API and reporting fully support them.
7. The Order Detail dialog offers cancel for paid orders that Engine A always rejects (and offers refund only when `paymentStatus === PAID`, hiding it for `REFUNDED` follow-ups).
8. No per-request refund/cancellation history screen (only totals); no rejection-reason visibility.
9. Cashier Sales `netSales` uses a different refund basis than the sales/profitability reports.
10. No rate limit / lockout on the admin-password confirmations.

**P3 — optimization**
11. Optional composite index `[restaurantId, status, requestedAt]` for the approval queue and a partial unique guard for “one PENDING per order”.
12. `GET /api/refunds` and `GET /api/cancellations` both return all three queues (redundant payload for the shifts page).

**Not a gap:** the absence of `/admin/refunds` and `/admin/cancellations` pages — Order Detail already exposes the actions; the missing piece is the approval *queue*, which can live on the existing `/admin/shifts` approvals area or a small shared card.

---

## 20. Recommended Next Phase

**PHASE 7B — targeted hardening only (no new engine, no migration):**

1. **(P0, smallest possible change)** Guard Engine B: in `orderService.updateOrderStatus`, refuse a transition to `CANCELLED` when collected money exists (`Σ PAID|REFUNDED payments − Σ APPROVED refunds > eps`) with an Indonesian message pointing at the refund flow — i.e. reuse the exact H3.7 guard already written in `decideCancellation`. Optionally also mirror it in the UI (hide the trash button for paid orders).
2. **(P1)** Render the existing `pendingRes.refunds` / `pendingRes.cancellations` from `/admin/shifts` (the data and the decide APIs already exist) and extend the approve dialog beyond `kind: "override"` so refunds/cancellations can be approved/rejected with the password.
3. **(P1)** Add an audit event for a direct order cancellation (or, better, route cancellations through Engine A so the existing event fires) — do **not** invent a new audit engine.
4. **(P1)** Decide the cancellation-vs-webhook interleaving policy (e.g. have the webhook skip/compensate when `order.status = CANCELLED`, or lock the order row in `decideCancellation`) — needs a product decision, so audit-only for now.
5. **(P2)** Offer the quantity-based refund path in the Order Detail dialog (the API, pricing, COGS reversal and stock restore are already done).
6. **(P2)** Align Cashier Sales `netSales` with the report engine’s proportional refund basis.
7. **(P2)** Rate-limit / lock the decide-password endpoints.
8. **(P3)** Optional index/unique hardening — only with scale evidence, per the PHASE 6 precedent.

**Do not:** build a new refund/cancellation/payment/order/approval/audit engine, add a migration, or redesign the admin area.

## Final Summary

| # | Question | Answer |
|---|---|---|
| 1 | Refund engine sudah ada? | **YA** — `approvalService.requestRefund` / `decideRefund` (`src/services/approval/approval.service.ts:72,352`) |
| 2 | Cancellation engine sudah ada? | **YA — dua**: approval (`:569/:660`) + direct status (`order.service.ts:1591`) |
| 3 | Partial refund sudah ada? | **YA** — amount (UI) & quantity via `RefundItem` (API-only, `refunditem` = 0 rows) |
| 4 | Full refund sudah ada? | **YA** — `netPaid <= eps` → payments `REFUNDED`, order `UNPAID` |
| 5 | Approval/rejection sudah ada? | **YA** — `RequestStatus` + guarded transition + admin password |
| 6 | Dedicated backoffice UI sudah ada? | **TIDAK ada page khusus**, tapi action-nya ada di Order Detail/Orders card; yang hilang = **queue persetujuan** |
| 7 | Existing Order Detail sudah cukup? | **Cukup untuk MEMBUAT permintaan & (ADMIN) memproses langsung; TIDAK cukup untuk memutuskan permintaan PENDING milik kasir** |
| 8 | Refund/cancellation API sudah secure? | **Refund: YA.** Cancellation: **TIDAK** — Engine B melewatkan guard pembayaran (P0) |
| 9 | Tenant isolation aman? | **YA** — `restaurantId` selalu dari session, tidak ada kebocoran lintas tenant |
| 10 | Branch isolation aman? | **YA** — `authorizedBranches` + `branchId: { in }` + `NotFoundError` tanpa bocor keberadaan |
| 11 | Race protection aman? | **Engine A: YA** (`FOR UPDATE` + guarded `updateMany`). **Engine B & cancel-vs-webhook: TIDAK** (P0/P1) |
| 12 | Revenue/report semantics konsisten? | **Hampir** — semua report memakai `revenueWhere` + `computeRefundRevenue`; pengecualian: Cashier Sales `netSales` (P2) |
| 13 | Audit logging cukup? | **Engine A: YA (6 event).** Direct cancellation: **TIDAK ada event** (P1) |
| 14 | Migration diperlukan? | **TIDAK** — semua kolom/enum/index yang dibutuhkan sudah ada (§17) |
| 15 | GAP P0/P1/P2/P3? | **P0:** direct cancel of a paid order. **P1:** no approve/reject UI, Engine B unaudited, cancel-vs-webhook race. **P2:** quantity-refund UI, misleading dialog affordances, no history view, cashier-sales basis, no password rate limit. **P3:** optional index/unique hardening |
| 16 | Apa yang sebaiknya dikerjakan PHASE 7B? | Item 1-8 di atas (P0 guard dulu, lalu queue UI) — tanpa engine/migration baru |

### Evidence appendix (read-only)

* `refund` = 2 (1 `PENDING` Rp30.000 on `ORD-20260909-SOSJRL`, since `2026-09-09`, `paymentId` set, `shiftId` set; 1 `APPROVED` Rp30.000 on `ORD-20260907-BAF3ZT`) · `refunditem` = **0**
* `cancellationrequest` = **0**
* CANCELLED orders = **7**, **all** with a `null`-note CANCELLED history (Engine-B signature) and **0** refunds; 1 of them (`ORD-20260908-HCOK1L`, Rp90.000 QRIS) is `paymentStatus = PAID` with the QRIS payment still `PAID`, cancelled by `kasir@restobahagia.com` (**CASHIER**) at `2026-09-08T08:14:24Z`
* Fulfilled refund chain verified: `ORD-20260907-BAF3ZT` → Refund `APPROVED` → payment `REFUNDED` → order `paymentStatus = UNPAID` (order still `PROCESSING`, so no stock restore — correct per code)
* Prior PHASE 6B runtime: `dashboard.todayRevenue === getSalesReport().summary.totalSales` still holds (report semantics intact)
* `npx tsc --noEmit` = 0 · `git diff --check` = 0 · `git status --short` unchanged · `HEAD` = `d7f29ac`

## STOP

AUDIT ONLY — **no source modified, no schema/migration, no database write, no build artifacts touched, no commit, no push, no deploy.** Awaiting review before any PHASE 7B implementation.
