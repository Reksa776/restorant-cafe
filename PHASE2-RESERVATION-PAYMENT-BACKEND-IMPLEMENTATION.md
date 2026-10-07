# PHASE 2 — RESERVATION PAYMENT BACKEND IMPLEMENTATION

> Scope: **Phase 2 backend only.** Customer UI (Phase 3), admin UI (Phase 4) dan
> E2E/regression penuh (Phase 5) **tidak** diimplementasikan.
> Tidak ada commit/push/deploy, tidak ada migration, tidak ada `prisma db push`/reset,
> tidak ada payment production dijalankan, tidak ada file WhatsApp/worker/schema disentuh.
> Repo: `/home/reksa/restorant-cafe` · HEAD `5d82cf4`
>
> Final architecture (dari `PHASE1-RESERVATION-PAYMENT-DESIGN.md`): **OPTION B** —
> `Reservation.orderId → Order.id → Payment.orderId`; payment state **derive** dari
> `Order.paymentStatus`; QRIS **on-demand**; endpoint `[code]/payment`; webhook
> `PAID → Order PAID → resolve Reservation → PENDING → CONFIRMED (CAS)`.

---

## 1. EXISTING FUNCTIONALITY REUSED

| Kebutuhan | Yang dipakai ulang (tanpa engine baru) |
|---|---|
| QRIS generate | `paymentService.createPayment(orderId, restaurantId, { method:"QRIS" }, branchFilters)` |
| Idempotency / live-PENDING reuse / retry / expiry / amount | seluruh perilaku `paymentService.createPayment` (tidak diubah) |
| Tenant resolve publik | `resolvePublicReservationRestaurant` (pola existing reservation public routes) |
| Ownership guest | `tryGetCustomerSessionFromRequest` + `normalizePhone` (pola `getReservationByCodeForGuest`) |
| Rate limiter | `assertRateLimit` + `rateLimitKey` (`@/lib/rate-limit`) |
| Error envelope | `AppError`/`NotFoundError`/`ConflictError`/`ValidationError` + `successResponse`/`errorResponse` |
| State machine reservasi | `ReservationService.transitionReservation` (matriks + CAS) — tidak diubah |
| Order cancel | `orderService.cancelUnpaidLinkedOrderInTransaction` — tidak diubah |
| WhatsApp konfirmasi | `ReservationService.notifyReservationWhatsApp` (private) → `dispatchReservationWhatsApp` — tidak diubah |
| Webhook | `paymentService.handleWebhook` (signature/parse/mirror existing) — diperluas, bukan diganti |

**Tidak** dibuat: payment engine baru, QRIS engine baru, auth system baru, reservation payment
model/kolom/enum baru, refund engine baru, logging subsystem baru.

---

## 2. FILES CHANGED

**Modified (2):**
1. `src/services/reservation/reservation.service.ts` (+123/−1 baris)
   - `ReservationPaymentSummary` (interface, exported) — payment state **derived**.
   - `reservationViews()` — select payment diperluas + `paymentMap` + `payment` pada setiap view.
   - `confirmFromPaidOrderInTransaction(tx, orderId, restaurantId)` — seam webhook (CAS, exported/public).
   - `notifyReservationConfirmedFromPayment(id, restaurantId)` — seam notifikasi (best-effort).
   - `transitionReservation()` blok `CANCELLED` — batalkan Payment **PENDING** berguard.
2. `src/services/payment/payment.service.ts` (+41/−3 baris)
   - `handleWebhook()` — setelah mirror `Order.paymentStatus = PAID`, resolve Reservation via
     `orderId` + `restaurantId` dan CAS `PENDING → CONFIRMED` (di dalam transaksi yang sama);
     dispatch WhatsApp konfirmasi existing setelah commit (best-effort). **Signature/parse/provider tidak diubah.**

**Created (2):**
3. `src/app/api/public/reservations/[code]/payment/route.ts` — `POST` + `GET` (reservation-scoped, QRIS).
4. `src/services/reservation/reservation.payment.test.ts` — 24 focused tests (Phase 2).

---

## 3. FILES INTENTIONALLY UNTOUCHED

- `src/services/whatsapp/**` (session-manager, providers, notifier) — **tidak disentuh**.
- `src/workers/**` — **tidak disentuh**.
- `src/services/reservation/reservation-whatsapp.ts` — **tidak disentuh** (dipakai lewat service existing).
- `src/services/reservation/reservation.slots.ts` — **tidak disentuh**.
- `src/services/order/order.service.ts` — **tidak disentuh** (flow Order default identik).
- `src/services/approval/approval.service.ts` — **tidak disentuh**.
- `src/services/payment/providers/ipaymu/ipaymu.provider.ts` — **tidak disentuh** (signature & parser utuh).
- `prisma/schema.prisma` — **tidak disentuh** (NO migration).
- `src/app/(customer)/payment/[orderNumber]/**`, `.../order/[orderNumber]/**`, `menu`, `cart`, `checkout` — **tidak disentuh**.
- `src/app/api/webhooks/ipaymu/route.ts` — **tidak disentuh** (perubahan ada di service).

---

## 4. API BEHAVIOR

### `POST /api/public/reservations/[code]/payment`
| Aspek | Implementasi |
|---|---|
| Auth | publik + rate limit 30/menit (`public-reservation-payment-create`) |
| Input | `{ method?: "QRIS", phone?: string, restaurantId?: string }` — `restaurantId`/`phone` hanyalah **hint** ownership/tenant |
| Server-side lookup | `code → Reservation` (tenant via `resolvePublicReservationRestaurant`) → `Reservation.orderId → Order` |
| Validasi | ownership (session customerId === reservation.customerId **atau** `normalizePhone(phone) === guestPhone`); reservation ≠ CANCELLED; `orderId` ada; order ada & tenant sama; order ≠ CANCELLED; `Order.paymentStatus ≠ PAID`; `method` hanya QRIS |
| Aksi | `paymentService.createPayment(order.id, reservation.restaurantId, { method:"QRIS" }, [order.branchId])` |
| Response | `{ reservationCode, reservationStatus, orderNumber, orderStatus, paymentStatus, grandTotal, payment: { status, method, amount, provider, reference, qrImage, qrString, paymentUrl, paidAt, expiresAt } | null }` |
| Error | 404 (tidak ditemukan/tidak dimiliki/cross-tenant), 409 (reservation cancelled / tanpa order / order cancelled / order PAID), 400 (method invalid), 429 (rate limit), 500 (internal/gateway) |

**Amount TIDAK diterima dari client** — selalu `Order.grandTotal` lewat engine existing.
`orderId`/`paymentId`/`providerRef`/`payment status`/`restaurantId` tidak pernah dipakai untuk menulis.

### `GET /api/public/reservations/[code]/payment`
| Aspek | Implementasi |
|---|---|
| Auth | publik + rate limit 120/menit (poll ~4s) |
| Read-only | **Tidak pernah** membuat payment (no side effects) |
| Response | state sama seperti POST; tanpa payment → `paymentStatus:"UNPAID"`, `payment:null` |
| Error | 404 / 429 / 500 |

Endpoint existing (`/api/public/payments`, `/api/public/payments/[orderNumber]`) **tidak diubah**.

---

## 5. PAYMENT LIFECYCLE

```
POST [code]/payment
  → order valid (tenant, belum PAID, belum CANCELLED, reservation belum CANCELLED)
  → paymentService.createPayment(QRIS)
        • tidak ada payment            → buat PENDING (gateway qris) → qrImage/qrString/expiresAt
        • ada PENDING hidup            → REUSE (tidak menumpuk intent)
        • PENDING kedaluwarsa/FAILED   → EXPIRED/retry → intent baru
        • order sudah PAID             → 409 (terminal, tidak bisa dobel)
        • payment CANCELLED            → tidak dihidupkan (guarded supersede existing)
  → mirror Order.paymentStatus = PENDING
GET [code]/payment → status/amount/qr/expiry/paidAt (derived dari Order.paymentStatus)
```
Status yang dibedakan: **UNPAID, PENDING, PAID, FAILED, EXPIRED, CANCELLED, REFUNDED**
(derived dari `Order.paymentStatus`; method/amount/provider/reference/paidAt/expiresAt dari intent terakhir).

---

## 6. RESERVATION LIFECYCLE

| Peristiwa | Status reservasi | Payment state | Catatan |
|---|---|---|---|
| Submit reservasi (QRIS/KASIR) | `PENDING` | UNPAID (KASIR) / belum ada intent (QRIS) | existing, tidak berubah |
| Customer buka layar bayar & QRIS dibuat | tetap `PENDING` | PENDING | on-demand |
| Webhook **PAID** | `PENDING → CONFIRMED` (**otomatis**, CAS, `confirmedAt`) | PAID | + WhatsApp CONFIRMED existing |
| Webhook EXPIRED/FAILED | tetap `PENDING` | EXPIRED/FAILED | customer dapat regenerate |
| Customer meninggalkan halaman | tetap `PENDING` | PENDING sampai `expiresAt` | existing |
| Cancel sebelum/ketika PENDING | `CANCELLED` | CANCELLED (payment PENDING dibatalkan) | existing + tambahan |
| Cancel setelah PAID | `CANCELLED` | tetap PAID (refund via engine existing) | platform |
| Sudah CONFIRMED manual lalu webhook PAID | tetap CONFIRMED | PAID | CAS gagal → no-op |

`ReservationStatus` **tidak** ditambah enum apa pun. `CONFIRMED` tetap bermakna "valid/diterima".

---

## 7. WEBHOOK BEHAVIOR

Trace final: `POST /api/webhooks/ipaymu → validateWebhook → parseWebhookPayload → handleWebhook`
→ lookup `providerRef` → idempotent/amount → `$transaction`:

```
guard Payment CANCELLED → IGNORED_CANCELLED (existing)
CAS Payment.status (existing)
PaymentTransaction (existing)
mirror Order.paymentStatus (existing)
  └─ bila status PAID:
        reservationService.confirmFromPaidOrderInTransaction(tx, payment.orderId, payment.restaurantId)
          CASE A PENDING   → CONFIRMED + confirmedAt (CAS)  → return id
          CASE B CONFIRMED → no-op (return null)
          CASE C CANCELLED → NO-OP (tidak dihidupkan)       → return null
          CASE D SEATED/COMPLETED/NO_SHOW → no-op
setelah commit:
  confirmedReservationId → notifyReservationConfirmedFromPayment (WhatsApp existing, best-effort)
realtime events (existing)
```

- Perubahan **minimum**, signature & parser iPaymu **tidak disentuh**; correlation `providerRef`
  (Phase 0.1: 18/18 cocok) tetap jadi kunci.
- Order biasa tanpa reservasi → `confirmFromPaidOrderInTransaction` mengembalikan `null`
  ⇒ **perilaku order normal tidak berubah**.
- Idempotent: webhook PAID ganda → CAS gagal pada panggilan kedua → tidak double-confirm, tidak double-WhatsApp.

---

## 8. CANCELLATION BEHAVIOR

Di `transitionReservation` (blok `target === "CANCELLED" && current.orderId`), setelah
`cancelUnpaidLinkedOrderInTransaction` (existing):
```ts
await tx.payment.updateMany({
  where: { orderId: current.orderId, restaurantId, status: "PENDING" },
  data: { status: "CANCELLED" },
});
```
- **Hanya** baris berstatus `PENDING` yang berubah (guarded/CAS). `PAID`/`FAILED`/`EXPIRED`/`REFUNDED`/
  sudah-`CANCELLED` **tidak pernah** disentuh.
- Setelah ini, webhook PAID yang menyusul ditolak oleh guard existing (`IGNORED_CANCELLED`) →
  **reservasi yang sudah CANCELLED tetap CANCELLED** (Step 5).
- Cancel order dengan payment PAID: order PAID tidak disentuh (existing) dan payment tetap PAID →
  diserahkan ke alur refund/cancellation existing (tidak menyentuh `approval.service`).

---

## 9. IDEMPOTENCY

| Kasus | Perilaku | Sumber |
|---|---|---|
| 1. Tidak ada payment | buat intent PENDING | engine existing |
| 2. PENDING hidup | **reuse** intent (tidak menumpuk) | engine existing |
| 3. EXPIRED | intent baru (stale di-EXPIRED) | engine existing |
| 4. FAILED | intent baru | engine existing |
| 5. PAID | 409 (`Order already paid`) | engine existing + guard route |
| 6. CANCELLED | tidak dihidupkan; QRIS baru dibuat bila perlu | engine existing |
| Webhook PAID ganda | CAS → sekali | `confirmFromPaidOrderInTransaction` + webhook PAID early-return existing |
| Reservation cancel + webhook PAID bersamaan | payment dibatalkan / webhook di-ignore | Step 4 + Step 5 |

`paymentService` idempotency **tidak ditulis ulang**.

---

## 10. TENANT SECURITY

- Publik: `code → reservation → restaurantId` (tenant di-resolve server-side lewat
  `resolvePublicReservationRestaurant`); `restaurantId` dari client hanya **hint** yang tidak bisa
  membuka reservasi tenant lain (kode harus cocok; mismatch → 404).
- Ownership: customer session (`customerId` cocok) **atau** `normalizePhone(phone) === guestPhone`;
  gagal → 404 (tidak membedakan "tidak ada" vs "bukan milik Anda" → anti-enumeration).
- Order selalu di-scope ulang: `findFirst({ id: reservation.orderId, restaurantId: reservation.restaurantId })`.
- Webhook: `confirmFromPaidOrderInTransaction` memfilter `orderId AND restaurantId` ⇒ reservasi tenant lain
  tidak bisa ter-confirm.
- Tidak mengekspos: API key, VA credential, provider secret, internal `orderId`/`customerId`/`paymentId`.
  `reference` = `providerRef` (non-secret, = `orderNumber` yang sudah publik).
- Amount & status: **selalu** dari DB / webhook signature — tidak dari client.

---

## 11. DATABASE IMPACT

**Migration: NO.** `prisma/schema.prisma` **tidak diubah**. Tidak ada `prisma migrate`, `db push`,
reset, DROP, TRUNCATE, atau SQL destruktif. Payment state reservasi **derive** dari relasi existing
(`Reservation.orderId → Order.paymentStatus`). Tidak ada kolom/tabel/enum baru, tanpa backfill.

---

## 12. TESTS RUN (focused only)

| Suite | Command | Hasil |
|---|---|---|
| **NEW** Phase 2 | `npx tsx --test --test-force-exit src/services/reservation/reservation.payment.test.ts` | **24 pass / 0 fail** |
| Existing reservation service + purchase | `... reservation.service.test.ts reservation.purchase.test.ts` | **68 pass / 0 fail** |
| Existing reservation HTTP API | `... reservation.api.test.ts` | **31 pass / 0 fail** |
| Existing customer + unit + whatsapp | `... reservation.customer.test.ts reservation.customer-api.test.ts reservation.unit.test.ts reservation-whatsapp.unit.test.ts` | **82 pass / 0 fail** |

Cakupan skenario yang diminta (A–N):
- **A** POST membuat QRIS via engine existing — *sebagian*: validasi pra-gateway diuji; pemanggilan gateway nyata
  diuji di Phase 5 (butuh iPaymu). Lihat §15.
- **B** POST dua kali tidak menduplikasi QRIS — reuse engine existing (diuji Phase 5 dengan gateway).
- **C** GET sebelum payment → `UNPAID` (payment null) — **PASS**.
- **D** GET pending → `PENDING` + QR + expiresAt — **PASS**.
- **E** GET paid → `PAID` + paidAt — **PASS**.
- **F** webhook PAID: PENDING → CONFIRMED (CAS, confirmedAt) — **PASS** (via `confirmFromPaidOrderInTransaction`).
- **G** webhook PAID duplikat: tetap CONFIRMED, return null — **PASS**.
- **H** webhook PAID setelah CANCELLED: tetap CANCELLED — **PASS**.
- **I** cancel reservasi dengan payment PENDING → payment CANCELLED — **PASS**.
- **J** cancel reservasi dengan payment PAID → payment tetap PAID (order tetap PAID) — **PASS**.
- **K** cross-restaurant ditolak — **PASS** (GET 404, POST 404).
- **L** client tidak bisa override amount — by design route tidak membaca `amount`; **dokumentasi** (Phase 5 E2E).
- **M** client tidak bisa override restaurantId — **PASS** (forged restaurantId → 404).
- **N** flow QRIS Order biasa tetap bekerja — **TIDAK dijalankan** (butuh gateway); engine Order/Payment tidak diubah.

---

## 13. TSC RESULT

`npx tsc --noEmit` → **EXIT 0** (setelah semua perubahan + test baru).

---

## 14. GIT DIFF --CHECK

`git diff --check` → **EXIT 0** (tidak ada whitespace error / conflict marker).

Status repo akhir (non-session): `M src/services/payment/payment.service.ts`,
`M src/services/reservation/reservation.service.ts`, `?? [code]/payment/`, `?? reservation.payment.test.ts`,
+ 3 file audit/design sebelumnya. `0 staged`, HEAD tetap `5d82cf4`. **Tidak commit, tidak push.**

Catatan lingkungan: server dev leftover dari sesi sebelumnya (port 3100) sempat dihentikan untuk menjalankan
test HTTP `reservation.api.test.ts` (Next menolak instance kedua untuk proyek yang sama), lalu **dinyalakan kembali**
(HTTP 200). `next-env.d.ts` (ditulis ulang oleh `next dev`) sudah dikembalikan ke HEAD.

---

## 15. KNOWN LIMITATIONS

1. **Gateway-dependent test** — test A/B/L/N yang benar-benar memanggil iPaymu tidak dapat dijalankan dalam
   test unit (tidak ada DI provider + tidak boleh payment production). Ditutup di **Phase 5 E2E sandbox**.
   Yang diuji sekarang: validasi pra-gateway + seluruh logika reservation payment tanpa gateway.
2. **Konflik kecil error contract (dilaporkan, bukan diimprovisasi):** permintaan Phase 2 menyebut
   `422` untuk "invalid request/ownership data", sedangkan konvensi aplikasi existing (`ValidationError`)
   memakai **400**; kode memakai konvensi existing (400) agar tidak membuat framework error baru.
   Ownership gagal tetap **404** (sesuai kontrak). Bila Anda ingin `422`, itu perubahan tersendiri lintas app.
3. **`paymentUrl` diekspos** pada DTO (untuk QRIS ini adalah sumber QR/citra yang memang perlu ditampilkan
   customer), konsisten dengan route publik existing; tidak ada provider secret/VA/apiKey.
4. **Public reservation DTO existing** (`_public-dto.ts`) belum menyertakan `payment` — itu kebutuhan
   Phase 3 (customer UI). View internal sudah menyediakan `payment` untuk admin (Phase 4).
5. **Auto-confirm WhatsApp** berjalan in-process mengikuti jalur existing (best-effort); bila WhatsApp
   tidak CONNECTED, hanya log (tidak menggagalkan webhook) — konsisten dengan perilaku existing.

---

## 16. PHASE 3 PREREQUISITES

Sebelum Phase 3 (Customer UI):
1. Endpoint backend sudah siap: `POST`/`GET /api/public/reservations/[code]/payment` (Phase 2 ✔).
2. Tentukan route UI final: **`/reservasi/[code]/payment`** (sesuai keputusan Phase 1 §H).
3. Wizard success-step mengganti CTA dari `/payment/[orderNumber]` → `/reservasi/[code]/payment`.
4. Layar QRIS reservasi: kode reservasi, resto/cabang, tanggal/jam/meja, customer, items, subtotal/discount/
   tax/service/grand total, QR (qrImage/qrString), status, expiry/countdown, refresh/retry, state
   success/expired/failed.
5. Ownership UI mengirim `phone` (dari step data customer) atau memakai customer session.
6. Tidak mengekspos secret; tidak mengubah halaman Order/Cashier existing.

**STOP — Phase 2 selesai. Tidak masuk Phase 3, tidak mengubah customer/admin UI, tidak commit/push/deploy.**
