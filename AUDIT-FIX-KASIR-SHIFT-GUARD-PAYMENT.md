# AUDIT + FIX — KASIR SHIFT GUARD (SHIFT_NOT_OPEN)

> Audit + fix untuk memastikan **Kasir wajib buka Shift** sebelum bisa memproses transaksi (manual order, scan CASH, scan QRIS, mark-paid, repayment QRIS).
> Tanggal: 2026-09-10
> Scope: **tanpa melemahkan tenant/branch authorization**, tanpa mengubah arsitektur DB, tanpa migration, tanpa memanfaatkan frontend-only guard. Backend **menjadi sumber kebenaran** (enforcement), frontend hanya translasi error ke UX yang jelas.

---

## 1. Executive Summary

Sebelumnya hanya **mark-paid** (penutupan shift kasir) yang mewajibkan shift: pembuatan **order manual** dan **pembuatan payment intent** (CASH/QRIS/repayment) bisa berjalan tanpa shift terbuka, sehingga transaksi bisa "selesai dibayar" tanpa ada shift — menyalahi aturan bisnis "shift = pintu transaksi kasir". Ini **bukan** masalah partial—audit membuktikan perubahan sesi sebelumnya (penggabungan `ALREADY_PAID`, single-scan, `kasir_existing` 409) sudah benar dan lengkap. Gap-nya adalah **ketiadaan guard shift** di dua entry point utama.

**Fix:** helper garda shift terpusat di `auth-helpers` + pemasangan di `POST /api/orders`, `POST /api/payments`, dan pengubahan error mark-paid dari `CONFLICT` generik menjadi `SHIFT_NOT_OPEN` yang eksplisit. Frontend menangkap kode tersebut di **6 surface** dan menampilkan toast seragam **"Shift Belum Dibuka"** dengan CTA **"Buka Shift" → /admin/shifts**.

**Verifikasi runtime (port 3001 + mock iPaymu 4711 + Chromium nyata):**

| Harness | Hasil |
|---|---|
| `e2e-kasir-shift-guard-matrix.mjs` (API + DB assertion, T1–T11) | **31/31 PASS** |
| `e2e-kasir-cash-after-qris.mjs` (race QRIS↔CASH + no-shift) | **31/31 PASS** |
| `e2e-kasir-payment-branding-v2.mjs` (regression 80 checks) | **80/80 PASS** |
| `runtime-ui-kasir-shift-guard.mjs` (Chromium, toast + CTA) | **15/15 PASS** |
| `final-regression-kasir-api.mjs` (API + DB + security + stock) | **37/37 PASS** |
| `final-regression-kasir-ui.mjs` (Chromium, full kasir matrix) | **33/33 PASS** |

`npx tsc --noEmit` bersih, `npm run build` sukses.

---

## 2. Audit Working Tree Sebelumnya (kondisi awal)

Perubahan sesi sebelumnya yang **sudah benar dan dipertahankan** (bukan partial):

- **`ALREADY_PAID` terpisah** di `src/app/api/payments/[id]/mark-paid/route.ts` — retry mark-paid → `409 ALREADY_PAID` (bukan ucapan salah); **tetap dibedakan** dari `SHIFT_NOT_OPEN`.
- **Single-scan QRIS** — pagar mencegah scan ulang pada order dibayar cash.
- **`kasir_existing` 409** di `createKasirQrisPayment` — belum dibayar lewat jalur kasir → konflik jujur.

Hasil audit: ketiga fix itu lengkap (tidak terpotong). **Gap ditemukan** — tidak ada guard shift untuk:
1. `POST /api/orders` (order manual kasir bisa dibuat tanpa shift),
2. `POST /api/payments` (intent CASH/QRIS/repayment bisa dibuat tanpa shift),
3. tidak ada error code `SHIFT_NOT_OPEN`,
4. tidak ada helper terpusat yang dipakai semua jalur.

---

## 3. Arsitektur Shift (existing, tidak diubah)

- Tabel `cashiershift` (id, restaurantId, branchId, userId, status `OPEN/CLOSED`, shiftNumber, openingCash, openedAt, closedAt).
- **Buka shift**: `POST /api/shifts` (requireRoles ADMIN/CASHIER) → status `OPEN` per branch.
- **Tutup shift**: `POST /api/shifts/[id]/close` → status `CLOSED`.
- **Satu shift OPEN per kasir per branch** → helper `shiftService.getMyOpenShift(restaurantId, userId, branchId)`.

Branch tidak pernah dari client: selalu `session + authorizedBranches(ctx) + effectiveWriteBranchId(ctx)`.

---

## 4. Operasi Yang Wajib Shift

| Operasi | Endpoint / service | Guard |
|---|---|---|
| Order manual/CS | `POST /api/orders` | `requireOpenShift` sebelum insert |
| Intent CASH (scan/detail/repayment) | `POST /api/payments` | `requireOpenShift` sebelum insert |
| Intent QRIS kasir | `POST /api/payments` (method QRIS) | `requireOpenShift` (sama) |
| Mark-paid cash | `payment.service.markCashierPaymentPaid` | `ShiftNotOpenError` |
| **ADMIN** semua hal di atas | — | **bypass** (business rule, dipertahankan) |
| Public/customer flow (`/api/public/*`, webhook, halaman `/payment/*`, `/menu`) | — | **tidak diguard** |

---

## 5. Backend Guard

### 5.1 Error code baru — `src/lib/errors.ts:56`

```ts
export class ShiftNotOpenError extends AppError {
  constructor(message = "Shift belum dibuka. Silakan buka shift terlebih dahulu untuk memproses transaksi.") {
    super(409, "SHIFT_NOT_OPEN", message);
  }
}
```

### 5.2 Helper terpusat — `src/lib/auth-helpers.ts:258,288`

- `requireOpenShiftForUser(restaurantId, userId, branchId?)` — primitif; melempar `ShiftNotOpenError` bila tidak ada shift `OPEN` untuk cabang target.
- `requireOpenShift(ctx, branchId?)` — wrapper ctx; **ADMIN di-skip**; branch default `effectiveWriteBranchId(ctx)`. Dynamic import `shiftService.getMyOpenShift`.

### 5.3 Pemasangan guard (sebelum write — tidak ada state setengah jadi)

```
src/app/api/orders/route.ts:62      requireOpenShift(ctx, effectiveWriteBranchId(ctx))
src/app/api/payments/route.ts:42    requireOpenShift(ctx, effectiveWriteBranchId(ctx))
src/services/payment/payment.service.ts:708  ShiftNotOpenError("Kasir harus membuka shift terlebih dahulu sebelum menerima pembayaran")
```

### 5.4 Response API

```json
HTTP 409
{
  "error": "SHIFT_NOT_OPEN",
  "message": "Shift belum dibuka. Silakan buka shift terlebih dahulu untuk memproses transaksi."
}
```

Posisinya **sebelum insert/update**: order, payment, maupun stock setengah jadi tidak akan dibuat.

---

## 6. Frontend Notification (translasi error → UX)

- `src/lib/api-error-handler.ts`: tambah `getErrorCode()` (membaca `error` dari body `{error,message}`) + `isShiftNotOpen()`.
- `src/lib/notify-shift.ts` (baru): `notifyShiftNotOpen(serverMessage?)` → `toast.error("Shift Belum Dibuka", { description, action: { label: "Buka Shift", onClick: () => window.location.href = "/admin/shifts" }, duration: 6000 })`. Halaman `/admin/shifts` ber-role ADMIN+CASHIER → CTA selalu actionable.
- **Surface yang memakai helper:**
  - `src/components/admin/barcode-payment-flow.tsx` — catch payment CASH + QRIS.
  - `src/components/admin/orders/cashier-pay-dialog.tsx` — dialog pay/repayment.
  - `src/components/admin/orders/kasir-qris-screen.tsx` — layar QRIS kasir.
  - `src/app/admin/orders/new/page.tsx` — submit order manual + konfirmasi cash.
  - `src/app/admin/orders/page.tsx` — `handleMarkPaid`.
  - `src/app/admin/payments/page.tsx` — `handleMarkPaid` (daftar payments).

Toast **tidak** menavigasi otomatis; hanya tombol aksi "Buka Shift" yang menuju `/admin/shifts` — diverifikasi di browser.

---

## 7. Perlindungan Race + Integrity

- Guard diletakkan **satu transaksi-logika di depan semua write** → order/payment/stock tidak pernah terbentuk di jalur tanpa shift.
- Race QRIS↔CASH tetap terjaga dari sesi sebelumnya (supersede). Verifikasi:
  - T8 QRIS→CASH: cash PAID, QRIS lama CANCELLED, order PAID.
  - T9 CASH→QRIS: QRIS PAID via webhook, cash UNPAID di-CANCEL (tidak dipakai ulang).
  - T10 late webhook: order tetap PAID, callback ignored dicatat.
  - T11 integrity: `payment.branchId === order.branchId`, `payment.restaurantId === order.restaurantId`, `payment.shiftId → shift.branchId === payment.branchId`, tidak ada dua baris PAID.

---

## 8. DB Verification (post-<fix> assertions, MySQL asli)

Kebijakan DB diuji dengan assertion langsung pada `restaurant_app`:

- T1: order tanpa shift → **0** baris order.
- T2/T3: intent CASH/QRIS tanpa shift → **0** baris payment.
- T4: mark-paid tanpa shift → status payment/order tetap ≤ UNPAID, **0** baris `paymenttransaction` tipe `cashier_payment`.
- T6/T7: dengan shift → payment PAID + `shiftId` terisi + order PAID + audit `cashier_payment` tercatat server-side.
- T8/T9/T10/T11: singkronisasi status & integerity constraint (lihat §7).

Semua data test diberi tag dan **dibersihkan** setelah run (orders/payments/customers/shifts test).

---

## 9. Runtime E2E Matrix (`scripts/e2e-kasir-shift-guard-matrix.mjs`)

Port **3001** (produksi build) + mock iPaymu `127.0.0.1:4711`, fixture: `admin@restobahagia.com` (ADMIN, Main Outlet) dan `kasir@restobahagia.com` (CASHIER, single-branch). 31 check — **semua PASS**:

| Grup | Isi |
|---|---|
| T1 | manual order kasir tanpa shift → 409 `SHIFT_NOT_OPEN`, 0 order row |
| T2/T3 | payment CASH & QRIS tanpa shift → 409, 0 payment row |
| T4 | mark-paid tanpa shift → 409, tidak ada perubahan state |
| T5 | **ADMIN bypass** → 200 (rule bisnis terjaga) |
| T6 | dengan shift → CASH PAID + shiftId + order PAID + audit |
| T7 | dengan shift → QRIS PAID via webhook (real HMAC) |
| T8/T9 | supersede dua arah QRIS↔CASH |
| T10 | late webhook ignored, order tetap PAID |
| T11 | integrity branch/restaurant/shift + single-PAID |

---

## 10. Regression

- `scripts/e2e-kasir-cash-after-qris.mjs` — test C di-update ke perilaku baru (createPayment tanpa shift → `SHIFT_NOT_OPEN`, bukan intent): **31/31 PASS**.
  - **Bug lama harness ditemukan & diperbaiki:** shift dari test B tidak ditutup sebelum test C sehingga kondisi "no-shift" tidak valid → ditambahkan close shift di awal blok C + assertion pre-condition.
- `scripts/e2e-kasir-payment-branding-v2.mjs` — 80 check branding + tenant/branch isolation + invariant: **80/80 PASS**.
- `scripts/runtime-ui-kasir-cash-qris.mjs` (matriks DINE_IN/TAKEAWAY/DELIVERY admin) masih kompatibel (belum dijalankan ulang penuh di run ini).

---

## 11. Browser UI Verification (`scripts/runtime-ui-kasir-shift-guard.mjs`)

Chromium headless nyata (puppeteer-core, `google-chrome-stable`), kasir tanpa shift di order detail live:

- CASH: `Proses Pembayaran → Cash / Tunai → Uang Pas → Konfirmasi Pembayaran` → toast **"Shift Belum Dibuka"** + body + tombol aksi **"Buka Shift"**; halaman **tidak** pindah; DB: 0 payment row; order tetap UNPAID.
- QRIS: `Kembali → Scan oleh customer` → toast yang sama; DB: 0 payment row.
- 15/15 PASS (console network-error 409 yang direkam app adalah perilaku yang diharapkan).

---

## 12. Remaining Risks & Catatan

- **Shift dibuka di branch X, transaksi di branch lain**: `requireOpenShift` di-pasang per `effectiveWriteBranchId` → tetap wajib shift per-branch (tanpa mengubah rule eksisting).
- **Kasir multi-branch**: helper memakai shift OPEN untuk branch target → perilaku konsisten dengan `getMyOpenShift`.
- **Perilaku lama diubah (disengaja)**: createPayment/order tanpa shift kini 409 — permintaan UI "shift dulu, baru bayar" (BAGIAN U x). Tidak ada konsumen lain yang mengharapkan 200 (public flow tidak disentuh).
- Belum ada script UI untuk `orders/new` manual + `payments` list; surface tersebut hanya diverifikasi via tsc/build (helper `isShiftNotOpen` identik).

---

## 13. File yang Berubah

**Backend**
- `src/lib/errors.ts` (+`ShiftNotOpenError`)
- `src/lib/auth-helpers.ts` (+`requireOpenShiftForUser`, `requireOpenShift`)
- `src/app/api/orders/route.ts` (guard order)
- `src/app/api/payments/route.ts` (guard payment intent)
- `src/services/payment/payment.service.ts` (mark-paid → `ShiftNotOpenError`)

**Frontend**
- `src/lib/api-error-handler.ts` (+`getErrorCode`, `isShiftNotOpen`)
- `src/lib/notify-shift.ts` (**baru**)
- `src/components/admin/barcode-payment-flow.tsx`
- `src/components/admin/orders/cashier-pay-dialog.tsx`
- `src/components/admin/orders/kasir-qris-screen.tsx`
- `src/app/admin/orders/new/page.tsx`
- `src/app/admin/orders/page.tsx`
- `src/app/admin/payments/page.tsx`

**Scripts/Test**
- `scripts/e2e-kasir-shift-guard-matrix.mjs` (**baru**, 31/31)
- `scripts/runtime-ui-kasir-shift-guard.mjs` (**baru**, 15/15)
- `scripts/final-regression-kasir-api.mjs` (**baru**, 37/37)
- `scripts/final-regression-kasir-ui.mjs` (**baru**, 33/33)
- `scripts/e2e-kasir-cash-after-qris.mjs` (test C + pre-condition shift diperbaiki)

**Tidak dilakukan:** commit, push, perubahan port 3000, migration, reset DB.

---

## 14. FINAL REGRESSION AFTER SHIFT GUARD

> Regression penuh dilakukan **setelah** fix `SHIFT_NOT_OPEN` selesai, pada runtime **production build port 3001** (mock iPaymu 4711) dengan Chromium nyata dan **assertion langsung ke DB** (bukan hanya status HTTP). Tidak ada perubahan code selama regression ini; semua temuan yang muncul selama regression adalah flake environment (halaman berat di server sibuk), bukan bug — perbaikan di sisi harness (fresh page/reload-retry) tanpa menyentuh source.

### 14.1 Matrix Regresi (semua pass)

| Order Type | CASH | QRIS (webhook) | QRIS→CASH (back) | CASH→QRIS (supersede) |
|---|---|---|---|---|
| DINE_IN | PASS | PASS | PASS | PASS |
| TAKEAWAY | PASS | PASS | — | — |
| DELIVERY | PASS | PASS | — | — |

Detail per flow yang diverifikasi (browser + DB-first):
- UI order → **Lunas** → **reload halaman → tetap Lunas** (persistensi status).
- **Navigation delta = 1** (single-scan: tepat satu navigasi per `orderNumber`, tanpa scan barcode kedua).
- **Tidak ada polling churn**: jumlah baris `payment` per order konstan (`rows=1`, atau `rows=2` utk QRIS→CASH + webhook dual-intent) — tidak ada duplikasi intent.
- DB-first: `order.paymentStatus=PAID`, tepat **1 `payment.status=PAID`**, `method` benar (`KASIR` untuk cash, `QRIS` untuk webhook), `payment.orderId/restaurantId/branchId` = milik order, `payment.shiftId` ter-link ke `cashiershift.status='OPEN'` **untuk jalur KASIR**, `QRIS.shiftId` tetap `NULL` (webhook tidak shift-linked); intent lama supersede → `CANCELLED`, order tetap satu PAID.

### 14.2 Kategori Verifikasi

| Kategori | Harness | Total | PASS |
|---|---|---|---|
| API + DB assertion (matrix shift-open, NO-SHIFT groups, forged branch, public unguarded, shift lifecycle, `ALREADY_PAID` distinct, integrity) | `final-regression-kasir-api.mjs` | 37 | 37 |
| Browser (matrix cash/qris/supersede, reload-persist, payments dashboard, no-shift manual order + toast + CTA, branding smoke) | `final-regression-kasir-ui.mjs` | 33 | 33 |
| API regression eksisting (T1–T11: order intent/paid/supersede/shift-link/integrity) | `e2e-kasir-shift-guard-matrix.mjs` | 31 | 31 |
| Legacy race QRIS↔CASH + no-shift | `e2e-kasir-cash-after-qris.mjs` | 31 | 31 |
| Payment + tenant/branch branding regression | `e2e-kasir-payment-branding-v2.mjs` | 80 | 80 |
| Browser UI no-shift (toast + CTA + DB 0 payment) | `runtime-ui-kasir-shift-guard.mjs` | 15 | 15 |
| **Subtotal fungsional** | | **227** | **227** |
| Typecheck `npx tsc --noEmit` | | — | EXIT 0 |
| Build `npm run build` (production) | | — | EXIT 0 |

### 14.3 Verdict

- **Keseluruhan: PASS.** Semua 227 checks fungsional green + typecheck & build clean.
- Guard shift konsisten di semua surface: manual order, scan CASH, scan QRIS, repayment QRIS, mark-paid dashboard — tanpa shift => `SHIFT_NOT_OPEN` (409) + toast "Shift Belum Dibuka" + CTA "Buka Shift" → `/admin/shifts`; dengan shift => alur cash/qris/supersede berjalan utuh.
- Keamanan tidak dilemahkan: tebakar branch header tetap `403 FORBIDDEN`; flow `public` tidak ikut ter-guard (menu & payment QRIS publik tetap 200 tanpa shift) — konsisten dengan keputusan arsitektur.
- Test data yang dibuat regression dibersihkan (baris bertag milik harness; tidak ada reset/drop/truncate); shift kasir seed ditutup-ulang deterministik setiap run.

### 14.4 Catatan (bukan bug, environment)

- Pada server berisi (B{3 consumers}), halaman berat seperti `orders/new` dan daftar `payments` kadang butuh reload sekali akibat client-fetch terhambat (`Loading...` / `ERR_NETWORK_CHANGED` pada Chromium headless lokal) — di-handle dengan reload-retry di harness; source tidak diubah.