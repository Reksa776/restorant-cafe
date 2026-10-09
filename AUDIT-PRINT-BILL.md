# AUDIT-PRINT-BILL.md

> PHASE 1 — AUDIT ONLY. **No source code, schema, migration, commit, push or
> deploy was changed by this audit.** The only artifact produced is this
> report.
>
> Scope: audit the PRINT BILL PESANAN feature against the existing
> restaurant/cafe stack (Next.js 16, TypeScript, Prisma 7, MySQL/MariaDB).
>
> **Headline finding:** a complete, already-verified **Print Bill** feature
> already exists in this repository and is wired into admin, cashier and
> order-detail flows. It renders a browser-print bill (A4 / thermal 80mm /
> thermal 58mm) purely client-side from the tenant-scoped admin order payload.
> It must be **reused, not rebuilt**. This report documents what exists, the
> (small) gaps, and the minimal optional follow-ups.

---

## 1. Existing Print Functionality

The feature is **already implemented** end-to-end.

| Concern | Where |
|---|---|
| Print component | `src/components/admin/orders/print-bill-dialog.tsx` (`PrintBillDialog`, `FullBill`, `ProductTicket`) |
| Print CSS | `src/app/globals.css` → `@media print { body > *:not(#print-root) { display:none } … }` |
| Trigger — admin order detail route | `src/app/admin/orders/[orderNumber]/page.tsx` (button + `PrintBillDialog`) |
| Trigger — admin orders list sheet | `src/components/admin/orders/order-detail.tsx` (button + `PrintBillDialog`) |
| Trigger — cashier sales history | `src/app/admin/cashier/sales/page.tsx` (buttons + `PrintBillDialog`) |
| Paper formats | A4, Thermal 80mm (72mm box), Thermal 58mm (52mm box) |
| Modes | `Print All` (full bill) and `Print Per Product` (one ticket per unit) |

Printing is **pure client-side**: `window.print()` renders `#print-root`
(portalled to `<body>`). There is **no print API route, no server-side PDF,
no printer service, and no hardware/printer dependency**.

No repository-wide search result for `receipt`, `invoice`, `thermal`,
`@page`, or a `print`/`cetak` API endpoint exists — **the print-bill dialog is
the one and only receipt/print engine**. There is consequently **no duplicate
receipt engine to worry about**, and none should be created.

Prior in-tree verification documents (context only, not authority):
`AUDIT-PRINT-VOUCHER-RECOMMENDATION-REPORT.md` (F1 per-product print),
`AUDIT-FIX-TABLE-PRINT-STOCK-BRANCH-SELECT.md` (print-root clipping fix,
A4/80/58 VERIFIED).

**Conclusion:** EXISTING — reuse.

---

## 2. Order Data Audit

Source of truth for an order read is `orderService.getOrder` /
`getOrderByNumberScoped` in `src/services/order/order.service.ts` (server,
Prisma). Client wrapper: `src/services/order.service.ts`.

Fields available on the payload (all confirmed present):

| Bill need | Field | Status |
|---|---|---|
| order number | `Order.orderNumber` | ✅ (unique per restaurant) |
| date/time | `Order.createdAt` | ✅ |
| order type | `Order.orderType` (`DINE_IN`/`TAKEAWAY`/`DELIVERY`) | ✅ |
| table | `Order.table { number, name }` | ✅ (nullable) |
| customer | `Order.customer { name, phone }` | ✅ (relation) |
| items | `Order.items[]` | ✅ |
| subtotal | `Order.subtotal` | ✅ |
| discount | `Order.discount` + `promoCode` | ✅ |
| tax | `Order.tax` | ✅ |
| service charge | `Order.serviceCharge` | ✅ |
| grand total | `Order.grandTotal` | ✅ |
| branch | `Order.branch { name, code }` | ✅ |
| restaurant header | `Order.restaurant { name, address, phone, settings{siteName,logoUrl} }` | ✅ |

The order detail endpoints exist and are already shaped for the bill
(`getOrder`, `getOrderByNumberScoped` both `include` customer, table, branch,
restaurant + settings, items + product, statusHistory, payments +
transactions). **All data required for a bill is available in one call.**

---

## 3. OrderItem Data Audit

`OrderItem` (`prisma/schema.prisma`): `orderId`, `productId`, `quantity`,
`unitPrice` Decimal(10,2), `totalPrice` Decimal(10,2), `notes`,
`customizations Json?`.

- Price snapshot at order time: ✅ `unitPrice` / `totalPrice` are stored.
- Quantity: ✅ stored.
- Variant / addon / modifier: ✅ stored inside `customizations` JSON as a
  snapshot (`selections[] { groupId, groupName, optionId, optionName,
  priceAdjustment }`, `addons[] { addonId, name, price, quantity }`, optional
  `notes`). The print dialog parses this same JSON (no new parsing logic).
- Product **name**: ⚠️ **not snapshotted** — the bill reads the live
  `Product.name` via the relation (see §11 Historical Accuracy).

---

## 4. Product / Variant / Modifier Audit

- `Product`: name, price, `isAvailable`, `isActive`, category — the live
  master. The bill renders `item.product.name`.
- **Variants**: there is **no `ProductVariant` model**. Variant choices are
  modelled as `ProductOptionGroup` → `ProductOption` (`priceAdjustment`).
- **Modifiers / add-ons**: `ProductAddon` (name, price). Optional mini-BOM
  (`AddonIngredient`, `OptionIngredient`) exists for costing only, not for the
  bill.
- The bill already renders selections (`groupName: optionName` + price
  adjustment) and addons (`+ name xN`), and notes.
- Confirmed: **no `ProductVariant` table exists**, so a bill must not be
  designed against one. The existing option/addon model is what the engine
  uses.

---

## 5. Customer Data Audit

- `Order.customerId` is **required** (`String`, relation to `Customer`).
- Guest orders get a `Customer` row: real normalized phone, or a placeholder
  `guest-<ts>-<rand>` when no phone is given (`order.service.ts`).
- `Customer.name` is **nullable** and **mutable**; `Customer.phone` may be a
  `guest-*` placeholder (the UI hides placeholder phones).
- The bill renders `order.customer?.name || "Guest"`.

**Source of truth for the customer NAME on the bill = the live
`Customer.name` relation. There is NO customer-name snapshot on `Order`.**
Consequence: if a customer record is renamed, a historical reprint shows the
new name. This is a documented gap (§11, §16), not a code defect.

---

## 6. Payment Data Audit

`Payment` model fields: `status` (`PaymentStatus`), `amount`, `method`
(`"KASIR"` / `"QRIS"` / null), `provider`, `providerRef`, `paymentUrl`,
`qrImage`, `qrString`, `paidAt`, `expiresAt`, `shiftId`, `transactions[]`.

`PaymentTransaction`: `provider`, `type`, `status`, `amount`, `rawData Json`.

Bill payment display (in `print-bill-dialog.tsx`):
- `order.paymentStatus` → localized label (Lunas / Menunggu Pembayaran /
  Belum Bayar / Gagal / Kedaluwarsa / Dikembalikan / Dibatalkan).
- Latest payment (newest first) → method label (`Kasir` / `QRIS` / `VA iPaymu`
  fallback), `paidAt`, and `expiresAt` when unpaid.
- **Never printed:** `providerRef`, `paymentUrl`, `qrString`, `qrImage`,
  `rawData`. This satisfies §10.

---

## 7. Cash Payment Audit

Cash receipt/change is **already persisted**, not on `Payment` directly but on
the audit transaction created by `paymentService.markCashierPaymentPaid`
(`src/services/payment/payment.service.ts`):

```
paymentTransaction.create({ provider: "cashier", type: "cashier_payment",
  status: "PAID", amount, rawData: { amountDue, amountReceived,
  changeAmount, processedBy, processedAt, shiftId? } })
```

The print dialog's `getCashierAudit()` finds the `cashier_payment`/`PAID`
transaction and reads `rawData.amountReceived` / `rawData.changeAmount`.
**Uang Diterima + Kembalian are printed.** No new field or table is needed —
the gap that the brief anticipated does **not** exist here.

---

## 8. QRIS Payment Audit

- QRIS state is represented by `Payment.status` (`PENDING` → `UNPAID`/`PAID`/
  `FAILED`/`EXPIRED`) and mirrored on `Order.paymentStatus`.
- The bill safely shows: `paymentStatus` label, method (`QRIS`), `paidAt`
  (when paid), and `expiresAt` (when pending). This is exactly the safe set
  the brief asks for (PAID/PENDING/FAILED + method + provider label).
- The bill deliberately does **not** print the QR image/string, providerRef,
  payment URL, or raw gateway payload. Provider is only used as a safe label
  (`VA iPaymu`) and never the secret.
- QRIS **pending** orders print "Menunggu Pembayaran / QRIS" (a customer can
  still pay at the counter/QRIS screen; the bill is informational only).

---

## 9. Restaurant Branding Audit

| Branding need | Field | Used by bill |
|---|---|---|
| display name | `RestaurantSettings.siteName` → fallback `Restaurant.name` | ✅ |
| logo | `RestaurantSettings.logoUrl` | ✅ (rendered, `next/image` disabled for arbitrary URL) |
| address | `Restaurant.address` | ✅ |
| phone | `Restaurant.phone` | ✅ |
| branch identity | `Order.branch { name, code }` | ✅ (name shown; code not printed) |
| theme colors | `RestaurantSettings.primaryColor/secondaryColor/accentColor` | n/a on print (B/W) |

**Gaps (optional, non-blocking):**
- No `taxRate` / `serviceChargeRate` / receipt header-footer / NPWP settings
  exist. The bill prints the literal label `"Pajak (10%)"` while the amount
  comes from `order.tax`. Consider a neutral `"Pajak"` label or a settings
  field before printing a hardcoded rate.
- Bill prints the **restaurant** address/phone; per-branch address/phone
  (`Branch.address/phone`) is not shown. Optional for multi-branch receipts.

---

## 10. Financial Source of Truth

Server-authoritative, stored on `Order` / `OrderItem`:

| Value | Source of truth |
|---|---|
| item price | `OrderItem.unitPrice` + `OrderItem.totalPrice` |
| quantity | `OrderItem.quantity` |
| subtotal | `Order.subtotal` |
| discount | `Order.discount` (+ `Order.promoCode` display) |
| tax | `Order.tax` |
| service charge | `Order.serviceCharge` |
| grand total | `Order.grandTotal` |
| amount paid | `Payment.amount` |
| cash received/change | `PaymentTransaction.rawData` (type `cashier_payment`) |

The print dialog **displays these stored values directly** and never
recomputes subtotal/tax/total in the browser. (One cosmetic comparison exists:
it decides whether to print an extra `@ unitPrice` line by comparing
`unitPrice` to `totalPrice/quantity` — a display check, not a re-derivation of
any total.) **Client is never trusted** — amounts are only rendered from the
server payload.

---

## 11. Historical Accuracy

| Change after order | Effect on reprint | Reason |
|---|---|---|
| Product **price** changes | ✅ accurate | `OrderItem.unitPrice`/`totalPrice` snapshotted |
| Product **deleted** | ✅ order row survives | `OrderItem.productId` FK is required/restrict; history kept |
| Product **name** changes | ⚠️ shows **new** name | bill reads live `item.product.name` (no snapshot) |
| Modifier/addon changes | ✅ accurate (if order stored `customizations`) | snapshot stored at order time |
| Customer **name** changes | ⚠️ shows **new** name | bill reads live `order.customer.name` (no snapshot) |
| Customer **deleted** | ✅ blocked by FK; order intact | `Order.customerId` required relation |
| Restaurant rebrand | changes on reprint (expected) | branding is intentionally live |

**Gap:** `OrderItem` has no `productName` snapshot and `Order` has no
`customerName` snapshot. Per the brief, **do not migrate now** — report the
gap. These are display-only long-term accuracy concerns.

---

## 12. Existing Order Detail

- `/admin/orders` list → `OrderDetail` right-side sheet
  (`order-detail.tsx`) with a **Print Bill** button → `PrintBillDialog`.
- `/admin/orders/[orderNumber]` (QR-scan landing) → full order page with a
  **Print Bill** button → `PrintBillDialog`.
- `/admin/cashier/sales` → **Cetak Bill** button per row and in the detail
  dialog → `PrintBillDialog`.

All three pass an already-fetched, tenant-scoped `Order` object. **No new page
is required** — the existing Order Detail is the correct host (§14 of brief).

---

## 13. Existing API

| Endpoint | Guard | Tenant scope |
|---|---|---|
| `GET /api/orders/[id]` | `requireRoles(["ADMIN","CASHIER"])` | `restaurantId` from session + `authorizedBranches` |
| `GET /api/orders/by-number/[orderNumber]` | `requireRoles(["ADMIN","CASHIER"])` | same |

Both return the full bill payload (restaurant+branding, items+product,
payments+transactions). The print component consumes these — **already
sufficient for the bill; REUSE**. No dedicated print endpoint is needed (and
none should be added).

`branchHintFrom` reads an `x-branch-id` **hint only**; authority is always
`requireRestaurantContext` → DB `UserBranch` assignments.

---

## 14. Existing Admin / Cashier UI

Optimal location (already implemented): **Orders → select Order → Detail
Order → Print Bill.** Not a new page. Buttons exist in the admin order detail
page, the order detail sheet, and the cashier sales history. No duplicate
action menus were introduced.

---

## 15. Print Architecture

- React component + `window.print()`; CSS `@media print` hides every
  `<body>` child except `#print-root` (portal target), so the navbar, sidebar,
  toolbar and dialogs never print.
- `Print All`: one continuous bill, paginates naturally on A4.
- `Print Per Product`: one ticket per unit (`quantity` 3 → 3 tickets), each
  with `print:break-after-page`; last ticket has no break.
- Paper widths via `paperWidthClass()`: A4 (screen max 190mm), 80mm→72mm box,
  58mm→52mm box.
- **No server-side printer system; no PDF generator.** Matches the brief's
  stated priority.

---

## 16. Thermal Printer Feasibility

- ✅ Already feasible and implemented at the **layout** level: 58mm and 80mm
  fixed-width classes render narrow tickets, and print media applies them.
- ⚠️ There is **no `@page { size: … }` rule**, so a thermal printer must be
  selected/set in the browser print dialog; the browser default page (A4) may
  add margins/scale. This is a cosmetic gap, not a functional one.
- Recommended H5/CSS: no hardware dependency. A future optional enhancement is
  `@page { size: 80mm auto; margin: 3mm }` scoped to a print wrapper, but it
  must not disturb the existing A4 path. **Not required now.**

---

## 17. Security / Tenant Isolation

- `restaurantId` is **never** taken from the client as authority; it comes from
  the session (`requireRestaurantContext`).
- Branch-scoped users are constrained via `authorizedBranches(ctx)` →
  `branchId: { in: [...] }`; an order from another branch/restaurant yields
  not-found (no data leak).
- The `x-branch-id` header is a validated hint, not a boundary.
- **IDOR:** direct order ID / order-number access requires ADMIN/CASHIER and
  is always filtered by `restaurantId` + branch scope → safe.
- Print shows no payment secrets (`providerRef`/`paymentUrl`/`qrString`/
  `qrImage`/`rawData` never printed) and hides placeholder `guest-*` phones
  (phone is not rendered by the bill at all; only name).
- **Print is read-only**: no server call is made at print time.

---

## 18. Side Effects

`window.print()` triggers no state change. Confirmed by code trace: the dialog
issues **no** API/DB write. Printing does **not**:
change Order status, change Payment status, create a Payment or
PaymentTransaction, touch inventory, modify a Customer, send WhatsApp, touch a
Reservation, or write an audit event. (No existing print-audit exists; none is
required.)

---

## 19. Database Impact

**Migration: NOT REQUIRED.**

Reasons:
1. All bill data already exists on `Order`, `OrderItem`, `Payment`,
   `PaymentTransaction`, `Customer`, `Restaurant`, `RestaurantSettings`,
   `Table`, `Branch`.
2. Cash received/change are already persisted in
   `PaymentTransaction.rawData.cashier_payment`.
3. The only missing items are **display snapshots** (product name / customer
   name), which are explicitly out of scope for this phase and must not be
   migrated before a separate decision.
4. The print path performs zero writes.

---

## 20. Files to Change

For the **core requirement (Print Bill)** — for completeness, but this is
already implemented:

**MUST CHANGE (new work):** none — the feature exists and satisfies the bill
requirements.

**OPTIONAL (only if the reviewer wants the polish items in §11/§16):**
- `src/components/admin/orders/print-bill-dialog.tsx` — e.g. neutral "Pajak"
  label instead of hardcoded "(10%)"; optional per-branch address; optional
  product/customer name snapshot fields if a later phase adds them to the
  payload.
- `src/app/globals.css` — optional scoped `@page` size for thermal.

**NEW FILES:** none required.

**DO NOT TOUCH:** see §21.

---

## 21. Files Not to Touch

- `src/services/order/order.service.ts` — order engine (read paths already
  provide the bill payload).
- `src/services/payment/payment.service.ts` + `providers/*` — payment engine,
  iPaymu, webhooks.
- `src/app/api/orders/*`, `src/app/api/payments/*` — reuse as-is.
- `prisma/schema.prisma` and `prisma/migrations/*` — no migration this phase.
- Reservation / WhatsApp / worker / refund / inventory / shift engines.

---

## 22. Implementation Plan

Because the feature exists, the plan is a **validation + optional-polish**
plan, not a build plan.

- **Phase A — data/source-of-truth:** no change. Confirm server values render
  (already true).
- **Phase B — API:** none. Reuse `GET /api/orders/by-number/[orderNumber]`
  and `GET /api/orders/[id]`.
- **Phase C — print component/template:** exists (`print-bill-dialog.tsx`).
- **Phase D — admin/cashier button:** exists (3 hosts).
- **Phase E — print CSS:** exists (`globals.css` `@media print`).
- **Phase F — verification:** run the manual/browser checks in §23 (see the
  brief's caution: no expensive full test suites).

**Minimal optional follow-ups (only if requested):** neutral tax label;
`@page` thermal sizing; snapshot columns (separate, migration-gated phase).

---

## 23. Test Plan

No test framework exists for this flow in-repo (consistent with prior audits),
so verification is browser + code-trace. Cases to exercise on the existing
dialog:

| # | Case | Expected |
|---|---|---|
| 1 | Unpaid order | "Belum Bayar"; no paidAt; total correct |
| 2 | Cash paid | method "Kasir", Uang Diterima + Kembalian from `rawData` |
| 3 | QRIS paid | "Lunas", method "QRIS", paidAt |
| 4 | QRIS pending | "Menunggu Pembayaran", method QRIS, expiry shown |
| 5 | DINE_IN | table name + number shown |
| 6 | TAKEAWAY | no table row; type label correct |
| 7 | DELIVERY | no table row; type label correct |
| 8 | Customer present | name printed |
| 9 | Customer absent/guest | "Guest"; no placeholder leakage |
| 10 | Discount | Diskon line + promo code, amounts from server |
| 11 | Tax | tax line from `order.tax` |
| 12 | Service charge | service line from `order.serviceCharge` |
| 13 | Variant (option) | `groupName: optionName` (+ price adj if ≠ 0) |
| 14 | Addon/modifier | `+ name xN` |
| 15 | Long product name | wraps, no clipping (print-root fix) |
| 16 | Deleted/changed product | order still renders; note name is live (§11) |
| 17 | Tenant isolation | cross-restaurant order number → 404/403 |
| 18 | Unauthorized admin/cashier | unauthenticated → 401; wrong role → 403 |
| 19 | Print does not mutate | order/payment status unchanged after print; 0 new DB rows |
| 20 | A4 / 80mm / 58mm | widths correct; only `#print-root` prints |
| 21 | Per-product mode | qty N → N pages, qty 1 each |

---

## 24. Risks / Regression

- **No code change proposed → no regression risk** to order/payment/
  reservation/iPaymu/webhook/WhatsApp/worker/refund/inventory engines.
- Residual **display** risks: live product/customer name on reprint (§11);
  hardcoded "(10%)" tax label (§9); no `@page` sizing for thermal (§16).
- Do **not** introduce a second receipt/printer engine or a print endpoint —
  that would be the real regression risk.
- Browser print is inherently environment-dependent (Chrome print emulation);
  the `#print-root` portal architecture already fixed the earlier clipping.

---

## 25. Final Recommendation

**REUSE the existing Print Bill feature. No implementation this phase.**

The brief's requirement is already met by `print-bill-dialog.tsx` + the
tenant-scoped admin order endpoints + the global print CSS. Only optional
cosmetic/reporting polish remains, and the historical-name snapshot gap must
be escalated as a separate decision (no migration now).

---

## Final Summary

**EXISTING:** A complete browser-print Print Bill exists — A4 + thermal
80/58mm, `Print All` + `Print Per Product`, branded header
(logo/siteName/address/phone), branch, order meta (number/date/type/table/
customer), items with variant/addon/notes, subtotal/discount(+promo code)/
tax/service charge/grand total, payment status/method/paidAt/expiry, cash
received/change, and a print-only CSS architecture (`#print-root`). Hosted in
admin order detail, admin order-detail sheet, and cashier sales. Fully
tenanted server-side and read-only.

**GAP:** (1) `OrderItem` has no product-name snapshot and `Order` has no
customer-name snapshot → reprints show live names; (2) ambiguous hardcoded
`"Pajak (10%)"` label; (3) no `@page` size for thermal; (4) bill shows
restaurant (not branch) address/phone. All display-only, non-blocking.

**REUSE:** `PrintBillDialog`/`FullBill`/`ProductTicket`
(`src/components/admin/orders/print-bill-dialog.tsx`); `globals.css`
`@media print`; `orderService.getOrder` /
`getOrderByNumberScoped`; `GET /api/orders/[id]` and
`GET /api/orders/by-number/[orderNumber]`; existing OrderDetail UI hosts;
`PaymentTransaction.rawData` cash audit; `RestaurantSettings` branding. No new
order/payment/receipt engine.

**MIGRATION:** NOT REQUIRED. All bill data already exists; cash
received/change already persisted in `PaymentTransaction.rawData`; print is
read-only.

**RISK:** LOW.

**RECOMMENDED IMPLEMENTATION (minimal):**
1. Do nothing for the core feature — validate the 21 cases in §23 in a browser
   and stop.
2. Optional cosmetic follow-ups (only if requested): neutral "Pajak" label;
   scoped `@page { size: 80mm auto }` for thermal; show branch address/phone
   when present.
3. Defer product/customer **name snapshots** to a separate, migration-gated
   phase with an explicit product decision.

> **STOP after audit.** Nothing was implemented, no schema/migration changed,
> no commit/push/deploy performed, no expensive test suite run.
