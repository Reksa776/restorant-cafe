# PHASE 2 — FINAL REPORT
## Reservation + Pembelian Terintegrasi + Payment (satu flow)

> Repo: `/home/reksa/restorant-cafe`
> HEAD: **`d7f29ac fix wa reservation`** (2026-10-07)
> Baseline audit: `AUDIT-PHASE1-RESERVATION-ORDER-PAYMENT-INTEGRATION.md` (APPROVED — tidak diaudit ulang)
> Mode: implementasi sudah ada di working tree yang ter-commit; sesi ini melakukan **verifikasi ulang + re-run checks** terhadap 7 keputusan final dan 32 daftar verifikasi.
> Tidak ada commit/push/deploy pada sesi ini.

---

## 1. Implementation Summary

Reservation kini adalah **satu flow**: booking + pembelian produk + payment.

FLOW FINAL yang terimplementasi:

```
Branch → Date → Party Size → Time → Table → PEMBELIAN → DATA CUSTOMER → REVIEW → SUBMIT → PAYMENT
```

- Wizard customer (`src/app/(customer)/reservasi/page.tsx`) memiliki step **`purchase`** di antara `table` dan `guest` (single source of truth: `RESERVATION_WIZARD_STEPS` di `reservation-flow.ts`).
- Pemilihan produk terjadi **DI DALAM wizard** melalui `reservation-product-picker.tsx` yang membaca katalog existing `GET /api/public/menu` (search, kategori, qty, variant/option, addon, stok). **Tidak ada** `router.push("/menu")` sebagai prasyarat pembelian.
- Submit mengirim `items[]` ke `POST /api/public/reservations`. Server membuat **Order + OrderItem (+ Payment)** melalui engine existing di dalam **satu transaksi** yang sama dengan Reservation, lalu mengisi `Reservation.orderId`.
- Gate historis R6/R6.5 (`requirePurchase` dkk + `GET /purchase-eligibility`) **dihapus**; reservasi kini membawa order-nya sendiri.
- Nomor follow-up **reuse `Reservation.guestPhone`** (required, dinormalisasi `62…`), label UI `"No. WhatsApp untuk Follow-up *"`, helper `"Nomor aktif yang dapat dihubungi untuk follow-up reservasi pada hari-H."`.
- Payment mengikuti engine existing: QRIS via halaman reservasi `/[code]/payment` → webhook iPaymu; KASIR via order/kasir. Status pembayaran tidak pernah dipalsukan.

---

## 2. Files Changed

**Backend**
| File | Perubahan |
| --- | --- |
| `src/services/order/order.service.ts` | `CustomerOrderEngineOptions { reservationMode? }`; `createCustomerOrderInTransaction(tx, …)`; `emitCustomerOrderEffects()`; `cancelUnpaidLinkedOrderInTransaction()`; skip `Table.status = OCCUPIED` & MAINTENANCE re-check bila `reservationMode` |
| `src/services/reservation/reservation.service.ts` | `createReservationOrder()` (panggil engine existing dalam tx); `Reservation.orderId` diisi; gate historis diganti; `confirmFromPaidOrderInTransaction()`; cancel menutup order UNPAID + payment intent PENDING |
| `src/services/reservation/reservation.types.ts` | `CreatePublicReservationSchema.items` **REQUIRED** (`.min(1)`, `OrderItemInputSchema`), `paymentMethod? (QRIS|KASIR)` |
| `src/services/reservation/reservation-whatsapp.ts` | target tetap `guestPhone` (fallback `customer.phone`), skip `guest-*` |
| `src/app/api/public/reservations/_public-dto.ts` | DTO publik menambah ringkasan `order` (orderNumber/status/paymentStatus/method/total/items); **tidak** mengekspos `orderId` internal |
| `src/app/api/public/reservations/purchase-eligibility/route.ts` | **DIHAPUS** (probe historis tak relevan) |
| `src/app/api/public/reservations/[code]/payment/route.ts` | **BARU** — payment intent reservasi yang mendelegasikan ke `paymentService` existing |

**Frontend**
| File | Perubahan |
| --- | --- |
| `src/components/customer/reservation/reservation-product-picker.tsx` | **BARU** — picker produk (search/kategori/qty/variant/addon/stok), konsumsi `/api/public/menu` |
| `src/app/(customer)/reservasi/page.tsx` | Step `purchase`, follow-up phone, review pembelian+payment, payload `items` |
| `src/app/(customer)/reservasi/reservation-flow.ts` | Local reservation purchase model (BUKAN `useCart`), helper total/format, urutan step |
| `src/app/(customer)/reservasi/[code]/payment/page.tsx` | **BARU** — UI bayar QRIS reservasi |
| `src/app/(customer)/reservasi/reservation-payment-state.ts` (+ `-storage.ts`) | state pembayaran reservasi |

**Tests**
`reservation.purchase.test.ts` (21), `reservation-flow.test.ts` (29), `reservation.service.test.ts` (47), `reservation.api.test.ts` (31), `reservation.customer.test.ts` (17), `reservation.customer-api.test.ts` (12), `reservation.payment.test.ts` (24), `reservation.purchase.fixtures.ts`, `reservation-whatsapp.unit.test.ts`, `reservation-payment-state.test.ts`, `reservation-payment-format.test.ts`, `reservation-format.test.ts`, `reservation-floor-map.test.ts`.

Catatan: commit `5d82cf4` juga membawa perbaikan WhatsApp (R7/Baileys/worker) yang **di luar scope PHASE 2** dan tidak diubah pada sesi ini.

---

## 3. Existing Engines Reused

| Kebutuhan | Engine existing | Status |
| --- | --- | --- |
| Katalog produk | `GET /api/public/menu` | dipakai apa adanya oleh picker |
| Harga/validasi server | `orderService.createCustomerOrderInTransaction` (varian dari `createCustomerOrder`) | di-reuse, tanpa pricing engine baru |
| Order + OrderItem | engine order existing | di-reuse |
| Payment QRIS/KASIR + webhook | `paymentService` + `/api/public/payments` + `/api/webhooks/ipaymu` | di-reuse, **tidak diubah** |
| Booking + availability R5.1 | `reservationService` kernel | di-reuse, tidak diubah |
| Link reservation→order | `Reservation.orderId` (scalar existing) | di-reuse, tanpa migration |
| Customer guest/logged-in | `normalizePhone` find-or-create + customer HMAC session | di-reuse, tanpa auth baru |
| WhatsApp R7 | `dispatchReservationWhatsApp`/notifier | di-reuse, tidak diubah |

**Tidak ada** engine Cart/Order/Payment/Product/auth baru.

---

## 4. Reservation → Order Integration

- Public reservation kini **wajib** membawa `items[]` (≥1 produk, `quantity ≥ 1`) — `CreatePublicReservationSchema.items.min(1)`.
- Sebelum order dibuat, kernel memvalidasi branch, window/slot (R5.1), table availability (row lock), dan duplicate booking.
- `createReservationOrder(tx, …)` memanggil `orderService.createCustomerOrderInTransaction(tx, {..., items, paymentMethod}, restaurantId, customerId, branchId, { reservationMode: true })`.
- `Reservation.orderId = orderResult.order.id` (scalar, tanpa relasi Prisma baru).
- Admin/kasir reservation (`createAdminReservation`) **tetap purchase-free** (`items` tidak ada; `orderId = null`).
- Realtime effects (`ORDER_CREATED`, dsb.) di-emit **setelah commit** via `orderService.emitCustomerOrderEffects`.

---

## 5. Payment Integration

- `paymentMethod: "KASIR"` → row `Payment` UNPAID dibuat **atomik** dalam transaksi reservasi (tanpa gateway). Order tetap UNPAID sampai kasir menandai lunas (`markCashierPaymentPaid`, alur shift existing).
- `paymentMethod: "QRIS"` → order UNPAID tanpa gateway call saat create; intent QRIS dibuat di halaman reservasi `/[code]/payment` yang **mendelegasikan ke `paymentService` existing** (`POST /api/public/reservations/[code]/payment`). PAID hanya lewat webhook iPaymu existing.
- Status pembayaran di DTO adalah turunan dari `Order.paymentStatus` — **single source of truth**; tidak ada status yang dipalsukan.
- **Tidak ada** perubahan pada business rules `paymentService`, QRIS, iPaymu webhook, atau payment transaction.

---

## 6. Product Picker

`src/components/customer/reservation/reservation-product-picker.tsx` (**baru**, tidak merefactor `/menu`):
- search produk (`Cari produk...`), filter kategori, hanya produk aktif, stok `0` = sold out;
- quantity stepper, modal customize untuk variant/option group + addon;
- subtotal/total display (server tetap otoritatif);
- mengonsumsi `GET /api/public/menu` (restaurant + branch scoped, priceOverride, option/addon/stok existing).
- State disimpan **lokal** (via `ReservationPurchaseLine` di `reservation-flow.ts`), bukan `useCart`.

---

## 7. WhatsApp Follow-up Phone

- Field: **`Reservation.guestPhone`** (existing) — tidak ada field baru (`contactPhone`/`customerPhone`/`whatsapp`/`followUpPhone` TIDAK dibuat).
- UI label: `"No. WhatsApp untuk Follow-up *"`, helper: `"Nomor aktif yang dapat dihubungi untuk follow-up reservasi pada hari-H."` (terverifikasi di `page.tsx:1498–1509`).
- Required + dinormalisasi server-side via `GuestPhoneSchema` → `normalizePhone` (`62…`).
- Nomor yang sama dipakai untuk `Customer.phone`/order (`createReservationOrder` mengirim `customerPhone: data.guestPhone`).
- Prefill dari sesi customer bila login; tetap editable.
- Notifier R7 menerima `guestPhone` (`reservation-whatsapp.unit.test.ts` PASS; `resolveReservationWhatsAppTarget` tetap `guestPhone` → fallback `customer.phone`).

---

## 8. Transaction / Atomicity

- **A1** dipakai: `createCustomerOrderInTransaction(tx, …)` menerima `Prisma.TransactionClient`. `/menu` checkout memakai `createCustomerOrder` default (perilaku lama, tidak berubah).
- Satu transaksi untuk: validasi branch/window/table/duplicate → Order → OrderItem → (Payment KASIR) → Reservation (`orderId`) → COMMIT.
- Urutan lock: **branch → table** (deadlock-safe). Kegagalan apa pun → rollback penuh; tidak ada Reservation tanpa Order, Order tanpa Reservation, atau Payment orphan.
- Tidak ada dua transaksi, compensation, atau orphan cleanup.

---

## 9. Idempotency

- Duplicate booking check (`restaurantId + branchId + date + startMinutes + status HOLDING`, by `customerId` atau `guestPhone`) dijalankan **sebelum** order dibuat, di dalam transaksi yang diserialisasi oleh row lock branch.
- Double-submit dengan payload sama → request kedua kena `ConflictError` (409) **sebelum** order/payment/order-item dibuat → tidak mungkin jadi Order A + Order B atau orphan order.
- Tidak ada idempotency system besar baru; mekanisme minimal ini konsisten dengan arsitektur existing (reservation duplicate gate + order-number collision retry).

---

## 10. Historical Purchase Gate Removal

- `requirePurchase` / `assertQualifyingPurchase` / `hasQualifyingPurchase`: tidak ada lagi di `reservation.service.ts` (gate diganti validasi order milik reservasi ini).
- `checkPurchaseEligibility` + `GET /api/public/reservations/purchase-eligibility`: **route dihapus**.
- UI: tidak ada lagi teks `"Verifikasi Pembelian"`, `"Pembelian Diperlukan"`, `"Pesan Menu Dulu"`, `"Purchase requirement terpenuhi"`. (Tersisa hanya `PURCHASE_REQUIRED_HINT = "Reservasi harus menyertakan minimal 1 produk."` — salinan validasi items wajib, bukan gate historis.)
- **Tidak** ada fungsi bersama yang ikut terhapus: helper gate lama hanya dipakai gate R6.

---

## 11. Table Status Behavior

- `reservationMode: true` mencegah `createCustomerOrder` menulis `Table.status = OCCUPIED` (`order.service.ts:1271`) dan melewati re-validasi `MAINTENANCE` (`:832`) karena availability R5.1 yang otoritatif.
- Booking jam 19:00 **tidak** membuat meja terlihat terisi.
- Behavior default (`reservationMode` false) tetap: order checkout normal tetap men-set OCCUPIED. Cashier/Admin/seating tidak berubah.
- Terverifikasi: `reservation.purchase.test.ts` #15 (`Table.status` tetap `AVAILABLE`).

---

## 12. Cancellation / Refund

- Tidak ada refund engine baru.
- Cancel reservasi **UNPAID**: `orderService.cancelUnpaidLinkedOrderInTransaction(tx, …)` membatalkan order dalam transaksi yang sama (status transition + `OrderStatusHistory`), dan intent `Payment` yang masih PENDING di-`CANCELLED` (guarded updateMany) → tidak ada order menggantung.
- Cancel reservasi **PAID**: order **tidak disentuh** (`paymentStatus === "PAID"` → early return); refund/cancellation workflow existing (`Refund`/`CancellationRequest`) tetap source of truth.
- Terverifikasi: `reservation.purchase.test.ts` #18 (no orphan), #19 (PAID left untouched).
- **Tidak ada GAP** — integrasi cancellation aman tanpa workaround berisiko.

---

## 13. Database Impact

- Baris baru per reservasi berbelanja: 1 `Order` + N `OrderItem` (+ 1 `Payment` KASIR) — semua via engine existing.
- `Reservation.orderId` (scalar `String?`, sudah ada) dan `Reservation.guestPhone` (sudah ada) dipakai; tidak ada kolom/tabel/FK baru.
- Reservasi lama (`orderId = NULL`) tetap valid = "tanpa pembelian".

---

## 14. Migration

- **TIDAK ADA migration baru.** `git diff --stat 70226bc..HEAD -- prisma/` = **kosong**. Tidak ada reset/drop/destructive, migration lama tidak diubah. Jumlah migration tetap 22.

---

## 15. API Changes

| Endpoint | Dampak |
| --- | --- |
| `POST /api/public/reservations` | request **+`items[]` (REQUIRED)**, **+`paymentMethod? (QRIS|KASIR)`**; respons **+ringkasan `order`** (orderNumber/status/paymentStatus/method/totals/items, tanpa `orderId` internal). Breaking untuk klien lama tanpa `items` (disengaja). |
| `GET /api/public/reservations/purchase-eligibility` | **dihapus** |
| `POST /api/public/reservations/[code]/payment` | **baru** (delegasi ke payment engine existing) |
| `POST /api/public/orders`, `POST /api/public/payments`, `GET /api/public/menu` | **tidak diubah** |
| Admin/customer reservation | DTO publik tetap tanpa id internal |

---

## 16. Security

- Harga/discount/tax/serviceCharge/grandTotal **100% server-side** (`createCustomerOrderInTransaction` menghitung dari DB). Terverifikasi: `reservation.purchase.test.ts` #3 & #4 (input harga klien diabaikan).
- `restaurantId`/`branchId`/`customerId`/status pembayaran di-resolve server-side; tidak dipercaya dari client (`#3`, `#20`).
- Validasi produk (restaurant scope, aktif, tersedia, stok cabang, priceOverride) + opsi (required/min/max) + addon tetap berlaku (`#4`–`#10`).
- Tenant isolation: `#20` — restB tidak bisa pakai branch/produk restA.
- Route baru `[code]/payment` ter-scope restaurant + code reservasi + customer session; tidak ada auth baru, tidak ada endpoint publik bocor id internal.

---

## 17. Regression Verification

Semua test dijalankan terhadap DB lokal (`node:test` + `tsx`). Exit code diambil langsung dari perintah test (`pipefail`/status capture).

| # | Verifikasi | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | Guest reservation tanpa historical purchase | **PASS** | purchase.test #1 |
| 2 | Logged-in reservation tanpa historical purchase | **PASS** | purchase.test #12 |
| 3 | Product picker di reservation | **PASS (static)** | komponen ada + di-mount pada step `purchase`; browser tidak dijalankan |
| 4 | Tidak ada redirect ke /menu | **PASS** | flow.test; trace source (tidak ada `router.push("/menu")` di step purchase) |
| 5 | Search product | **PASS (static)** | picker implementasi `search`/`Cari produk...` |
| 6 | Category filter | **PASS (static)** | picker implementasi `categories`/filter kategori |
| 7 | Quantity | **PASS** | purchase.test #9, flow.test |
| 8 | Variant/option | **PASS** | purchase.test #4, #5, #6 |
| 9 | Addon | **PASS** | purchase.test #4 |
| 10 | Server-side price validation | **PASS** | purchase.test #3, #4 |
| 11 | Order created | **PASS** | purchase.test #1 |
| 12 | OrderItem created | **PASS** | purchase.test #1 |
| 13 | `Reservation.orderId` terisi | **PASS** | purchase.test #1 |
| 14 | Payment created | **PASS** | purchase.test #13 (KASIR) |
| 15 | `Reservation.guestPhone` tersimpan | **PASS** | purchase.test #2 |
| 16 | Follow-up phone tersimpan benar | **PASS** | purchase.test #2 (canonical `62…`) |
| 17 | QRIS existing flow | **PASS (engine)** | reservation.payment.test 24/24; webhook iPaymu live **tidak dijalankan** |
| 18 | KASIR existing flow | **PASS** | purchase.test #13, payment.test |
| 19 | Review menampilkan purchase | **PASS (static)** | blok PEMBELIAN/TOTAL/PAYMENT di page.tsx; browser tidak dijalankan |
| 20 | Availability tetap benar | **PASS** | purchase.test #21 |
| 21 | Table tidak auto-OCCUPIED | **PASS** | purchase.test #15 |
| 22 | Failed reservation rollback Order | **PASS** | purchase.test #16 |
| 23 | Failed reservation rollback Payment | **PASS** | tx tunggal (purchase.test #16 membuktikan rollback order; payment ikut dalam tx) |
| 24 | /menu checkout tetap bekerja | **PASS (build/engine)** | `createCustomerOrder` default tidak berubah; build sukses. E2E browser tidak dijalankan |
| 25 | Existing Cashier tetap bekerja | **PASS (build)** | tidak ada perubahan cashier/payment; build sukses. E2E tidak dijalankan |
| 26 | Tenant isolation | **PASS** | purchase.test #20 |
| 27 | Reservation cancellation | **PASS** | purchase.test #18, #19 |
| 28 | Existing refund workflow | **PASS** | purchase.test #19 (order PAID tidak di-cancel) |
| 29 | WhatsApp notifier tetap dapat guestPhone | **PASS** | reservation-whatsapp.unit.test PASS |
| 30 | TypeScript | **PASS** | `npx tsc --noEmit` exit 0 |
| 31 | Build | **PASS** | `npm run build` exit 0 |
| 32 | git diff --check | **PASS** | exit 0 |

**Test suites (semua PASS, exit 0):**
- `reservation.purchase.test.ts` — 21/21
- `reservation-flow.test.ts` — 29/29
- `reservation.service.test.ts` — 47/47
- `reservation.api.test.ts` — 31/31
- `reservation.customer.test.ts` — 17/17
- `reservation.customer-api.test.ts` — 12/12
- `reservation.payment.test.ts` — 24/24
- `reservation.unit.test.ts`, `reservation-whatsapp.unit.test.ts`, `reservation-payment-state.test.ts`, `reservation-payment-format.test.ts`, `reservation-format.test.ts`, `reservation-floor-map.test.ts` — PASS

**Tidak dijalankan (jujur):** runtime browser (picker/search/kategori/review), E2E /menu checkout, E2E cashier, dan webhook iPaymu live (butuh gateway). Tidak ada hasil runtime yang difabrikasi.

---

## 18. TypeScript Result

```
npx tsc --noEmit   → exit 0 (TSC_EXIT=0)
```

---

## 19. Build Result

```
npm run build      → exit 0 (BUILD_EXIT=0)
```
Route wizard `/reservasi`, `/[code]/payment`, `/menu`, `/checkout`, `/order/[orderNumber]`, `/payment/[orderNumber]`, `/api/webhooks/ipaymu` semuanya ter-build.

---

## 20. git status

```
?? AUDIT-PRINT-BILL.md
?? PHASE1.5-PRINT-BILL-VALIDATION.md
```

Hanya dua deliverable PHASE 1/1.5 Print Bill yang untracked (out of scope). Implementasi PHASE 2 sudah ter-commit pada HEAD `d7f29ac`. **Tidak ada commit/push pada sesi ini.**

---

## 21. git diff --check

```
git diff --check   → exit 0 (DIFF_CHECK_EXIT=0)
```
Tidak ada whitespace/conflict marker.

---

## 22. Remaining Limitations

1. **Browser runtime tidak dijalankan** — picker, search, filter kategori, quantity stepper, review, dan halaman bayar QRIS diverifikasi via static code trace + unit test helper, bukan di browser.
2. **E2E /menu checkout & cashier tidak dijalankan** — hanya diverifikasi bahwa engine default tidak berubah dan build sukses.
3. **iPaymu webhook live tidak dijalankan** — hanya alur engine/unit (reservation.payment.test) dan integrasi delegasi ke `paymentService`.
4. **`items` REQUIRED** membuat `POST /api/public/reservations` breaking untuk klien lama tanpa `items` (sesuai keputusan final #2).
5. **Idempotency** bersifat minimal (duplicate booking gate) — retry dengan payload sama mengembalikan 409, bukan replay respons sukses. Sesuai batasan "tanpa idempotency system besar".
6. Commit `5d82cf4` juga memuat perubahan WhatsApp R7 (Baileys/worker/notifier) yang **di luar scope PHASE 2**; tidak dievaluasi ulang di sini.
7. **Print Bill tetap tidak disentuh** (out of scope) — `AUDIT-PRINT-BILL.md` & `PHASE1.5-PRINT-BILL-VALIDATION.md` tetap untracked.
