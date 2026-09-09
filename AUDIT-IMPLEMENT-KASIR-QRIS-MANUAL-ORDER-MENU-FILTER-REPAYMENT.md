# AUDIT + IMPLEMENT — KASIR QRIS • MANUAL ORDER • MENU FILTER • REPAYMENT

> Audit-first implementation of 4 features for the Kasir (outlet dashboard) and
> customer menu. All payment/order/stock/recommendation engines are **reused** —
> no new payment engine, no DB migration, no data deletion, no commit/push.
> Tanggal: 2026-09-09 · Verifikasi: `npx tsc --noEmit` + `npm run build` + code-trace.
> Produksi tetap `next start -p 3001` — port 3000 tidak disentuh.

---

## 1. Problem / Objective

1. **Kasir — Scan Order → CASH / QRIS**: setelah scan QR/barcode pesanan, kasir
   memilih CASH atau QRIS. QRIS harus memakai engine iPaymu existing
   (`createKasirQrisPayment`), reuse PENDING valid, retry FAILED/EXPIRED, jangan
   buat VA/customer payment, polling status existing, berlaku untuk
   DINE_IN/TAKEAWAY/DELIVERY, branch-scoped & tenant-safe.
2. **Kasir — Buat Pesanan Manual**: flow POS sederhana (pilih branch → pilih
   menu → qty → variant/addon/notes → review → CASH/QRIS → buat & proses
   pembayaran) tanpa memaksa customer login. Stock `0` → SOLD OUT, tidak bisa
   ditambahkan; server tetap memvalidasi; stock berkurang saat order COMPLETED.
   Kasir hanya membuat order di branch yang di-authorize.
3. **Filtering Menu Customer**: search produk, filter kategori, Terlaris,
   Rekomendasi, Tersedia/Sold Out — reuse API/service recommendation &
   best-seller existing, tetap branch-aware.
4. **`/admin/payment` — Repayment QRIS Page**: dari Payment Dashboard → "Bayar"
   tidak berhenti di request; ada dedicated page (QR tampil, nominal, order
   number, countdown expired, polling, PAID → kembali ke dashboard). Reuse
   `createKasirQrisPayment()`, tidak duplicate engine.

## 2. Existing Flow Audit

| Area | Temuan |
|---|---|
| Kasir QRIS engine | **Sudah ada & lengkap.** `createKasirQrisPayment(orderNumber, restaurantId, branchFilters)` di `src/services/payment/payment.service.ts` — reuse PENDING valid (`pending_existing`), flip stale/FAILED/EXPIRED lalu intent baru (`qris_created`), tolak PAID (`ConflictError "Order already paid"`), kembalikan UNPAID KASIR (`kasir_existing`). Tidak ada guard OrderType → berlaku untuk DINE_IN/TAKEAWAY/DELIVERY. |
| Kasir CASH engine | **Sudah ada.** `createPayment(orderId, …, {method:"KASIR"})` → row UNPAID; `markCashierPaymentPaid` (guarded UNPAID→PAID, `amountReceived ≥ amountDue`, shift RBAC untuk CASHIER, audit `PaymentTransaction`, 409 double-pay). |
| Scan flow | `OrderScanner` (kamera) → `/admin/orders/[orderNumber]` → `BarcodePaymentFlow` (dialog CASH + QRIS lengkap: QR render, countdown, polling 4s, retry, single-fire PAID). **Feature 1 sudah terimplementasi** oleh audit sebelumnya (`AUDIT-REPAYMENT-KASIR-QRIS-REPORT.md`). |
| Order creation | `createOrder` (admin) — validasi customer/table/product/branch-product/stock server-side, harga dari DB. **Gap:** schema `CreateOrderSchema` sudah menerima `selections`/`addons`/`notes` per item, tetapi service `createOrder` mengabaikannya (hanya `createCustomerOrder` yang menghitung variant/addon). |
| Customer | Tidak ada endpoint create/find-or-create untuk staff (hanya GET list admin + PUT). Kasir butuh customer row (Order.customerId wajib). |
| Repayment di Payment Dashboard | `/admin/payments` punya tombol "Repayment" yang **hanya membuat request + toast** — QR tidak pernah ditampilkan. "Bayar" (PENDING QRIS) membuka `paymentUrl` eksternal. Tidak ada dedicated payment page. |
| Menu customer | `/menu` sudah punya Rekomendasi (personalized/popular) + Terlaris (PAID-only, server-side) + section kategori + SOLD OUT per branch. **Gap:** belum ada search, filter kategori, toggle Tersedia/Habis, atau quick view Terlaris/Rekomendasi. Data sudah branch-scoped (`/api/public/menu` + `branchCode` → `BranchProduct` availability/price/stock). |
| Auth/branch | `requireRoles(["ADMIN","CASHIER"])` → `requireRestaurantContext` (restaurantId dari session), `authorizedBranches(ctx)` (scoped → branch sendiri), `effectiveWriteBranchId(ctx)` (scoped user wajib punya branch konteks). Semua route order/payment sudah tenant+branch-scoped. |

## 3. Root Cause / Gap

1. **Feature 1** — tidak ada gap fungsional; flow sudah jalan end-to-end. Hanya
   diverifikasi ulang (tidak diubah).
2. **Feature 2** — (a) admin `createOrder` tidak mendukung variant/addon/notes
   padahal schema sudah menerimanya; (b) tidak ada endpoint customer
   find-or-create untuk staff; (c) tidak ada halaman "Buat Pesanan" kasir.
3. **Feature 3** — UI filter belum ada (search/kategori/availability/quick view).
4. **Feature 4** — Payment Dashboard hanya membuat QRIS lalu berhenti; QR tidak
   pernah dirender; tidak ada halaman payment dedicated; PENDING QRIS salah
   diarahkan ke URL gateway eksternal.

## 4. Architecture & Reused Services

- **Payment**: 100% reuse `createKasirQrisPayment`, `createPayment` (KASIR),
  `markCashierPaymentPaid`, `getPayment` (polling) — tidak ada engine baru.
- **Order**: reuse `createOrder` (admin) yang **diperluas** agar menghitung
  variant/addon/notes server-side (pola identik `createCustomerOrder`). Harga
  selalu dari DB; stock divalidasi per branch.
- **Customer**: reuse `customerService.findOrCreateCustomer` via route baru
  `POST /api/customers` (ADMIN/CASHIER, restaurantId dari session).
- **Menu / Rekomendasi / Terlaris**: reuse `/api/public/menu`,
  `/api/public/menu/recommendations`, `/api/public/menu/best-sellers`
  (branch-aware). Filter baru murni client-side di atas data yang sudah
  branch-scoped.
- **QRIS screen**: komponen bersama `KasirQrisScreen` dipakai oleh flow
  manual-order dan halaman repayment — satu implementasi QR+countdown+polling.

```
branch (session/UserBranch)
  → requireRoles → restaurantId server-side
  → authorizedBranches(ctx) [read filter] / effectiveWriteBranchId(ctx) [write]
  → BranchProduct (availability → priceOverride → stock)
  → menu/order/payment
```

## 5. Files Changed

| File | Perubahan |
|---|---|
| `src/services/order/order.service.ts` | **`createOrder` (admin) diperluas**: include optionGroups+addons pada query produk; validasi + hitung `selections` (required/min/max), `addons`, `notes`; `unitPrice = base + adj + addon`; simpan `customizations` JSON. Caller lama tanpa selections tidak berubah perilakunya. |
| `src/app/api/customers/route.ts` | **`POST /api/customers`** (baru) — find-or-create customer utk kasir: `requireRoles(["ADMIN","CASHIER"])`, restaurantId dari session, name wajib, phone opsional (placeholder `guest-kasir-…` jika kosong). GET list tetap ADMIN-only (tidak dilebarkan). |
| `src/services/customer.service.ts` | `findOrCreateCustomer({name, phone})` client wrapper. |
| `src/app/admin/orders/new/page.tsx` | **BARU — halaman "Buat Pesanan" kasir (POS)**: resolusi branch (`useBranchContext`), menu branch-scoped (search + kategori chips + grid produk besar + SOLD OUT), cart selalu terlihat (qty +/-, edit, hapus, subtotal/tax/service/total), modal customize (variant/addon/notes), data pelanggan (find-or-create), tipe pesanan + meja, CASH (form uang diterima/kembalian) atau QRIS (`KasirQrisScreen`), lalu buat & proses pembayaran. |
| `src/components/admin/orders/kasir-qris-screen.tsx` | **BARU — layar QRIS bersama**: create/reuse via `createKasirQrisPayment`, QR (`qrImage` → fallback `qrString` via lib `qrcode`), nominal + order number, countdown expired, polling 4s `getPayment`, PAID single-fire, FAILED/EXPIRED → "Buat QRIS Baru", `kasir_existing` → arahkan ke pembayaran kasir, PAID → tanpa duplicate (server Conflict → tampil state paid). |
| `src/app/admin/orders/page.tsx` | Tombol **"Buat Pesanan"** di header (→ `/admin/orders/new`). |
| `src/app/admin/dashboard/page.tsx` | Tombol **"Buat Pesanan"** di header (→ `/admin/orders/new`). |
| `src/app/(customer)/menu/page.tsx` | **Filter menu**: search box, chips kategori, quick view Semua / ⭐ Rekomendasi / 🔥 Terlaris, toggle Tersedia / Tersedia & Habis / Habis; section kategori & rekomendasi/terlaris ikut terfilter; state "Tidak ada produk yang cocok" + Reset Filter. Data tetap branch-scoped dari server. |
| `src/app/admin/payments/[orderNumber]/qris/page.tsx` | **BARU — halaman repayment QRIS dedicated**: load order scoped (`getOrderByNumber` admin), render `KasirQrisScreen`, not-found/error state, kembali ke dashboard. |
| `src/app/admin/payments/page.tsx` | "Bayar"/"Repayment" utk QRIS (PENDING/FAILED/EXPIRED) → **Link ke halaman QRIS** (tidak lagi request-then-stop; tidak ada intent dibuat dari list). VA legacy tetap `paymentUrl` eksternal. |

## 6. Implementation

### 6.1 Kasir Scan → CASH / QRIS (feature 1 — verified, no change)
Flow existing sudah lengkap: scan → detail order → "Proses Pembayaran" dengan
dua tombol besar [Cash / Tunai] dan [QRIS] → cash form (total, uang diterima,
kembalian live, "Uang Pas", konfirmasi) atau QRIS screen (QR, nominal, status,
countdown, polling, retry "Buat QRIS Baru"). Keduanya memakai engine existing.

### 6.2 Kasir Buat Pesanan Manual (feature 2)
1. Branch: single-branch auto; multi-branch pakai `useBranchContext`; tanpa
   branch ter-resolve → halaman meminta pilih cabang. Server tetap otoritatif
   (`effectiveWriteBranchId` menolak scoped-user tanpa branch konteks).
2. Menu: `/api/public/menu?restaurantId&branchCode` → produk branch-scoped
   dengan stock + variant/addon. `stock 0` → kartu "Habis" (tidak bisa
   ditambah); qty di-cap stock (advisory; server final).
3. Customize: modal variant/addon/notes → payload `selections/addons/notes`
   → **server menghitung ulang** harga (validasi group/option/addon).
4. Customer: `POST /api/customers` find-or-create (nama wajib, HP opsional).
5. Order: `POST /api/orders` (existing) → `createOrder` memvalidasi
   produk/branch/stock (server = sumber kebenaran) dan menyimpan
   customizations. **Stock belum berkurang saat pembuatan** — hanya saat
   status → COMPLETED (mekanisme existing `updateOrderStatus`).
6. Pembayaran:
   - **CASH** → `POST /api/payments {orderId, method:"KASIR"}` → row UNPAID →
     `markCashierPaymentPaid(amountReceived)` (server cek `amountReceived ≥
     amountDue`, shift kasir, 409 double-pay).
   - **QRIS** → `POST /api/payments {orderNumber, method:"QRIS"}` →
     `createKasirQrisPayment` → `KasirQrisScreen` (reuse/retry/polling).

### 6.3 Filtering Menu Customer (feature 3)
Filter bar di atas menu: search (nama+deskripsi), chips kategori, quick view
Terlaris (data `best-sellers` PAID-only existing) & Rekomendasi (data
`recommendations` existing), toggle Tersedia/Habis (`isSoldOut` dari stock
branch). Semua filter diterapkan **client-side** di atas daftar produk yang
sudah di-scope server per branch (branch → BranchProduct → availability →
stock → menu) — produk cabang lain tidak pernah muncul.

### 6.4 Repayment QRIS Page (feature 4)
`/admin/payments/[orderNumber]/qris`:
1. `orderService.getOrderByNumber` (admin scoped, 404/403 untuk order asing).
2. `KasirQrisScreen` → `createKasirQrisPayment(orderNumber)`:
   - PENDING valid → **reuse** (tidak ada panggilan gateway kedua);
   - FAILED/EXPIRED/stale-PENDING → di-expire lalu intent baru (retry);
   - PAID → server `Conflict "Order already paid"` → tampil state paid, **tidak
     membuat payment baru**;
   - UNPAID KASIR row → notice + arahkan ke pembayaran kasir.
3. QR render (qrImage → fallback qrString), nominal, order number, countdown
   expired (tick 1s), polling 4s via `getPayment` (existing).
4. PAID → success view → kembali ke Payment Dashboard.
Dashboard: tombol "Bayar" (PENDING) / "Repayment" (FAILED/EXPIRED) QRIS kini
menjadi link ke halaman ini — tidak ada payment yang dibuat dari list.

## 7. Security Validation

| Kontrol | Status |
|---|---|
| `restaurantId` dari session/server | ✅ `requireRoles` → `requireRestaurantContext` (user.restaurantId dari DB); `POST /api/customers` & semua route order/payment memakai ctx.restaurantId. |
| Branch authorization server-side | ✅ `authorizedBranches(ctx)` pada semua read/write; `effectiveWriteBranchId(ctx)` untuk order baru (scoped-user tanpa branch → ditolak). |
| Tidak percaya `branchId` dari client | ✅ Order: branch dari konteks session (header `x-branch-id` di-revalidasi; stale dibersihkan `useBranchContext`). Menu: `branchCode` divalidasi ke restaurant. |
| Order/Payment IDOR → 403/404 | ✅ `getOrderByNumberScoped`, `getPayment`, `createKasirQrisPayment`, `markCashierPaymentPaid` semua filter `restaurantId` + `branchId ∈ authorizedBranches`. Nomor order asing/cabang lain → not-found/403. |
| Kasir tidak bisa membayar order cabang lain | ✅ `markCashierPaymentPaid` filter payment by `restaurantId` + branch; shift kasir juga branch-bound. |
| QRIS tidak bisa duplicate payment | ✅ `createPayment` pakai per-order `FOR UPDATE` lock + cek PENDING/PAID existing; `createKasirQrisPayment` reuse/expire logic; PAID → Conflict. UI `busy` + single-fire PAID. |
| Tidak ada credential/payment secret di client | ✅ Tidak ada secret baru di client; provider keys tetap server-side; halaman baru hanya memakai axios → `/api` (session cookie). |
| Harga/uang tidak bisa dimanipulasi client | ✅ `createOrder` menghitung ulang unitPrice dari DB (termasuk variant/addon); payment amount = `order.grandTotal` dari DB; `amountReceived ≥ amountDue` server-side. |

## 8. Test Matrix PASS/FAIL

Verifikasi statis (typecheck + build + code-trace) tuntas. Runtime gateway/iPaymu
membutuhkan server + DB + kunci sandbox (sama dengan audit sebelumnya —
MySQL lokal tidak aktif di sesi ini, produksi 3001 tidak berjalan).

### Kasir QRIS
| Skenario | Status |
|---|---|
| scan DINE_IN → CASH/QRIS | ✅ flow UI+engine traced (`BarcodePaymentFlow` + `createKasirQrisPayment`) |
| scan TAKEAWAY → CASH/QRIS | ✅ tidak ada OrderType guard di engine |
| scan DELIVERY → CASH/QRIS | ✅ tidak ada OrderType guard di engine |
| QRIS PENDING reuse | ✅ `pending_existing` branch traced (`createKasirQrisPayment`) |
| FAILED/EXPIRED retry | ✅ stale→EXPIRED lalu intent baru traced |
| PAID tidak duplicate | ✅ `ConflictError "Order already paid"` → `KasirQrisScreen` state paid |
| foreign branch → reject | ✅ order lookup scoped → 404/403 |
| QR tampil + countdown + polling | ✅ `KasirQrisScreen` (qrImage/qrString, tick 1s, poll 4s `getPayment`) |

### Kasir Order (manual)
| Skenario | Status |
|---|---|
| create order (admin route) | ✅ POST /api/orders → `createOrder` (schema validated) |
| category/search produk | ✅ picker dengan kategori chips + search client-side |
| variant/addon/notes | ✅ modal + validasi & pricing server-side (`createOrder` diperluas) |
| stock 0 → tidak bisa ditambah | ✅ kartu "Habis" disabled + server tolak `sudah habis` |
| stock insufficient → ditolak | ✅ server `Stok … tidak mencukupi`; client cap qty advisory |
| CASH | ✅ `createPayment KASIR` → `markCashierPaymentPaid` (409 double-pay, shift RBAC) |
| QRIS | ✅ `createKasirQrisPayment` via `KasirQrisScreen` |
| branch isolation | ✅ `effectiveWriteBranchId` + `authorizedBranches`; halaman minta pilih cabang |

### Menu Filter
| Skenario | Status |
|---|---|
| search | ✅ filter client-side (nama+deskripsi) |
| kategori | ✅ chips kategori |
| Terlaris | ✅ quick view atas data `best-sellers` existing (PAID-only) |
| Rekomendasi | ✅ quick view atas data `recommendations` existing |
| sold out / tersedia | ✅ toggle availability (`isSoldOut` dari stock branch) |
| branch isolation | ✅ data dari `/public/menu?branchCode` (server branch-scoped) |

### Repayment
| Skenario | Status |
|---|---|
| `/admin/payments` → Bayar | ✅ Link → `/admin/payments/[orderNumber]/qris` |
| dedicated QRIS page | ✅ halaman baru + `KasirQrisScreen` |
| QR tampil | ✅ gateway `qrImage` / fallback `qrString` |
| polling | ✅ 4s `getPayment` selama PENDING |
| expired | ✅ countdown + effective-EXPIRED lokal + retry |
| PAID | ✅ single-fire success + kembali ke dashboard |
| duplicate prevention | ✅ server lock + Conflict; dashboard tidak membuat intent |

### Build
| Check | Hasil |
|---|---|
| `npx tsc --noEmit` | ✅ **PASS** (0 error) |
| `npm run build` | ✅ **PASS** (exit 0; semua route compile; `/admin/orders/new`, `/admin/payments/[orderNumber]/qris`, `/api/customers` terdaftar) |
| ESLint (file baru/diubah) | ✅ 0 error baru; sisa error `react-hooks/set-state-in-effect` di `orders/page.tsx:101` & `dashboard/page.tsx:91` **pre-existing** (terverifikasi via `git diff` — bukan dari edit ini), konsisten dengan debt lint yang didokumentasikan audit sebelumnya. |

## 9. Regression

- **Customer QRIS / checkout / cart** — tidak diubah (hanya halaman menu
  customer yang ditambah filter; logika cart/checkout utuh).
- **Kasir CASH** — `markCashierPaymentPaid` tidak diubah.
- **Barcode scanner** (`OrderScanner`) — tidak diubah.
- **Order COMPLETED → stock deduction** — `updateOrderStatus` tidak diubah;
  order baru dibuat PENDING tanpa mengurangi stock.
- **Branch selection / table QR / landing `/`** — tidak diubah.
- **Recommendation / best-seller** — service tidak diubah; hanya view menu.
- **Reports / shifts / stock management** — tidak diubah.
- **Payment webhook/polling** — `handleWebhook` & endpoint polling tidak diubah.
- **`createOrder`** — tanpa `selections/addons` berperilaku persis seperti
  sebelumnya (unitPrice = product.price); validasi stock/branch/product tetap.
- Port 3000 tidak disentuh; produksi tetap `next start -p 3001`.

## 10. Remaining Risks

1. **Runtime gateway belum diverifikasi** — QRIS create/reuse/retry/PAID via
   iPaymu live/sandbox membutuhkan server + DB + kunci; verifikasi di sesi ini
   adalah typecheck + build + code-trace (sama seperti audit sebelumnya).
2. **CASHIER + CASH wajib shift terbuka** — perilaku RBAC existing
   (`markCashierPaymentPaid`); kasir tanpa shift terbuka mendapat pesan error
   yang jelas. Bukan perubahan baru.
3. **Client stock check bersifat advisory** — kasir bisa menambah qty hingga
   stock per-baris di UI, tetapi server menghitung agregat lintas baris dan
   tetap menjadi sumber kebenaran (order ditolak bila melebihi stock).
4. **Lint debt pre-existing** — `react-hooks/set-state-in-effect` di
   orders/dashboard (dan 27 error lain di luar scope) tetap ada; perlu sweep
   terpisah.
5. **Menu filter** — `availabilityFilter === "Habis"` hanya bermakna saat ada
   konteks branch (stock != null); tanpa branch (legacy) toggle Habis kosong —
   perilaku wajar karena tidak ada data stock.
6. **Screenshot/browser check** direkomendasikan setelah deploy (layout POS
   `/admin/orders/new` pada layar kecil belum diverifikasi visual).

---

## Verdict

**🟢 IMPLEMENTED — siap test** — 4 fitur terimplementasi di atas engine
existing (tidak ada payment/order engine baru, tidak ada migrasi, tidak ada
data terhapus). `tsc` + `build` PASS; security trace 8/8 aman; matrix statis
hijau. Runtime gateway (iPaymu) menunggu lingkungan live/sandbox.