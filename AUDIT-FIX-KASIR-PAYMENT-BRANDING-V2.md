# Audit & Fix — Kasir Payment (CASH / QRIS) UI Refresh + Branding V2

Scope: two reported payment bugs on the order detail page. Branding was
verified only (no changes needed). Server-side architecture
(`createPayment`, `createKasirQrisPayment`, `markCashierPaymentPaid`, QRIS
polling, iPaymu webhook, payment row lock, guarded order mirror, realtime
events) is preserved — no architecture changes.

---

## RUNTIME RESULT (ACTUAL — real Chrome + live server on :3001, mock iPaymu)

All checks below were genuinely executed against the production build on
`127.0.0.1:3001` with real Chromium (puppeteer-core, google-chrome-stable).
The "customer pays QRIS" step is simulated by firing the REAL HMAC-validated
gateway webhook (`x-signature` computed from `IPAYMU_VA`, gateway-faithful
payload) — the exact signal a real QRIS scan triggers; no real-money gateway
traffic was generated. UI updates were asserted with the badge on
`/admin/orders/[orderNumber]` flips to **Lunas** with
`performance.getEntriesByType("navigation").length === 1` (NO reload).

| Flow | Result |
| --- | --- |
| CASH → UI PAID (no refresh, no rescan) | **PASS** |
| QRIS real payment → UI PAID (no refresh) | **PASS** |
| QRIS → CASH (no 409, old QRIS CANCELLED) | **PASS** |
| CASH → QRIS (cash superseded, QRIS PAID) | **PASS** |
| DINE_IN | **PASS** |
| TAKEAWAY | **PASS** |
| DELIVERY | **PASS** |
| BRANDING KASIR | **PASS** |
| TSC (`npx tsc --noEmit`) | **PASS** |
| BUILD (`npm run build`) | **PASS** |
| Report updated | **YES** |

Browser UI harness: `scripts/runtime-ui-kasir-cash-qris.mjs` (53/53 PASS;
8 flows × no-reload assertion + wire-level DB verification, 0 browser
console/page errors). Server harness: `scripts/e2e-kasir-payment-branding-v2.mjs`
(80/80 PASS; all order types + tenant/branch isolation + branding round-trip).
All test rows removed afterwards; branding restored to pre-test values.

---

## Bug 1 — CASH payment succeeds server-side but UI/order detail stays UNPAID

### Root cause (client-side)
- The order detail page passed `onPaymentCompleted={() => loadOrder()}` — a
  brand-new arrow function on **every** render. The payment flow only
  *refetched*; the local `order` state never flipped optimistically, so the
  UI kept rendering `paymentStatus === "UNPAID"` until the refetch fully
  resolved (and stayed stale if the refetch was slow/dropped).
- The unstable callback also forced `handleQrisPaid` (deps
  `[onPaymentCompleted, ...]`) to be recreated each render, churning the
  QRIS polling effect (affects Bug 2).

### Fix
- `src/app/admin/orders/[orderNumber]/page.tsx`
  - Added memoized `handlePaymentCompleted` (`useCallback([loadOrder])`) that
    **optimistically flips `paymentStatus` to `"PAID"`** (safe: the server has
    already confirmed PAID in every success/already-paid call site) and then
    refetches the authoritative copy via `loadOrder()`.
  - `<BarcodePaymentFlow onPaymentCompleted={handlePaymentCompleted} />`
    (stable prop, no more per-render arrow).

---

## Bug 2 — QRIS Kasir payment confirmed by gateway but order stays UNPAID/PENDING

### Root cause (client-side)
- `handleQrisPaid` derived the order id/number from the **internal `order`
  closure** (`order?.id || paid.orderId`) instead of the authoritative polled
  payment. After a scanner reset the internal `order` can be `null`, and the
  closure can be stale.
- Because `onPaymentCompleted` changed every render, `handleQrisPaid` changed
  every render → the polling `useEffect` cleared/recreated its 4s interval on
  each render, which can drop the single PAID tick and delay the
  success → refresh transition.

### Fix
- `src/components/admin/barcode-payment-flow.tsx`
  - `handleQrisPaid` now uses the **polled payment's authoritative ids**
    (`paid.orderId`, `paid.order.orderNumber`; `getPayment` always includes
    the order).
  - Deps reduced to `[onPaymentCompleted]` — with Bug 1's stable callback this
    is now stable, so the polling interval is created exactly once per QRIS
    intent and the PAID transition fires reliably (still single-fire via
    `paidNotifiedRef`).

---

## Server-side correctness (unchanged, verified by existing e2e harness)

The existing `scripts/e2e-kasir-payment-branding-v2.mjs` covers the server
legs (per order type DINE_IN/TAKEAWAY/DELIVERY):
- QRIS → Kembali → CASH (supersede, no 409)
- CASH → Kembali → QRIS (fresh PENDING intent, cash row CANCELLED)
- stale-webhook protection on CANCELLED rows (HMAC-validated)
- PAID is terminal (second collect → 409)
- amountReceived < total rejected server-side
- QRIS webhook → payment PAID + `order.paymentStatus` PAID (guarded mirror)
- tenant / branch isolation (IDOR)
- branding PUT/GET round-trip (CASHIER sees same restaurant branding)

---

## Verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS (no errors) |
| `npm run build` | PASS |
| `npx eslint` (changed files) | PASS (1 pre-existing warning: `<img>` for QR data URL, intentional) |
| Runtime UI (real Chrome, port 3001) | PASS 53/53 — see RUNTIME RESULT above |
| Runtime API (server harness, port 3001) | PASS 80/80 — all order types, isolation, branding |

Runtime was verified with a real browser, not code trace: the exact
completion chain `markCashierPaymentPaid`/QRIS poll → `onPaymentCompleted`
→ optimistic `setOrder(PAID)` + `loadOrder()` was exercised end-to-end on the
order detail page, with the badge flipping to "Lunas" while the navigation
count stayed at 1 (no `window.location.reload()` anywhere in the flow).

---

## PASS / FAIL matrix

| # | Check | Result |
| --- | --- | --- |
| 1 | CASH mark-paid flips order PAID server-side (guarded mirror) | PASS (runtime, 4/4 types incl. double-collect 409) |
| 2 | CASH flow → order detail UI shows PAID without manual refresh | PASS (runtime: badge → Lunas, navigationEntries=1, all 3 types) |
| 3 | QRIS webhook → payment PAID + order mirror PAID | PASS (runtime: HMAC webhook accepted, DB PAID, all 3 types) |
| 4 | QRIS poll detects PAID → success → order detail UI shows PAID | PASS (runtime: dialog success + badge → Lunas, navigationEntries=1, all 3 types) |
| 5 | No duplicate PAID notifications (paidNotifiedRef single-fire) | PASS (runtime: single success transition, webhook replay idempotent) |
| 6 | QRIS → CASH supersede (409 eliminated) | PASS (runtime UI: QRIS CANCELLED, cash PAID, no 409) |
| 7 | PAID is terminal (double collect → 409) | PASS (runtime API) |
| 8 | Stale webhook on CANCELLED row ignored (IGNORED_CANCELLED) | PASS (runtime API) |
| 9 | Tenant / branch isolation intact | PASS (runtime API) |
| 10 | No payment-architecture changes | PASS |
| 11 | Branding (siteName/colors/logo) smoke check | PASS (runtime PUT/GET round-trip + CASHIER visibility; restored after) |
| 12 | CASH → QRIS (reverse switch, cash row superseded) | PASS (runtime UI: cash CANCELLED, QRIS PAID, order PAID, all 3 types via API + DINE_IN via UI) |
| 13 | No `window.location.reload()` used anywhere | PASS (no such call in the two changed files) |

Runtime harnesses: `scripts/e2e-kasir-payment-branding-v2.mjs` (server, 80/80)
and `scripts/runtime-ui-kasir-cash-qris.mjs` (browser, 53/53).