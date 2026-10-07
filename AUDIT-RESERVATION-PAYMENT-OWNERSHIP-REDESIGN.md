# AUDIT — RESERVATION PAYMENT OWNERSHIP REDESIGN

> Mode: **AUDIT ONLY**. Tidak ada kode, schema, migration, atau data yang diubah.
> Tidak ada commit/push/deploy. Tidak ada perintah destruktif.
> Repo: `/home/reksa/restorant-cafe` · branch `main` · HEAD `70226bc`
>
> Tujuan: ketika sebuah reservation membutuhkan pembayaran, **QRIS/payment dibuat dan
> dibayar sebagai PAYMENT RESERVATION** — ownership pembayaran berada pada
> **Reservation**, bukan Order — tanpa membuat payment engine / QRIS engine baru,
> tanpa merusak flow Order/Cashier/QRIS yang sudah ada.
>
> Catatan penting: audit ini menemukan bahwa **Phase-1 (Reservation → Order → Payment
> sudah terintegrasi) SUDAH terimplementasi di working tree** — lihat §A/§B. Jadi
> titik berangkatnya bukan "belum ada integrasi", melainkan "integrasi ada tetapi
> **ownership-nya Order-centric** dan customer di-redirect ke halaman Order".

---

## A. EXISTING FUNCTIONALITY

### A.1 Reservation engine (sudah lengkap)
- Kernel tunggal `reservationService.createReservation()` (`src/services/reservation/reservation.service.ts:758`)
  berjalan dalam satu `prisma.$transaction`: **branch `FOR UPDATE`** → validasi window/slot/horizon
  (`validateReservationWindow`, `reservation.slots.ts:455`) → validasi customer link → **table `FOR UPDATE`**
  + tolak overlap (`409 TABLE_NOT_AVAILABLE`) → duplicate check (phone/customer + date + start, status HOLDING)
  → INSERT `Reservation` → COMMIT.
- Status machine existing (`reservation.service.ts:125`):
  `PENDING → CONFIRMED|CANCELLED`, `CONFIRMED → SEATED|CANCELLED|NO_SHOW`,
  `SEATED → COMPLETED`, `COMPLETED/CANCELLED/NO_SHOW` terminal.
  `HOLDING = PENDING/CONFIRMED/SEATED/COMPLETED` (yang memblokir meja).
- Transisi di `transitionReservation()` (`:1293`) memakai **conditional `updateMany({where:{id, status}})`**
  (CAS) + set timestamp sekali (tidak pernah reset).
- Cancellation: `cancelReservation()` (`:1264`) = transisi ke `CANCELLED`.
- Notification WhatsApp R7 (`notifyReservationWhatsApp`, `:391`) dipanggil setelah commit create (`:993`) dan
  setelah transisi (`:1377`) — best-effort, tidak pernah rollback.
- API: admin `GET/POST /api/admin/reservations`, `[id]`, `[id]/status` (PATCH), `[id]/cancel`, `code/[code]`,
  `availability`; public `GET/POST /api/public/reservations`, `[code]`, `availability`; customer account
  `/api/public/customer/account/reservations/*`.

### A.2 Phase-1 reservation purchase integration (SUDAH ADA di working tree)
- `CreatePublicReservationSchema` (`reservation.types.ts` §"Create — public") **mewajibkan `items[]`**
  (min 1, shape = `OrderItemInputSchema`) dan menerima opsi `paymentMethod: "QRIS"|"KASIR"`.
- `createReservationOrder()` (`reservation.service.ts:598`) memanggil
  `orderService.createCustomerOrderInTransaction(tx, {...}, restaurantId, customerId, branchId, { reservationMode: true })`
  → **Order + OrderItems (+ Payment UNPAID bila KASIR) dibuat di transaksi yang sama**.
- `Reservation.orderId` (`prisma/schema.prisma:661`, scalar `String?`, sengaja tanpa relasi) **ditulis**
  (`reservation.service.ts:951`) dan dibaca kembali oleh `reservationViews()` (`:205`).
- Setelah commit, `orderService.emitCustomerOrderEffects(...)` dipanggil (`:985`).
- `createAdminReservation` (`:691`) **tidak** membawa `items` → booking admin tetap bebas pembelian.
- Gate lama R6/R6.5 (`assertQualifyingPurchase` / `checkPurchaseEligibility` / `/purchase-eligibility`)
  **sudah dihapus** dari service & route (sisa konstanta copy `PURCHASE_REQUIRED_HINT` di
  `reservation-flow.ts:368`).

### A.3 Order engine
- `createCustomerOrder` (`order.service.ts:189`) / `createCustomerOrderInTransaction` (`:639`) →
  validasi + pricing **100% server-side** (`buildCustomerOrderContext` `:787`, `persistCustomerOrder`),
  `Table.status` **tidak** di-OCCUPIED bila `reservationMode` (`:1271`), `paymentMethod: KASIR`
  membuat Payment UNPAID atomik.
- `VALID_STATUS_TRANSITIONS` (`order.service.ts:32`): PENDING→CONFIRMED|CANCELLED, CONFIRMED→PROCESSING|CANCELLED,
  PROCESSING→READY|CANCELLED, READY→COMPLETED, terminal COMPLETED/CANCELLED.
- `cancelUnpaidLinkedOrderInTransaction` (`:749`) — membatalkan order reservasi yang **belum PAID**
  (order dengan `paymentStatus = PAID` **tidak disentuh**).
- `updateOrderStatus` (`:1587`) dengan CAS + notifikasi WhatsApp READY (`:1808`).

### A.4 Payment engine
`src/services/payment/payment.service.ts` (1384 baris) — sudah mature:
`createPayment` (QRIS/KASIR/VA), `switchToCashier`, `markCashierPaymentPaid`,
`createKasirQrisPayment`, `handleWebhook`, `getPayments/getPayment/getPaymentUrl`.
- **Source of truth**: `Payment.status` + mirror `Order.paymentStatus`.
- `Payment.amount` **selalu** dihitung dari DB (`lockedOrder.grandTotal`) — klien tidak pernah menentukan nominal.
- Idempotency/CAS: order row `FOR UPDATE`, `updateMany` berguard, early-return untuk `PAID`, guard `CANCELLED`,
  guard stale (`IGNORED_STALE`/`IGNORED_CANCELLED` dicatat ke `PaymentTransaction`).
- `PaymentTransaction[]` = jejak audit per payment.

### A.5 Provider iPaymu (QRIS + VA)
`src/services/payment/providers/ipaymu/ipaymu.provider.ts` — `createPayment` (direct `/payment/direct`,
`channel: "qris"|"va"`), `validateWebhook` (HMAC-SHA256 secret = **VA number**, header `X-Signature`,
3 variasi normalisasi), `parseWebhookPayload` (`reference_id`, `status`, `amount` → mapped status).
- Webhook route: `POST /api/webhooks/ipaymu` (`src/app/api/webhooks/ipaymu/route.ts`) → `paymentService.handleWebhook`.

### A.6 Reporting
`src/services/report/report.service.ts` — sales report menghitung omzet dari `Order` dengan
`status != CANCELLED AND paymentStatus = 'PAID'`; payment report dari `prisma.payment` (join `order.orderNumber`,
`groupBy orderId`).

---

## B. CURRENT RESERVATION PAYMENT FLOW

**Customer (wizard `src/app/(customer)/reservasi/page.tsx`)** — urutan step:
`Cabang → Tanggal → Jumlah Orang → Jam → Meja → Pembelian (product picker lokal) → Data Customer → Review
(termasuk pilih metode QRIS/KASIR) → Submit`.
Saat review, teks eksplisit: *"Status pembayaran: belum dibayar — pembayaran diselesaikan setelah reservasi dibuat."*
(`page.tsx` ~1638).

**Submit**: `POST /api/public/reservations` → `createPublicReservation` → kernel transaksional:
```
Reservation + Order + OrderItems  (+ Payment UNPAID bila paymentMethod=KASIR)  [SATU TRANSAKSI]
Reservation.orderId = order.id
```
Respons publik (`toPublicReservationDto`) membawa ringkasan `order`:
`orderNumber, status, paymentStatus, paymentMethod, subtotal/discount/tax/serviceCharge/grandTotal, items[]`.

**Setelah submit (success screen `page.tsx` ~1826):** customer melihat ringkasan order dan tombol:
- `QRIS` → **`<Link href="/payment/[orderNumber]">`** → customer **keluar dari flow reservasi** dan masuk ke
  halaman pembayaran **Order**, di sana QRIS dibuat via `POST /api/public/payments {orderNumber, method:"QRIS"}`.
- `KASIR` → **`<Link href="/order/[orderNumber]">`** → bayar di kasir.

**Akibatnya hari ini:**
1. **Payment dimiliki Order** (`Payment.orderId` NOT NULL; tidak ada `Payment.reservationId`).
2. **Status Reservation TIDAK berubah saat pembayaran** — tetap `PENDING` (tidak ada
   `PAYMENT_PENDING`/`PAID`). Konfirmasi tetap manual oleh admin/kasir.
3. Pembuatan QRIS **tidak** dilakukan server-side saat reservasi dibuat (kecuali KASIR); QRIS baru dibuat setelah
   customer membuka halaman Order.
4. Webhook hanya resolve `payment → order`; **tidak ada** rantai `payment → reservation`.
5. `Reservation.orderId` sudah ada tetapi hanya sebagai scalar; tidak dipakai webhook.

**Admin**: `createAdminReservation` tidak membawa items ⇒ reservasi admin tanpa Order maupun Payment.
`ReservationDetail` (`src/components/admin/reservations/reservation-detail.tsx`) **tidak menampilkan
pembayaran sama sekali** (padahal `ReservationView.order` sudah membawa `paymentStatus`/`paymentMethod`).

---

## C. CURRENT ORDER PAYMENT FLOW

```
/menu → cart → /checkout → POST /api/public/orders (createCustomerOrder)
   → Order PENDING / UNPAID (+ OrderItems harga server-side)
   → (QRIS) POST /api/public/payments {orderNumber, method:"QRIS"}
        → paymentService.createPayment → gateway iPaymu channel "qris"
        → Payment PENDING {providerRef, paymentUrl, qrImage, qrString, expiresAt}
        → Order.paymentStatus = PENDING
     customer poll GET /api/public/payments/[orderNumber] tiap 4 detik
        → (KASIR) Payment UNPAID → markCashierPaymentPaid (shift-linked) → PAID + Order PROCESSING
webhook POST /api/webhooks/ipaymu
   → validateWebhook (HMAC, VA secret) → parseWebhookPayload
   → findFirst Payment where providerRef = payload.reference_id|Reference
   → amount match (tolerance 0.01) → guarded updateMany Payment.status (+paidAt)
   → mirror Order.paymentStatus (hanya bila order masih mencerminkan state intent tsb)
   → PaymentTransaction (status PAID/FAILED/EXPIRED/CANCELLED atau IGNORED_*)
```
Terminal: `Order.paymentStatus = PAID` tidak pernah bisa di-downgrade; order tidak bisa dibayar dua kali.

---

## D. CURRENT QRIS IMPLEMENTATION

| Aspek | Implementasi existing | Lokasi |
|---|---|---|
| Channel | `"qris"` pada iPaymu direct payment (`paymentChannel: "qris"`) | `ipaymu.provider.ts` `createPayment` |
| Endpoint | `POST {baseUrl}/payment/direct` | idem |
| Body | `name, phone, email, amount (string), product[], qty[], price[], referenceId=orderNumber, account=VA, returnUrl=/payment/callback, notifyUrl=/api/webhooks/ipaymu, cancelUrl=/order/{orderNumber}` | idem |
| Signature | `HMAC-SHA256(apiKey)` atas `POST:VA:sha256(jsonBody):apiKey`; header `va, signature, timestamp` | idem |
| Output | `reference` (`Data.Reference`), `paymentUrl` (fallback = QrImage), `qrImage` (di-resolve dari HTML wrapper → data URI), `qrString`, `expiresAt` (`parseExpired`, fallback +24 jam) | idem `resolveQrImage`, `parseExpired` |
| Simpan | `Payment.providerRef = reference`, `paymentUrl`, `qrImage`, `qrString`, `expiresAt` | `payment.service.ts:352` |
| Render | `QRCode.toDataURL(qrString)` bila `qrImage` null; countdown dari `expiresAt`; poll 4s sampai terminal | `src/app/(customer)/payment/[orderNumber]/page.tsx` |
| Webhook validasi | HMAC secret = **VA number**, header `X-Signature`, 3 varian normalisasi payload | `ipaymu.provider.ts` `validateWebhook` |

**Jawaban pertanyaan "bisakah QRIS generator existing dipakai langsung untuk Reservation?"**
**YA** — `paymentService.createPayment(orderId, restaurantId, {method:"QRIS"})` tidak peduli order itu berasal dari
checkout biasa atau dari reservasi; yang dibutuhkan hanyalah sebuah **orderId milik tenant yang benar**.
**Tidak boleh** membuat QRIS engine baru.

> ⚠️ **MUST-VERIFY (correlation key.webhook):** saat create, `providerRef` diisi dari
> `Data.Reference` (reference gateway). Saat webhook, lookup memakai
> `providerRef = payload.reference_id || payload.Reference`, sedangkan yang kita kirim sebagai
> `referenceId` adalah `orderNumber`. Kedua nilai ini **harus identik** agar webhook menemukan
> `Payment`. Kalau iPaymu mengembalikan `Data.Reference ≠ reference_id`, lookup webhook akan gagal
> (`404 Payment not found`). Ini adalah risiko yang harus diverifikasi terhadap callback sandbox
> **sebelum** mendesain ulang rantai webhook reservation (lihat §E/§F/§Q).

---

## E. CURRENT WEBHOOK ARCHITECTURE

`POST /api/webhooks/ipaymu` (publik, tanpa auth) → `paymentService.handleWebhook(body, x-signature)`:

1. `validateWebhook` (HMAC; gagal → `PaymentError`).
2. `parseWebhookPayload` → `{ reference, status: PAID|PENDING|FAILED|EXPIRED|CANCELLED, amount }`.
3. `prisma.payment.findFirst({ where: { providerRef: webhookData.reference }, include: { order: true } })`
   → **tidak ditemukan** ⇒ `NotFoundError`.
4. Idempotent: sudah `PAID` → return; status `PENDING` → no-op.
5. Bila `PAID`: verifikasi `|payment.amount − webhook.amount| ≤ 0.01`.
6. `$transaction`: baca status terkini; bila `CANCELLED` → catat `IGNORED_CANCELLED`, return null;
   `updateMany({where:{id, status: current.status}})` (CAS) → bila kalah → `IGNORED_STALE`;
   catat `PaymentTransaction`; mirror `Order.paymentStatus` **hanya bila order masih berada di state
   yang di-mirror** (`where:{id: orderId, paymentStatus: current.status}`).
7. Realtime events (`PAYMENT_STATUS_CHANGED`, `PAYMENT_UPDATED`, `DASHBOARD_UPDATED`).

**Kesimpulan:** webhook 100% **Order-centric** — `Payment.orderId` dipakai untuk mirror. Tidak ada
resolusi ke `Reservation`. Aman terhadap: double webhook (early return + CAS), webhook setelah payment
`CANCELLED` (guard + IGNORED), webhook PAID vs order sudah PAID (mirror berguard, tidak downgrade).

---

## F. GAP (yang harus ditutup)

| # | Gap | Bukti |
|---|---|---|
| G1 | **Payment ownership Order-level.** `Payment.orderId` NOT NULL; tidak ada `Payment.reservationId` atau relasi ke Reservation. | `prisma/schema.prisma:1075` |
| G2 | **Reservation tidak punya state pembayaran.** Tidak ada `PAYMENT_PENDING`/`PAID` di `ReservationStatus`, dan `Reservation` tidak punya field `paymentStatus`. | `schema.prisma:154`, `:661` |
| G3 | **Customer di-redirect ke Order checkout/payment page**, bukan layar QRIS reservasi. | `reservasi/page.tsx` ~1832-1845 |
| G4 | **Webhook tidak resolve ke Reservation** (payment → order saja). | `payment.service.ts:1001-1006` |
| G5 | **Admin reservation detail tidak menampilkan pembayaran** (status/metode/amount/ref/providerRef/paidAt). | `reservation-detail.tsx` |
| G6 | **Cancel reservasi tidak membatalkan Payment PENDING yang masih hidup.** `cancelUnpaidLinkedOrderInTransaction` hanya flip `Order.status`, tidak menyentuh `Payment`. | `order.service.ts:749` |
| G7 | **Webhook setelah reservasi dibatalkan** bisa tetap menyetel payment/order PAID (tidak ada guard "reservation CANCELLED"). | `payment.service.ts:1019-1045` |
| G8 | **Tidak ada API pembayaran ber-scope reservasi** (`POST/GET .../payment` by reservation code). | — |
| G9 | **Amount** sudah server-side (`order.grandTotal`) tetapi tidak diekspos sebagai "reservation payable amount" yang otoritatif per reservasi. | `payment.service.ts` |
| G10 | **Korrelation webhook** `providerRef` vs `reference_id` belum diverifikasi (lihat §D). | `payment.service.ts:352` vs `:1005` |

**Yang TIDAK perlu dibuat:** payment engine baru, QRIS engine baru, cart/order engine baru,
refund engine baru, meja/availability engine baru.

---

## G. RECOMMENDED ARCHITECTURE (2 opsi — JANGAN dipilih dulu)

Prasyarat bersama (berlaku di kedua opsi):
1. **Order TETAP dibuat** untuk setiap pembelian reservasi (menu detail, inventory/COGS saat COMPLETED,
   reporting, customer order history, kitchen workflow) — `Reservation.orderId` tetap dipakai.
2. **QRIS tetap dari `paymentService.createPayment`** (tidak ada engine baru).
3. **Amount tetap dari DB** (`Order.grandTotal`) — bukan dari browser.
4. **Webhook tetap satu route** `/api/webhooks/ipaymu`; hanya **resolusinya diperluas**.
5. Layar QRIS baru ber-scope **reservation code**, bukan order.

### OPTION A — `Payment` punya optional `reservationId`

```
Payment
├── orderId        (tetap, tetap NOT NULL → tidak mengubah kolom existing)
└── reservationId? (String?, nullable, ADDITIVE)
Reservation
└── payments  (derived via reservationId; tanpa relasi Prisma bila mengikuti pola scalar)
```
- Webhook chain: `Gateway → PaymentTransaction → Payment → (payment.reservationId ?? Reservation.orderId → Reservation)`.
- **Keuntungan**: ownership eksplisit & query langsung; admin/customer bisa baca pembayaran "milik reservasi"
  tanpa join order; webhook bisa update state reservasi tanpa menebak.
- **Biaya**: perlu **ADDITIVE migration** (kolom nullable + index) — non-destruktif; perlu menjaga
  konsistensi `reservationId` (diisi saat createpayment reservasi).
- **Kompatibilitas**: `Payment.orderId` **tidak dibuat nullable** ⇒ flow Order/Cashier/Report tidak berubah.
  Pembayaran lama (`reservationId = NULL`) tetap valid dan aman.

### OPTION B — Order-centric, Reservation jadi owner secara **logical** via Order

```
Reservation.orderId → Order → Payment
Reservation "payment state" = turunan dari Order.paymentStatus (+ Reservation.status)
```
- **Keuntungan**: **ZERO schema change** (paling minimal); memakai `Reservation.orderId` yang sudah ada;
  webhook tidak berubah struktural (hanya menambah langkah "kalau order ini dimiliki reservasi → update
  reservation state").
- **Kekurangan**: ownership hanya **semantik** (tidak ada kolom pembeda); query "pembayaran reservasi" harus
  lewat join `Order`; sukar menjawab "payment mana milik reservasi" bila ada banyak Payment pada satu order;
  edge case reservation tanpa order (legacy) harus di-handle null.
- **Kompatibilitas**: maksimum — tidak menyentuh `payment` maupun reporting.

### Analisis trade-off ringkas

| Kriteria | OPTION A | OPTION B |
|---|---|---|
| Perubahan minimal | Sedang (1 migrasi aditif) | **Paling minimal** (0 migrasi) |
| Ownership eksplisit | **Ya** | Tidak (derivasi) |
| Kompatibilitas Payment engine | Tinggi (tanpa ubah kolom existing) | **Tertinggi** (tanpa perubahan skema) |
| Webhook resolution | Sederhana (langsung `reservationId`) | Perlu langkah derivasi `Order → Reservation.orderId` |
| Reporting impact | Rendah (payment tetap punya orderId) | **Nol** |
| Risiko regresi | Rendah–sedang | **Rendah** |
| Admin/customer query | Mudah | Perlu join |
| Legacy `orderId` NOT NULL | Tetap aman | Tetap aman |

**Catatan**: keduanya **tidak** menghapus Order dan **tidak** membuat engine baru. Yang membedakan hanyalah
apakah ownership dinyatakan sebagai **kolom** (A) atau **relasi turunan** (B).

**Keputusan yang harus Anda ambil sebelum implementasi (belum dipilih di sini):**
1. Option A (tambah `Payment.reservationId?`, migrasi aditif) **atau** Option B (tanpa migrasi).
2. Reservation state machine: derive dari `Order.paymentStatus` (tanpa enum baru) **atau** tambah
   `Reservation.paymentStatus PaymentStatus?` **atau** tambah enum `PAYMENT_PENDING/PAID` (migrasi aditif).
3. Auto-confirm Reservation saat pembayaran PAID, atau tetap manual (admin).
4. Cancel reservasi → batalkan Payment PENDING yang hidup (G6/G7)?
5. Refund setelah PAID: full/parsial & siapa yang approve.

---

## H. DATABASE IMPACT

**Yang sudah ada (tidak diubah):**
- `Reservation.orderId String?` (scalar) — `schema.prisma:661`.
- `Payment.orderId String` (NOT NULL), `Payment.status`, `Payment.providerRef`, `Payment.qrImage/qrString`,
  `expiresAt`, `paidAt`, `PaymentTransaction[]`.
- Enum `PaymentStatus { UNPAID, PENDING, PAID, FAILED, EXPIRED, REFUNDED, CANCELLED }`.
- Enum `ReservationStatus { PENDING, CONFIRMED, SEATED, COMPLETED, CANCELLED, NO_SHOW }`.

**OPTION A — ADDITIVE (non-destruktif):**
```prisma
model Payment {
  ...
  reservationId String?          // ADD COLUMN nullable — aman untuk baris lama (NULL)
  ...
  @@index([reservationId])       // ADD INDEX
}
```
Opsional (bila ingin state tersimpan):
```prisma
model Reservation {
  ...
  paymentStatus PaymentStatus?   // ADD COLUMN nullable
  paidAt        DateTime?        // ADD COLUMN nullable
  @@index([paymentStatus])
}
```
- **Tidak** mengubah `Payment.orderId` menjadi nullable (menghindari alter kolom existing / potensi breaking).
- Baris baru: 1 `Order` + N `OrderItem` (+1 `Payment` untuk QRIS/KASIR) — semua via engine existing.
- Backfill: **tidak perlu** — `reservationId = NULL` untuk data lama = "bukan pembayaran reservasi" (aman).
- **DILARANG** (sesuai instruksi): reset/drop/`MODIFY` destruktif/mengubah data existing.

**OPTION B — NO SCHEMA CHANGE.**

---

## I. API IMPACT

| Endpoint | Perubahan | Catatan |
|---|---|---|
| `POST /api/public/reservations` | **Tidak diubah** (sudah menerima `items[]` + `paymentMethod`) | boleh opsional: buat QRIS langsung server-side setelah commit |
| `POST /api/public/payments` | **Tidak diubah** untuk flow Order | tetap dipakai /menu,/cart,/checkout |
| **BARU (disarankan)** `POST /api/public/reservations/[code]/payment` | buat/tarik QRIS untuk **reservation** | memakai `paymentService.createPayment` di balik layar; scope = reservation code, bukan orderNumber |
| **BARU (disarankan)** `GET /api/public/reservations/[code]/payment` | status pembayaran reservation (poll) | ekspos: reservation code, status, method, amount, qrImage/qrString, expiresAt — **tanpa** secret provider |
| `GET /api/public/payments/[orderNumber]` | **Tidak diubah** | tetap untuk flow Order |
| `POST /api/webhooks/ipaymu` | **Diperluas**: setelah mirror order, resolve `Payment → Reservation` dan update state reservasi | route & signature validation **tidak berubah** |
| `GET /api/admin/reservations/[id]` | **Additive**: sertakan detail pembayaran (status, method, amount, reference, paidAt, transaction ref) | `ReservationView.order` sudah ada; tambah `payment` |
| `PATCH /api/admin/reservations/[id]/status`, `[id]/cancel` | Perlu menangani Payment PENDING saat cancel (G6) | reuse engine existing |

Prinsip: **additive**, tidak mengubah kontrak endpoint existing yang dipakai flow Order.

---

## J. UI IMPACT

**Customer (target flow — jangan redirect ke Order checkout):**

Layar QRIS reservasi minimal (baru atau reuse komponen QRIS existing):
- reservation code, nama restoran, tanggal, jam, meja, amount
- gambar QR (`qrImage` / render `qrString`), status pembayaran
- countdown/expiry dari `expiresAt` (existing mendukung) + tombol "Refresh/Perbarui QR"
- setelah PAID: **"Pembayaran berhasil"** → Reservation `PAID`/`CONFIRMED`

Perubahan konkret:
1. `src/app/(customer)/reservasi/page.tsx` — ganti CTA success screen dari `Link` ke
   `/payment/[orderNumber]` menjadi flow QRIS reservasi (screen/modal baru), memakai
   `created.order.grandTotal` + reservation code.
2. **BARU**: `src/components/customer/reservation/reservation-payment-screen.tsx` (poll status,
   countdown, regenerate QR).
3. Revenue copy: hapus "pembayaran diselesaikan setelah reservasi dibuat" → jadi "bayar sekarang".

**Admin (`src/components/admin/reservations/reservation-detail.tsx`):** tambah blok Pembayaran:
status, metode, amount, reference, `paidAt`, transaction reference. **Tanpa** provider secret
(tidak tampilkan apiKey/VA/qrString mentah).

**Regresi UI yang harus dijaga:** `/payment/[orderNumber]`, `/order/[orderNumber]`, `/menu`, `/cart`,
`/checkout`, halaman kasir QRIS — **tidak berubah**.

---

## K. SECURITY IMPACT

| Area | Aturan |
|---|---|
| Amount | **Selalu** dari DB (`Order.grandTotal` via `Reservation.orderId`). Browser tidak pernah mengirim nominal. |
| Status | Webhook adalah satu-satunya penentu PAID (signature-verified). Client tidak pernah mengirim status. |
| Tenant isolation | Setiap query wajib `restaurantId` (+ `branchId` bila branch-scoped). Webhook **tidak boleh** bisa mengakses reservasi restoran lain — resolusi harus lewat `Payment.restaurantId` → `Reservation.restaurantId` dan **dicek sama**. |
| Reservation ownership | `Reservation.orderId` → `Order.restaurantId` harus sama dengan `payment.restaurantId`; kalau tidak, ignore + catat. |
| Public DTO | jangan bocorkan `orderId`, `customerId`, `providerRef` mentah, `paymentUrl`, qrString internal notes. Layar reservasi cukup `orderNumber`/reservation code. |
| Callback body | Jangan percaya `amount`, `status`, `reservation status`, `order total` dari client/webhook tanpa verifikasi signature + amount match + DB lookup. |
| Branch scope | Route publik reservasi: tenant di-resolve server-side (`_resolve-public-context`). Route admin: `requireRoles`/`requireAdmin` + `effectiveWriteBranchId`/`assertBranchInScope`. |

---

## L. RACE-CONDITION RISKS (matriks)

| Skenario | Mekanisme existing yang dipakai | Status desain |
|---|---|---|
| Customer buka 2 tab / submit 2× | Duplicate check reservasi + branch `FOR UPDATE` | ✅ sudah ada |
| Customer generate QRIS 2× | `createPayment` idempotent (live PENDING QRIS dikembalikan) + order `FOR UPDATE` | ✅ reuse |
| Webhook dikirim 2× | Early-return `PAID` + CAS `updateMany(status: current)` + `IGNORED_STALE` | ✅ reuse |
| Webhook datang setelah payment `CANCELLED` | Guard `CANCELLED` → `IGNORED_CANCELLED` | ✅ reuse |
| **Webhook datang setelah Reservation `CANCELLED`** | **BELUM ADA** — hanya guard payment state | ❌ **harus ditambah guard reservasi** (G7) |
| Payment expired (webhook EXPIRED tak datang) | Stale PENDING → `EXPIRED` di route public payments / `switchToCashier` | ⚠️ perlu dipastikan berlaku untuk reservasi juga |
| PAID vs cancellation bersamaan | `cancelUnpaidLinkedOrderInTransaction` skip bila order `PAID`; mirror order berguard | ⚠️ perlu tambahan: cancel Payment PENDING (G6) |
| QRIS reservasi & QRIS order lama bersamaan | tidak relevan — order terpisah; lock per-order | ✅ |
| Double cancel reservasi | CAS `updateMany({id, status})` → ConflictError | ✅ reuse |

**Kesimpulan:** seluruh mekanisme idempotency/CAS/lock existing **cukup**; yang kurang hanya
**guard "reservation CANCELLED" di webhook** dan **pembatalan Payment PENDING saat cancel reservasi**.

---

## M. CANCELLATION / REFUND IMPACT

Skenario:
1. **Cancel sebelum payment** → `cancelUnpaidLinkedOrderInTransaction` membatalkan Order (unpaid).
   ⚠️ **Gap G6**: Payment PENDING (QRIS hidup) **tidak** ikut dibatalkan ⇒ QR masih bisa dibayar.
   Mitigasi: tambah pembatalan Payment PENDING (`status: PENDING → CANCELLED`) di dalam transaksi
   `transitionReservation` yang sama (guarded `updateMany`).
2. **Cancel SETELAH payment** → Order `PAID` **tidak disentuh** oleh `cancelUnpaidLinkedOrderInTransaction`
   (by design). Refund harus lewat **engine refund existing**: `src/services/approval/approval.service.ts`
   (`requestRefund`, `decideRefund`) + route `/api/refunds/*`, dengan `Refund.orderId` = order reservasi.
   **JANGAN** membuat refund engine baru.
3. **Payment expired / failed** → state terminal payment; reservation tetap `PENDING` (atau perlu aturan
   "expired → reservation batal?" — keputusan bisnis).
4. **Payment PAID lalu reservasi dibatalkan** → refund penuh (via approval) + `Payment.status = REFUNDED`
   bila diperlukan. Perlu keputusan policy (siapa approve, penuh/parsial, apakah kursi dilepas).

---

## N. REPORTING IMPACT

- **Sales report** (`report.service.ts`): menghitung order `status != CANCELLED AND paymentStatus = 'PAID'`.
  Selama **Order tetap dibuat** (kedua opsi), reservasi yang dibayar otomatis masuk omzet — **konsisten**.
- **Payment report**: query `prisma.payment` join `order.orderNumber`, `groupBy orderId`. Karena
  `Payment.orderId` tetap NOT NULL (kedua opsi), report **tidak berubah**.
- **Order report / customer order history**: tetap berjalan (order + items ada).
- **Reservation report**: perlu keputusan apakah pembayaran reservations dilaporkan terpisah
  (mis. "Reservation revenue") — opsional, additive.
- **Shift sales**: QRIS reservation yang dibayar tanpa kasir **tidak** punya `shiftId` (null) — sama seperti
  QRIS online existing; **tidak** masuk drawer kasir. Aman.
- **Bahaya** hanya bila memilih varian "reservation payable tanpa Order" — akan memutus reporting.
  ⇒ **Rekomendasi kuat: Order wajib tetap dibuat** (baik OPTION A maupun B).

---

## O. EXACT FILES THAT WOULD NEED MODIFICATION

**Backend — service**
- `src/services/payment/payment.service.ts` — tambah resolver `Payment → Reservation` di `handleWebhook`
  (guard reservation CANCELLED), opsi `reservationId` saat create (Option A), pencatatan `PaymentTransaction`
  yang menyertakan reservation context. **Tidak** mengubah state machine payment.
- `src/services/reservation/reservation.service.ts` — (a) batalkan Payment PENDING saat cancel (G6),
  (b) state pembayaran reservasi (derive atau kolom), (c) opsi buat QRIS langsung setelah create,
  (d) ekspos pembayaran di `reservationViews`.
- `src/services/order/order.service.ts` — kemungkinan kecil: helper `findReservationByOrderId` /
  guard tambahan; **jangan** mengubah `createCustomerOrder` (perilaku default harus identik).
- `src/services/reservation/reservation.types.ts` — schema/tipe respons pembayaran reservasi (additive).
- `src/services/report/report.service.ts` — **hanya bila** memutuskan laporan reservation terpisah
  (opsional).

**Backend — API**
- **BARU** `src/app/api/public/reservations/[code]/payment/route.ts` (POST create + GET status).
- `src/app/api/webhooks/ipaymu/route.ts` — **tidak berubah** (signature/parse tetap); perubahan ada di service.
- `src/app/api/admin/reservations/[id]/route.ts` — sertakan detail pembayaran (additive).
- `src/app/api/public/reservations/[code]/route.ts` dan `_public-dto.ts` — expose ringkasan pembayaran
  reservasi dengan aman (additive).

**Frontend**
- `src/app/(customer)/reservasi/page.tsx` — ganti CTA ke layar QRIS reservasi.
- **BARU** `src/components/customer/reservation/reservation-payment-screen.tsx`.
- `src/app/(customer)/reservasi/reservation-flow.ts` — helper copy/format (pembayaran reservasi).
- `src/components/admin/reservations/reservation-detail.tsx` — blok Pembayaran.
- (opsional) `src/app/(customer)/account/reservasi/[code]/page.tsx` — tampilkan status pembayaran reservasi.

**Prisma**
- `prisma/schema.prisma` — **hanya bila OPTION A / state tersimpan** (additive).

**Test**
- `src/services/reservation/*.test.ts`, `src/services/payment/*.test.ts`, `src/app/(customer)/reservasi/reservation-flow.test.ts` — tambah kasus pembayaran reservasi (tanpa melonggarkan assertion).

**TIDAK disentuh:** `src/services/whatsapp/*` (session-manager, Baileys, notifier),
`src/services/reservation/reservation.slots.ts`, `reservation-whatsapp.ts`,
`src/app/(customer)/menu|c/or` halaman Order/Cashier/QRIS lama, `src/app/(customer)/payment/[orderNumber]`.

---

## P. MIGRATION REQUIRED OR NOT

- **OPTION B → NO MIGRATION.** Memakai `Reservation.orderId` yang sudah ada. (Paling minimal.)
- **OPTION A → ADDITIVE MIGRATION.** `ADD COLUMN Payment.reservationId VARCHAR(191) NULL` +
  `ADD INDEX payment_reservationId_idx`; opsional `Reservation.paymentStatus/paidAt` nullable.
  Semua nullable ⇒ **aman untuk data lama**, tanpa backfill, **tanpa** mengubah/menghapus data existing.
- Bila memilih enum `PAYMENT_PENDING/PAID` pada `ReservationStatus` → `ALTER TABLE ... MODIFY COLUMN`
  pada enum MySQL = **aditif nilai** (tidak menghapus nilai lama), masih non-destruktif tetapi mengubah
  definisi kolom → **perlu persetujuan eksplisit**.
- **DILARANG & tidak diperlukan:** `prisma migrate reset`, drop table/column, alter destruktif,
  backfill yang mengubah data existing.

---

## Q. REGRESSION RISKS

| Risiko | Level | Mitigasi |
|---|---|---|
| Order payment / Cashier Cash / Cashier QRIS berubah perilaku | **Tinggi** kalau menyentuh `payment.service` inti | Perubahan hanya **tambahan** resolver; state machine payment tidak diubah; test payment existing dijalankan |
| iPaymu webhook rusak | **Tinggi** | Ubah hanya setelah lookup payment; signature & parse tidak disentuh; uji callback nyata |
| Correlation key `providerRef` vs `reference_id` (G10) | **Tinggi** | Verifikasi terhadap callback sandbox **sebelum** implementasi |
| Customer checkout `/menu`→`/cart`→`/checkout` rusak | Sedang | Tidak menyentuh `createCustomerOrder` default; `reservationMode` tetap opt-in |
| Reservation existing (orderId NULL / tanpa pembelian) | Sedang | UI & service harus handle null |
| Cancel reservasi menyisakan Payment PENDING (G6) | Sedang | Tambah pembatalan Payment PENDING berguard |
| Webhook setelah reservation cancel (G7) | Sedang | Tambah guard reservation CANCELLED + `PaymentTransaction` IGNORED |
| Reporting omzet berubah | Sedang | Pertahankan Order untuk pembelian reservasi (jangan pilih varian tanpa Order) |
| WhatsApp reservation notification rusak | Rendah | `reservation-whatsapp.ts` & notifier tidak disentuh |
| Inventory/COGS | Rendah | Order/OrderItem tetap dibuat; snapshot COGS tetap di READY→COMPLETED |
| Test purchase gate lama | Rendah | Sudah dihapus pada Phase 1 |

---

## R. STEP-BY-STEP IMPLEMENTATION PLAN

> Semua langkah **hanya boleh dijalankan setelah Anda memilih** OPTION A/B dan kebijakan state machine.
> Setiap langkah wajib punya test + verifikasi (`npx tsc --noEmit`, `npm run build`, `git diff --check`).

**Fase 0 — Keputusan & verifikasi (tanpa kode)**
0.1 Verifikasi correlation key iPaymu (`Data.Reference` vs callback `reference_id`) di sandbox. ← blocker.
0.2 Pilih OPTION A atau B.
0.3 Pilih kebijakan state reservasi (derive / kolom / enum) & auto-confirm.
0.4 Pilih kebijakan cancel/refund (batalkan PENDING? refund penuh/parsial? siapa approve?).

**Fase 1 — Model (bila OPTION A)**
1.1 Tambah `Payment.reservationId String?` + index (additive) & opsional `Reservation.paymentStatus/paidAt`.
1.2 `prisma generate` + migration additive (tanpa reset). Tanpa backfill.

**Fase 2 — Pembuatan pembayaran reservasi**
2.1 Endpoint `POST /api/public/reservations/[code]/payment` → resolve reservation (public-safe) →
`paymentService.createPayment(orderId, restaurantId, {method:"QRIS"|"KASIR"})`; isi `reservationId` (A).
2.2 Pastikan amount = `Order.grandTotal` dari DB, bukan input klien.
2.3 `GET` status (poll) dengan proyeksi aman + rate limit (reuse pattern existing).

**Fase 3 — Webhook resolution**
3.1 Di `handleWebhook`, setelah payment ditemukan: resolve reservation via `payment.reservationId`
(Option A) atau `Reservation.findFirst({orderId: payment.orderId})` (Option B).
3.2 Verifikasi `reservation.restaurantId === payment.restaurantId`; kalau tidak → ignore + catat.
3.3 Guard: bila reservation `CANCELLED` → jangan set PAID (catat `IGNORED`), atau alihkan ke jalur refund.
3.4 Bila `PAID` → update state reservasi (`CONFIRMED`/`paid`) sesuai keputusan; guarded `updateMany`.
3.5 Semua dalam transaksi + `PaymentTransaction` existing.

**Fase 4 — Cancel/refund**
4.1 Saat transisi reservasi ke `CANCELLED`: batalkan Payment PENDING berguard (G6).
4.2 Cancel setelah PAID → arahkan ke approval/refund engine existing (tanpa engine baru).

**Fase 5 — UI**
5.1 Layar QRIS reservasi (customer) + status poll + "Pembayaran berhasil".
5.2 Ganti CTA success screen; hapus copy "dibayar setelah reservasi dibuat".
5.3 Admin reservation detail: blok Pembayaran (tanpa secret).

**Fase 6 — Reporting (opsional)**
6.1 Bila perlu, tambah laporan reservation pembayaran terpisah (additive). Pastikan report existing tak berubah.

**Fase 7 — Verifikasi & regresi**
7.1 Test unit/service baru (webhook→reservation, cancel→payment cancel, amount server-side).
7.2 Regresi: Order QRIS, Cashier Cash, Cashier QRIS, webhook, checkout, reservation, WhatsApp
notification, inventory, refund/cancellation, availability R5.1, multi-branch isolation.
7.3 `npx tsc --noEmit`, `npm run build`, `git diff --check`, eslint.
7.4 E2E: buat reservasi → QRIS → bayar (sandbox) → Reservation PAID/CONFIRMED; dokumentasikan bukti.

---

## LAMPIRAN — RINGKASAN JAWABAN CEPAT

| Pertanyaan | Jawaban |
|---|---|
| Apakah Reservation sekarang membuat Order sebelum payment? | **YA** (Phase-1, atomik, `Reservation.orderId` diisi; order PENDING/UNPAID) |
| Berapa orderId di Payment? | `Reservation.orderId` → Order → `Payment.orderId` (NOT NULL) |
| Source of truth payment? | `Payment.status` (+ mirror `Order.paymentStatus`) — signature-verified webhook |
| Bisakah QRIS generator existing dipakai untuk Reservation? | **YA**, langsung — tidak boleh buat QRIS engine baru |
| Perlu migration? | **OPTION B: tidak.** OPTION A: additive (nullable + index) |
| Apakah webhook sudah resolve ke Reservation? | **Belum** (hanya Payment→Order) |
| Apakah enum reservation cukup? | Tidak untuk state pembayaran ⇒ derive dari `Order.paymentStatus` **atau** tambah kolom/enum (additif) |
| Yang paling berisiko? | (1) correlation key webhook, (2) guard reservation CANCELLED, (3) cancel yang meninggalkan Payment PENDING, (4) menyentuh `payment.service` inti |

**STOP — AUDIT SELESAI. Tidak ada kode yang diubah, tidak ada migration dijalankan,
tidak ada commit/push/deploy, tidak ada perintah destruktif.**
