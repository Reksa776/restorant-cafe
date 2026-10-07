# PHASE 4 — RESERVATION PAYMENT ADMIN UI

**Repository:** `~/restorant-cafe`
**Base HEAD:** `5d82cf4` (unchanged — no commit/push/deploy)
**Architecture preserved:** `Reservation → Reservation.orderId → Order.id → Payment.orderId`, payment state derived from `Order.paymentStatus`. No schema change, no migration, no enum, no new engine.

**Result:** ✅ **PASS** — admin/kasir can now see the reservation payment information (read-only) in the existing reservation detail modal.

---

## 1. EXISTING ADMIN RESERVATION DETAIL

Audited (no changes made except as listed in §3):

- `src/components/admin/reservations/reservation-detail.tsx` — **MODAL** (`Dialog` from `@/components/ui/dialog`), not a route. There is **no** `/admin/reservations/[id]` page; the modal is opened from the board. It renders an `initial: ReservationTableView` row from the board and, on open, best-effort refetches the freshest view via `reservationService.getById(id)` (`GET /api/admin/reservations/[id]`). Uses a local `DetailRow` (`flex … border-b`, `dd` carries `min-w-0 … break-words`). Renders reservation fields + a "Riwayat Status" timeline. Renders **no** payment info before Phase 4.
- `src/app/api/admin/reservations/[id]/route.ts` — `GET`, guarded by `requireRoles(["ADMIN","CASHIER"], branchHintFrom(request))`; calls `reservationService.getReservationById(id, ctx.restaurantId, authorizedBranches(ctx))` and returns the full `ReservationView` via `successResponse(view)`. **No `payment`-specific filtering** — the whole view is returned. No modification needed.
- `src/services/reservation.service.ts` — **client** wrapper + `ReservationTableView` type. `getById` hits the authorized endpoint. Type previously lacked `payment`.
- Existing helpers reused: `ReservationStatusBadge`, `reservation-format.ts` (`formatReservationDate`, `formatReservationDateTime`, `formatTimeSlot`, `RESERVATION_STATUS_LABELS`, `RESERVATION_SOURCE_LABELS`).

## 2. EXISTING PAYMENT DATA

Phase 2 already attached `payment` to every `ReservationView`:

- `src/services/reservation/reservation.service.ts` (server): `ReservationPaymentSummary` + `paymentMap` keyed by order id, injected as `payment: r.orderId ? (paymentMap.get(r.orderId) ?? null) : null` in `reservationViews()`. `status` is `Order.paymentStatus`; the rest mirrors the latest `Payment` intent (`amount` falls back to `Order.grandTotal` before any intent).
- Because `getReservationById` returns that view and `GET /api/admin/reservations/[id]` returns it verbatim, **the payment data was already reaching the admin client** — no backend/API change was required. (Verified: the shape is consumed directly, no new query from the browser.)

## 3. CHANGES IMPLEMENTED

Read-only admin payment display:

1. **Client type** (`src/services/reservation.service.ts`): added `ReservationPaymentView` and `payment: ReservationPaymentView | null` to `ReservationTableView` so the UI consumes the existing backend field with no `any`.
2. **Display helpers** (`src/components/admin/reservations/reservation-format.ts`): added `PAYMENT_STATUS_LABELS`, `PAYMENT_STATUS_BADGE_CLASSES`, `PAYMENT_METHOD_LABELS`, and `formatRupiah` (pure; same convention as other admin components).
3. **Payment badge** (new `reservation-payment-status-badge.tsx`), mirroring the existing `ReservationStatusBadge` pill pattern, with a muted fallback for unknown values.
4. **Modal section** (`src/components/admin/reservations/reservation-detail.tsx`): a read-only "Pembayaran" block + empty state.

No payment engine, refund engine, QRIS engine, auth, endpoint, migration, or customer/Order payment page was touched. No webhook/iPaymu/WhatsApp/order.service change.

## 4. PAYMENT DTO

The admin detail consumes the server-derived summary verbatim (no re-derivation, no internal ids):

```ts
// client type — mirrors the server ReservationPaymentSummary over JSON
export interface ReservationPaymentView {
  status: string;        // DERIVED: linked Order.paymentStatus
  method: string | null;
  amount: number;
  provider: string | null;
  expiresAt: string | null; // ISO over the wire (server Date | null)
  paidAt: string | null;
  reference: string | null; // gateway providerRef — non-secret correlation id
}
```

- No `paymentId` / internal `Payment.id` is exposed or rendered.
- `reference` = `providerRef` (e.g. the order number), safe to display per the existing DTO.
- `payment` is `null` when the reservation has no linked order (`orderId == null`).

## 5. PAYMENT STATUS DISPLAY

Mapping (labels + pill classes), all seven states the derived DTO can emit:

| Status | Label | Pill |
|---|---|---|
| `UNPAID` | Belum Bayar | muted (gray) |
| `PENDING` | Menunggu Pembayaran | warning (yellow) |
| `PAID` | Lunas | success (green) |
| `FAILED` | Pembayaran Gagal | destructive (red) |
| `EXPIRED` | Pembayaran Kedaluwarsa | warning/muted (orange) |
| `CANCELLED` | Dibatalkan | muted (gray) |
| `REFUNDED` | Dana Dikembalikan | info (blue) |

Unknown values fall back to the muted pill (`?? "bg-gray-100 text-gray-600"`) and render the raw status text — a future enum value can never crash the modal. No enum was added or changed.

## 6. RESERVATION VS PAYMENT STATUS

The two states are rendered **separately and never conflated**:
- Reservation status → existing `ReservationStatusBadge` in the "Status" row (vocabulary: PENDING/CONFIRMED/SEATED/COMPLETED/CANCELLED/NO_SHOW).
- Payment status → new `ReservationPaymentStatusBadge` inside the "Pembayaran" block (vocabulary: UNPAID/PENDING/PAID/FAILED/EXPIRED/CANCELLED/REFUNDED).
- The payment block only renders when `reservation.payment != null`; `PAID` is **never** inferred from `status === "CONFIRMED"`. A unit test asserts the two label maps share no keys.

## 7. ADMIN AUTHORIZATION

Unchanged and reused: the detail modal reads through `GET /api/admin/reservations/[id]`, which stays guarded by the existing `requireRoles(["ADMIN","CASHIER"], …)`. ADMIN and CASHIER behave exactly as before; no auth was added, widened, or weakened. Payment data is **not** made public — the endpoint remains admin/cashier-only and branch-scoped.

## 8. TENANT ISOLATION

Unchanged: `getReservationById(id, restaurantId, authorizedBranches(ctx))` scopes by `restaurantId` and (for branch-scoped callers) `branchId in authorizedBranches`. The client never sends a `restaurantId` as authority and never queries payment by id from the browser; the payment object rides along the already-scoped reservation. Covered by the existing isolation tests (see §14).

## 9. PAYMENT INFORMATION UI

A read-only "Pembayaran" block added after the main field list, before "Riwayat Status":

- **Status** — `ReservationPaymentStatusBadge`
- **Metode** — `PAYMENT_METHOD_LABELS[method] ?? method` (QRIS / Kasir / Virtual Account)
- **Jumlah** — `formatRupiah(amount)`
- **Provider** — e.g. `ipaymu`
- **Reference** — `providerRef`
- **Dibayar Pada** — `formatReservationDateTime(paidAt)`
- **Kadaluarsa Pada** — `formatReservationDateTime(expiresAt)`

Long references wrap via the existing `DetailRow` (`dd` has `min-w-0 … break-words`); the status badge uses `shrink-0 whitespace-nowrap`.

## 10. EMPTY STATE

When `reservation.payment == null` (no linked order), the block shows a muted message:

> **Belum ada pembayaran**

No `PAID`/amount/reference rows are shown, and no payment button exists (Phase 5/backend owns creation; admin UI is read-only). Verified in the browser (§13).

## 11. LOADING / ERROR STATE

Reuses the existing modal behavior — no new loading architecture:
- The board's row (`initial`) is shown immediately; the background `GET /[id]` refresh is best-effort and swallows errors, so there is never a blank window and the payment block simply reflects whatever view is current.
- No payment-specific loading spinner or error toast was added.

## 12. REFUND / CANCEL COMPATIBILITY

Untouched. Phase 4 adds display only:
- Existing reservation cancel (`POST /api/admin/reservations/[id]/cancel`) and status transitions keep using the existing service (`transitionReservation`, `cancelUnpaidLinkedOrderInTransaction`, guarded PENDING-payment cancel from Phase 2).
- Existing refund/approval engine (`approval.service.ts`, `/api/refunds/*`) is not modified.
- `src/services/approval/approval.service.ts` was not touched.
- Existing admin reservation tests still pass (§14).

## 13. RESPONSIVE VERIFICATION

Focused browser verification (headless Chrome, dev server on `:3100`). Because the detail is an auth-gated modal, a **throwaway preview scaffold** (`src/app/p4-preview/**`) rendered the real `ReservationDetail` component with fixtures; it was **deleted after** (`git status` clean of it).

- **Populated state — DOM text confirmed present:** `Pembayaran`, `Status Lunas`, `Metode QRIS`, `Jumlah Rp125.000`, `Provider ipaymu`, `Reference ORD-20261007-XYZ-LONG-REFERENCE-0123456789`, `Dibayar Pada`, `Kadaluarsa Pada`; reservation `Status Dikonfirmasi` shown separately.
- **Empty state — DOM text confirmed:** `Pembayaran` + `Belum ada pembayaran`; no `Lunas`, no `Rp125.000`, no `Reference`.
- **Screenshots rendered:** 390×844 → PNG `390x844` (40,340 B); 1280×800 → PNG `1280x800` (45,328 B).
- **Overflow mitigation:** the payment rows sit inside the existing `max-h-[60vh] overflow-y-auto` body and the existing `DetailRow` (`min-w-0`, `break-words`); the long reference wraps instead of forcing width. No layout redesign.

## 14. TESTS

- **New:** `src/components/admin/reservations/reservation-payment-format.test.ts` — **7 pass / 0 fail** (4 suites):
  - every derived payment state has a label + pill class;
  - the payment vocabulary is distinct from the reservation vocabulary (no shared keys);
  - method labels;
  - `formatRupiah` separators + null/undefined/NaN safety (renders `Rp0`);
  - `formatReservationDateTime` null-safe for `paidAt`/`expiresAt`.
- **Existing, restored & still passing:** `src/components/admin/reservations/reservation-format.test.ts` — **8 pass / 0 fail**.
- **Regression (relevant, unchanged backend):**
  - `src/services/reservation/reservation.service.test.ts` — **47 pass / 0 fail** (includes `getReservationById` tenant/branch isolation and guest-lookup safety).
  - `src/services/reservation/reservation.payment.test.ts` — **24 pass / 0 fail** (admin detail carries `payment`, cross-restaurant 404, wrong-owner 404, cancelled/already-paid 409, forged `restaurantId` cannot cross tenant).
- No new test infrastructure was introduced.

Coverage against the requested list: 1 no-payment ✔ (§10), 2 UNPAID ✔, 3 PENDING ✔, 4 PAID ✔, 5 FAILED ✔, 6 EXPIRED ✔, 7 CANCELLED ✔, 8 REFUNDED ✔ (all via the label/badge coverage test + admin-DTO tests), 9 CONFIRMED+PAID ✔ (browser DOM), 10 PENDING+EXPIRED ✔ (vocabulary test), 11 tenant isolation ✔ (existing), 12 admin authorization ✔ (route unchanged; existing), 13 cancel/refund not broken ✔ (existing tests pass).

## 15. TSC

`npx tsc --noEmit` → **EXIT 0**.

## 16. GIT DIFF CHECK

`git diff --check` → **EXIT 0** (no whitespace/conflict issues).
`npx eslint` on all changed/created files → **EXIT 0**.

## 17. KNOWN LIMITATIONS

- Admin payment display is **read-only** by design; there is no "mark paid"/refund action inside the reservation modal — those flows keep their existing engines/screens.
- The modal shows the **latest** payment intent only (backend `payments take 1`, newest first); full payment history for a reservation order is not shown here (available on the existing order detail).
- No admin-specific payment polling was added — the block refreshes only via the modal's existing open-time refresh.
- The populated-state browser check used a fixture scaffold (no reservation with a linked order+payment exists in the dev DB); the underlying DTO was independently verified through the admin service tests.
- `formatRupiah` was added to the reservations `reservation-format.ts` module (pure helper) because no shared currency formatter exists in that folder; it follows the existing admin convention (`Rp${Number(v).toLocaleString("id-ID")}`).

## 18. PHASE 5 PREREQUISITES

- End-to-end verification of the **reservation QRIS** flow across customer page → `POST/GET /api/public/reservations/[code]/payment` → iPaymu sandbox callback → webhook → `Order.paymentStatus = PAID` → `confirmFromPaidOrderInTransaction` → reservation `CONFIRMED` → admin modal shows `Lunas`.
- Gateway-dependent cases that could not run here (production iPaymu is forbidden): real POST creating a QRIS intent, double-POST dedupe, client amount-override rejection, and the ordinary Order QRIS regression.
- Confirm WhatsApp `Reservasi Dikonfirmasi` dispatch fires once on webhook-driven confirmation.
- Refresh/back-navigation parity for the admin modal once a real paid reservation exists in the environment.
- Confirm no regression in cashier payment flow and in the sales/payment reports that join `Order`.

_STOP — Phase 4 only. No Phase 5, no live payment, no commit/push/deploy._
