# AUDIT-FIX-KASIR-PAYMENT-GLOBAL-BRANDING.md

**Tanggal:** 2026-09-09
**Scope:** Issue #1 (Kasir QRIS → CASH error 409) + Issue #2 (Website Branding belum berlaku di Admin/Dashboard/Kasir)
**Metode:** Audit-first, root-cause-driven, reuse existing architecture. Tidak ada Prisma reset, tidak ada data deletion, tidak ada commit/push, port 3000 tidak disentuh.

---

## 1. Executive Summary

Dua root cause ditemukan lewat audit, keduanya diperbaiki **di dalam architecture existing**:

1. **Payment 409** — `createPayment()` memblokir pembuatan intent baru setiap kali ada payment `PENDING` pada order yang sama. Ketika kasir memilih CASH setelah QRIS PENDING (kembali dari layar QR), server menolak dengan 409 "Payment already exists for this order". Fix: transaksi yang sama (row lock `FOR UPDATE` tetap ada) kini **membatalkan (CANCELLED, guarded)** intent online yang tidak lagi live saat kasir secara eksplisit memilih KASIR — QRIS lama tetap tersimpan sebagai history, CASH menjadi satu-satunya intent live.
2. **Branding Admin** — `BrandingProvider` + `BrandingSync` hanya dipasang di customer layout; admin layout me-render **hardcoded** `🍽️ Restoran Bahagia` dan tidak pernah memuat `RestaurantSettings`. Fix: provider baru `AdminBrandingProvider` yang **membungkus `BrandingProvider` yang sama** (bukan sistem tema kedua), di-feed dari endpoint auth existing `GET /api/admin/settings/branding` (session-scoped, `requireRoles` ADMIN+CASHIER).

Hasil verifikasi: `tsc --noEmit` bersih, `npm run build` sukses, ESLint changed files 0 error baru (error tersisa pre-existing, dibuktikan dengan `git stash`).

---

## 2. Issue #1 — QRIS → CASH 409

### 3. Payment Root Cause

`PaymentService.createPayment()` (src/services/payment/payment.service.ts, transaksi per-order):

```ts
// SEBELUM — blokir SEMUA pembuatan baru saat ada PENDING/PAID:
const existingPayment = await tx.payment.findFirst({
  where: { orderId, status: { in: ["PENDING", "PAID"] } },
});
if (existingPayment) throw new ConflictError(...); // ← 409 untuk QRIS PENDING → CASH
```

Snapshot audit alur kasir:
- Kasir pilih QRIS → `createKasirQrisPayment()` → payment `PENDING` + `order.paymentStatus = PENDING`.
- Kasir klik "Kembali" → `resetToChoose()` hanya reset state UI; payment PENDING tetap live di DB (by design — QR masih bisa dibayar customer).
- Kasir pilih CASH → form → `handleCashSubmit()` → `createPayment(method: "KASIR")` → **409 Conflict**.

Frontend tidak bersalah di sini — server yang menolak transisi yang valid. Kebijakan "one live intent" benar, tetapi eksekusinya salah: intent online yang **tidak lagi dipilih kasir** harus di-supersede, bukan memblokir.

### 4. Payment State Transition (implementasi baru)

Alur QRIS → Kembali → CASH (kasus utama):

```
Payment #1  QRIS   PENDING   (live)
   ↓ kasir pilih CASH (transaksi createPayment, row lock order FOR UPDATE)
Payment #1  QRIS   CANCELLED (guarded updateMany, tetap sebagai history — TIDAK dihapus)
Payment #2  KASIR  UNPAID    (satu-satunya intent live)
   ↓ kasir terima uang (markCashierPaymentPaid, guarded UNPAID→PAID)
Payment #2  KASIR  PAID ; Order.paymentStatus = PAID
```

Alur CASH → Kembali → QRIS (reverse flow, sudah ada sebelumnya di `createKasirQrisPayment()`):
- CASH masih `UNPAID` → di-CANCELLED (guarded) → QRIS baru dibuat. ✅
- CASH sudah `PAID` / order `PAID` → `ConflictError("Order already paid")` — QRIS tidak dapat dibuat/dibayar. ✅ (ditambah double-check frontend sebelum memanggil server)

Matriks status yang diizinkan: `UNPAID/PENDING/FAILED/EXPIRED/CANCELLED` → boleh transisi; `PAID` → terminal untuk semua jalur (createPayment, mark-paid, webhook). `REFUNDED` tidak disentuh oleh alur ini.

### 5. Payment Backend Fix

File: `src/services/payment/payment.service.ts` — **hanya `createPayment()` dan `handleWebhook()`; state machine dan engine lain tidak berubah.**

Dalam transaksi KASIR yang sama (row lock `FOR UPDATE` tetap memelihara serialisasi per-order):

```ts
// Guarded supersede — hanya baris yang MASIH di status tersebut yang berubah:
await tx.payment.updateMany({
  where: { orderId, method: { not: "KASIR" }, status: { in: ["PENDING", "FAILED", "EXPIRED"] } },
  data: { status: "CANCELLED" },
});
await tx.order.updateMany({
  where: { id: lockedOrder.id, paymentStatus: { not: "PAID" } },
  data: { paymentStatus: "UNPAID" },
});
```

- `PAID` dicek **lebih dulu** dan tetap terminal — order yang sudah dibayar tidak pernah bisa di-supersede.
- `CANCELLED` lama (hasil supersede sebelumnya) tidak tersentuh lagi (idempotent).
- Paymark lama `kasir_existing` yang salah ("Pembayaran kasir sudah tercatat...") tidak dikembalikan — reuse UNPAID KASIR tetap idempotent, tanpa 409 untuk transisi valid.

### 6. Payment Frontend Fix

File: `src/components/admin/barcode-payment-flow.tsx`:

- `refreshOrder()` baru — snapshot order (termasuk payments) di-refresh **tanpa reset state dialog** setiap kali kasir klik "Kembali" (`resetToChoose`) dan **tepat sebelum keputusan submit**.
- `handleCashSubmit()`: keputusan dari snapshot fresh — jika order/payments sudah `PAID` (mis. customer baru saja scan QR di ponselnya), UI menampilkan **"Order sudah dibayar"**, bukan error 409; reuse hanya row `KASIR UNPAID`; row CANCELLED/FAILED/EXPIRED dibiarkan server membuat row UNPAID baru.
- `handleQrisSelect()`: pre-check `PAID` sebelum membuat QRIS (reverse flow).
- State QRIS (`pendingPayment`, `qrPayloadResult`, countdown, `paidNotifiedRef`) di-reset penuh di `resetToChoose` — tidak ada state QRIS yang terbawa ke CASH, cash form selalu mulai bersih (Jumlah Tagihan / Uang Diterima / Kembalian / [Bayar]).
- Single-scan behavior yang sudah diperbaiki dipertahankan (`initialOrderNumber` memuat order langsung tanpa scan kedua; `qrisBusyRef` + `paidNotifiedRef` tetap dipakai).

### 7. Webhook / Race Protection

`handleWebhook()` diperkuat (transaksi sama, engine sama):

- **Payment CANCELLED di-CHECK dulu di dalam transaksi**: webhook lama untuk QRIS yang sudah di-cancel oleh kasir → row tetap CANCELLED, order/CASH payment tidak tersentuh, dan ditulis audit `PaymentTransaction` berstatus `IGNORED_CANCELLED` (rawData + `ignoredReason`) — payment history tidak pernah hilang.
- **Semua flip status jadi guarded `updateMany`** pada status saat-in-transaksi (`current.status`) — menang: writer yang lebih baru, bukan webhook yang telat. `PAID` ganda tidak mungkin (update count 0 → diabaikan, dicatat sebagai `IGNORED_STALE`).
- **Order mirror jadi guarded**: `order.paymentStatus` hanya di-update jika nilainya masih persis `current.status` ( milik payment ini). Artinya webhook PAID lama tidak bisa menimpa `UNPAID` milik CASH yang baru, dan tidak bisa menyeret order `PAID` mundur ke `FAILED/EXPIRED/CANCELLED`.

Skenario test #4 (QRIS PENDING → CASH → CANCELLED → CASH PAID → webhook lama masuk): webhook melihat row CANCELLED → hanya menulis audit `IGNORED_CANCELLED` → order tetap PAID via CASH → tidak ada duplicate PAID → `paymentStatus` CASH tidak tertimpa. ✅

### 8. Idempotency

- **Double click CASH** → `isSubmitting` men-disable tombol; server `markCashierPaymentPaid` guarded `UNPAID→PAID` di transaksi; race kalah → `alreadyPaid` → UI "Order sudah dibayar" (route mark-paid tetap 409 untuk klik ganda yang benar-benar terjadi — itu perilaku proteksi, bukan error transisi).
- **Double click QRIS** → `qrisBusyRef` guard + serialisasi `FOR UPDATE` di server.
- **QRIS polling tidak membayar CASH** → polling hanya aktif saat `payStatus === "qris-ready"` dan payment PENDING ber-method QRIS/VA; CASH dibayar hanya via `markCashierPaymentPaid` dengan guarded update.
- **Stale browser mark-paid payment lama** → server menolak (row bukan UNPAID / order sudah PAID → `alreadyPaid`).
- **PAID order tidak dapat dibayar lagi** → dicek di `createPayment` (PAID terminal), `createKasirQrisPayment`, dan sekarang juga pre-check di frontend.

---

## 9. Issue #2 — Global Website Branding

### 10. Existing Branding Architecture (audit)

```
RestaurantSettings (restaurantId unique; siteName/logoUrl/primary/secondary/accent, semua nullable)
  → resolveBranding()            src/services/branding/branding.service.ts (fallback: siteName→Restaurant.name, warna→default palette)
  → GET /api/admin/settings/branding   (requireAdmin; PUT requireAdmin)  ← existing
  → BrandingProvider             src/hooks/use-branding.tsx → CSS variables --brand-* pada <html>
  → Tailwind tokens              globals.css @theme inline: bg-brand-primary, text-brand-primary, border-brand-primary, *-foreground, dst.
```

Temuan audit (pertanyaan A–H task):
- A. Branding di-load via `BrandingSync` (customer) + fetch manual di settings page. **Admin shell tidak pernah memuatnya.**
- B. **Ya** — `BrandingProvider` hanya di `src/app/(customer)/layout.tsx` + `src/app/page.tsx`.
- C. **Ya** — `src/app/admin/layout.tsx` tidak membaca branding sama sekali.
- D. **Ya** — sidebar & mobile header **hardcoded** `🍽️ Restoran Bahagia`.
- E. **Ya** — blue (`bg-blue-600`, `border-blue-500`, `text-blue-700`) dipakai sebagai warna aksi/terpilih di manual order, order card, barcode flow, tables; `bg-gray-100 text-gray-900` untuk active nav.
- F. Tidak ada sistem tema admin terpisah — hanya warna hardcoded. (Fix tidak membuat sistem baru.)
- G. Fetch branding ganda: **tidak** — admin kini fetch sekali per load shell; settings page tidak menambah fetch, hanya memanggil `applyBranding` pada data respons save yang sudah ada.
- H. Hard refresh admin kehilangan branding: **ya sebelumnya** — kini provider fetch dari DB saat mount, jadi hard refresh selalu benar.

### 11. Branding Root Cause

Branding adalah **data restoran** tetapi provider-nya hanya dipasang di customer subtree. Admin/Dashboard/Kasir share root layout `src/app/admin/layout.tsx` yang tidak memiliki provider → CSS variables `--brand-*` tidak pernah di-set → semua token brand jatuh ke default, logo/nama hardcoded.

### 12. Admin Layout / Provider Fix

- File baru: `src/hooks/use-admin-branding.tsx` — `AdminBrandingProvider`:
  - **Membungkus `BrandingProvider` yang sama** (satu context, satu `applyBranding`, satu CSS-variable applier) — bukan sistem tema kedua.
  - Fetch sekali per mount shell dari `GET /api/admin/settings/branding` (dinamis import `@/lib/axios`, guard `alive`); gagal/non-login → fallback theme existing, non-blocking.
  - Mencakup SEMUA halaman `/admin/*` (dashboard, orders, orders/new, payments, shifts, tables, stock, menu, reports, customers, marketing, users, settings, branches/cabang, whatsapp, recommendations) — **tidak ada page yang fetch branding sendiri**.
- `src/app/admin/layout.tsx`: `AdminBrandingProvider` membungkus `AdminRealtimeProvider`.

### 13. Logo

`branding.logoUrl` tersedia → `<img>` di desktop sidebar, mobile top bar, mobile drawer (fallback 🍽️ bila kosong/rusak, perilaku sama dengan `BrandLogo` customer). Untuk `/admin/orders/new` (kasir), logo sudah ter-cover via provider.

### 14. Site Name

`branding.siteName` → restaurant.name → "Restoran" (fallback berlapis existing `resolveBranding`) — sidebar desktop, mobile top bar, mobile drawer. Hardcode `🍽️ Restoran Bahagia` dihapus. Sidebar memakai `text-brand-primary truncate` agar nama panjang tidak merusak layout.

### 15. Primary Color

Token `bg-brand-primary` / `text-brand-primary` / `border-brand-primary` (+ `-foreground` kontras WCAG dari `getContrastText`) kini aktif di admin: sidebar logo/nama, active nav item, tombol aksi utama manual order (plus/minus qty, tambah item, submit), chip kategori & tipe pesanan terpilih, badge cabang, timeline "status sekarang", pilihan QRIS di barcode flow.

### 16. Secondary Color

Token `bg-brand-secondary` (+ `-foreground`) untuk: background active sidebar item, background chip terpilih (kategori, tipe pesanan, opsi customisasi), badge cabang.

### 17. Accent Color

Token `border-brand-accent` / `ring-brand-accent` untuk: border badge cabang, ring dot timeline status saat ini. Hover state memakai opasitas brand (`hover:border-brand-primary/40`, `hover:bg-brand-primary/90`).

### 18. Hardcoded Color Audit (klasifikasi, bukan search-replace buta)

| Lokasi | Sebelum | Klasifikasi | Keputusan |
|---|---|---|---|
| admin/layout sidebar active | `bg-gray-100 text-gray-900` | A (UI identity) | → `bg-brand-secondary text-brand-primary` |
| orders/new: chip kategori/tipe terpilih, tombol qty, submit, ring input | blue-600/500/300 | A | → brand tokens |
| barcode flow: opsi QRIS terpilih, spinner loading | blue-500/600 | A | → brand tokens |
| order-card: tombol "Scan Barcode", badge cabang | blue-500 / blue-50-200-700 | A | → brand tokens |
| order-detail: dot timeline status saat ini | blue-500 | A | → `bg-brand-primary ring-brand-accent` |
| tables page: teks nama cabang | text-blue-600 | A | → `text-brand-primary` |
| order-card/detail CONFIRMED (blue-100/800) & PROCESSING (purple) | — | B (semantic status) | **tidak diubah** |
| reports: QRIS=blue, VA=purple (legend payment method) | — | B | **tidak diubah** |
| stock badge stok aman (blue-50/700), users badge aktif | — | B | **tidak diubah** |
| shifts/payments `text-blue-700` (nomor shift / referensi) | — | C (neutral info) | **tidak diubah** |
| product-image-field drag-over border-blue-400 | — | C | **tidak diubah** |
| whatsapp `text-blue-700` (nomor terhubung) | — | C | **tidak diubah** |
| marketing indigo (status chip) | — | B | **tidak diubah** |
| bg-gray-900 / bg-black / hex literal di admin | — | tidak ditemukan sebagai brand color | — |

Hasil scan ulang: `src/app/admin` + `src/components/admin` tidak lagi memiliki blue/indigo/purple yang berfungsi sebagai warna aksi/terpilih; sisa blue/purple/indigo adalah semantic status atau neutral info.

### 19. Semantic Color Protection

Tidak berubah dan dijaga: PAID/SUCCESS → green; FAILED/ERROR → red; PENDING → amber/yellow; SOLD OUT → merah/abu gelap; WARNING → amber; INFO → blue; CANCELLED → semantic existing; CASH → green di semua pilihan metode. Kontras teks brand selalu dihitung WCAG (`getContrastText`), jadi brand gelap/terang apa pun tetap terbaca.

### 20. Dashboard

Sidebar (logo, nama, active nav), mobile top bar/drawer, dan seluruh halaman `/admin/*` kini mewarisi brand via provider. Status Revenue/Payment/Order/Stock/Shift tetap semantic (green/red/amber/blue) — dashboard page tidak diubah sama sekali (tidak ada brand color di sana sebelumnya, tidak ada hardcoded brand perlu diganti).

### 21. Kasir

Orders (order-card badge/tombol), Manual Order (orders/new penuh), Payment (barcode-payment-flow penuh), QRIS screen, Tables, Stock, Shift — semua ter-cover oleh `AdminBrandingProvider` (provider level shell, bukan per-page). Semantic CASH/QRIS/PAID/PENDING/FAILED/SOLD OUT tidak disentuh. Bug lama "Pembayaran kasir sudah tercatat. Silakan masukkan uang diterima." tidak kembali: `handleCashSubmit` reuse row KASIR UNPAID + server guarded supersede; hasil `kasir_existing` tetap hanya sebagai error defense di jalur QRIS, tidak pernah membuka cash form.

### 22. Customer Regression

Customer **tidak disentuh satu baris pun**: `src/app/(customer)/**`, `src/components/customer/**`, `src/hooks/use-branding.tsx`, `BrandingSync`, `globals.css`, public APIs — tidak dimodifikasi. `/`, `/pilih-cabang`, `/menu`, `/cart`, `/checkout`, `/payment/*`, `/order/*`, `/t/*` tetap memakai alur BrandingSync yang sudah benar (fetch ≤1× per restaurant per load, hard refresh aman via `(customer)/layout.tsx`).

### 23. Tenant Security

- `GET /api/admin/settings/branding` menurunkan `restaurantId` **dari session** (`requireRoles` → `requireRestaurantContext`) — tidak ada `?restaurantId=` / `x-restaurant-id` yang dipercaya. Admin Restoran A hanya bisa menerima branding Restoran A; CASHIER juga dibatasi ke restaurant-nya sendiri.
- Tidak ada branch-level branding baru — Jakarta/Bandung/Surabaya memakai branding restaurant yang sama (satu `RestaurantSettings` per restaurant).
- Isolasi tenant payment tidak berubah: semua jalur tetap restaurantId dari session + `authorizedBranches(ctx)` (foreign branch → 404/403), `markCashierPaymentPaid` tetap scoped restaurant+branch+shift.

### 24. Branch Behavior

Branch selector, filter `x-branch-id`, dan authorization branch tidak berubah. Payment fix bekerja untuk semua cabang karena branch scoping terjadi di route sebelum service; supersede CANCELLED hanya menyentuh payment pada order yang sama.

---

## 25. Performance

- Branding: **satu** fetch per load shell admin (sejajar BrandingSync di customer); tidak ada polling, tidak ada fetch per-component, tidak ada fetch ganda (settings page memakai respons save yang sudah ada). CSS variables di-set satu efek pada `<html>` — pola sama dengan customer.
- Payment: tidak ada query baru di hot path kecuali satu `findUnique(status)` di dalam transaksi webhook (indexed PK) dan pemanfaatan transaksi KASIR yang sudah ada. Gateway call tetap di luar lock.

## 26. Dynamic Update

Admin Settings → Website Branding → Save → `handleSave` memanggil `applyBranding(...)` (context yang sama) → seluruh admin shell re-theme **seketika tanpa reload/rebuild**; customer mengambil branding baru pada load berikutnya via BrandingSync existing. Tanpa polling, tanpa fetch per-component.

## 27. Hard Refresh

`AdminBrandingProvider` fetch branding dari DB saat mount → `/admin/dashboard`, `/admin/orders`, `/admin/menu`, `/admin/reports`, `/admin/settings` pada hard refresh selalu menampilkan logo, site name, primary, secondary, accent yang benar (fallback theme hanya saat endpoint gagal, non-blocking).

---

## 28. Payment Test Matrix

| # | Skenario | Hasil |
|---|---|---|
| 1 | UNPAID → CASH → PAID | ✅ jalur existing, guarded UNPAID→PAID |
| 2 | UNPAID → QRIS PENDING → Kembali → CASH → PAID | ✅ **409 hilang** — PENDING di-CANCELLED guarded, row KASIR UNPAID dibuat, mark-paid sukses |
| 3 | UNPAID → QRIS PENDING → Kembali → QRIS | ✅ `createKasirQrisPayment` mengembalikan PENDING yang masih valid (QR sama) |
| 4 | QRIS FAILED → CASH → PAID | ✅ FAILED termasuk set supersede |
| 5 | QRIS EXPIRED → CASH → PAID | ✅ EXPIRED termasuk set supersede |
| 6 | CASH UNPAID → Kembali → QRIS | ✅ CASH di-CANCELLED guarded → QRIS baru |
| 7 | CASH PAID → QRIS | ✅ diblokir server (Order already paid) + pre-check frontend |
| 8 | Double click CASH | ✅ isSubmitting + guarded update; race kalah → "sudah dibayar" |
| 9 | Double click QRIS | ✅ qrisBusyRef + serialisasi FOR UPDATE |
| 10 | QRIS polling vs CASH | ✅ polling hanya saat qris-ready; CASH hanya via mark-paid guarded |
| 11 | Webhook QRIS lama setelah CASH PAID | ✅ row CANCELLED → IGNORED_CANCELLED; order tidak tersentuh |
| 12 | Webhook lama vs order baru | ✅ order mirror guarded `paymentStatus = current.status` |
| 13 | Foreign branch payment | ✅ `authorizedBranches` unchanged → 404/403 |
| 14 | Already PAID → CASH/QRIS | ✅ PAID terminal di semua jalur |
| 15 | Semua order type × CASH/QRIS | ✅ tidak ada pembatasan order type baru; kasir QRIS tetap semua tipe; kasir_existing salah tidak kembali |

## 29. Branding Test Matrix

- **Customer (regression, kode tidak berubah):** `/`, `/pilih-cabang`, `/menu`, `/cart`, `/checkout`, `/payment/*`, `/order/*`, `/t/*` — BrandingSync existing tetap: fetch ≤1×/restaurant/load, hard refresh aman, navigation/login/branch-selection tidak mengubah perilaku.
- **Admin:** `/admin/dashboard`, `/admin/orders`, `/admin/orders/new`, `/admin/payments`, `/admin/shifts`, `/admin/tables`, `/admin/stock`, `/admin/menu`, `/admin/reports`, `/admin/customers`, `/admin/marketing`, `/admin/users`, `/admin/settings`, `/admin/settings/branches`, `/admin/whatsapp`, `/admin/recommendations` — semua ter-cover oleh satu provider di layout (logo, site name, primary/secondary/accent, active nav, primary action, selected tab/filter/pagination-level states di halaman yang memakai blue sebelumnya).
- **Semantic check:** PAID green, FAILED red, PENDING amber, SOLD OUT merah, CANCELLED existing, INFO blue — dipertahankan (lihat §18/§19).
- **Dynamic:** save di settings → seluruh shell re-theme instan tanpa reload.
- **Hard refresh:** branding tetap benar (fetch dari DB saat mount).

## 30. Files Changed

| File | Perubahan |
|---|---|
| `src/services/payment/payment.service.ts` | Fix 409: guarded supersede PENDING/FAILED/EXPIRED → CANCELLED saat KASIR dipilih; PAID dicek lebih dulu; webhook: guarded flips + race protection + audit IGNORED_* |
| `src/components/admin/barcode-payment-flow.tsx` | refreshOrder() snapshot fresh sebelum keputusan; pre-check PAID (CASH & QRIS); reset penuh state antar metode; brand tokens untuk opsi QRIS |
| `src/hooks/use-admin-branding.tsx` **(baru)** | AdminBrandingProvider — membungkus BrandingProvider existing, feed dari /api/admin/settings/branding (session-scoped) |
| `src/app/admin/layout.tsx` | Pasang AdminBrandingProvider; logo+site name dinamis (desktop/mobile); active nav → brand tokens |
| `src/app/admin/settings/page.tsx` | applyBranding() setelah save (dynamic update seluruh shell) |
| `src/app/admin/orders/new/page.tsx` | Blue UI-identity → brand tokens (chip, tombol, ring, submit) |
| `src/components/admin/orders/order-card.tsx` | Tombol "Scan Barcode" + badge cabang → brand tokens |
| `src/components/admin/orders/order-detail.tsx` | Dot timeline status saat ini → brand tokens |
| `src/app/admin/tables/page.tsx` | Teks nama cabang → brand token |

Tidak diubah: prisma schema, migrasi, customer app, public payment APIs, iPaymu provider, realtime bus, shift/stock logic.

## 31. TSC

`npx tsc --noEmit` → **0 error** (dijalankan ulang setelah semua edit).

## 32. Build

`npm run build` → **sukses** (Compiled successfully, 69/69 static pages, exit 0).

## 33. ESLint (changed files)

0 error / 0 warning baru pada seluruh file yang diubah. Error yang tersisa pada repo (`settings/page.tsx` ref-during-render & setState-in-effect, `tables/page.tsx` setState-in-effect) **pre-existing** — dibuktikan dengan `git stash` + lint ulang pada file yang tidak disentuh; tidak diperbaiki karena berada di luar scope (no unrelated refactor).

## 34. Runtime Test

Tidak dijalankan server (lingkungan agent; DB produksi tidak boleh disentuh, port 3000 dilarang). Verifikasi dilakukan lewat: build produksi sukses + trace manual seluruh state transition pada kode (matriks §28). Untuk smoke test produksi-like: `next start -p 3001` dan jalankan skenario #2, #6, #11 pada §28.

## 35. Remaining Risks

1. `switchToCashier` (jalur customer "Bayar ke Kasir") tetap membatasi PENDING aktif — by design (customer tidak "kembali"; kasir punya jalurnya sendiri). Jika product ingin customer bisa batal QR aktif sendiri, perlu kebijakan baru — bukan bagian task ini.
2. Webhook `IGNORED_*` menambah baris `PaymentTransaction` audit — volume tumbuh sesuai jumlah webhook telat (kecil, indexed).
3. Gateway expiry bawaan provider tidak diubah — QR yang sudah di-CANCELLED di sisi kita tetap bisa saja dibayar di sisi gateway; webhook-nya akan diabaikan aman (uang masuk tidak tercatat otomatis — sama seperti perilaku EXPIRED existing; rekonsiliasi manual tetap diperlukan).
4. ESLint pre-existing (settings/tables pages) masih ada — direkomendasikan task terpisah.

## 36. Final Verdict

- **Issue #1 FIXED** — QRIS → Kembali → CASH → input uang → Bayar → PAID bekerja tanpa 409, dengan history terjaga, webhook lama tidak bisa menang, idempotency dipertahankan.
- **Issue #2 FIXED** — Satu konfigurasi `RestaurantSettings` kini berlaku untuk CUSTOMER + ADMIN DASHBOARD + ADMIN + KASIR melalui **satu** `BrandingProvider` dan **satu** source of truth `resolveBranding`; tanpa sistem tema kedua; semantic colors utuh; tenant isolation utuh.
- Tidak ada data/payment history yang dihapus, tidak ada reset, tidak ada commit/push, port 3000 tidak disentuh.

---

### FINAL OUTPUT

```
PAYMENT ROOT CAUSE: createPayment() memblokir intent baru saat ada payment PENDING pada order yang sama
                    → QRIS PENDING lama membuat CASH ditolak 409 "Payment already exists for this order".
PAYMENT FIX:        Dalam transaksi KASIR (row lock FOR UPDATE existing), intent online yang tidak lagi dipilih
                    (PENDING/FAILED/EXPIRED) di-CANCELLED secara guarded dan tetap tersimpan sebagai history;
                    PAID dicek lebih dulu dan tetap terminal; frontend mengambil snapshot fresh sebelum keputusan.
PAYMENT STATE TRANSITION: QRIS PENDING → CANCELLED (history) → KASIR UNPAID → PAID; Order UNPAID→PAID;
                    reverse CASH UNPAID → CANCELLED → QRIS; PAID terminal untuk semua jalur.
WEBHOOK PROTECTION: Transaksi webhook mengecek status row saat-in-transaksi; CANCELLED → diabaikan
                    (audit IGNORED_CANCELLED); semua flip = guarded updateMany; order mirror hanya bila
                    order.paymentStatus masih current.status — webhook lama tidak pernah memenangkan payment baru.
BRANDING ROOT CAUSE: BrandingProvider hanya dipasang di customer layout; admin layout hardcoded
                    "🍽️ Restoran Bahagia" dan tidak pernah memuat RestaurantSettings.
BRANDING FIX:       AdminBrandingProvider (membungkus BrandingProvider existing) di src/app/admin/layout.tsx,
                    feed dari GET /api/admin/settings/branding (session-scoped); logo/site name dinamis;
                    warna UI-identity blue/gray → brand tokens; settings save → applyBranding instan.
BRANDING SOURCE OF TRUTH: RestaurantSettings → resolveBranding() → BrandingProvider → CSS variables → tokens.
CUSTOMER:  Tidak berubah satu baris pun — BrandingSync existing tetap (regression-safe).
ADMIN:     Satu provider di layout; semua /admin/* ter-cover; tidak ada page yang fetch sendiri.
DASHBOARD: Sidebar/active nav/mobile bar mengikuti branding; status tetap semantic.
KASIR:     Orders/Manual Order/Payment/QRIS/Tables/Stock/Shift ter-cover; semantic CASH/QRIS/PAID/PENDING utuh.
LOGO:      branding.logoUrl → sidebar & mobile bar, fallback 🍽️ (sama seperti customer).
SITE NAME: branding.siteName → restaurant.name → "Restoran" (fallback existing dipertahankan).
PRIMARY:   bg/text/border-brand-primary untuk active nav, primary action, selected tab/filter/chip, timeline dot.
SECONDARY: bg-brand-secondary untuk background item terpilih/active sidebar/badge.
ACCENT:    border/ring-brand-accent untuk badge border & ring; hover via brand opasitas.
SEMANTIC COLORS: PAID green, FAILED red, PENDING amber, SOLD OUT merah, CANCELLED existing, INFO blue — tidak diubah.
SECURITY:  restaurantId dari session (requireRoles); tanpa branch-level branding; payment scoping branch tidak berubah.
PERFORMANCE: 1 fetch branding per load shell; tanpa polling/fetch per-component; tidak ada query berat baru.
FILES CHANGED: 9 file (8 modified + 1 baru) — daftar di §30.
TEST RESULT: Semua skenario matriks §28/§29 lolos berdasarkan trace kode; build produksi sukses.
TSC:      PASS (0 error).
BUILD:    PASS (exit 0).
LINT:     0 error baru pada changed files (error tersisa pre-existing, dibuktikan via git stash).
RUNTIME:  Tidak dijalankan (larangan port 3000 / DB produksi); siap smoke test via `next start -p 3001`.
REPORT:   AUDIT-FIX-KASIR-PAYMENT-GLOBAL-BRANDING.md (file ini).
REMAINING RISKS: §35 (switchToCashier kebijakan customer, audit webhook rows, rekonsiliasi gateway, lint lama).
FINAL VERDICT: Kedua issue FIXED dengan reuse architecture penuh — satu payment engine, satu branding system,
               history terjaga, semantic colors utuh, tenant isolation utuh.
```
