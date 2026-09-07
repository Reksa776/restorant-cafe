# AUDIT-REPAYMENT-KASIR-QRIS-REPORT

> Kasir (outlet dashboard) Cash + QRIS payment flow.
> Both payment contexts (customer website vs outlet Kasir) verified against the
> backend contract before any change. Audit-first, then only the required
> changes were made and verified with `tsc`, `build`, and `lint`.

---

## 1. Customer QRIS Status

**UNCHANGED / INTACT.**

Customer website QRIS is the existing flow and was NOT modified:

- `POST /api/public/payments` (`src/app/api/public/payments/route.ts`) with
  `method: "QRIS"` — still DINE_IN-only, still rate-limited (30/min/IP), still
  amount-recomputed server-side from the order row.
- Customer payment page `src/app/(customer)/payment/[orderNumber]/page.tsx` —
  QR render, 4s polling, effective-expiry (local EXPIRED), PAID/FAILED/EXPIRED
  terminal handling, "Bayar ke Kasir" fallback: **untouched**.
- Customer checkout `src/app/(customer)/checkout/page.tsx` — QRIS (default) /
  KASIR selection for DINE_IN, legacy VA for TAKEAWAY/DELIVERY: **untouched**.
- `POST /api/public/payments/[orderNumber]/switch-to-cashier` — DINE_IN-only
  guard preserved.

Customer QRIS can never become a KASIR payment: the public route only ever maps
`method` → `createPayment` for the customer order and keeps the DINE_IN guard.

## 2. Kasir Cash Status

**IMPLEMENTED — reuses the existing engine.**

Single cash engine only (`markCashierPaymentPaid`, server
`src/services/payment/payment.service.ts`; route
`src/app/api/payments/[id]/mark-paid/route.ts`). No second cash engine was
created.

Flow (Kasir → CASH):
1. `POST /api/payments` with `{ orderId, method: "KASIR" }` →
   `createPayment(..., { method: "KASIR" })` records an **UNPAID** row
   (amount = `order.grandTotal`, recomputed server-side; no gateway). Existing
   UNPAID KASIR row is returned idempotently.
2. Cashier enters `amountReceived`.
3. `POST /api/payments/[id]/mark-paid`:
   - `amountReceived < amountDue` → `ValidationError` (rejected before any write).
   - Guarded `updateMany({ status: "UNPAID" })` → double-pay impossible (lost
     race returns `alreadyPaid` → HTTP 409).
   - CASHIER role requires an OPEN own shift; cross-drawer payment blocked;
     payment linked to the acting cashier's shift.
   - `PaymentTransaction` audit row written (`amountDue/amountReceived/
     changeAmount/processedBy/processedAt/shiftId`). Order mirrored to PAID.
4. Receipt (total / diterima / kembalian) shown in UI.

## 3. Kasir QRIS Status

**IMPLEMENTED — reuses the existing engine.**

Single QRIS engine only (`createKasirQrisPayment`, server
`src/services/payment/payment.service.ts:1009`; iPaymu provider; webhook). No
second QRIS engine was created.

Flow (Kasir → QRIS):
1. `POST /api/payments` with `{ orderNumber, method: "QRIS" }` →
   `createKasirQrisPayment(orderNumber, restaurantId)` (authenticated,
   restaurant-scoped lookup; NOT the public lookup).
2. Idempotency / lifecycle:
   - already **PAID** (order or any payment) → `ConflictError "Order already paid"`.
   - existing UNPAID **KASIR** row → returned as `kasir_existing` (UI routes to
     the cash form — never a silent second intent).
   - valid **PENDING** payment (not expired) → reused as `pending_existing`
     (no duplicate gateway call).
   - **FAILED** / **EXPIRED** / stale-PENDING (expiry passed) → stale rows
     flipped to EXPIRED, then a new QRIS intent created (`qris_created`).
   - per-order `FOR UPDATE` row lock in `createPayment` serializes concurrent
     creations → **duplicate request protection**.
3. UI shows QR (gateway `qrImage` preferred, `qrString` payload rendered via the
   existing `qrcode` lib as fallback), amount due, status, expiry countdown
   (1s tick), 4s polling via `paymentService.getPayment(id)`.
4. **PAID** detected via polling → single-fire success transition; **FAILED /
   EXPIRED** detected → "Buat QRIS Baru" retry button; webhook → PAID is the
   server-authoritative status that polling picks up.

## 4. Payment Context Separation

Verified against the backend contract — the `method` field is the discriminator:

| Context | Route | Body `method` | Service call |
|---------|-------|---------------|--------------|
| CUSTOMER + QRIS | `POST /api/public/payments` | `"QRIS"` (DINE_IN only) | `createPayment(..., { method: "QRIS" })` |
| CUSTOMER + KASIR | `POST /api/public/payments` | `"KASIR"` (DINE_IN only) | `createPayment(..., { method: "KASIR" })` |
| CUSTOMER legacy VA | `POST /api/public/payments` | absent (TAKEAWAY/DELIVERY) | `createPayment(..., undefined)` |
| **KASIR + CASH** | `POST /api/payments` (auth) | `"KASIR"` | `createPayment(..., { method: "KASIR" })` |
| **KASIR + QRIS** | `POST /api/payments` (auth) | `"QRIS"` | `createKasirQrisPayment(orderNumber, restaurantId)` |

- There is **no `VA`/`KASIR` channel ambiguity**: `POST /api/payments` requires
  ADMIN/CASHIER auth, validates `method` ∈ {`QRIS`, `KASIR`}, forwards it to
  `createPayment` on the orderId path, and routes `orderNumber + QRIS` to
  `createKasirQrisPayment`. An absent `method` keeps the legacy VA path — this
  is the fixed behavior verified below (§7).
- Kasir QRIS is a **QRIS** payment with `provider: "ipaymu"`, `method: "QRIS"`
  — never VA, never customer, never cash.
- Kasir Cash is an **UNPAID** payment with `method: "KASIR"`, `provider: null` —
  never a gateway payment.

## 5. OrderType Support

`createKasirQrisPayment` has **no OrderType guard**; `createPayment` with
`method: "KASIR"`/`"QRIS"` also has no OrderType guard. Both engines work for
every existing `OrderType`:

| Order Type | Cash | QRIS |
| ---------- | ---- | ---- |
| DINE_IN    | YES  | YES  |
| TAKEAWAY   | YES  | YES  |
| DELIVERY   | YES  | YES  |

Kasir QRIS is **not** restricted to DINE_IN. The customer flow (public route,
checkout `paymentMethod`, `switchToCashier`) remains DINE_IN-only — untouched.

## 6. Files Changed

| File | Change |
|------|--------|
| `src/components/admin/barcode-payment-flow.tsx` | Added optional controlled `open` / `onOpenChange` props (external "Bayar" trigger, self-managed by default); kept "Proses Pembayaran" selection title. Flow already contained the full CASH + QRIS screens, cash form (received/change/validation), QRIS QR render + countdown + 4s polling, single-fire PAID handler, FAILED/EXPIRED retry, and Kembali buttons. |
| `src/app/admin/orders/[orderNumber]/page.tsx` | Re-wired the previously dead "Scan & Bayar" button to the controlled `BarcodePaymentFlow` (fixes unreachable Kasir QRIS from the order detail page). Fixed a React 19 `set-state-in-effect` violation; removed an unused `barcodePaymentOpen`-era dead state that was never consumed. |
| `src/components/admin/orders/cashier-pay-dialog.tsx` | Fixed React 19 `set-state-in-effect` violation (snapshot + form reset now deferred off the effect body via async continuation that captures state once on open). No behavior change. |
| `src/services/payment/payment.types.ts` | `WebhookData.rawData: any` → `Record<string, unknown>` (removes the only flagged `any` in the payment flow; provider already produces a `Record<string, unknown>`). |

No changes to the customer website, the QR scanner (`order-scanner.tsx` —
already fixed previously), the iPaymu provider, the webhook handler, the
customer/payment public routes, or the payment database model.

## 7. API Changes

No new endpoints. Two touch points verified:

- `POST /api/payments` (`src/app/api/payments/route.ts`) — the previously
  reported defect (body `method` not forwarded on the orderId path, causing a
  KASIR intent to create a VA payment) is **confirmed fixed and still correct**:
  1. `method` is validated ∈ {`QRIS`, `KASIR`}.
  2. `orderNumber + method:"QRIS"` → `createKasirQrisPayment`.
  3. otherwise the validated `{ method }` is passed to `createPayment`.
  - Trace check (DINE_IN QRIS via orderId): `{ method: "QRIS" }` →
    `createPayment(..., { method: "QRIS" })` → `isQris = true` → iPaymu `qris`
    channel, `method: "QRIS"` row. No VA, no cash. ✅
  - Trace check (TAKEAWAY legacy, no method): `createPayment(..., undefined)` →
    `isQris = false`, no KASIR → VA channel (intended legacy behavior). ✅
- `POST /api/payments/[id]/mark-paid` — unchanged; amount rules, shift RBAC,
  double-pay 409, and audit all enforced server-side.

## 8. UI Changes

- Outlet Dashboard → Kasir → Scan QR Pesanan (dashboard/orders pages scan →
  `/admin/orders/[orderNumber]`).
- Order detail page: **"Scan & Bayar"** now opens the Kasir payment dialog
  (previously dead), and **"Proses Pembayaran Kasir"** remains for direct cash.
- Within `barcode-payment-flow.tsx` the required screen is present:
  SCAN → ORDER DETAIL → **PROSES PEMBAYARAN** with two distinct buttons
  **[💵 Cash / Tunai]** and **[📱 QRIS]** → CASH screen (total, uang diterima,
  kembalian live, "Uang Pas", Konfirmasi) or QRIS screen (QR, amount, status,
  countdown, retry "Buat QRIS Baru"). Both screens have a **Kembali** button to
  return to the selection screen.

## 9. Security Verification

- **Authentication**: Kasir lookup uses the ADMIN/CASHIER-session routes only
  (`requireRoles(["ADMIN", "CASHIER"])`); `createKasirQrisPayment` and
  `markCashierPaymentPaid` are session-restaurant-scoped. The public lookup is
  NOT authoritative for Kasir.
- **RBAC / shift**: CASHIER completion requires an OPEN shift owned by the
  actor; payments linked to another shift are rejected; ADMINS keep the legacy
  quick-pay path.
- **Tenant isolation**: `createKasirQrisPayment(orderNumber, restaurantId)`
  queries `{ orderNumber, restaurantId }` and `createPayment(orderId,
  restaurantId)` filters on `restaurantId`; cross-restaurant payment can't
  create/complete — server raises NotFound/Conflict. Cashier order lookup is
  `getOrderByNumberScoped` (tenant-scoped).
- **Server-side amount**: payment amount always `order.grandTotal` recomputed in
  the DB; `markCashierPaymentPaid` validates `amountReceived >= amountDue`
  server-side; webhook validates amount ±0.01 and HMAC signature.
- **Payment state validation**: guarded `UNPAID→PAID` update prevents
  double-pay; PENDING/PAID existence checks prevent a second live intent;
  per-order `FOR UPDATE` serializes creation.
- **No `any`/`as any`/`@ts-ignore`/`@ts-expect-error`** in the changed code. The
  only suppressed `any` in the payment scope is `handleWebhook(payload: any)`
  (pre-existing, `eslint-disable-next-line`, deliberate untrusted webhook
  boundary) — left untouched; `WebhookData.rawData` (the flagged one) is now
  `Record<string, unknown>`.

## 10. Test Matrix

Static verification (code-trace) is complete for all rows. Runtime verification
requires a live server + seeded DB + iPaymu sandbox/prod keys + a camera
browser; the existing Puppeteer suite (`scripts/e2e-dine-in-payment.mjs`, 21+
flows) targets this matrix but cannot run in this offline environment.

| Scenario | Status |
|----------|--------|
| DINE_IN + CASH | ⚠ Runtime test required (code-complete) |
| DINE_IN + QRIS | ⚠ Runtime test required (code-complete) |
| TAKEAWAY + CASH | ⚠ Runtime test required (code-complete) |
| TAKEAWAY + QRIS | ⚠ Runtime test required (code-complete) |
| DELIVERY + CASH | ⚠ Runtime test required (code-complete) |
| DELIVERY + QRIS | ⚠ Runtime test required (code-complete) |
| QRIS create new | ✅ server logic (`createPayment` QRIS intent) + UI path traced |
| QRIS reuse PENDING | ✅ `pending_existing` branch traced (`createKasirQrisPayment`) |
| QRIS retry FAILED | ✅ `FAILED` → new intent branch traced |
| QRIS retry EXPIRED | ✅ stale-PENDING→EXPIRED then new intent traced |
| QRIS webhook → PAID | ⚠ Needs live iPaymu (handler verified: HMAC, amount, idempotent) |
| QRIS polling → PAID | ✅ 4s `getPayment` poll + single-fire handler traced |
| QRIS duplicate request | ✅ UI `qrisBusyRef` + server `FOR UPDATE` + Conflict traced |
| QRIS already PAID | ✅ `ConflictError "Order already paid"` traced |
| Cash valid amount | ✅ server min amount + guarded update traced |
| Cash insufficient | ✅ `ValidationError` before write traced |
| Cash change calc | ✅ `changeAmount = amountReceived - amountDue` server+UI traced |
| Cash duplicate submit | ✅ 409 `alreadyPaid` traced |
| Cash already PAID | ✅ 409 traced |
| Security same restaurant | ✅ tenant-scoped queries traced |
| Security cross restaurant | ✅ Not-found/Conflict traced |
| Security unauthorized | ✅ `requireRoles` on all Kasir routes traced |
| Security manipulated amount | ✅ server recomputes `grandTotal`; amountReceived rule server-side |
| Customer regression: website QRIS | ✅ customer pages/routes untouched; builds pass |
| Customer QRIS not KASIR | ✅ public route keeps DINE_IN-only QRIS/KASIR intents |

## 11. Build Result

- `npx tsc --noEmit` — **PASS** (0 errors).
- `npm run build` — **PASS** (exit 0; all routes compile).
- `npx eslint <kasir payment-flow files>` — **0 errors**; 2 pre-existing
  warnings (`<img>` element for QR data-URL, `_restaurantId` unused param) —
  both documented previously and out of this change's scope.
- Full-repo `npm run lint` reports 27 pre-existing errors / 49 warnings **all in
  files outside the Kasir payment flow** (customer pages, dashboard, settings,
  shifts, tables, users, product-image-field, qr-code-display, use-mobile,
  auth). None are introduced by this change; the kasir flow files are clean.

## 12. Remaining Blockers

1. **Physical runtime verification** (the gate to VERIFIED / PRODUCTION READY):
   - Browser camera scan round-trip (order → order detail → payment selection).
   - The full order-type × method matrix in §10 against a live iPaymu sandbox.
   - QRIS create/reuse/retry/PAID/FAILED/EXPIRED and webhook→PAID with a real
     gateway.
2. Full-repo lint debt (27 pre-existing errors) — unrelated to Kasir; needs a
   separate cleanup sweep.
3. `scripts/e2e-dine-in-payment.mjs` must be executed against a running stack
   (app + MySQL + Redis + iPaymu env) to close the runtime matrix.

---

## Final Status

**READY FOR TESTING** — Kasir CASH and Kasir QRIS flows are implemented
end-to-end on the existing engines with correct payment-context separation and
OrderType support; `tsc`, `build`, and Kasir-flow lint all pass. The Cash + QRIS
Kasir flow has NOT yet been physically tested against a live gateway, so
**PRODUCTION READY must not be claimed** until the §10 runtime matrix and §12
blockers are cleared.