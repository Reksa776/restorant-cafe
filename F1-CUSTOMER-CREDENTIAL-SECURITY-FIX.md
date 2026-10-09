# F1 — CUSTOMER CREDENTIAL EXPOSURE SECURITY FIX

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (unchanged):** `d7f29ac`
**Date:** 2026-10-08
**Source:** `PHASE9B-POST-AUDIT.md` finding **F1**

---

## 1. Executive Summary

The HIGH finding **F1** is fixed. Every Order/Payment read path that previously used
`include: { customer: true }` now projects only the **public** customer fields `{ id, name, phone }`.
The customer bcrypt `password` hash and the internal `whatsappId` can no longer be serialized by
`GET /api/orders`, order detail/by-number, payment reads, or the order-status read path.

Verified at runtime: `GET /api/orders`, `GET /api/orders/[id]`, `GET /api/orders/by-number/[n]`,
`GET /api/payments`, `GET /api/payments/[id]`, `GET /api/orders/dashboard/stats` and the public
order route all return **no `password`, no `whatsappId`, and no `$2b$` marker**, while customer
`name`/`phone` are preserved on all 35 orders. `tsc` = 0 errors, `build` = exit 0, `git diff --check`
clean. No schema/migration/seed change; no unrelated refactor.

---

## 2. Finding F1

- **Severity:** HIGH
- **Description:** `GET /api/orders` and related Order/Payment service read paths serialized the
  customer relation with `include: { customer: true }`, returning **all** Customer scalars —
  including the bcrypt `password` hash and `whatsappId`.
- **Evidence (before):** `GET /api/orders?limit=100` returned 3 orders whose `customer.password`
  was a real bcrypt hash (`$2b$12$…`, 60 chars; customer `reksa@gmail.com`), and the customer key
  set was `{createdAt, email, id, isActive, name, password, phone, restaurantId, updatedAt, whatsappId}`.
- **Impact:** customer credential material (offline-crackable hash) and internal provider id exposed
  to any authenticated ADMIN client.

---

## 3. Root Cause

Prisma `include: { customer: true }` is an **unrestricted** relation load: it selects *every* scalar
column of the related `Customer` row. Because `Customer.password` (bcrypt) and `Customer.whatsappId`
are columns on that model, they were included in the Prisma result object and then serialized
verbatim by the API routes (`successResponse(order)`), which return the object as-is. There was no
DTO/serializer layer between the query and the HTTP response, so the projection (the query itself)
is the only place to withhold the fields.

---

## 4. Affected Files

- `src/services/order/order.service.ts`
- `src/services/payment/payment.service.ts`

(Confirmed by `grep -rn "customer: true" src` — no other production file contained the pattern. The
only remaining match is inside a test file, `src/services/reservation/reservation.purchase.test.ts`,
which does not affect API responses and is out of scope.)

---

## 5. Affected Functions

`src/services/order/order.service.ts` — 7 query sites + the payload type:

| Function | Site (pre-fix line) |
|---|---|
| `createOrder` | 507 |
| `persistCustomerOrder` | 1253 |
| `getOrders` (admin order list) | 1370 |
| `getOrder` (order detail) | 1431 |
| `getOrderByNumberScoped` | 1493 |
| `updateOrderStatus` (pre-read) | 1612 |
| `updateOrderStatus` (`fresh` re-read) | 1688 |
| `CreatedCustomerOrder` (payload type) | 124 |

`src/services/payment/payment.service.ts` — 2 query sites:

| Function | Site (pre-fix line) |
|---|---|
| `createPayment` | 55 |
| `createKasirQrisPayment` | 1275 |

---

## 6. Before Behavior

- `include: { customer: true }` on all 9 query sites + the `CreatedCustomerOrder` payload type.
- API responses serialized `customer.password` (bcrypt `$2b$12$…`) and `customer.whatsappId`.
- Runtime proof: 3 of 35 orders in `GET /api/orders` carried a non-null `customer.password`;
  nested customer keys included `password` and `whatsappId`.

---

## 7. Fix Applied

Replaced the unrestricted `include` with an explicit nested `select` on every affected site:

```ts
customer: { select: { id: true, name: true, phone: true } },
```

and updated the payload type to match:

```ts
export type CreatedCustomerOrder = Prisma.OrderGetPayload<{
  include: {
    customer: { select: { id: true; name: true; phone: true } };
    table: true;
    items: { include: { product: true } };
  };
}>;
```

Each site carries a short `F1 (security)` comment so the projection is not reverted to
`customer: true`. **No shared constant was introduced** — the repository already exposes a
`CUSTOMER_PUBLIC_SELECT` in `customer/customer.service.ts` (server-side Prisma), but importing it
into the Order/Payment engine would create an unwanted cross-module dependency for a 3-field
projection; a local explicit `select` is simpler and safer here (per the task's guidance). The
API-facing contract in `src/services/order/order.types.ts` already declares
`customer: { id; name; phone }`, so the new projection is the intended shape.

---

## 8. Selected Customer Fields

`{ id, name, phone }` — the minimum required by existing callers.

Verified required-field analysis (grep of all `.customer.` / `.customer?.` consumers): only
`name`, `phone` (and `id`) are read by the admin order list/detail, order card, kitchen ticket,
print bill/receipt, cashier pay dialog, dashboard, QRIS page, reservation detail, sales export and
the public order routes. `email` was **not** selected (no order/payment consumer reads
`order.customer.email`); `whatsappId` and `password` are never used by any consumer.

---

## 9. Sensitive Fields Removed

- `customer.password` (bcrypt hash) — removed everywhere.
- `customer.whatsappId` (internal provider id) — removed everywhere.
- Also no longer projected (harmless, not requesters): `restaurantId`, `createdAt`, `updatedAt`,
  `isActive`, `email` on the order-embedded customer object — matching the documented API contract.

---

## 10. Compatibility Verification

- `CreatedCustomerOrder` updated so `createCustomerOrder` / `createCustomerOrderInTransaction`
  return types still match the query projection (tsc confirms no misuse).
- All consumers compile and read only the retained fields; `order.types.ts` `AdminOrder.customer`
  (`{ id, name, phone }`) matches exactly.
- Runtime: every order in `GET /api/orders` still exposes a non-empty `customer.name`/`phone`
  (35/35); order totals, statuses and payment statuses are unchanged.
- No caller accessed `customer.email`, `customer.whatsappId` or `customer.password`.

---

## 11. Runtime Security Verification

Authenticated `next start` (ADMIN session). `password` / `whatsappId` / `$2b$` checks operate on the
**raw response body**, not just the status code:

| Endpoint | HTTP | `password` | `whatsappId` | `$2b$` | customer keys |
|---|---|---|---|---|---|
| `GET /api/orders?limit=100` | 200 | ❌ absent | ❌ absent | ❌ absent | `id, name, phone` |
| `GET /api/orders/[id]` | 200 | ❌ | ❌ | ❌ | `id, name, phone` |
| `GET /api/orders/by-number/[n]` | 200 | ❌ | ❌ | ❌ | `id, name, phone` |
| `GET /api/payments?limit=5` | 200 | ❌ | ❌ | ❌ | (no customer nested) |
| `GET /api/payments/[id]` | 200 | ❌ | ❌ | ❌ | — |
| `GET /api/orders/dashboard/stats` | 200 | ❌ | ❌ | ❌ | — |
| `GET /api/public/orders/[n]` | 200 | ❌ | ❌ | ❌ | `name` (as before) |

Before/after on the same endpoint (`GET /api/orders`): **`password` False, `whatsappId` False,
bcrypt False** (was `True` with a 60-char `$2b$12$…` hash). The registered customer `Reksa`
returns `{ id, name, phone }` with no credential field.

---

## 12. TypeScript Verification

`npx tsc --noEmit` → **0 errors** (exit 0). No `any` casts, no suppressions.

---

## 13. Build Verification

`npm run build` → **exit 0**. All routes compiled; the two modified service files are used by the
admin order/payment pages and the public order flow, which still build.

---

## 14. Git Diff Check

`git diff --check` → **clean** (exit 0).

F1 diff hunks (isolated from pre-existing PHASE 7B churn):
- `order.service.ts`: the `CreatedCustomerOrder` type + 7 `customer: true` → `customer: { select: … }`.
- `payment.service.ts`: 2 `customer: true` → `customer: { select: … }`.

`grep -n "customer: true"` on both files → **none remaining**.

---

## 15. Regression Verification

| System | Result |
|---|---|
| Order totals | ✅ unchanged (e.g. `subtotal 8000`, `grandTotal 9200`) |
| Payment status | ✅ present/unchanged |
| Refund logic | ✅ untouched (no refund code modified) |
| Revenue calculations | ✅ Sales Report unchanged: `totalSales 517000, grossSales 517000, paidOrders 16, totalRefund 30000, netSales 487000, AOV 32312.5` |
| Customer authentication | ✅ `customer-auth/*` untouched; `/api/customers` still `password`-free |
| Order authorization | ✅ `restaurantId`/`branchId` scoping untouched |
| Tenant isolation | ✅ untouched |
| Branch isolation | ✅ untouched |
| Reservation behavior | ✅ `reservation/*` untouched; `/api/admin/reservations` responds 200, no leak |
| Report calculations | ✅ `report.service.ts` untouched by F1 |
| WhatsApp behavior | ✅ still reads `order.customer?.phone`/`name` (retained); notifier untouched |

Only the customer **projection** changed; no business logic, arithmetic, or scope predicate changed.

---

## 16. Database Integrity

- No `prisma/` change (`git status --porcelain -- prisma/` empty); no migration, no seed, no schema edit.
- No production/historical data written. Verification was read-only (HTTP GETs); no temporary fixtures
  were required.
- No temporary files remain (`ls _p9b* _f1*` → none).
- `HEAD = d7f29ac`, staged files = 0. Nothing committed/pushed/deployed.

---

## 17. Scope Compliance

- Fixed **only** the F1 customer serialization exposure in the two named files.
- Explicitly **not** touched: F2 (reservation CSV cross-branch revenue), F3 (customer report branch
  semantics), F4 (canonical SQL duplication), F5 (order-count semantics), F6 (no-show timestamp),
  F7 (revenue date basis), F8 (cross-tenant fixture). No PHASE 10, no C7, no new reports, no schema,
  no migrations, no unrelated refactor.
- `whatsappId` remains in the client wrapper `Customer` type in `src/services/customer.service.ts`
  (an optional, unused type field) — left untouched to avoid unrelated churn; it is not serialized
  by any endpoint.

---

## 18. Files Modified

| File | Change |
|---|---|
| `src/services/order/order.service.ts` | `CreatedCustomerOrder` type + 7 query sites: `customer: true` → `customer: { select: { id, name, phone } }` |
| `src/services/payment/payment.service.ts` | 2 query sites: `customer: true` → `customer: { select: { id, name, phone } }` |

---

## 19. Remaining Findings

Unchanged from `PHASE9B-POST-AUDIT.md` and **out of scope** for this task:

| ID | Severity | Summary |
|---|---|---|
| F2 | LOW | Reservation CSV export vs report disagree on a cross-branch `orderId` |
| F3 | LOW | Customer report lists period-created customers regardless of branch |
| F4 | MEDIUM | Canonical revenue predicate duplicated in 4 report queries (refactor) |
| F5 | INFO | List `orderCount` (activity) vs `totalSpent` (canonical net) bases |
| F6 | INFO | No-show has no timestamp (funnel is a status snapshot) |
| F7 | INFO | Reservation revenue date basis differs from the business date |
| F8 | INFO | Cross-tenant `orderId` verified structurally (tenant B has no branch) |

---

## 20. Final Verdict

**PASS**

- ✅ `customer.password` no longer serialized (`GET /api/orders` and all verified Order/Payment read paths).
- ✅ `customer.whatsappId` no longer serialized.
- ✅ Affected functionality remains operational (name/phone preserved 35/35; order totals/status intact).
- ✅ `npx tsc --noEmit` passes (0 errors).
- ✅ `npm run build` passes (exit 0).
- ✅ `git diff --check` passes (clean).
- ✅ No unrelated scope changes (only the F1 projection).
- ✅ No migration/schema changes.

**STOP.**
