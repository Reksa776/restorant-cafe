# PHASE R6 — AUDIT LOG VIEWER · RESERVATION QR · MINIMUM PURCHASE GATE

Tanggal: 2026-10-06 · Branch: `main` · HEAD: `aad78dd` (belum ada commit/push baru)

Implementasi mengikuti audit `AUDIT-AUDITLOG-RESERVATION-QR-MINIMAL-PURCHASE.md` dan
keputusan bisnis yang di-lock. **Tidak ada engine baru** — semua memakai engine,
auth, komponen QR/scanner, dan Order/Payment engine yang sudah ada.

---

## 1. IMPLEMENTED FEATURES

1. **Audit Log Viewer** — API `GET /api/admin/audit-logs` (ADMIN only, restaurant +
   branch scoped, server-side pagination/filter) + halaman `/admin/audit-logs`
   (filter action/entity/entityId/actor/branch/date-range/search, tabel, detail
   dialog, loading/empty/error state) + item navigasi "Audit Logs" (ADMIN).
2. **Customer Reservation QR** — section "QR Reservasi" di halaman sukses wizard
   `/reservasi` dan di detail `/account/reservasi/[code]`. Payload QR **hanya kode
   reservasi** (`R-XXXXXXXX`).
3. **Admin/Cashier Reservation QR Scanner + Manual Lookup** — tombol "Scan QR
   Reservasi" (kamera browser) + input "Masukkan Kode Reservasi" + tombol "Cari
   Reservasi" di `/admin/reservations`, memakai ulang endpoint look-up yang sudah
   ada; hasil ditampilkan di dialog detail reservasi. **Read-only**.
4. **Minimum Purchase Gate** — reservasi publik hanya boleh dibuat bila
   customer/guest memiliki ≥1 purchase di restoran yang sama:
   `paymentStatus = PAID`, `status != CANCELLED`, `>= 1 OrderItem`. Cabang boleh
   berbeda. Staff/admin booking tidak digate.

---

## 2. EXISTING FUNCTIONALITY REUSED

| Area | Yang dipakai ulang |
|---|---|
| Audit engine | `AuditLog` model + `auditService.log()` (satu-satunya writer) — tidak ada tabel/engine baru |
| Audit list | `auditService.list()` yang sudah ada (ditambah filter/pagination/redaksi) |
| QR render | `qrcode` + `QrCodeDisplay` (`src/components/qr-code-display.tsx`) |
| QR scan | `html5-qrcode` — lifecycle kamera diekstrak ke `QrScannerDialog`; `OrderScanner` tetap API-nya |
| Reservation lookup | `GET /api/admin/reservations/code/[code]` (ADMIN/CASHIER, scoped, read-only) yang sudah ada |
| Auth/RBAC | `requireAdmin`, `requireRoles`, `authenticated` branch scope (`authorizedBranches`, `branchHintFrom`) |
| Ownership guest | Mekanisme existing: guest order membuat `Customer` berdasarkan `normalizePhone`; reservation memakai `guestPhone` ternormalisasi yang sama |
| Order/Payment | Query baca `Order` + `OrderItem` (tanpa engine baru); `paymentStatus PAID` hasil engine payment existing |

---

## 3. FILES CHANGED

**Ditambah (8):**
- `src/services/audit/audit.types.ts` — schema query (pagination + filter)
- `src/services/audit.service.ts` — client wrapper (`auditLogService.list`)
- `src/app/api/admin/audit-logs/route.ts` — API ADMIN
- `src/app/admin/audit-logs/page.tsx` — halaman viewer
- `src/components/admin/qr-scanner.tsx` — `QrScannerDialog` generik (diekstrak)
- `src/components/admin/reservation-scanner.tsx` — wrapper scanner reservasi
- `src/services/reservation/reservation.purchase.fixtures.ts` — fixture test only
- `src/services/reservation/reservation.purchase.test.ts` — test gate (15 test)

**Dimodifikasi (14):**
`src/services/audit/audit.service.ts`, `src/services/reservation/reservation.service.ts`,
`src/services/reservation.service.ts`, `src/app/admin/layout.tsx`,
`src/app/admin/reservations/page.tsx`, `src/components/admin/order-scanner.tsx`,
`src/app/(customer)/reservasi/page.tsx`, `src/app/(customer)/reservasi/reservation-flow.ts`,
`src/app/(customer)/account/reservasi/[code]/page.tsx`, serta 5 test
(`reservation-flow.test.ts`, `reservation.service.test.ts`, `reservation.customer.test.ts`,
`reservation.customer-api.test.ts`, `reservation.api.test.ts`).

---

## 4. DATABASE IMPACT — **NO MIGRATION**

Schema existing sudah cukup (`AuditLog`, `Reservation.guestPhone/customerId`,
`Order.customerId/paymentStatus/status`, `OrderItem`). Tidak ada perubahan
schema, tidak ada migration, tidak ada reset, tidak ada kolom baru.

---

## 5. API CHANGES

| Method | Path | Akses | Catatan |
|---|---|---|---|
| GET | `/api/admin/audit-logs` | ADMIN | **Baru.** Pagination + filter (`page`,`limit`≤100,`action`,`entityType`,`entityId`,`userId`,`branchId`,`dateFrom`,`dateTo`,`search`). Response `{items,total,page,limit,totalPages}`; `details` sudah diredaksi. |
| GET | `/api/admin/reservations/code/[code]` | ADMIN/CASHIER | **Tidak berubah** — dipakai ulang untuk scan & manual lookup. |
| POST | `/api/public/reservations` | publik | **Perilaku baru:** bisa mengembalikan `409 PURCHASE_REQUIRED` (message "Reservasi hanya tersedia setelah Anda menyelesaikan minimal 1 pembelian."). `409 TABLE_NOT_AVAILABLE` dipertahankan. |
| GET | `/api/admin/reservations/availability` & publik | — | **Tidak diubah** (R5.1 tetap). |

Format error mengikuti envelope existing (`errorResponse(message, code, status)`).

---

## 6. SECURITY CHANGES

- Audit viewer **ADMIN only**; tenant selalu dari session; branch scope via
  `authorizedBranches` (bukan dari klien).
- **Redaksi defensif** `details` saat dibaca: key mirip `password|token|secret|apiKey|credential|authorization|cookie|session` → `[REDACTED]` (rekursif). Tidak menyentuh baris tersimpan.
- QR hanya berisi kode reservasi (tanpa nama/HP/email/id/secret).
- Scanner **read-only** (tidak mengubah reservation/order/payment/table). 404 generik
  lintas tenant/cabang.
- Minimum-purchase gate di dalam transaksi existing (branch `FOR UPDATE` → table
  `FOR UPDATE` → gate purchase → `canAccommodate` → insert). Klien tidak bisa
  memalsukan `customerId/orderId/restaurantId/paymentStatus`.
- Batas concurrency & tenant/table validation existing dipertahankan.

---

## 7. GUEST RESERVATION PURCHASE OWNERSHIP & GAP

- **Logged-in:** identitas = `customerId` dari **session cookie terverifikasi**
  (HMAC), bukan klien.
- **Guest:** identitas = `Customer` yang dicocokkan lewat `guestPhone` **ternormalisasi** —
  mekanisme yang **sama** dengan saat guest order membuat customer dan saat guest
  self-lookup membuktikan kepemilikan. Guest A tidak bisa memakai purchase Guest B
  (dibuktikan test #11). Guest TIDAK wajib login.
- **GAP yang dilaporkan (tidak di-workaround diam-diam):** nomor telepon guest
  **tidak diverifikasi OTP**, sehingga guest yang mengetahui nomor pelanggan lain
  secara teori bisa memakai order pelanggan tersebut. Ini adalah sinyal kepemilikan
  terkuat yang tersedia di flow guest existing; menambah OTP = autentikasi baru
  (dilarang oleh requirement), jadi implementasi memakai mekanisme existing dan
  gap ini dicatat sebagai risiko (lihat §13).

---

## 8. TEST RESULTS

Dijalankan dengan `npx tsx --test --test-force-exit` (semua **PASS, 0 gagal**):

| Suite | Jumlah |
|---|---|
| `src/services/audit/audit.service.test.ts` (baru) | 8 |
| `src/services/reservation/reservation.purchase.test.ts` (baru) | 15 |
| `src/app/(customer)/reservasi/reservation-flow.test.ts` | 18 |
| `src/services/reservation/reservation.service.test.ts` | 47 |
| `src/services/reservation/reservation.customer.test.ts` | 17 |
| `src/services/reservation/reservation.customer-api.test.ts` | 12 |
| `src/services/reservation/reservation.api.test.ts` | 31 |

Cakupan gate (test #1–#14): guest tanpa purchase → 409; guest dengan PAID → sukses;
logged-in tanpa purchase → 409; logged-in dengan PAID → sukses; CANCELLED → 409;
UNPAID → 409; full-refund (UNPAID) → 409; tanpa OrderItem → 409; beda cabang → sukses;
beda restoran → 409; Guest A ≠ purchase Guest B → 409; spoof klien → 409; staff booking
tidak digate; R5.1 (Table.status tidak mempengaruhi availability) tetap.

**Test yang berubah & alasannya (bukan agar lolos, tapi karena rule berubah):**
- `reservation.service.test.ts`: 3 create publik yang sukses (test 1, 18b, guest lookup)
  kini menyemai 1 purchase yang memenuhi syarat — **assertion tidak diubah**.
- `reservation.customer.test.ts` & `reservation.customer-api.test.ts`: helper booking
  menyemai purchase untuk identitas yang bertindak — assertion tetap.
- `reservation.api.test.ts`: P1/P2/P8/P9/P15/A16 menyemai purchase agar relevan
  mencapai gate yang diuji (konflik meja / sukses / race). P3/P4/P5/P6 tidak berubah
  karena gagal sebelum gate. Teardown ditambah pembersihan order/product/category.
- `reservation-flow.test.ts`: tambahan test untuk payload QR + copy gate.

---

## 9. TSC RESULT

`npx tsc --noEmit` → **exit 0** (dijalankan ulang setelah semua edit).
`npx eslint` pada semua file berubah/baru → **0 error** (1 warning "file ignored" untuk
dokumen markdown, bukan kode).

---

## 10. BUILD RESULT

`npm run build` → **exit 0**. Route baru terdaftar: `○ /admin/audit-logs`,
`ƒ /api/admin/audit-logs`; `/reservasi` & `/account/reservasi/[code]` tetap.
`git diff --check` → **0**.

---

## 11. BROWSER RESULT (dev 3100, Chrome)

**Customer (guest, tanpa login):** 8/8
- Halaman `/reservasi` terbuka tanpa login; pilih cabang → tanggal → jumlah → jam → meja.
- **Gate purchase tampil**: submit tanpa purchase → notice "Minimal 1 Pembelian Diperlukan" + CTA "Pesan Menu Dulu".
- Setelah nomor diganti ke nomor yang punya purchase PAID → reservasi **sukses**.
- Halaman sukses menampilkan "QR Reservasi", gambar QR (`data:image`), dan kode (`R-…`);
  `alt` QR = kode reservasi (payload = kode saja).

**Admin (login `admin@restobahagia.com`):** 
- Nav "Audit Logs" tampil; halaman menampilkan filter + riwayat; `GET /api/admin/audit-logs` → 200 (44 baris).
- `/admin/reservations` menampilkan "Scan QR Reservasi" + "Cari Reservasi".
- Manual lookup kode → **dialog "Detail Reservasi"** terbuka dengan kode yang benar.
- Scanner dibuka → kamera hidup ("QR belum terdeteksi…") = lifecycle kamera berjalan.
- Lookup **read-only**: status reservasi tetap `PENDING` sebelum & sesudah.

**Cashier (login `kasir@restobahagia.com`):**
- `GET /api/admin/audit-logs` → **403**; nav "Audit Logs" **tidak tampil**; membuka
  `/admin/audit-logs` menampilkan error "Access denied for your role" (tanpa baris audit).

**Total: 17/17 + 4/4 pemeriksaan cashier PASS.** Data uji dibersihkan
(`deleted reservations = 1`, `leftover QA restaurants: 0`, 0 order/product/category/customer sisa).

---

## 12. REGRESSION CHECK

- **R5.1 LOCKED**: availability tetap biner berbasis reservation saja; `Table.status`
  (OCCUPIED/MAINTENANCE) tidak dipakai; tidak ada partial-overlap/capacity-sharing.
  Tidak ada perubahan pada `availability`/`status` DTO.
- Order engine, Table lifecycle, Cashier, Payment, QRIS, WhatsApp, TableLayout,
  barcode scanner, customer ordering flow — **tidak diubah**.
- `OrderScanner` tetap kompatibel (4 pemanggil existing tidak berubah API).
- Reservation tetap boleh guest; tidak ada login wajib; purchase boleh beda cabang.

---

## 13. REMAINING GAP / RISK

1. **Guest phone belum terverifikasi (OTP)** → teoretis, guest yang tahu nomor lain bisa
   memakai order pelanggan itu untuk memenuhi gate. Direkomendasikan OTP/verifikasi
   nomor di masa depan (butuh keputusan produk; autentikasi baru tidak dibuat sekarang).
2. **Threshold "minimal 1 pembelian" lemah secara nominal** — pembelian PAID senilai
   kecil (mis. 1 item) sudah memenuhi syarat; bila diinginkan minimal nominal/jumlah,
   itu perubahan business rule terpisah.
3. **Urutan gate**: purchase dicek **sebelum** gate meja, sehingga pengguna tanpa
   purchase tidak bisa membedakan kondisi meja (bocor informasi minimal). Dapat
   dibalik tanpa risiko bila diinginkan.
4. **Admin/staff booking tidak digated** — keputusan sengaja (walk-in/front-desk tetap
   bekerja). Bila ingin semua booking digate, perlu aturan baru.
5. **Audit redaksi** berbasis nama key; key sensitif dengan nama tak terduga bisa lolos.
   Saat ini tidak ada writer yang menulis secret ke `details`.

Status: **no migration, no commit, no push.** Perubahan tertinggal di working tree untuk review.
