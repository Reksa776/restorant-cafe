# AUDIT PHASE 1 — RESERVATION + ORDER + PAYMENT MENJADI SATU FLOW

> Mode: **AUDIT ONLY**. Tidak ada kode/schema yang diubah. Tidak ada test/build yang dijalankan.
> Repo: `/home/reksa/restorant-cafe` · HEAD: **`70226bc update reservation with integration whastapp`** (working tree bersih)
> Konteks: menggantikan gate R6/R6.5 "harus punya paid order historis" → reservation MEMBAWA order-nya sendiri.

---

## RINGKASAN EKSEKUTIF

**Semua engine yang dibutuhkan SUDAH ADA dan bisa direuse tanpa membuat engine baru:**

| Kebutuhan | Engine existing yang direuse |
| --- | --- |
| Katalog produk (harga, opsi, addon, stok cabang) | `GET /api/public/menu` |
| Hitung harga + validasi server | `orderService.createCustomerOrder` (sudah ada) |
| Order + OrderItem | `POST /api/public/orders` → `createCustomerOrder` |
| Payment QRIS/KASIR + webhook | `paymentService.createPayment` + `POST /api/public/payments` + `/api/webhooks/ipaymu` |
| Halaman bayar | `/payment/[orderNumber]` (QRIS) & `/order/[orderNumber]` (KASIR/UNPAID) |
| Booking | `reservationService.createPublicReservation` (kernel existing) |
| Link reservation → order | **`Reservation.orderId` SUDAH ADA di schema tapi belum pernah dipakai** |

**Temuan kunci:**
1. **`Reservation.orderId` sudah ada** (`String?`, scalar, komentar "set when converted to order at check-in") dan **tidak pernah ditulis/dibaca** di seluruh kode aplikasi ⇒ bisa dipakai untuk link tanpa migration.
2. **`Reservation.guestPhone` sudah menyimpan nomor follow-up** (required, dinormalisasi `62…`, dipakai notifier WhatsApp R7) ⇒ label UI tinggal diganti, **tidak perlu field baru** ⇒ tanpa migration.
3. **`POST /api/public/orders` + `createCustomerOrder` sudah menerima keranjang penuh** (items + selections/variant + addons + qty), menghitung harga server-side, dan mendukung `paymentMethod: QRIS|KASIR` untuk DINE_IN ⇒ tidak perlu cart/order/payment engine baru.
4. **UI product picker di `/menu` bersifat INLINE di `page.tsx`** (tidak ada komponen bersama), sehingga "reuse komponen menu" tidak gratis — perlu picker ringkas di wizard yang memakai **API menu yang sama** (bukan mesin baru).
5. **`useCart` adalah cart GLOBAL (localStorage) yang dibagi dengan /menu, /cart, dan badge header** ⇒ memakainya di wizard akan mengotori cart customer (keputusan desain, lihat §9/§16).

---

## 1. EXISTING MENU / CART

**API menu (dipakai apa adanya):** `GET /api/public/menu?restaurantId=&branchCode=&categoryId=` (rate limit 240/min)
Mengembalikan: `restaurant`, `categories[]` (+`productCount`), dan `products[]`:
`id, name, description, price (sudah di-resolve branch override), imageUrl, categoryId, category, optionGroups[] (aktif, options aktif + priceAdjustment), addons[] (aktif + price), isPriceOverride, hasBranchProduct, stock`.

Aturan yang sudah berlaku: `price = branchProduct.priceOverride ?? product.price`; produk difilter bila `branchProduct.isAvailable === false`; `stock` 0 = habis; tanpa branch → `stock: null` (legacy).
Endpoint tambahan: `/api/public/menu/recommendations`, `/api/public/menu/best-sellers`.

**UI menu:** `src/app/(customer)/menu/page.tsx` (~1.700 baris) — state produk, pemilihan option group, qty addon, dan kalkulasi harga **inline di page** (tidak ada komponen bersama). Tidak ada komponen `ProductCard`/`ProductModal` di `src/components/customer/` (isinya hanya `auth-dialog`, `branding-sync`, `promo-section`, `reservation/*`).

**Cart:** `src/hooks/use-cart.tsx` — React context, dipersist ke `localStorage` (`restaurant_cart`, `restaurant_id`, `table_context`, `customer_branch_context`), sinkron antar-tab, badge di header.
API: `items, isHydrated, addItem, addCustomizedItem, removeItem, updateQuantity, updateCartItem, clearCart, subtotal, tax, serviceCharge, total, tableContext, customerBranch`.
`CartItem`: `productId, name, price, quantity, imageUrl, categoryName, selections[], addons[], notes, displayPrice`.
`CartSelection`: `{groupId, groupName, optionId, optionName, priceAdjustment}` · `CartAddon`: `{addonId, name, price, quantity}` — **identik dengan payload `OrderItemInputSchema`** (bagus untuk reuse).

## 2. EXISTING ORDER ENGINE

`orderService.createCustomerOrder(input, restaurantId, sessionCustomerId?, branchId?)` — `CreateCustomerOrderSchema`:
`customerName, customerPhone?, orderType (DINE_IN default), tableId?, restaurantId?, branchCode?, visitorCount?, notes?, items[] (min 1: productId, quantity>0, selections[], addons[], notes?), paymentMethod? (QRIS|KASIR, DINE_IN only), promoCode?`.

Validasi **server-side** (semua sudah ada):
- restaurant aktif; table (restaurant-scoped, bukan MAINTENANCE, branch table = authoritative);
- produk: `restaurantId + isActive + isAvailable` (semua id harus ada, kalau tidak → 400 "Produk tidak ditemukan atau tidak tersedia");
- `BranchProduct`: ketersediaan per cabang + **priceOverride** (`override ?? Product.price`, override 0 = gratis) + **stok** (baris hilang = SOLD OUT);
- **opsi/variant**: group harus milik produk, option harus milik group, priceAdjustment dari DB, validasi `isRequired/minSelect/maxSelect`;
- **addon**: harus milik produk, harga dari DB × qty;
- `unitPrice = base + Σ option + Σ addon`; `totalPrice = unitPrice × qty`; `subtotal` akumulasi;
- **DINE_IN bebas tax & service** (`grandTotal = subtotal - discount`); TAKEAWAY/DELIVERY 10% + 5%;
- order dibuat `status: PENDING`, `paymentStatus: UNPAID`, item menyimpan `customizations` JSON (productName, basePrice, selections, addons, notes);
- `OrderStatusHistory` "Order created via website";
- bila `tableId` → `Table.status = OCCUPIED`;
- `paymentMethod: "KASIR"` → row `Payment` UNPAID dibuat **atomik** dalam transaksi yang sama;
- order number di-retry maks 5× bila tabrakan; realtime events (ORDER_CREATED, TABLE_STATUS_CHANGED, dll);
- **membuka `prisma.$transaction` sendiri** (tidak menerima tx dari luar).
Konteks promo (F3) tersedia (`promoCode` + `promoService`) — opsional, hanya untuk customer login.

**Route:** `POST /api/public/orders` (30/min) — `restaurantId`/`branchId` di-resolve server-side (table → session → claimed id → first active), `branchCode` divalidasi ke cabang aktif milik restaurant itu.
**Model `Order`:** `customerId` **WAJIB** (guest dibuatkan `Customer` by normalized phone, atau placeholder `guest-<ts>-<rand>`), `branchId?`, `tableId?`, `orderType`, `status`, `paymentStatus`, `subtotal/discount/tax/serviceCharge/grandTotal`, `notifiedAt`, `promoId/promoCode`, relasi `items/statusHistory/payments/refunds/cancellations/costSnapshots`. **Tidak ada `reservationId`.**

## 3. EXISTING PAYMENT ENGINE

`paymentService.createPayment(orderId, restaurantId, { method?: "QRIS"|"KASIR" }, branchFilters?)`:
- **PAID = terminal & idempotent** (semua metode); order tidak bisa dibayar dua kali;
- **KASIR** → row `Payment` UNPAID (tanpa gateway); order tetap UNPAID sampai kasir menandai lunas (`markCashierPaymentPaid`) melalui alur cashier/shift existing;
- **QRIS** → gateway iPaymu `channel: "qris"` → `Payment` PENDING dengan `paymentUrl`, `qrImage`, `qrString`, `expiresAt`; melunasi via webhook `POST /api/webhooks/ipaymu` (validasi signature) → `Payment` PAID + `Order.paymentStatus = PAID`;
- ada `switchToCashier` (QRIS → KASIR), `createKasirQrisPayment` (QRIS di kasir), penanganan `EXPIRED` (regenerasi QR aman);
- `Payment` model: `orderId` (NOT NULL), `shiftId` (KASIR), `status`, `amount`, `method`, `provider`, `providerRef`, `paymentUrl`, `qrImage`, `qrString`, `paidAt`, `expiresAt` + `PaymentTransaction[]`.
**Route:** `POST /api/public/payments` (30/min) `{orderNumber, method?}` → `paymentUrl/status/qr`.
**UI bayar existing:** `/payment/[orderNumber]` (tampilkan QR + poll 4s, berhenti di status terminal) dan `/order/[orderNumber]` (status UNPAID/KASIR, bisa membuat payment QRIS/KASIR).
**Cancel/refund:** model `Refund`/`RefundItem`, `CancellationRequest`; route `/api/refunds/*`, `/api/cancellations/*` (keputusan admin), `PATCH /api/orders/[id]/status` (CANCELLED). Tidak ada refund service terpisah — logika ada di dalam `order.service`/`payment.service` + approval.

## 4. EXISTING CUSTOMER ENGINE

- **Guest:** tanpa auth. `createCustomerOrder` mencari `Customer` by `normalizePhone(customerPhone)`; bila tidak ada → dibuat; bila tidak ada telepon → placeholder `guest-…` (tidak pernah ditampilkan ke publik: DTO mengubahnya jadi `null`).
- **Logged-in:** cookie session customer (HMAC, `tryGetCustomerSessionFromRequest`) → `customerId` + `restaurantId`; dipakai untuk akun & promo. Hook klien `useCustomerAuth()` untuk prefill (nama/telepon).
- `Customer` model: `restaurantId, phone, name, isActive`. **Tidak ada mekanisme auth baru yang diperlukan** untuk reservasi+order guest.

## 5. EXISTING RESERVATION ENGINE

- `createPublicReservation(restaurantId, raw, { now?, customerId? })` → `CreatePublicReservationSchema`: `branchCode, reservationDate, startMinutes, durationMinutes, partySize, tableId?, guestName, guestPhone, notes?, source:PUBLIC`.
- Kernel `createReservation` (satu jalur transaksional):
  `BEGIN → branch FOR UPDATE → validasi window/slot/horizon → validasi customer link → **PURCHASE GATE (requirePurchase)** → table FOR UPDATE + tolak overlap (409 TABLE_NOT_AVAILABLE) → duplicate check (guestPhone/customerId + date + startMinutes + status HOLDING) → INSERT Reservation → COMMIT` → `reservationViews` → **notify WhatsApp best-effort (R7)**.
- Status: `PENDING → CONFIRMED → SEATED → COMPLETED`, plus `CANCELLED`/`NO_SHOW` (matriks transisi + conditional update).
- Route: `POST /api/public/reservations`; admin: `POST /api/admin/reservations`, `PATCH /[id]/status`, `/[id]/cancel`; customer: `POST /api/public/customer/account/reservations/[code]/cancel`; lookup: `GET /api/admin/reservations/code/[code]` (scan QR).
- Availability R5.1 (binary reservation-only) + QR reservasi: **tidak berubah** oleh rencana ini.

## 6. EXISTING `Reservation.orderId`

```prisma
model Reservation {
  ...
  // Set when the reservation is converted to a real order at check-in.
  // Scalar only — the Order model is intentionally untouched.
  orderId         String?
```
- **Sudah ada di schema** (migration `20260915_add_reservation`) dan **TIDAK PERNAH dipakai**: grep di `src/services/reservation`, route admin/public, dan halaman admin reservasi hanya menemukan penyebutan di **test** yang memastikan `orderId` **tidak** diekspos pada DTO publik.
- `reservationViews` sengaja tidak memakai relasi (`Reservation` dideklarasikan tanpa relasi) dan me-resolve table/branch/customer dengan lookup terpisah.
⇒ **Cukup untuk menyimpan link order. Tidak perlu field baru. Tidak perlu migration.** Menambahkan `@relation` Prisma justru akan memicu FK migration → **tidak disarankan**; ikuti pola scalar + lookup manual yang sudah dipakai codebase.

## 7. EXISTING PHONE / CONTACT FIELDS

| Tempat | Field | Catatan |
| --- | --- | --- |
| Reservation | `guestPhone` | **wajib**, dinormalisasi `62…` (`GuestPhoneSchema` + `normalizePhone`), dipakai duplicate check + notifier WhatsApp R7 |
| Reservation | `guestName` | wajib |
| Reservation | `customerId?` | link ke akun bila login |
| Order → Customer | `Customer.phone` | hasil `normalizePhone(customerPhone)`, atau `guest-…` placeholder |
| Notifier WA | `resolveReservationWhatsAppTarget` | `guestPhone` → fallback `customer.phone`, menolak `guest-*` |

**Tidak ada** `phone`/`contactPhone`/`customerPhone`/`whatsapp`/`followUpPhone` lain di `Reservation`.
⇒ **Nomor follow-up = reuse `Reservation.guestPhone`** (sudah required + normalized + sudah dipakai untuk follow-up WhatsApp). Sesuai instruksi: **jangan menambah field duplikat** ⇒ **tanpa migration**.

## 8. EXISTING PURCHASE GATE R6 / R6.5 (yang akan diubah)

- `CreateReservationData.requirePurchase?: boolean` (L256); `createPublicReservation` mengirim `requirePurchase: true` (L643).
- Call site di kernel: **L782-783** `if (data.requirePurchase) await this.assertQualifyingPurchase(tx, restaurantId, data);`
- `assertQualifyingPurchase` (L525) → `hasQualifyingPurchase` (L543): resolve `customerId` (session, else `Customer` by phone) → `order.findFirst({ restaurantId, customerId, paymentStatus: "PAID", status != CANCELLED, items: { some: {} } })` → bila kosong → **409 `PURCHASE_REQUIRED`**.
- Probe UX: `checkPurchaseEligibility` (L583) → `GET /api/public/reservations/purchase-eligibility` (dibuat khusus R6.5).
- UI R6.5: step **"Pembelian"** di `page.tsx` (`purchaseStepView`, `PURCHASE_REQUIRED_CODE/MESSAGE`, `PURCHASE_CTA_HREF="/menu"`, draft `sessionStorage`, catatan "✓ Purchase requirement terpenuhi" di Review).
- Test: `reservation.purchase.test.ts` (21), `reservation-flow.test.ts` (29 termasuk urutan step + purchase-view), `reservation-whatsapp.unit.test.ts` (10).

⇒ Semantiknya **berbalik**: dari "harus punya order PAID historis" menjadi "reservation membawa order sendiri". Gate lama + probe + step UX-nya harus diganti (bukan dihapus buta — lihat §9/§16).

## 9. DEPENDENCY YANG HARUS DIUBAH

| # | Dependency | Perubahan minimal yang diminta |
| --- | --- | --- |
| D1 | `CreatePublicReservationSchema` | tambah `items[]` (payload sama dengan `OrderItemInputSchema`), opsional `paymentMethod (QRIS\|KASIR)`, opsional `visitorCount` |
| D2 | `reservation.service.createReservation` | buat Order via engine existing **dan** simpan `orderId`; ganti gate lama |
| D3 | Order engine atomicity | **keputusan**: (A1) `createCustomerOrder` diberi parameter tx opsional (atau helper internal `…InTx`) agar Order+Item+Payment+Reservation **satu transaksi**; (A2) dua transaksi + kompensasi (batal order bila reservasi gagal) → tanpa ubah order engine tapi ada jendela orphan |
| D4 | Gate R6 | ganti `assertQualifyingPurchase` → validasi **order milik reservasi ini** (restaurant sama, `customerId`/phone cocok, ≥1 item; `paymentStatus` mengikuti aturan existing, bukan prasyarat) |
| D5 | Probe R6.5 | `checkPurchaseEligibility` + `GET /purchase-eligibility` menjadi **tidak diperlukan** (keputusan: hapus atau repurpose) — jangan hapus sebelum disetujui |
| D6 | UI langkah "Pembelian" | ganti isi dari gate+`/menu` menjadi **product picker** di dalam wizard (tanpa redirect) |
| D7 | Review step | tampilkan blok PEMBELIAN (produk, variant/modifier, qty, harga, subtotal, discount, tax, service, grand total) + PAYMENT (status, method); hapus "Purchase requirement terpenuhi" |
| D8 | Nomor follow-up | label & helper text di step data customer; **tetap** `guestPhone`; prefill dari session, boleh diubah |
| D9 | Payment | pakai `POST /api/public/payments` (QRIS) / intent KASIR; arahkan ke `/payment/[orderNumber]` atau tampilkan QR inline; **jangan** ubah cashier/QRIS |
| D10 | `reservationViews` | (opsional, additive) sertakan ringkasan order (orderNumber, items, total, paymentStatus/method) untuk halaman admin/customer |
| D11 | Cancel/refund | saat reservasi dibatalkan → batalkan/refund order lewat engine existing (`Refund`/`CancellationRequest`); hindari order PAID yang menggantung |
| D12 | WhatsApp R7 | **tidak berubah** (target tetap `guestPhone`); opsional menambah baris ringkasan order pada pesan |
| D13 | `useCart` | **keputusan**: reuse cart global (state bocor ke /menu & badge) **atau** state baris lokal di wizard yang POST ke order API. Rekomendasi: state lokal (UI only, bukan engine baru) |

## 10. FILES YANG AKAN DIUBAH (perkiraan)

**Backend**
- `src/services/reservation/reservation.types.ts` — schema public + DTO/tipe
- `src/services/reservation/reservation.service.ts` — buat order, simpan `orderId`, ganti gate, ringkasan order di view
- `src/services/order/order.service.ts` — **hanya** bila memilih A1 (parameter tx opsional/helper InTx), additif & backward-compatible
- `src/app/api/public/reservations/route.ts` — teruskan input baru, respons + ringkasan order (additive)
- `src/app/api/public/reservations/purchase-eligibility/route.ts` — dihapus/repurpose (butuh persetujuan)

**Frontend (wizard)**
- `src/app/(customer)/reservasi/page.tsx` — langkah Pembelian = picker, step data customer (follow-up phone), Review, payload items
- `src/app/(customer)/reservasi/reservation-flow.ts` — buang/perbarui konstanta purchase gate; tambah helper total/format
- **baru**: `src/components/customer/reservation/reservation-product-picker.tsx` (UI; konsumsi `/api/public/menu`)
- **baru (opsional)**: `src/components/customer/reservation/reservation-order-summary.tsx`

**Test**
- `src/services/reservation/reservation.purchase.test.ts` — **ditulis ulang** (rule berubah; bukan melonggarkan assertion)
- `src/app/(customer)/reservasi/reservation-flow.test.ts` — update urutan/view step
- `src/services/reservation/reservation.service.test.ts`, `reservation.api.test.ts`, `reservation.customer*.test.ts` — helper create publik kini harus menyertakan items

**Tidak disentuh:** `src/app/(customer)/menu`, `/cart`, `/checkout`, `payment.service`, `cashier`, `webhooks/ipaymu`, `reservation.slots` (availability R5.1), `session-manager`/Baileys/queue WA.

## 11. DATABASE IMPACT

- **Tidak ada tabel/kolom baru**:
  - link order → pakai `Reservation.orderId` yang **sudah ada** (kini kosong),
  - nomor follow-up → pakai `Reservation.guestPhone` yang **sudah ada**.
- Baris baru per reservasi berbelanja: 1 `Order` + N `OrderItem` (+ 1 `Payment` bila KASIR atau saat QRIS dibuat) — **semua lewat engine existing**.
- `Reservation` tetap tanpa relasi Prisma (pola existing) → **tanpa FK baru**.
- Tidak ada data lama yang perlu di-backfill (reservasi lama: `orderId = NULL`, artinya "tanpa pembelian" — aman & kompatibel).

## 12. MIGRATION DIPERLUKAN ATAU TIDAK

**TIDAK ADA MIGRATION** untuk desain yang direkomendasikan (reuse `orderId` + reuse `guestPhone`).
Migration **hanya** bila tim memutuskan hal di luar rekomendasi:
- memisahkan **nomor order** vs **nomor follow-up** menjadi dua field (tidak disarankan: `guestPhone` sudah memenuhi), atau
- menambahkan relasi/FK Prisma `Reservation → Order` (tidak diperlukan; melanggar pola "scalar only" dan memicu FK migration).

## 13. API IMPACT

| Endpoint | Dampak |
| --- | --- |
| `POST /api/public/reservations` | request **+`items[]`** (+`paymentMethod?`, `visitorCount?`); respons **+ringkasan order** (orderNumber, items, subtotal/total, paymentStatus/method). Additive, tapi **breaking bila `items` diwajibkan** → perlu keputusan (wajib vs opsional) |
| `GET /api/public/reservations/purchase-eligibility` | menjadi tidak terpakai → dihapus/repurpose (butuh persetujuan) |
| `POST /api/public/orders` | **tidak diubah** (tetap tersedia untuk /menu, /cart, /checkout) |
| `POST /api/public/payments` | **tidak diubah** (dipakai wizard untuk QRIS) |
| `GET /api/public/menu` | **tidak diubah** (dipakai picker) |
| Admin/customer reservation | (opsional additive) ringkasan pembelian; DTO publik tetap tanpa id internal |
| `GET /api/admin/reservations/code/[code]` | (opsional) tampilkan pembelian di layar scan kasir |

## 14. PAYMENT IMPACT

- **Tanpa perubahan** pada `paymentService`, cashier, QRIS, webhook, `PaymentTransaction`.
- QRIS: `PENDING → PAID` lewat webhook existing (source of truth tetap `Payment.status` + `Order.paymentStatus`).
- KASIR: intent UNPAID → lunas lewat `markCashierPaymentPaid` (butuh shift terkait — perilaku existing dipertahankan; perlu diverifikasi untuk order yang berasal dari reservasi).
- Reservasi **tidak boleh** dianggap lunas hanya karena order dibuat: status pembayaran SELALU dibaca dari engine payment.
- Catatan pricing: order DINE_IN bebas tax/service (existing) → konsisten untuk reservasi (makan di tempat). Jika nanti ditagih DP/uang muka, itu fitur baru (di luar scope).

## 15. SECURITY IMPACT

- Harga/discount/tax/service/grand total **tetap 100% server-side** (`createCustomerOrder` menghitung dari DB; input klien hanya id produk + qty + id opsi/addon).
- Validasi produk (restaurant scope, aktif, tersedia, stok cabang, priceOverride) dan validasi opsi (required/min/max) & addon **sudah ada** → tidak boleh dilonggarkan.
- `restaurantId`/`branchId` tetap di-resolve server-side (resolver reservasi existing) — `items[].productId` harus divalidasi terhadap restaurant hasil resolve (sudah dilakukan engine order).
- **DTO publik** tidak boleh membocorkan `customerId/orderId internal/payment internals`; ringkasan order yang diekspos cukup `orderNumber`, nama item, qty, total, status pembayaran.
- Guest tetap tanpa OTP (limitasi existing, tidak berubah).
- Rate limit: `POST /public/reservations` 30/min + `POST /public/orders` 30/min → reservation+order dalam satu request mengurangi panggilan, tapi **wajib** ada proteksi duplikat/idempotency order (lihat §16).
- Tidak ada auth baru; tidak ada endpoint publik baru.

## 16. REGRESSION RISK

| Risiko | Level | Mitigasi |
| --- | --- | --- |
| Mengubah `createCustomerOrder` (tx opsional) merusak checkout `/menu` | **Tinggi** | Jadikan parameter opsional; perilaku default tak berubah; jalankan seluruh test order/`api` existing |
| Double order bila submit di-retry (network/refresh) | **Tinggi** | Idempotency: kunci order pada (reservation identity + items hash) atau buat reservasi lebih dulu lalu order di transaksi yang sama; retry order-number tidak boleh menduplikasi reservasi+order |
| `Table.status = OCCUPIED` otomatis saat order dibuat → meja terlihat terisi sejak booking | Sedang | Keputusan bisnis: terima (konsisten dengan order dine-in) atau buat order tanpa memicu OCCUPIED (butuh flag kecil di engine — additive) |
| Transaksi reservasi jadi lebih panjang (lock meja/branch + insert order) | Sedang | Ukur; pertimbangkan A2 (order di luar lock reservasi) + kompensasi |
| Gate R6 dihapus → celah "reservasi tanpa order" | Sedang | Ganti dengan validasi baru (order wajib & ter-link + ≥1 item) — jangan hanya dihapus |
| Cart global tercemar bila memakai `useCart` | Sedang | Pakai state baris lokal di wizard (rekomendasi) |
| Reservasi lama (`orderId = NULL`) di admin/customer UI | Rendah | UI harus handle null (tanpa pembelian) |
| Cashier/QRIS berubah perilaku | Rendah | Tidak ada perubahan di file payment/cashier |
| Availability R5.1 berubah | **Sangat rendah** | `reservation.slots` & `checkAvailability` tidak disentuh |
| Test purchase gate lama gagal | Pasti | Ditulis ulang dengan alasan rule berubah (dokumentasikan, jangan melonggarkan assertion) |

---

# ARCHITECTURE FLOW YANG DIREKOMENDASIKAN

```
Customer Reservation Wizard (src/app/(customer)/reservasi/page.tsx)
  Branch → Date → Party → Time → Table
     │
     ├─ PEMBELIAN  (produk langsung di dalam wizard — TANPA redirect /menu)
     │    └─ GET /api/public/menu?restaurantId&branchCode     ← katalog existing (harga/opsi/addon/stok)
     │    └─ state baris lokal (productId, qty, selections, addons) + tampilan subtotal/total
     │
     ├─ DATA CUSTOMER / FOLLOW-UP
     │    └─ nama + "No. WhatsApp untuk Follow-up"  → Reservation.guestPhone (existing, normalized)
     │       (prefill dari session customer bila login; boleh diubah)
     │
     └─ REVIEW (RESERVATION + FOLLOW-UP + PEMBELIAN + PAYMENT) → SUBMIT
          │
          └─ POST /api/public/reservations  { branchCode, date, start, duration, partySize,
                                              tableId, guestName, guestPhone, notes,
                                              items[], paymentMethod? }
               │
               └─ reservationService.createPublicReservation
                    ├─ resolve restaurant/branch (server-side, existing)
                    ├─ ORDER ENGINE EXISTING (orderService.createCustomerOrder)
                    │     ├─ validasi produk/branch/stok + harga server-side
                    │     ├─ Customer find-or-create (phone / session)
                    │     ├─ Order + OrderItem (+ Payment UNPAID bila KASIR)
                    │     └─ return orderId + orderNumber
                    ├─ RESERVATION KERNEL EXISTING (lock branch/table, availability R5.1, duplicate)
                    │     └─ simpan Reservation.orderId  ← field SUDAH ADA (tanpa migration)
                    └─ notify WhatsApp (R7, best-effort, targeted ke guestPhone)

  Sesudah submit:
    ├─ QRIS  → POST /api/public/payments { orderNumber, method:"QRIS" }
    │           → paymentUrl/qrImage → /payment/[orderNumber] (halaman existing, poll 4s)
    │           → webhook iPaymu → Payment PAID + Order.paymentStatus PAID
    └─ KASIR → Payment UNPAID sudah dibuat → /order/[orderNumber] (bayar di kasir; markCashierPaymentPaid)

  Relasi data:  Reservation.orderId → Order → OrderItem → Payment → PaymentTransaction
                (Reservation.orderId = scalar existing, di-resolve manual seperti pola codebase)
```

**Keputusan yang perlu persetujuan Anda sebelum implementasi:**
1. **Atomicity (D3):** A1 = tambah parameter tx opsional pada `createCustomerOrder` (satu transaksi, menyentuh order engine sedikit) vs A2 = dua transaksi + kompensasi (tanpa menyentuh order engine, ada risiko orphan).
2. **`items` wajib atau opsional** pada `POST /api/public/reservations` (wajib = breaking untuk klien lama; opsional = reservasi tanpa pembelian tetap bisa).
3. **Nomor follow-up:** satu input (dipakai untuk order & reservation, tanpa migration) vs dua input (butuh migration).
4. **Cart:** state lokal di wizard (rekomendasi) vs reuse `useCart` global.
5. **`Table.status` OCCUPIED** saat order dibuat — terima atau jangan.
6. **Probe R6.5** (`/purchase-eligibility` + `checkPurchaseEligibility`): hapus atau repurpose.
7. **Kebijakan cancel/refund** reservasi yang order-nya sudah PAID (refund penuh/parsial, siapa yang menyetujui).

**Verifikasi yang direncanakan setelah implementasi (20 poin Anda):** guest tanpa historical purchase, logged-in tanpa historical purchase, pilih produk di dalam reservasi, modifier/variant, quantity, validasi harga server-side, order terbentuk, reservation ter-link ke order, nomor follow-up tersimpan, nomor berbeda dari `Customer.phone`, QRIS, cash, review menampilkan pembelian, tidak ada redirect `/menu`, ordering normal tetap jalan, Cashier tetap jalan, QRIS tetap jalan, availability R5.1 tetap jalan, tenant isolation, cancel/refund.

**STOP — menunggu persetujuan audit. Tidak ada kode yang diubah dan tidak ada commit/push.**
