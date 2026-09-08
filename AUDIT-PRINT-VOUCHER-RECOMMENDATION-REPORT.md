# AUDIT-PRINT-VOUCHER-RECOMMENDATION-REPORT

> Audit-first implementation of four features on top of the EXISTING
> order / payment / promo / menu engines:
> **F1** Print Bill per product, **F2** Voucher preview → confirm flow,
> **F3** Admin-manipulable product recommendations, **F4** "Terlaris"
> (best sellers) section.
>
> No existing engine was rewritten. Customer QRIS, Kasir CASH/QRIS,
> barcode scanner, staff auth, middleware and the order engine are
> untouched except for the one required integration point: the promo
> code is now sent from checkout AFTER a confirmed voucher preview
> (the server still re-validates and recomputes everything).

---

## 1. Existing architecture audited

| Area | Files audited | Outcome |
|------|---------------|---------|
| Print bill | `src/components/admin/orders/print-bill-dialog.tsx`, `order-detail.tsx`, `getOrder`/`getOrderByNumberScoped` (restaurant + branding + items + payments + transactions) | Pure client-side `window.print()`, A4 / Thermal 58 / Thermal 80, no DB writes on print. |
| Order engine | `src/services/order/order.service.ts`, `order.types.ts`, `POST /api/public/orders` | Server-authoritative prices; promo applied + consumed INSIDE the order transaction with per-promo `FOR UPDATE`; guest checkout intact. |
| Promo engine | `src/services/promo/promo.service.ts`, `/api/public/promos*`, `/api/admin/promos*`, `Promo` + `PromoUsage` models | Race-safe claim (row lock), usage = `orderId` set, claim = `orderId` NULL. |
| Customer auth/session | `src/services/customer-auth/*`, `use-customer-auth.tsx`, `customer-session.server.ts` | Dedicated httpOnly signed cookie, separate from staff NextAuth; `tryGetCustomerSessionFromRequest` used by public endpoints. |
| Recommendations | `src/app/api/public/menu/recommendations/route.ts` | Automatic only: customer favorites → co-occurrence → best seller → active-product fallback. |
| Reports / aggregation | `src/services/report/report.service.ts` | "Sold" predicate = `status != CANCELLED AND paymentStatus = PAID`. |
| Migration history | `prisma/migrations` | `0_baseline`-era history + 5 named migrations, latest `20260909_add_customer_auth_promo`. No P3018 currently unresolved in-tree; **no reset, no rewrite, no record deletion** was performed. |

## 2. Print Bill current architecture

- Opened from the Order Detail sheet; builds the bill **entirely from the
  already-loaded admin order** (`getOrder`, tenant-scoped).
- `window.print()`; the toolbar is `print:hidden`; the bill is
  `print:absolute print:inset-0 print:w-full` so only the bill prints.
- Paper formats A4 / Thermal 80mm (72mm box) / Thermal 58mm (52mm box).
- Prints restaurant header (branding logo/site name/address/phone), order
  meta, items + customizations, totals, payment status/method + cashier
  audit (received/change). Never prints payment secrets
  (providerRef / qrString / paymentUrl).
- **No database record is created and no order/payment status is changed
  by printing** (unchanged).

## 3. Print-per-product implementation

`print-bill-dialog.tsx` now has a mode selector:

```
[ PRINT ALL ]  [ PRINT PER PRODUCT ]   |   [ A4 ] [ Thermal 80mm ] [ Thermal 58mm ]  [ Cetak ]
```

- **Print All** — unchanged full bill.
- **Print Per Product** — every order item is expanded into **one ticket
  per UNIT**: quantity 3 → 3 individual tickets, each `Qty: 1`. Each
  ticket is a separate printed page via `print:break-after-page` (last
  ticket has no break).
- Ticket content (kitchen/outlet matching, **no totals, no payment info**):
  product name, `Qty: 1`, order number, time, order type, table (DINE_IN),
  customer name, variant selections (group: option), addons (`+ name xN`),
  item notes, footer order number.
- Customization information always follows the ticket (selections/addons/
  notes parsed from the same `customizations` JSON the order detail page
  uses — no new parsing logic).
- All three paper formats apply to per-product tickets; thermal widths are
  reused unchanged. One item = one page/ticket, so two different products
  can never share a ticket.
- Browser print pagination is used (no server-side PDF generator).

## 4. Voucher current architecture (before F2)

- Promo has `type PERCENT/FIXED`, `value`, `minOrder`, `maxDiscount`,
  `startsAt/expiresAt`, `maxUsage`, `perCustomerLimit`, `isActive`.
- `PromoUsage`: claim row (`orderId` NULL) reserves a promo; use row
  (`orderId` set) consumes it. Quota + per-customer limits enforced under
  a per-promo `SELECT … FOR UPDATE` row lock.
- Checkout previously had a single promo-code input; the code was sent with
  the order and validated/applied/consumed in one step at order creation.
- Guest checkout works without a promo; promos require a logged-in customer
  (order creation throws `UnauthorizedError` when a `promoCode` is sent
  without a valid session).

## 5. Voucher preview / selection / confirmation flow (F2)

New two-stage UX on `/checkout`:

1. **Guest** — sees "Masuk akun di halaman menu untuk memakai voucher";
   checkout continues without a voucher.
2. **Logged-in customer** — Voucher block shows:
   - **Voucher Saya** (claimed vouchers, from `/public/promos` claimed
     flags computed server-side from the session cookie) — each with
     discount label, min order, expiry, and a **Pilih** button; or
   - **Masukkan kode voucher** input + **Cek Voucher** button.
3. Either path calls the new **non-mutating** endpoint
   `POST /api/public/promos/validate` (`promoCode` + advisory cart
   subtotal). The server re-validates against the DB (active, window,
   minOrder, global quota, per-customer usage limit) and returns the
   authoritative discount + `finalSubtotal` preview.
4. **Preview card** shows code, discount label, Potongan, Total setelah
   diskon with **[ Ganti Voucher ] [ Konfirmasi Voucher ]**.
5. **Konfirmasi Voucher** sets the confirmed voucher state; the order
   summary shows `Voucher: CODE`, `Diskon: -Rp`, and the discounted total
   (tax/service recomputed on the discounted base for TAKEAWAY/DELIVERY,
   same as the server).
6. **Buat Pesanan** sends only the confirmed `promoCode`. The client never
   sends a discount amount; a client-side "confirmed" flag is NEVER
   authorization — order creation re-validates everything authoritatively.

**API:** `POST /api/public/promos/validate` — requires customer session,
tenant-scoped (promo must belong to the session's restaurant), rate-limited
(60/min/IP), returns the same validation errors the order path would throw
(clear invalid/expired/minOrder/quota/per-customer messages).

## 6. Promo transaction / quota safety

**Unchanged** (preserved, not re-implemented):

- Quota/per-customer consumption happens ONLY inside the order-creation
  transaction (`applyPromoToOrder` + `recordPromoUse` in
  `createCustomerOrder`). A failed order rolls back the whole transaction,
  so no dangling `PromoUsage` is left behind.
- Preview NEVER creates `PromoUsage` and NEVER consumes quota (no write at
  all).
- Race safety: per-promo `FOR UPDATE` row lock serializes claims and uses;
  duplicate claims rejected (`ConflictError`); reused voucher blocked by
  the per-customer usage count.
- Cross-restaurant voucher use is impossible: promo lookup is always
  `{ code, restaurantId }` with `restaurantId` from the verified session /
  admin context.
- Order creation path is byte-for-byte the same validation the previous
  flow used — only the checkout UX moved the send point to after a
  confirmed preview.

## 7. Recommendation architecture

### Before (automatic only)
1. customer favorites (session cookie) → 2. co-occurrence (productId) →
3. best sellers (non-cancelled) → 4. active-product fallback.

### After (F3) — manual tier added, automatic tiers preserved
1. **MANUAL admin recommendations** (new, highest priority)
2. Personalized (customer favorites — preserved)
3. Frequently bought together (preserved)
4. Best sellers (preserved)
5. Active product fallback (preserved)

New model `ProductRecommendation` (tenant-scoped):

```
id, restaurantId, productId, recommendedProductId,
sortOrder, isActive, createdAt, updatedAt
UNIQUE (restaurantId, productId, recommendedProductId)
```

Meaning: "product A (productId) recommends product B
(recommendedProductId)". One row per pair; `sortOrder` controls order;
`isActive` enables/disables without deleting. On the menu page (no product
context) all curated rows for the restaurant are collected (deduped) and
shown first; with a `productId` context only that product's curated list is
used. Public display additionally filters to active rows where the
recommended product is `isActive AND isAvailable`.

## 8. Admin recommendation management

- **UI:** new **Rekomendasi** tab on `/admin/menu` (no new sidebar entry —
  avoids duplicate nav sections).
- Features: pick source product (active products only), add products
  (active + available only, same restaurant, not already listed, not
  itself), reorder (▲/▼), enable/disable toggle, remove, dirty indicator
  and a single **Simpan**.
- **API:** `GET/PUT /api/admin/recommendations` (ADMIN only,
  tenant-scoped). `PUT` is a **transactional replace** — add / reorder /
  toggle / remove all commit atomically; array order becomes `sortOrder`.
  The server re-validates every target (`restaurantId`, `isActive`,
  `isAvailable`, no self-recommendation, no duplicates), so cross-restaurant
  or inactive/unavailable config is rejected.
- Shared engine extracted to `src/services/recommendation/recommendation.service.ts`
  (admin CRUD + public tiers + best-seller aggregation); the public
  `/api/public/menu/recommendations` route now delegates to it (the old
  inline aggregation was removed — no duplicated logic).

## 9. Best seller implementation (F4 "Terlaris")

- New `GET /api/public/menu/best-sellers?restaurantId=&categoryId=&limit=&excludeIds=`.
- Uses the shared `getBestSellers` aggregation with `requirePaid: true`:
  **only PAID orders**, CANCELLED excluded, ACTIVE + AVAILABLE products
  only, restaurant-scoped, `SUM(quantity)` descending.
- Response: `{ products: [{ product, totalSold, rank }] }` — no customer
  PII, no internal order/payment IDs (same product shape as `/public/menu`).
- The recommendation engine's best-seller tier keeps its existing
  non-cancelled semantics (behavior preserved); the Terlaris section uses
  the stricter PAID-only definition — parameterized in one shared helper
  instead of duplicating logic.
- Customer menu renders **🔥 Terlaris** as a separate section after
  Rekomendasi and before the category sections, passing the recommendation
  ids via `excludeIds` so the two sections avoid duplicates when enough
  different products exist.
- No sales history → empty list → the section simply hides (no fabricated
  "best sellers").

## 10. Tenant / security verification

- **Admin endpoints** (`/api/admin/recommendations`): `requireAdmin()`;
  `restaurantId` always derived from the session, never from the body.
- **Customer endpoints** (`/api/public/promos/validate`,
  `/api/public/menu/recommendations`, `/api/public/menu/best-sellers`):
  `restaurantId` validated against an active Restaurant; customer identity
  comes from the httpOnly session cookie and is re-verified against the
  restaurant before use (personalization only).
- Voucher validation is scoped to `session.restaurantId` — a promo from
  another restaurant can never be validated/applied.
- Recommendation targets must belong to the SAME restaurant and be
  active + available (admin write-time AND public read-time).
- Best sellers are restaurant-scoped; `excludeIds` cannot leak other
  tenants' products (ids are only used to filter this restaurant's rows).
- No `any` / unsafe casts introduced; no new auth bypass; middleware and
  staff NextAuth untouched.

## 11. Tests and results

- `npx tsc --noEmit` — **PASS (0 errors)**.
- `npm run build` — **PASS** (exit 0; all routes compile, including the 4
  new/changed routes).
- `npx eslint` on all changed files — **0 NEW errors**; the 4 remaining
  errors in changed files are pre-existing (verified by stashing: the
  original checkout/menu/admin-menu files lint with 8 errors, none of which
  are in code introduced by this change).
- No test framework exists in this repo; per the previous audit's practice,
  verification is static (code-trace) + build. The existing Puppeteer suite
  (`scripts/e2e-dine-in-payment.mjs`) does not cover these features.

### F1 code-trace matrix
| Case | Result |
|------|--------|
| qty 1 | ✅ 1 ticket, Qty 1, break-after only when more tickets follow |
| qty 3 | ✅ 3 individual tickets (flatMap over `quantity`) |
| variant (selections) | ✅ rendered `groupName: optionName` |
| addon | ✅ `+ name xN` |
| notes | ✅ `Catatan:` line (item notes + customization notes) |
| DINE_IN / TAKEAWAY / DELIVERY | ✅ order type label; table only for DINE_IN |
| print doesn't change status/payment | ✅ pure client-side render, no API/DB writes |
| each quantity → individual page | ✅ `print:break-after-page` per ticket |
| thermal 58/80 | ✅ same width classes as Print All |

### F2 code-trace matrix
| Case | Result |
|------|--------|
| guest cannot use voucher | ✅ UI hides picker; server `getCustomerSessionFromRequest` throws 401; order path `UnauthorizedError` |
| see claimed vouchers | ✅ "Voucher Saya" from `/public/promos` claimed flags |
| claim voucher | ✅ existing `/public/promos/[id]/claim` unchanged |
| select claimed / enter code | ✅ both paths call `/public/promos/validate` |
| preview valid / invalid / expired / minOrder / maxDiscount / quota / perCustomerLimit | ✅ all validated server-side in `validatePromoPreview` (same rules as apply) |
| duplicate claim | ✅ existing claim limit (unchanged) |
| confirmed voucher | ✅ client state only; order sends `promoCode` |
| create order | ✅ authoritative re-validation + consumption in transaction |
| failed order doesn't consume | ✅ PromoUsage written inside the order transaction |
| concurrent redemption | ✅ existing per-promo `FOR UPDATE` (unchanged) |
| cross-restaurant isolation | ✅ promo lookup scoped to session `restaurantId` |

### F3 code-trace matrix
| Case | Result |
|------|--------|
| admin creates manual recommendation | ✅ PUT replace creates rows with `sortOrder` |
| appears publicly | ✅ manual tier first in `/public/menu/recommendations` |
| admin reorders | ✅ array order → `sortOrder` (atomic replace) |
| disable | ✅ `isActive` toggle; public filters `isActive` |
| delete | ✅ removed from payload → rows deleted in replace |
| cross-restaurant blocked | ✅ server validates every target's `restaurantId` |
| inactive/unavailable target | ✅ rejected at save AND filtered at read |
| automatic fallback still works | ✅ tiers 2–5 preserved |

### F4 code-trace matrix
| Case | Result |
|------|--------|
| PAID contributes / CANCELLED doesn't / UNPAID doesn't | ✅ `status != CANCELLED AND paymentStatus = PAID` |
| quantity aggregation correct | ✅ `SUM(quantity)` desc |
| restaurant isolation | ✅ `restaurantId` in order where |
| inactive product hidden | ✅ `loadProducts` requires `isActive + isAvailable` |
| no-sales fallback | ✅ empty list → section hidden |
| recommendation vs Terlaris dedupe | ✅ `excludeIds` = recommendation ids |

## 12. Files changed

| File | Change |
|------|--------|
| `src/components/admin/orders/print-bill-dialog.tsx` | F1: Print All / Print Per Product modes; per-unit tickets (`Qty: 1`, one page each via `break-after: page`); shared header; paper formats apply to both modes. |
| `src/services/promo/promo.service.ts` | F2: `validatePromoPreview` — non-mutating server-side validation + discount math (no PromoUsage, no quota). |
| `src/app/api/public/promos/validate/route.ts` | NEW F2 endpoint (session required, tenant-scoped, rate-limited). |
| `src/app/(customer)/checkout/page.tsx` | F2: Voucher Saya / pilih / kode / Cek Voucher / preview / Konfirmasi Voucher / discounted summary; submits confirmed `promoCode` only. |
| `prisma/schema.prisma` | F3: `ProductRecommendation` model + Product/Restaurant relations. |
| `prisma/migrations/20260910_add_product_recommendations/migration.sql` | NEW additive migration (table + FKs + unique index). |
| `src/services/recommendation/recommendation.service.ts` | NEW server service: admin CRUD (list/save replace) + public tiered engine + shared best-seller/bought-together/favorites/fallback aggregations. |
| `src/services/recommendation.service.ts` | NEW browser API wrapper (LOW-1 pattern). |
| `src/app/api/admin/recommendations/route.ts` | NEW ADMIN GET/PUT (requireAdmin, tenant-scoped). |
| `src/app/api/public/menu/recommendations/route.ts` | Refactored to delegate to the service; manual tier now first. |
| `src/app/api/public/menu/best-sellers/route.ts` | NEW F4 endpoint (PAID-only aggregation, `totalSold` + `rank`). |
| `src/app/admin/menu/page.tsx` | F3: **Rekomendasi** tab (source product, add/reorder/toggle/remove/save). |
| `src/app/(customer)/menu/page.tsx` | F4: **🔥 Terlaris** section after Rekomendasi; `excludeIds` dedupe; section order Promo → Rekomendasi → Terlaris → Categories. |

**Intentionally preserved / untouched:** `src/services/order/order.service.ts`
(order engine incl. promo-in-transaction), payment services + gateway +
webhook, `middleware.ts`, `auth.config.ts` + staff auth helpers, customer
auth service/session lib, claim endpoint, admin promos routes, promo/menu/
report engines, and the migration history (old migrations not modified).

## 13. Database migration required

- New additive migration only: `20260910_add_product_recommendations`
  (creates `productrecommendation` table; no existing rows/tables touched).
- In-tree migration history is intact (no P3018 currently outstanding in
  this checkout). Old migrations were NOT modified, no records deleted.
- **Production command:** `npx prisma migrate deploy`
  (applies only the new migration; never `prisma migrate reset`).
- If production still has an unresolved `0_baseline`/P3018 history issue,
  that must be resolved by the ops team first (per the project's known
  history) — it is unrelated to this change and was not "repaired" here.

## 14. Remaining risks / manual tests

1. **Runtime browser tests still required** (not claimed as done):
   - F1: print dialog on a live admin order — verify Print All unchanged,
     Print Per Product produces 1 page per unit (qty 3 → 3 pages), thermal
     58/80 layouts, and that printing does not alter order/payment status.
   - F2: full voucher journey in a live browser — login, claim, Voucher
     Saya, code entry, preview, confirm, order creation with discount;
     expired/minOrder/quota/per-customer failures; guest checkout.
   - F3: admin Rekomendasi tab against a seeded DB — save, reorder,
     toggle, remove, cross-restaurant rejection, public priority order.
   - F4: Terlaris with seeded PAID/UNPAID/CANCELLED orders — aggregation,
     restaurant isolation, inactive product hiding, dedupe vs Rekomendasi.
2. **Migration deploy on a copy of production data** before applying to
   prod (`prisma migrate deploy` + `prisma migrate status` check).
3. Full-repo lint debt (pre-existing errors) remains out of scope.

---

## Final Status

**READY FOR TESTING** — all four features implemented on the existing
engines with zero new lint errors, `tsc` and `build` passing. Runtime
(gateway-independent) browser verification of print pagination, voucher
flow, recommendation admin UI and Terlaris aggregation is still required
before any production claim.