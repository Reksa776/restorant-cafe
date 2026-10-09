# PHASE1.5-PRINT-BILL-VALIDATION.md

> PHASE 1.5 — VERIFICATION ONLY. **No source code, schema, migration, commit,
> push or deploy was changed by this phase.** No full test suite was run, no
> production data was touched, and no new test infrastructure was created.
> The only artifact produced is this report.

---

## 1. Scope

Validate the **existing** Print Bill implementation (no code changes) against
the 21 requested cases, using code trace and existing artifacts because a live
browser runtime could not be safely executed in this environment (see §3).

Target implementation:
- `src/components/admin/orders/print-bill-dialog.tsx`
- `src/app/globals.css` (`@media print`)

Hosts:
- Admin Order Detail — `src/app/admin/orders/[orderNumber]/page.tsx`
- Admin Order Detail Sheet — `src/components/admin/orders/order-detail.tsx`
- Cashier Sales History — `src/app/admin/cashier/sales/page.tsx`

Excluded (do NOT fix this phase): product-name snapshot, customer-name
snapshot, hardcoded `"Pajak (10%)"`, thermal `@page` sizing, branch
address/phone. These are only documented if observed (§24–§25).

---

## 2. Existing Implementation

| Piece | Detail |
|---|---|
| Component | `PrintBillDialog` → `FullBill` (`Print All`) and `ProductTicket` (`Print Per Product`) |
| Render model | Pure client-side React; `window.print()`; a duplicate `billBody` is `createPortal`-ed to `<div id="print-root">` at the top of `<body>` |
| Print CSS | `globals.css` `@media print`: `body > *:not(#print-root){display:none!important}`; `#print-root{display:block!important}` |
| Paper | `paperWidthClass()`: A4 (`sm:max-w-[190mm]`), Thermal 80mm (`w-[72mm]`), Thermal 58mm (`w-[52mm]`) |
| Data source | The already-loaded, tenant-scoped admin `Order` payload; component imports **no** service/network layer |
| Payment source | `Payment.transactions[]` (incl. `type:"cashier_payment"` `rawData.amountReceived/changeAmount`) |
| Hooks (hosts) | All 3 hosts render `<PrintBillDialog order=... open=... onOpenChange=... />` |

Verified by grep: the dialog contains **no** `fetch`/`axios`/`api.`/`orderService`/
`paymentService`/`/api/` reference — only `window.print()` and `createPortal`.

---

## 3. Validation Environment

- **Method:** static code trace of the exact rendering logic + existing in-tree
  verification artifacts (`AUDIT-PRINT-VOUCHER-RECOMMENDATION-REPORT.md`,
  `AUDIT-FIX-TABLE-PRINT-STOCK-BRANCH-SELECT.md`).
- **Browser runtime:** **NOT RUN** in this environment. No dev server, no local
  database, and no authenticated session were started, and no production data
  was used. This is the fallback explicitly permitted by the brief ("gunakan
  code trace … jangan membuat test infrastructure baru").
- **Consequence:** every `PASS` below is a **static code-trace PASS** unless its
  Method line says otherwise. Pixel-level rendering, actual printer output and
  live HTTP/DB snapshots are stated as **NOT RUN** where they would be required
  for a runtime claim.
- **Fixtures:** none created; no DB writes; no permanent preview route.

---

## 4. Unpaid Order

**Status: PASS (static)**

- `PAYMENT_STATUS_LABEL["UNPAID"] = "Belum Bayar"` rendered from
  `order.paymentStatus`.
- Total rendered directly from `order.grandTotal` (server value).
- `paidAt` block renders only when `latestPayment.paidAt` is truthy — for an
  unpaid row it is null, so **no paidAt line** appears.
- Even when an `UNPAID` KASIR payment row exists, `getCashierAudit()` finds no
  `cashier_payment`/`PAID` transaction (created only on mark-paid), so no
  Uang Diterima/Kembalian is shown.

Method: code trace.

---

## 5. Cash Paid

**Status: PASS (static)**

- `latestPayment.method === "KASIR"` → `methodLabel = "Kasir"`.
- `getCashierAudit(latestPayment)` finds the transaction with
  `type === "cashier_payment" && status === "PAID"` and reads
  `rawData.amountReceived` and `rawData.changeAmount`.
- Those values are written server-side by
  `paymentService.markCashierPaymentPaid` in `paymenttransaction.rawData` — the
  bill reads them; **no new field/table needed**.
- Uang Diterima and Kembalian rows render from that audit.

Method: code trace (source-of-truth confirmed in `src/services/payment/payment.service.ts`).

---

## 6. QRIS Paid

**Status: PASS (static)**

- `paymentStatus = "PAID"` → `"Lunas"`.
- `latestPayment.method === "QRIS"` → `methodLabel = "QRIS"`.
- `latestPayment.paidAt` truthy → "Dibayar" line renders (localized).
- QRIS secrets (`providerRef`/`qrString`/`qrImage`/`paymentUrl`/`rawData`) are
  never referenced by the render path.

Method: code trace.

---

## 7. QRIS Pending

**Status: PASS (static)**

- `paymentStatus = "PENDING"` → `"Menunggu Pembayaran"`.
- method `"QRIS"` → `"QRIS"`.
- The block `!latestPayment.paidAt && latestPayment.expiresAt` renders
  "Berlaku s/d" with `expiresAt`, guarded against an invalid date via
  `Number.isNaN(new Date(...).getTime())`.

Method: code trace.

---

## 8. Dine In

**Status: PASS (static)**

- `ORDER_TYPE_LABEL["DINE_IN"] = "Dine In"` rendered from `order.orderType`.
- Table row renders only when `order.orderType === "DINE_IN" && order.table`,
  showing `order.table.name` and `order.table.number`.

Method: code trace.

---

## 9. Takeaway

**Status: PASS (static)**

- Type label `"Takeaway"` from `ORDER_TYPE_LABEL`.
- Table row is gated on `DINE_IN`, so **no meja row** is rendered for TAKEAWAY.

Method: code trace.

---

## 10. Delivery

**Status: PASS (static)**

- Type label `"Delivery"` from `ORDER_TYPE_LABEL`.
- Same DINE_IN-only gate → **no meja row**.

Method: code trace.

---

## 11. Customer / Guest

**Status: PASS (static)**

- Customer row renders `order.customer?.name || "Guest"`.
- `Customer.name` is nullable → null/empty falls back to `"Guest"`.
- Phone (incl. `guest-*` placeholders) is not rendered by the bill.

Method: code trace.

---

## 12. Discount / Promo

**Status: PASS (static)**

- `Number(order.discount) > 0` → "Diskon" row with `-{rupiah(order.discount)}`
  (server value, never recomputed).
- `order.promoCode` (non-empty) → "Promo" row with the stored code.

Method: code trace.

---

## 13. Tax

**Status: PASS (static)**

- `Number(order.tax) > 0` → row labelled `"Pajak (10%)"` with
  `rupiah(order.tax)`.
- Note: label is **hardcoded "(10%)"** while the amount is the server
  `order.tax`; if `order.tax === 0` the row is omitted. (Gap documented §25,
  not fixed.)

Method: code trace.

---

## 14. Service Charge

**Status: PASS (static)**

- `Number(order.serviceCharge) > 0` → "Service Charge" row with the server
  value. Omitted when 0.

Method: code trace.

---

## 15. Variant / Addon

**Status: PASS (static)**

- Variant: `customizations.selections[]` → `groupName: optionName`, plus the
  price adjustment when ≠ 0.
- Addon/modifier: `customizations.addons[]` → `+ name x{quantity}`.
- Both are parsed from the `OrderItem.customizations` snapshot (same JSON the
  order detail uses) — no new parsing logic.

Method: code trace.

---

## 16. Long Product Name

**Status: PASS (static) — with a documented edge case**

- Item row is `flex justify-between gap-2`; the product-name `<span>` wraps
  naturally at spaces, and the price cell is `tabular-nums whitespace-nowrap`
  so the amount never wraps mid-number.
- The bill body is width-bounded (`w-full sm:max-w-[190mm]` / `w-[72mm]` /
  `w-[52mm]`), so wrapping content cannot widen the printed page.
- **Unverified edge:** the name `<span>` has no `min-w-0`/`break-words`, so a
  single very long *unbroken* token could still overflow horizontally. This
  was not reproduced at runtime (see §25). Not fixed this phase.

Method: code trace; runtime pixel check NOT RUN.

---

## 17. Print All

**Status: PASS (static)**

- `mode === "all"` renders the single `FullBill`.
- On print, `@media print` hides every `<body>` child except `#print-root`
  (`display:none`), and `#print-root` is forced visible — so **only the bill**
  is visible in print media. The `#print-root` portal contains the same
  `billBody` (FullBill).

Method: code trace; actual print preview NOT RUN.

---

## 18. Print Per Product

**Status: PASS (static)**

- Tickets = `order.items.flatMap(item => Array.from({length: Math.max(item.quantity,1)}))`
  → **quantity N yields N tickets**.
- Each `ProductTicket` hardcodes `Qty: 1`.
- Every ticket except the last carries `print:break-after-page` → one page per
  unit; the last has no break.

Method: code trace; actual page count NOT RUN.

---

## 19. A4

**Status: PASS (static)**

- `paperWidthClass("a4") = "w-full sm:max-w-[190mm]"` (normal page width).
- Branding header (`BillHeader`) renders for both modes: `logoUrl` (if set),
  `siteName` (`order.restaurant.settings.siteName` → fallback `restaurant.name`),
  `address`, `phone`.
- Default paper state is `"a4"`.

Method: code trace; actual A4 print output NOT RUN.

---

## 20. Thermal 80mm

**Status: PASS (static)**

- `paperWidthClass("thermal80") = "mx-auto w-[72mm] max-w-[72mm]"` → narrow
  fixed-width box on screen and in print.
- Width is capped by `max-w-[72mm]`, so content cannot widen the box; long
  content wraps (see §16 edge case).

Method: code trace; actual 80mm output NOT RUN.

---

## 21. Thermal 58mm

**Status: PASS (static)**

- `paperWidthClass("thermal58") = "mx-auto w-[52mm] max-w-[52mm]"` → narrow
  fixed-width box.
- Same overflow considerations as §20.

Method: code trace; actual 58mm output NOT RUN.

---

## 22. Security / Tenant Isolation

**Status: PASS (static)**

- The dialog receives an `Order` already fetched through tenant-scoped
  endpoints:
  - `GET /api/orders/[id]` and `GET /api/orders/by-number/[orderNumber]` →
    `requireRoles(["ADMIN","CASHIER"])`; `restaurantId` from the session
    (`requireRestaurantContext`), branch scope via `authorizedBranches(ctx)` →
    `branchId: { in: [...] }`.
  - `x-branch-id` is a validated hint only, never an authority boundary.
- The print dialog itself makes **no** API call, so it cannot be used to fetch
  another tenant's order; a foreign order number/id resolves to not-found.
- No production data was used, and no authorization was bypassed.

Method: code trace; live unauthorized request NOT RUN (no runtime session).

---

## 23. No Side Effects

**Status: PASS (static)**

- Static trace of the dialog's executable surface: only `useState`,
  `createPortal`, `window.print()`, and rendering. Grep confirms **no**
  `fetch`/`axios`/service/`/api/` call inside
  `print-bill-dialog.tsx`.
- Therefore printing issues **no** network/DB write: it cannot change
  `Order.status`/`Order.paymentStatus`, cannot change `Payment.status`, and
  cannot create a `Payment` or `PaymentTransaction` row.
- Runtime before/after snapshot (recording counts around a real print) was
  **NOT RUN** because no runtime session/DB was available.

Method: code trace (no write path exists); runtime mutation snapshot NOT RUN.

---

## 24. Validation Result

Brief cases map to report sections §4–§23 (brief cases 12 "Variant" and 13
"Addon" share the single §15 section).

| Brief case | Case | Status | Method |
|---|---|---|---|
| 1 | Unpaid Order | PASS | static trace |
| 2 | Cash Paid | PASS | static trace |
| 3 | QRIS Paid | PASS | static trace |
| 4 | QRIS Pending | PASS | static trace |
| 5 | Dine In | PASS | static trace |
| 6 | Takeaway | PASS | static trace |
| 7 | Delivery | PASS | static trace |
| 8 | Customer / Guest | PASS | static trace |
| 9 | Discount / Promo | PASS | static trace |
| 10 | Tax | PASS | static trace |
| 11 | Service Charge | PASS | static trace |
| 12+13 | Variant / Addon | PASS | static trace |
| 14 | Long Product Name | PASS | static trace (unbroken-token edge unverified) |
| 15 | Print All | PASS | static trace |
| 16 | Print Per Product | PASS | static trace |
| 17 | A4 | PASS | static trace |
| 18 | Thermal 80mm | PASS | static trace |
| 19 | Thermal 58mm | PASS | static trace |
| 20 | Security / Tenant | PASS | static trace |
| 21 | No Side Effect | PASS | static trace (runtime snapshot NOT RUN) |

**Summary:** all 21 brief cases covered; **20/20 report sections PASS on static
code trace**. **0 FAIL, 0 BLOCKED.** Runtime-only aspects (actual print
rendering/pagination, live HTTP/DB mutation snapshot) are **NOT RUN** in this
environment and are not claimed as executed.

---

## 25. Known Limitations

Documented only — **not fixed** in this phase:

1. **Product name snapshot:** the bill prints live `item.product.name`; a
   renamed product changes on reprint.
2. **Customer name snapshot:** the bill prints live `order.customer.name`; a
   renamed customer changes on reprint. Fallback `"Guest"` works.
3. **Hardcoded `"Pajak (10%)"`:** the tax label is a literal while the amount
   is the server `order.tax`; a non-10% tax would be mislabelled.
4. **Thermal `@page` sizing:** no `@page { size: … }`; the operator must pick
   the paper size in the browser print dialog.
5. **Branch address/phone:** the bill shows the restaurant header, not the
   per-branch `Branch.address`/`phone`.
6. **Runtime verification:** all rendering/print/no-side-effect claims are
   static code-trace PASS; no browser, dev server, DB, or printer was used.
7. **Long unbroken product name:** the name span lacks `min-w-0`/`break-words`;
   a single very long unbroken token could overflow (not reproduced).
8. Tests: this repo has no automated test suite for the print flow, so no
   automated tests were run (consistent with prior phases).

---

## Final Confirmations

```
== git status ==
?? AUDIT-PRINT-BILL.md
?? PHASE1.5-PRINT-BILL-VALIDATION.md

== git diff --check ==
exit=0   (no whitespace/conflict errors)

== tracked/staged changes ==
(none)   git diff --name-only → empty
         git diff --cached --name-only → empty

== last commit ==
d7f29ac fix wa reservation (2026-10-07 16:48:21 +0700)   (pre-existing)
```

- **Source code unchanged:** ✅ — no tracked file modified (`git diff` empty);
  the only new entries are the two audit/validation markdown files.
- **Schema unchanged:** ✅ — `git diff --name-only -- prisma/` is empty;
  `prisma/schema.prisma` untouched.
- **Migration unchanged:** ✅ — no files under `prisma/migrations/` modified or
  added.
- **No commit:** ✅ — HEAD is still the pre-existing `d7f29ac`; no new commit
  created.
- **No push:** ✅ — no remote operation performed.
- **No deploy:** ✅ — no build/deploy command run.

> **STOP after report.** Nothing was implemented or fixed; no code, schema,
> migration, commit, push or deploy was performed, no production data was
> touched, and no expensive test suite was run.
