# PHASE 1 — RESERVATION PAYMENT OWNERSHIP & STATE DESIGN

> Mode: **AUDIT / DESIGN ONLY.** Tidak ada source/schema/migration yang diubah, tidak ada commit/push/deploy,
> tidak ada payment production, tidak ada worker/WhatsApp disentuh, tidak ada data dihapus.
> Repo: `/home/reksa/restorant-cafe` · HEAD `5d82cf4`
>
> Fakta dari Phase 0.1 (dipakai sebagai premis): `referenceId = orderNumber`, `providerRef = Data.Reference || orderNumber`,
> webhook reference = `payload.reference_id`, lookup = `providerRef`, correlation key terbukti **18/18 cocok, 0 mismatch**.

---

## A. AUDIT CURRENT PAYMENT/RESERVATION RELATION (runtime trace)

### A.1 Rantai relasi yang benar-benar dipakai runtime

```
Reservation.orderId  (String?, SCALAR tanpa @relation)
        │  ditulis di reservasi.service.ts:951  (orderResult.order.id)
        ▼
   Order.id  (Order.restaurantId, Order.branchId?, Order.paymentStatus)
        │  Payment.orderId (String, NOT NULL, @relation)
        ▼
   Payment  (status, amount, method, provider, providerRef, qrImage/qrString, expiresAt, paidAt)
        │
        ▼
   PaymentTransaction (paymentId, provider, type, status, rawData)   ← jejak webhook/cashier
```

### A.2 Trace flow nyata (Phase-1 yang sudah terimplementasi)
`test`: `POST /api/public/reservations` → `createPublicReservation` (`reservation.service.ts:642`) →
`createReservation` kernel (`:758`) → `createReservationOrder` (`:598`) →
`orderService.createCustomerOrderInTransaction(tx, …, {reservationMode:true})` (`order.service.ts:639`) →
Order + OrderItem (+ Payment UNPAID bila `paymentMethod="KASIR"`) + `Reservation.orderId` — **satu transaksi** →
`emitCustomerOrderEffects` setelah commit (`reservation.service.ts:985`) → `notifyReservationWhatsApp` (`:993`).

`reservationViews()` (`:205`) membaca ulang Order via `orderIds` (`:217`) dan mengekspos ringkasan:
`orderNumber, status, paymentStatus, paymentMethod, orderType, subtotal/discount/tax/serviceCharge/grandTotal, items[]`
(termasuk `payments[{method,status}]` take 1). DTO publik `_public-dto.ts` membuang `orderId` internal.

### A.3 Dependensi lain pada `Reservation.orderId → Order`
| Dependensi | Lokasi | Dampak bila diubah |
|---|---|---|
| Ringkasan order di view | `reservation.service.ts:205-313`, `:951` | admin/customer UI |
| Cancel → batalkan order UNPAID | `reservation.service.ts:1352` → `orderService.cancelUnpaidLinkedOrderInTransaction` (`order.service.ts:749`) | cancel behavior |
| DTO publik (order ringkas) | `_public-dto.ts` | contract publik |
| Test | `reservation.purchase.test.ts:96-230,590,613,634` | jaring pengaman |
| Guard DTO (tidak bocorkan `orderId`) | `reservation.api.test.ts:273`, `reservation.customer-api.test.ts:280` | security |

**Tidak ada** relasi Balik Prisma / FK `Reservation↔Order` (sengaja scalar). **Tidak ada** `Payment.reservationId`.
`Payment.orderId` dipakai oleh: webhook (`payment.service.ts:1005`), mirror order (`:1085-1090`), cashier (`markCashierPaymentPaid`),
report (`report.service.ts` `groupBy orderId`, join `orderNumber`), refund (`approval.service.ts` — semua by `orderId`),
print bill (`print-bill-dialog.tsx`), order detail (`order-detail.tsx` "Riwayat Pembayaran").

### A.4 Yang SUDAH ada vs yang KURANG
| Sudah ada | Kurang |
|---|---|
| Reservation+Order atomik, `Reservation.orderId` terisi | Payment **tidak** punya tautan eksplisit ke Reservation |
| Order → Payment engine lengkap (QRIS/KASIR, webhook, refund) | Reservation **tidak** punya payment state |
| `reservationViews` sudah membawa `paymentStatus`/`paymentMethod` | Webhook **tidak** resolve ke Reservation |
| Cancel membatalkan order UNPAID | Cancel **tidak** membatalkan Payment PENDING yang hidup |
| — | Layar pembayaran ber-scope **reservation** (customer masih diarahkan ke `/payment/[orderNumber]`) |
| — | Admin reservation detail **tidak** menampilkan pembayaran |

---

## B. OWNERSHIP MODEL — OPTION A vs OPTION B (recommendation final)

### OPTION A — `Payment.reservationId String?` (additive)
```
Reservation ├── Order ── Payment (orderId NOT NULL, reservationId?)
            └── Payment (reservationId)   ← ownership eksplisit
```
| # | Kriteria | Penilaian |
|---|---|---|
| 1 | Complexity | Sedang — kolom baru + wajib menjaga sinkronisasi `reservationId` di setiap createpayment reservasi |
| 2 | Migration risk | **Ada** (aditif: ADD COLUMN nullable + index; non-destruktif, tapi tetap perubahan skema) |
| 3 | Regression risk | Rendah–sedang (Payment engine tersentuh) |
| 4 | Webhook complexity | **Rendah** (langsung `payment.reservationId`) |
| 5 | Reporting compatibility | Aman (orderId tetap NOT NULL) |
| 6 | Refund compatibility | Aman (refund tetap by orderId) |
| 7 | Admin compatibility | Mudah (query pembayaran per reservasi) |
| 8 | Customer history compatibility | Aman |
| 9 | Tenant isolation | Aman (tetap scope restaurantId) |
| 10 | Future extensibility | **Tinggi** (pembayaran tanpa Order mungkin di masa depan) |

### OPTION B — order-centric, Reservation owner secara **logical** (NO schema change)
```
Reservation ── Order ── Payment
payment state reservation = derivasi dari Order.paymentStatus
```
| # | Kriteria | Penilaian |
|---|---|---|
| 1 | Complexity | **Paling rendah** |
| 2 | Migration risk | **NOL** |
| 3 | Regression risk | **Paling rendah** |
| 4 | Webhook complexity | Sedang (Payment → Order → Reservation via `Reservation.orderId`) |
| 5 | Reporting compatibility | **Nol dampak** |
| 6 | Refund compatibility | **Nol dampak** |
| 7 | Admin compatibility | Perlu join kecil (Order → Reservation) |
| 8 | Customer history compatibility | **Nol dampak** |
| 9 | Tenant isolation | Aman (cek `payment.restaurantId === reservation.restaurantId`) |
| 10 | Future extensibility | Sedang (cukup; bisa ditingkatkan ke A nanti tanpa breaking) |

### ✅ RECOMMENDATION FINAL: **OPTION B**

**Alasan:**
1. Memenuhi syarat "**payment terkait secara semantik dengan Reservation**": rantai `Payment → Order → Reservation.orderId`
   memberi ownership yang dapat di-resolve server-side, dan chain webhook yang diminta
   (`PaymentTransaction → Payment → Reservation`) tercapai.
2. **Perubahan minimal & kompatibilitas maksimum** dengan Payment engine: `Payment.orderId` tetap NOT NULL ⇒
   webhook, cashier, refund (`approval.service.ts`), reporting (`report.service.ts`), print bill, order detail
   **tidak berubah sama sekali**.
3. **Tanpa migration** ⇒ tidak ada risiko skema sama sekali (sesuai "prioritaskan perubahan minimal").
4. Order **tetap wajib dibuat** (menu detail, inventory/COGS, reporting, history, kitchen) — sesuai keputusan audit sebelumnya.

**Catatan**: OPTION A bukan salah; ia lebih eksplisit dan lebih extensible. Tetapi ia menambah kolom + migrasi
+ kewajiban sinkronisasi **tanpa manfaat fungsional yang dibutuhkan sekarang**. Bila di masa depan muncul kebutuhan
"pembayaran tanpa Order", tambahkan `Payment.reservationId?` secara aditif **saat itu** — tidak ada yang rusak.

---

## C. PAYMENT STATE RESERVATION

| State yang harus dibedakan | UNPAID · PENDING · PAID · FAILED · EXPIRED · CANCELLED · REFUNDED |

### OPTION 1 (RECOMMENDED) — derive dari `Order.paymentStatus`
Tanpa field baru. Mapping di view (`reservationViews`) → `reservation.payment = { status, method, amount, … }`:
| `Order.paymentStatus` | Reservation payment state (UI) |
|---|---|
| UNPAID | Belum Dibayar |
| PENDING | Menunggu Pembayaran |
| PAID | Lunas |
| FAILED | Gagal |
| EXPIRED | Kedaluwarsa |
| REFUNDED | Dikembalikan |
| CANCELLED | Dibatalkan |
| (reservation tanpa order) | Belum Dibayar / — (legacy admin booking) |
- **Pros**: zero migration, satu sumber kebenaran (Payment/Order sudah authoritative), tidak ada state ganda yang bisa divergen.
- **Cons**: butuh join (sudah ada di `reservationViews`), tidak bisa menyimpan payment-state khusus reservasi di luar order.

### OPTION 2 — tambah `Reservation.paymentStatus PaymentStatus?`
- **Pros**: state tersimpan, query langsung, cocok bila kelak ada pembayaran tanpa Order.
- **Cons**: **migrasi aditif**, dan menciptakan **dua sumber kebenaran** (`Order.paymentStatus` vs `Reservation.paymentStatus`) yang harus disinkronkan di create/webhook/cancel/refund ⇒ risiko divergensi.

### OPTION 3 — pakai `ReservationStatus` untuk payment state
- **Tidak direkomendasikan.** `ReservationStatus { PENDING, CONFIRMED, SEATED, COMPLETED, CANCELLED, NO_SHOW }`
  tidak punya UNPAID/PENDING/PAID/FAILED/EXPIRED/REFUNDED; menambahkannya (a) butuh migrasi enum,
  (b) **mencampur dua lifecycle berbeda** (booking/front-of-house vs payment), (c) akan merusak matriks transisi
  existing dan pemakaian `HOLDING` untuk availability.

### ✅ RECOMMENDATION FINAL: **OPTION 1 (derive)**
Reservation payment state = turunan dari `Order.paymentStatus` (via `Reservation.orderId`). **Tidak menambah enum/kolom.**

---

## D. RESERVATION STATUS TRANSITION (state machine final)

**Fakta existing** (`reservation.service.ts:113-135`): `PENDING → CONFIRMED|CANCELLED`,
`CONFIRMED → SEATED|CANCELLED|NO_SHOW`, `SEATED → COMPLETED`, terminal `COMPLETED/CANCELLED/NO_SHOW`.
`CONFIRMED` menSet `confirmedAt`, membuat reservasi masuk `HOLDING` (memblokir meja), dan memicu WhatsApp CONFIRMED.
⇒ **`CONFIRMED` SUDAH bermakna "reservasi valid/diterima"** — tidak perlu enum baru.

### State machine final (dengan payment terintegrasi)

```
                     ┌───────────────────── QRIS ─────────────────────┐
Reservation dibuat → PENDING ─────────────────────────────────────────┤
                     │ (payment state: PENDING, dari Order.paymentStatus)
                     │
   payment PAID ─────┴──► CONFIRMED (auto, guarded CAS)  → SEATED → COMPLETED
   KASIR           ──────► CONFIRMED (manual oleh staff saat kas diterima — existing)
   payment EXPIRED/FAILED ► tetap PENDING (payment state EXPIRED/FAILED; customer boleh regenerate QR)
   customer pergi         ► tetap PENDING (QR valid sampai expiresAt)
```

| Pertanyaan | Keputusan |
|---|---|
| Kapan reservation dibuat? | Saat submit wizard (`POST /api/public/reservations`) — **tidak berubah** |
| Kapan QRIS dibuat? | **On-demand** saat customer membuka layar pembayaran reservasi (lihat §E) — **bukan** di dalam transaksi reservasi |
| Kapan reservation dianggap CONFIRMED? | **Otomatis** saat `Payment.status = PAID` di webhook (QRIS), atau **manual** oleh staff (KASIR) — memakai `transitionReservation` existing |
| QRIS expired? | Reservation tetap `PENDING`; payment state `EXPIRED`; customer dapat "Buat QR baru" (retry existing) |
| Payment failed? | Reservation tetap `PENDING`; payment state `FAILED`; customer dapat retry |
| Payment pending? | Reservation tetap `PENDING`; payment state `PENDING`; countdown dari `expiresAt` |
| Customer meninggalkan halaman? | Reservation tetap `PENDING`; QR tetap valid sampai `expiresAt`; bila expired → regenerate |
| Staff sudah CONFIRM manual lalu webhook PAID? | Auto-confirm **guard** hanya dari status `PENDING` (CAS) ⇒ tidak menimpa/duplikasi; WhatsApp tidak dikirim dua kali (idempotency per status) |

**Tidak menambah** `PAYMENT_PENDING`/`PAID` ke `ReservationStatus`.

---

## E. QRIS CREATION FLOW

### Kandidat
- **(K1) Eager**: submit → Reservation + Order dibuat **dan** `createPayment(QRIS)` + gateway call di dalam request yang sama.
- **(K2) Lazy/on-demand**: submit → Reservation + Order dibuat; customer membuka layar pembayaran → `createPayment(QRIS)` dipanggil saat itu.

### ✅ RECOMMENDATION FINAL: **K2 (lazy/on-demand)**

Alasan:
1. **Jangan menahan lock di atas network I/O.** Kernel reservasi sudah memegang `branch`/`table FOR UPDATE`;
   memanggil gateway (HTTP) di dalamnya memperpanjang lock dan memperbesar risiko timeout/deadlock — pola yang
   sudah dihindari `payment.service.createPayment` (gateway call **di luar** lock).
2. **Menghindari orphan PENDING QRIS** bila customer tidak jadi membayar (abandon sebelum membuka bayar).
3. **Reuse 100%** proteksi existing: `createPayment` sudah idempotent (live PENDING QRIS dikembalikan),
   `order FOR UPDATE`, CAS `updateMany`, stale-PENDING → EXPIRED, amount dari DB.
4. `paymentMethod="KASIR"` tetap membuat Payment UNPAID atomik (existing) — tidak berubah.

Alur final:
```
submit → Reservation + Order (atomik)          [existing]
      → layar pembayaran reservasi
      → POST /api/public/reservations/[code]/payment   → paymentService.createPayment(orderId, restaurantId, {method:"QRIS"})
      → QR tampil, poll GET .../[code]/payment
      → webhook iPaymu → Payment PAID → Order.paymentStatus PAID → Reservation CONFIRMED
```

Perhatikan (semua **sudah** ditangani existing): idempotency, duplicate request, refresh (live PENDING dikembalikan),
retry (FAILED/EXPIRED → QR baru), `FOR UPDATE`, CAS, `expiresAt`, amount validation (`order.grandTotal`).
**Tidak membuat QRIS engine baru.**

---

## F. WEBHOOK FLOW (perubahan minimum)

Trace existing: `POST /api/webhooks/ipaymu` → `parseWebhookPayload` → `handleWebhook`
→ lookup `providerRef` → idempotent/amount check → `$transaction`: guard CANCELLED → CAS `Payment.status`
→ `PaymentTransaction` → mirror `Order.paymentStatus` → realtime.

**Perubahan minimum tambahan (di dalam transaksi yang sama, setelah mirror Order):**
```
if (webhookData.status === "PAID") {
  const reservation = await tx.reservation.findFirst({
    where: { orderId: payment.orderId, restaurantId: payment.restaurantId },
  });
  if (reservation) {
    if (reservation.status === "CANCELLED") {
      // catat ke PaymentTransaction rawData (ignoredReason: "RESERVATION_CANCELLED") — JANGAN hidupkan kembali
    } else if (reservation.status === "PENDING") {
      await tx.reservation.updateMany({ where: { id: reservation.id, status: "PENDING" },
        data: { status: "CONFIRMED", confirmedAt: new Date() } });   // CAS → tidak double-confirm
    }
  }
}
```
Setelah commit (best-effort, di luar transaksi): `notifyReservationWhatsApp` (CONFIRMED) + realtime events.

| Kondisi | Hasil |
|---|---|
| `Payment PAID` | Reservation `PENDING → CONFIRMED` (CAS), `confirmedAt` di-set, WhatsApp CONFIRMED |
| `Payment EXPIRED` | Reservation **tetap `PENDING`** (payment state EXPIRED) — tidak false-confirm |
| `Payment FAILED` | Reservation **tetap `PENDING`** — tidak false-confirm |
| Callback PAID setelah reservation `CANCELLED` | **Diabaikan** (tidak menghidupkan reservasi); tercatat di `PaymentTransaction` |
| Webhook PAID ganda | Guard `reservation.status === "PENDING"` (CAS) ⇒ hanya sekali; idempotency Payment existing tetap |
| Reservation sudah CONFIRMED manual | Tidak disentuh (CAS gagal) |

**Webhook tetap idempotent** — semua flip berguard; signature/parse **tidak** disentuh.

---

## G. CANCELLATION / REFUND

**Engine existing** (tidak membuat baru): `order.service.cancelUnpaidLinkedOrderInTransaction` (cancel order unpaid),
`approval.service.ts` `requestRefund` (`:72`) + `decideRefund` (`:352`) + restore stock, route `/api/refunds/*`,
`/api/cancellations/*`, dan `shift.service.ts` wrapper. Semua refund **by `orderId`** (`Refund.orderId` NOT NULL).

| Case | Aksi final | Catatan |
|---|---|---|
| **1. CANCELLED sebelum payment** | Cancel order UNPAID (existing) + **batalkan Payment PENDING bila ada** (tambahan minimal) | Payment state → CANCELLED |
| **2. CANCELLED saat QRIS PENDING** | Sama; live PENDING Payment di-`CANCELLED` berguard ⇒ webhook PAID yang menyusul **ditolak** (guard existing `IGNORED_CANCELLED`) | Menutup G6/G7 audit |
| **3. CANCELLED setelah PAID** | Order PAID **tidak disentuh** (existing); refund lewat `approval.service` (Refund by orderId); setelah refund → `Payment.status = REFUNDED` | Reuse engine, tanpa refund engine baru |
| **4. Payment EXPIRED** | Tidak mengubah reservation (tetap PENDING); customer regenerate QR | existing |
| **5. Payment FAILED** | Tidak mengubah reservation; customer retry | existing |
| **6. Duplicate webhook PAID** | Early return + CAS ⇒ sekali saja | existing |
| **7. Webhook PAID setelah reservation CANCELLED** | Diabaikan + dicatat; **tidak** mengembalikan reservasi ke CONFIRMED | tambahan minimal §F |

Keputusan bisnis yang perlu dikonfirmasi: apakah refund setelah PAID = **full** (karena reservasi batal) dan siapa
yang menyetujui (admin, password) — memakai alur approval existing.

---

## H. CUSTOMER UX

### Konvensi routing existing yang ditemukan
| Resource | Route existing |
|---|---|
| Order payment | `src/app/(customer)/payment/[orderNumber]/page.tsx` |
| Order detail/kasir | `src/app/(customer)/order/[orderNumber]/page.tsx` |
| Reservation wizard | `src/app/(customer)/reservasi/page.tsx` (single page) |
| Reservation (akun customer) | `src/app/(customer)/account/reservasi/[code]/page.tsx` |
| Reservation lookup admin | `src/app/api/admin/reservations/code/[code]/route.ts` |

⇒ Konvensi aplikasi = **`<resource>/[key]`** (kode reservasi selalu jadi key: `[code]`).

### ✅ RECOMMENDATION FINAL: **`/reservasi/[code]/payment`**
- Konsisten dengan `account/reservasi/[code]` (reservation key = `[code]`) dan pola item-child.
- Alternatif `/reservasi/payment/[code]` kurang konsisten (menaruh `payment` sebagai collection, `code` sebagai item)
  dan tidak mengikuti penempatan key yang sudah dipakai di app.
- **Customer TIDAK diarahkan ke `/payment/[orderNumber]`** untuk reservasi.

Alur: `Reservation → Review → [Bayar QRIS] → /reservasi/[code]/payment → Waiting → PAID → Reservation Confirmed`.

Isi layar minimal: reservation code · restaurant · branch · date · time · table · customer · order items ·
subtotal · discount · tax · service charge · grand total · QRIS (qrImage/qrString) · payment status · expiry ·
countdown · refresh/retry · success state · expired state · failed state.
**Tidak** mengekspos: API key / VA credential / provider secret / `qrString` mentah di DOM publik non-perlu / internal id
yang tidak perlu (`orderId`, `customerId`, `paymentId` internal).

---

## I. ADMIN RESERVATION

**Temuan struktur (koreksi asumsi):** **tidak ada** route `/admin/reservations/[id]`. Halaman admin reservasi
adalah daftar + **modal** `src/components/admin/reservations/reservation-detail.tsx`, yang me-refresh via
`GET /api/admin/reservations/[id]` (`requireRoles(["ADMIN","CASHIER"])` + branch scope).

**Perlu ditambahkan (read-only, additive) di modal + respons API:**
payment status · payment method · amount · provider · transaction/reference · `paidAt` · expiry · refund status (bila ada).

**Jangan** membuat manajemen pembayaran baru: admin **tetap** memakai engine existing
(`/api/payments/*`, `/api/refunds/*`, kasir QRIS screen, `order-detail.tsx` "Riwayat Pembayaran" sebagai referensi UI).
Jangan expose secret (`qrString` mentah hanya seperlunya, tanpa provider VA/apiKey).

---

## J. REPORTING

| Report | Sumber | Dampak |
|---|---|---|
| Sales report | `Order` `status != CANCELLED AND paymentStatus = 'PAID'` | **Tidak berubah** — reservation QRIS tetap menghasilkan Order PAID |
| Payment report | `prisma.payment` join `order.orderNumber`, `groupBy orderId` | **Tidak berubah** — `Payment.orderId` tetap NOT NULL |
| Order history | `Order` + items | **Tidak berubah** |
| Customer history | `Customer.orders` | **Tidak berubah** |
| Revenue aggregation | Paid orders | **Tidak berubah** |
| Refund | `Refund.orderId` | **Tidak berubah** |
| Cancellation | `CancellationRequest.orderId` | **Tidak berubah** |

**Syarat mutlak:** Order **wajib tetap dibuat** untuk pembelian reservasi (baik Option A maupun B). Bila kelak
ada varian "reservation payable tanpa Order", reporting akan putus ⇒ **jangan**.
Opsi tambahan (bukan wajib): laporan "Reservation revenue" terpisah, additive.

---

## K. TENANT ISOLATION

| Akses | Bagaimana tenant di-resolve (server-side) |
|---|---|
| Customer public reservation payment | `resolvePublicReservationRestaurant` (pola existing) + `restaurantId` dari reservasi hasil lookup (bukan dari client) |
| Admin reservation payment | `requireRoles` → `ctx.restaurantId` + `authorizedBranches(ctx)` (branch scope) |
| Webhook payment | `payment.restaurantId` (dari Payment hasil lookup `providerRef`), lalu cek `reservation.restaurantId === payment.restaurantId` |
| Order | `Order.restaurantId` |
| Payment | `Payment.restaurantId` |
| Reservation | `Reservation.restaurantId` |

**Jangan percaya dari client**: `restaurantId`, `amount`, payment status, `orderId`, `reservationId`.
Semua di-resolve dari relasi server-side: `code → Reservation → restaurantId`, `Payment.providerRef → restaurantId`.
Ownership publik reservasi diverifikasi dengan `guestPhone` (normalized) **atau** customer session (`customerId`) —
konsisten dengan `getReservationByCodeForGuest`.

---

## L. IDEMPOTENCY / RACE CONDITIONS

| Skenario | Proteksi existing | Tambahan diperlukan |
|---|---|---|
| 1. Customer klik bayar 2× | `createPayment` idempotent (live PENDING QRIS dikembalikan) + order `FOR UPDATE` | tidak ada |
| 2. Refresh payment page | `GET` status (read-only) + reuse live PENDING | tidak ada |
| 3. Dua browser buka payment | order `FOR UPDATE` → satu intent; yang kedua dapat intent sama | tidak ada |
| 4. Webhook PAID 2× | early-return `PAID` + CAS `updateMany(status: current)` | tidak ada |
| 5. Webhook PAID + retry bersamaan | CAS order lock | tidak ada |
| 6. QRIS expired + webhook delayed | stale PENDING → EXPIRED (route public) + webhook EXPIRED guarded | tidak ada |
| 7. Reservation CANCELLED + webhook PAID | guard Payment `CANCELLED` → `IGNORED_CANCELLED` | **guard Reservation CANCELLED** (§F) |
| 8. Payment creation timeout tapi gateway sukses | gateway call di luar lock; gagal → `FAILED` + order mirror `FAILED`; webhook menyusul | tidak ada |
| 9. Cancel saat QRIS PENDING (baru) | — | **batalkan Payment PENDING berguard** (§G case 2) |

**Tidak** membuat mekanisme baru; hanya **2 tambahan minimal** (guard reservation CANCELLED di webhook, cancel Payment PENDING).

---

## M. API DESIGN (minimal)

### M.1 `POST /api/public/reservations/[code]/payment`
| Aspek | Rancangan |
|---|---|
| Auth | publik, **rate-limited** (pola `public-payment-create`, 30/min) |
| Input | `{ method?: "QRIS" \| "KASIR" }` (+ ownership: `phone` normalized ATAU customer session) |
| Lookup server-side | `code → Reservation` (tenant di-resolve server-side) → `Reservation.orderId → Order` |
| Validation | reservasi ada & tenant cocok; `orderId` tidak null; order belum `PAID`; order tidak `CANCELLED`; `method` DINE_IN-only |
| Action | `paymentService.createPayment(order.id, order.restaurantId, {method}, branchFilters)` |
| Response | `{ reservationCode, status, method, amount, paymentId, qrImage, qrString|null, paymentUrl|null, expiresAt, reference }` (tanpa secret) |
| Error | 404 (tidak ditemukan/tenant), 409 (sudah PAID / CANCELLED / belum ada order), 422 (validasi), 429 (rate limit) |
| Idempotency | live PENDING QRIS dikembalikan (tidak menumpuk intent) |
| Tenant isolation | `restaurantId` dari reservasi hasil lookup; branch dari order |

### M.2 `GET /api/public/reservations/[code]/payment`
| Aspek | Rancangan |
|---|---|
| Auth | publik, rate-limited (pola `public-payment-status`, 120/min untuk poll 4s) |
| Input | `code` + ownership (`phone` / session) |
| Response | status pembayaran + QR + `expiresAt` + `paidAt` + ringkasan reservasi/order (aman) |
| Error | 404 / 422 / 429 |
| Catatan | **read-only**, tanpa efek samping |

**Alternatif**: memakai ulang `/api/public/payments` (by `orderNumber`) — tetapi itu mengungkap `orderNumber` ke
customer dan mengaburkan ownership reservasi. **Rekomendasi**: endpoint ber-scope `[code]` di atas.
**Tidak** mengubah endpoint existing.

---

## N. FILE IMPACT

### MUST CHANGE
- `src/services/reservation/reservation.service.ts` — payment state derivation di `reservationViews`; cancel Payment PENDING saat transisi `CANCELLED`; helper resolve reservasi by orderId (untuk webhook).
- `src/services/payment/payment.service.ts` — `handleWebhook`: tambah resolusi+guard Reservation (PAID → CONFIRMED CAS; CANCELLED → ignore).
- `src/services/reservation/reservation.types.ts` — tipe ringkasan pembayaran reservasi (additive).
- **BARU** `src/app/api/public/reservations/[code]/payment/route.ts` (POST + GET).
- **BARU** `src/app/(customer)/reservasi/[code]/payment/page.tsx` (layar QRIS reservasi).
- `src/app/(customer)/reservasi/page.tsx` — CTA success → `/reservasi/[code]/payment` (bukan `/payment/[orderNumber]`).
- `src/components/admin/reservations/reservation-detail.tsx` — blok Pembayaran.
- `src/app/api/admin/reservations/[id]/route.ts` — (via view) sertakan detail pembayaran.

### OPTIONAL
- `src/app/(customer)/reservasi/reservation-flow.ts` — helper copy/format pembayaran.
- `src/app/(customer)/account/reservasi/[code]/page.tsx` — tampilkan status pembayaran reservasi.
- `src/components/customer/reservation/reservation-payment-screen.tsx` (bila layar dijadikan komponen bersama).
- `src/services/report/report.service.ts` — laporan reservation terpisah (bila diminta).
- Test: `src/services/reservation/*.test.ts`, `src/services/payment/*.test.ts`, `src/app/(customer)/reservasi/reservation-flow.test.ts`.

### DO NOT TOUCH
- `src/services/whatsapp/**` (session-manager, Baileys provider, `whatsapp-notifier.ts`), `src/workers/**`
- `src/services/reservation/reservation-whatsapp.ts`
- `src/services/reservation/reservation.slots.ts` (availability R5.1)
- `src/app/(customer)/payment/[orderNumber]`, `src/app/(customer)/order/[orderNumber]`, `menu`, `cart`, `checkout`
- `src/services/order/order.service.ts` — **jangan ubah perilaku default** (`createCustomerOrder` harus tetap identik)
- `src/services/approval/approval.service.ts` (reuse, jangan modifikasi)
- iPaymu provider signature/parse (`ipaymu.provider.ts` `validateWebhook`/`parseWebhookPayload`)
- `prisma/schema.prisma` (kecuali keputusan berubah ke OPTION A)

---

## O. DATABASE IMPACT

**Migration: NO** (dengan OPTION B).

Ownership pembayaran reservasi tetap dapat dilakukan melalui **relasi existing**:
1. `Reservation.orderId` (scalar, sudah ada & sudah ditulis) → `Order.id` → `Payment.orderId` (**NOT NULL**, existing).
2. Payment state reservasi = turunan `Order.paymentStatus` (tanpa kolom baru).
3. Webhook resolve: `Payment.providerRef → Payment.orderId → Order.id → Reservation.orderId` (semua existing).

Tidak ada tabel/kolom/index baru, tidak ada backfill, tidak ada perubahan data.
**Bila** kelak pindah ke OPTION A, migrasi = additif: `ADD COLUMN Payment.reservationId VARCHAR(191) NULL` +
`ADD INDEX payment_reservationId_idx` (+ opsional `Reservation.paymentStatus/paidAt`), semua nullable, non-destruktif.
**DILARANG**: reset/drop/alter destruktif.

---

## P. SECURITY IMPACT

| Area | Sudah tersedia | Perlu ditambahkan |
|---|---|---|
| Authorization | `requireRoles`/`requireAdmin` + branch scope (admin); publik rate-limited | verifikasi ownership publik (`code` + `phone`/session) di endpoint baru |
| Tenant isolation | semua query existing restaurant-scoped | cek `payment.restaurantId === reservation.restaurantId` di webhook |
| Amount tampering | `Payment.amount` **selalu** dari `Order.grandTotal` (DB) | — (pertahankan; jangan terima amount dari client) |
| Payment status tampering | hanya webhook signature-verified yang menyetel PAID | — |
| Reservation code enumeration | kode non-sekuensial (`R-XXXXXXXX`) + rate limit + phone/session | rate limit endpoint baru (reuse pola) |
| Webhook signature | `validateWebhook` HMAC (VA secret), X-Signature | — (jangan ubah) |
| Payment secret exposure | DTO publik tidak mengekspos `provider`/`paymentUrl`/`providerRef` sensitif | pastikan layar reservasi hanya `qrImage`/`qrString`/status |
| Duplicate payment | idempotent live PENDING + PAID terminal | — |
| Replay webhook | idempotency `PAID` + CAS + `IGNORED_*` | — |
| Webhook after cancel | guard Payment `CANCELLED` | guard Reservation `CANCELLED` |

---

## Q. REGRESSION RISK

| Area | Rating | Alasan / mitigasi |
|---|---|---|
| Payment | **MEDIUM** | `payment.service.ts` tersentuh (additif di `handleWebhook`); state machine lama tidak diubah; jalankan regression payment |
| iPaymu webhook | **MEDIUM–HIGH** | perubahan di jalur webhook; signature/parse **tidak** disentuh; uji callback |
| Order | **LOW** | tidak mengubah `createCustomerOrder` default |
| Reservation | **LOW–MEDIUM** | tambah derive state + cancel Payment PENDING |
| Customer reservation | **LOW** | layar baru; wizard existing tetap |
| Admin reservation | **LOW** | additive di modal |
| Refund | **LOW** | engine existing tidak disentuh |
| Reporting | **LOW** | Order tetap dibuat |
| **WhatsApp** | **NONE — DO NOT CHANGE** | `reservation-whatsapp.ts` + notifier tidak disentuh; hanya **dipanggil** pada CONFIRMED otomatis |

---

## R. FINAL DESIGN DECISION

1. **Ownership:** **OPTION B** — order-centric dengan Reservation sebagai owner **logical** via `Reservation.orderId`;
   `Payment.orderId` tetap NOT NULL. (Tanpa migration.)
2. **Payment state:** **OPTION 1** — derive dari `Order.paymentStatus` (7 state terpetakan), tanpa field/enum baru.
3. **Reservation confirmation:** **CONFIRMED otomatis** saat `Payment.status = PAID` (webhook, CAS `PENDING→CONFIRMED`
   + `confirmedAt` + WhatsApp CONFIRMED). Untuk **KASIR**: CONFIRMED manual oleh staff (existing).
4. **QRIS creation:** **on-demand (K2)** saat customer membuka `/reservasi/[code]/payment` — bukan di dalam transaksi reservasi.
5. **Webhook (perubahan minimum):** setelah mirror Order, resolve `Reservation` via `orderId`;
   `PAID` → CAS `CONFIRMED`; `RESERVATION_CANCELLED` → abaikan + catat; `EXPIRED`/`FAILED` → reservation tetap `PENDING`.
6. **Cancellation policy:** cancel sebelum/ketika PENDING → cancel Order UNPAID (existing) **+** batalkan live Payment PENDING (tambahan);
   cancel setelah PAID → jalur refund approval existing.
7. **Refund:** **reuse engine existing** (`approval.service.ts` + `/api/refunds/*`) — **tidak** membuat refund engine baru.
8. **API final:** `POST` + `GET /api/public/reservations/[code]/payment` (ownership: `code` + `phone`/session, rate-limited).
9. **UI route final:** `/reservasi/[code]/payment` (customer); admin = blok pembayaran di modal `reservation-detail.tsx`.
10. **Migration:** **NO.**
11. **Exact files final:** lihat §N (MUST CHANGE 8 item + 1 BARU API + 1 BARU page; OPTIONAL; DO NOT TOUCH).
12. **Implementation phases:**
    - **Phase 2 (backend):** endpoint `[code]/payment` (POST/GET) + derive payment state di `reservationViews`
      + cancel Payment PENDING saat CANCELLED + guard Reservation di `handleWebhook` (PAID→CONFIRMED, CANCELLED→ignore).
    - **Phase 3 (customer UI):** `/reservasi/[code]/payment` (QR, status, countdown, refresh/retry, success/expired/failed)
      + ganti CTA success wizard.
    - **Phase 4 (admin UI):** blok Pembayaran di `reservation-detail.tsx` + ekspos di `GET /api/admin/reservations/[id]`.
    - **Phase 5 (verification):** test unit/service (webhook→reservation, cancel→payment cancel, idempotency),
      regression (Order QRIS, Cashier Cash, Cashier QRIS, webhook, checkout, reservation, WhatsApp, inventory,
      refund/cancellation, reporting, availability, multi-branch), lalu `tsc --noEmit` + `build` + `git diff --check` + E2E sandbox.

**WhatsApp: DO NOT CHANGE** — tetap untouched.

---

**STOP — PHASE 1 SELESAI. Tidak ada coding, tidak ada migration, tidak ada commit/push/deploy,
tidak ada payment production, tidak ada perintah destruktif.**
