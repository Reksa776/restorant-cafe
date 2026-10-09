# ACCOUNTING — PHASE C: CASHBOOK AUDIT & PLAN

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) ✅ sesuai expected, tidak berubah
**Mode:** AUDIT + IMPLEMENTATION PLAN ONLY. Tidak coding, tidak migration, tidak mengubah schema/source/data, tanpa commit/push/deploy.
**Tanggal:** 2026-10-09
**Referensi dibaca:** `ACCOUNTING-PHASE-A-AUDIT.md`, `ACCOUNTING-PHASE-B-IMPLEMENTATION-REPORT.md`, `ACCOUNTING-PHASE-B-CLOSEOUT-REPORT.md`.

> **Legend bukti:**
> **[Source]** = diperiksa langsung pada schema/source code saat audit ini.
> **[Test]** = dijalankan runtime **read-only** (SELECT saja) terhadap DB lokal; tidak ada INSERT/UPDATE/DELETE.
> **[Belum diverifikasi]** = tidak dapat dipastikan dari data/lingkungan saat ini.

---

## 1. Existing functionality

Fondasi kas/keuangan yang **sudah ada** (tidak akan dibuat ulang):

| Area | Artefak | Ringkas |
|---|---|---|
| Pembayaran | `Payment` (model 1079, service `payment.service.ts`) | `status PaymentStatus`, `amount`, `method` (String: `"KASIR"` \| `"QRIS"` \| null), `paidAt`, `shiftId?`, `branchId?`, `orderId` |
| Jejak gateway/refund | `PaymentTransaction` (model 1187) | `paymentId`, `provider`, `type`, `status`, `amount` (bisa negatif), `rawData`. **Tanpa `restaurantId`** |
| Refund | `Refund` (model 422, approval di `approval.service.ts`) | `amount`, `status RequestStatus`, `approvedAt?`, `shiftId?`, `paymentId?`, `branchId?`, `orderId` |
| Pengeluaran | `Expense` (PHASE B, model 1592) | `amount`, `spentAt`, `method ExpenseMethod`, `branchId` (**wajib**), `categoryId`, `createdByUserId` |
| Shift/drawer | `CashierShift` (model 358) + `shift.service.ts` | `openingCash`, `closingCash`, `expectedCash`, `difference`, `status`, `branchId?`, `userId` |
| Report kanonik | `report.service.ts` | `revenueWhere` (203), `computeRefundRevenue` (264), `getPaymentReport` (~2100), `getShiftSalesReport` (~1985) |
| Ledger kasir | `cashier-sales.service.ts` | Shift/drawer ledger — **bukan** report revenue akuntansi |
| Audit/auth | `AuditLog`, `auth-helpers.ts` (`requireAdmin`, `branchHintFrom`, `authorizedBranches`) | — |

**Tidak ada model Cashbook/CashMovement/CashLedger/OpeningBalance/BankAccount/Settlement/Ledger** **[Source]** (`grep` schema → NONE); tidak ada kata "cashbook" di `src/` selain komentar di `expense.service.ts`. Jadi cashbook harus **diturunkan (read-model)** dari sumber di atas.

Konstanta kunci yang sudah ada dan akan dipakai ulang: **`COLLECTED_PAYMENT_STATUSES = ["PAID", "REFUNDED"]`** (`approval.service.ts:32`) — himpunan "uang benar-benar sudah diterima". **[Source]**

---

## 2. Gap Cashbook

| Kebutuhan Cashbook | Status saat ini |
|---|---|
| Daftar kas masuk per tanggal | **TIDAK ADA** (tersedia hanya via report Pembayaran per `createdAt`, bukan `paidAt`, dan tanpa konteks kas vs non-kas) |
| Daftar kas keluar (refund) | **TIDAK ADA** sebagai arus kas (refund tersedia di report/ledger tapi tidak sebagai mutasi kas) |
| Daftar pengeluaran sebagai kas keluar | **TIDAK ADA** rekap gabungan (Expense ada, belum masuk buku kas) |
| Net movement per periode | **TIDAK ADA** (sales report = revenue, bukan mutasi kas) |
| Saldo awal / saldo berjalan absolut | **TIDAK ADA** (hanya `CashierShift.openingCash` per shift, bukan saldo rekening) |
| Bucket kas fisik vs QRIS/settlement | **TIDAK ADA** pemisahan eksplisit |
| Rekonsiliasi kas vs revenue akuntansi | **TIDAK ADA** |

**Kesimpulan:** gap-nya adalah **read-model agregasi**, bukan engine baru. Semua angka sudah ada di `Payment`/`Refund`/`Expense`/`CashierShift`.

---

## 3. Peta sumber transaksi dan field aktual

### 3.1 Payment — kas masuk **[Source]**
- Model/field: `id, restaurantId, branchId?, orderId, shiftId?, status PaymentStatus{UNPAID,PENDING,PAID,FAILED,EXPIRED,REFUNDED,CANCELLED}, amount Decimal(10,2), method String?, provider?, providerRef?, paidAt?, createdAt`.
- **Tanggal transaksi kas:** `paidAt` (saat uang benar-benar diterima). Snapshot: **0 dari 17** collected payment ber-`paidAt` null **[Test]**. Fallback bila null: `createdAt` (dengan penanda eksplisit).
- **Status yang membolehkan:** hanya `PAID` dan `REFUNDED` (= `COLLECTED_PAYMENT_STATUSES`). `UNPAID/PENDING/FAILED/EXPIRED/CANCELLED` = **bukan** kas masuk.
- **Scope:** `restaurantId` wajib; `branchId` **nullable** (semua collected di snapshot A punya `branchId` **[Test]**); `shiftId` **nullable**.
- **Duplikasi:** satu order bisa punya >1 payment (split tender KASIR+QRIS) → **jangan** de-dup per order untuk arus kas; hitung **per payment**.
- **Mencerminkan kas aktual?** **Ya untuk KASIR** (uang drawer). **Untuk QRIS: bukan kas fisik** — hanya penanda "dibayar ke gateway"; settlement ke rekening **tidak tercatat**.

### 3.2 PaymentTransaction — jejak gateway/refund **[Source]**
- Field: `id, paymentId, provider, type, status, amount, rawData, createdAt`. **Tidak ada `restaurantId`, `branchId`, `paidAt`.**
- **TIDAK boleh dijumlahkan** sebagai kas masuk/keluar: ia **mirror** dari `Payment` untuk gateway (`webhook/PAID`) dan `cashier_payment/PAID`, **plus** baris refund negatif (`type="refund"`).
- **Bukti duplikasi [Test]:** `cashier_payment/PAID` n=10 Σ465000 (termasuk payment yang kini `REFUNDED`), `webhook/PAID` n=7 Σ142000 (duplikat QRIS `Payment`), `refund/REFUNDED` n=1 Σ−30000 (refleksi `Refund` APPROVED). Menjumlahkannya bersama `Payment` = **double count**.
- **Peran yang benar:** bukti/drill-down per transaksi (join ke `Payment` untuk tenant scope), bukan komponen total.

### 3.3 Refund — kas keluar **[Source]**
- Field: `id, restaurantId, branchId?, orderId, paymentId?, shiftId?, amount, status RequestStatus{PENDING,APPROVED,REJECTED}, approvedAt?, requestedAt, decidedAt`.
- **Tanggal transaksi kas:** `approvedAt` (basis kanonik H4.5-B1). Snapshot APPROVED: `approvedAt` **terisi** **[Test]**.
- **Status yang membolehkan:** hanya **APPROVED**.
- **Scope:** `restaurantId` wajib; `branchId` nullable; `shiftId` nullable.
- **Atribusi drawer:** `shiftId` = shift yang menagih KASIR payment, **NULL untuk refund QRIS/legacy** **[Source `approval.service.ts` ~213–220]**. Snapshot: refund APPROVED **`shiftId` NULL** **[Test]** → tidak bisa diatribusikan ke drawer via `shiftId` (inilah alasan `cashier-sales.service.ts` memakai **order scope**, bukan `refund.shiftId`).
- **Kas aktual?** Hanya refund atas **pembayaran KASIR** yang merupakan kas keluar fisik; refund QRIS = pengembalian via gateway (bukan kas drawer).

### 3.4 Expense — kas keluar operasional **[Source]**
- Field: `id, restaurantId, branchId (wajib), categoryId, amount Decimal(12,2), spentAt, method ExpenseMethod{CASH,TRANSFER,QRIS,CARD,OTHER}, note, createdByUserId`.
- **Tanggal transaksi:** `spentAt` (tanggal pengeluaran).
- **Status:** tidak ada status; setiap baris `Expense` adalah pengeluaran tercatat.
- **Scope:** restaurant + branch (wajib).
- **Kas aktual?** Hanya `method = CASH` = kas keluar fisik. `TRANSFER/QRIS/CARD` = non-kas; `OTHER` = tidak pasti (**[Belum diverifikasi]** apakah kas).
- **Snapshot:** 0 baris (tabel kosong) **[Test]** → belum ada contoh nyata.
- **Duplikasi:** `Expense` **tidak** masuk `CashierShift.expectedCash` (rumus hanya opening + cashSales − refund) → **tidak** dobel di drawer ledger. **Purchase BUKAN Expense** (lihat §5).

### 3.5 CashierShift — ledger drawer **[Source]**
- `expectedCash = openingCash + Σ(PAID KASIR, shiftId=this) − Σ(APPROVED refund, shiftId=this)` (`shift.service.ts:69`).
- Ini **kas fisik per drawer**, bukan buku kas tenant. Snapshot: 1 OPEN, 6 CLOSED **[Test]**.
- **Tidak** termasuk QRIS, **tidak** termasuk Expense, **tidak** termasuk KASIR collected tanpa `shiftId`.

### 3.6 Canonical revenue & payment report **[Source]**
- `computeRefundRevenue` = `Σ productRevenue` (order `createdAt`) − `Σ refundRevenue` (refund `approvedAt`), pada **revenue set** (`status<>CANCELLED AND (PAID OR ada payment REFUNDED)`), product basis `grandTotal − tax − serviceCharge`.
- `getSalesReport().summary` (snapshot A) = `totalSales 517000, totalRefund 30000, netSales 487000` **[Test]**.
- **Revenue ≠ kas:** revenue memakai basis `grandTotal`/order-date dan mengecualikan CANCELLED; kas memakai `paidAt`/`approvedAt` atas **jumlah payment aktual**. Bukti perbedaan: Σ payment collected = **607000** vs `totalSales` 517000 **[Test]** (beda metode, waktu, tax/service, order cancelled, dan split tender).

### 3.7 AuditLog & auth **[Source]**
- `AuditLog{restaurantId, branchId?, userId?, action, entityType?, entityId?, details, ipAddress?, createdAt}`; `auditService.log()` best-effort, meredaksi key sensitif.
- `requireAdmin`, `branchHintFrom`, `authorizedBranches`, `assertBranchInScope` — pola standar tenant/branch.

---

## 4. Definisi cash inflow / outflow

**Prinsip: kas = uang yang benar-benar berpindah, dibuktikan dari data yang ada.** Revenue akuntansi ≠ arus kas.

| Bucket | Definisi | Sumber & tanggal | Masuk total? |
|---|---|---|---|
| **Kas masuk fisik (tunai)** | Payment `status ∈ {PAID,REFUNDED}` dan `method="KASIR"` | `Payment.paidAt` | Ya |
| **Kas masuk non-fisik (QRIS)** | Payment `status ∈ {PAID,REFUNDED}` dan `method="QRIS"` | `Payment.paidAt` | Dipisah — **settlement ke rekening belum terbukti** |
| **Kas keluar fisik (tunai)** | Refund `APPROVED` atas pembayaran KASIR + Expense `method=CASH` | `Refund.approvedAt` / `Expense.spentAt` | Ya |
| **Kas keluar non-fisik** | Refund `APPROVED` atas QRIS + Expense `method ∈ {TRANSFER,CARD}` | idem | Dipisah |
| **Tidak pasti** | Expense `method=OTHER`; KASIR collected tanpa `shiftId` untuk atribusi drawer | — | Perlu label |
| **Transfer/settlement** | Perpindahan QRIS→rekening bank, setoran tunai ke bank | **Tidak ada datanya** | **Tidak dapat dibuktikan → dilaporkan sebagai nol/`unverified`, bukan dihitung** |

**Eksplisit dikecualikan dari arus kas:**
- `PaymentTransaction` (mirror/duplikat) — kecuali sebagai bukti drill-down.
- `Order.grandTotal` (omzet) sebagai "kas tambahan" — omzet bukan arus kas.
- `Purchase` (inventory/aset) — bukan kas keluar non-kas? **Purchase bukan Expense**; pembelian tunai tidak tercatat sebagai kas keluar di model saat ini (**[Belum diverifikasi]** apakah purchase dibayar tunai/transfer; model tidak punya field pembayaran).
- `CashierShift` totals sebagai buku kas tenant penuh (hanya drawer).

**Kas fisik vs QRIS (wajib dipisah):** QRIS `PAID` **bukan bukti** dana masuk rekening bank. Tidak ada model settlement/rekening → tidak dapat diklaim sebagai saldo bank.

---

## 5. Aturan deduplication

1. **Satu Payment dihitung sekali** — `status ∈ {PAID, REFUNDED}` (collected set), per **baris Payment**, bukan per order (split tender sah). **[Source]**
2. **PaymentTransaction tidak pernah dijumlahkan** ke total kas — ia mirror `Payment` + ledger refund negatif. Snapshot membuktikan duplikasi (`cashier_payment/PAID` 10×465000 termasuk baris REFUNDED; `webhook/PAID` 7×142000 duplikat QRIS) **[Test]**. Pemakaian hanya untuk drill-down, di-scope via join ke `Payment.restaurantId`.
3. **Satu Refund dihitung sekali** sebagai kas keluar (`status="APPROVED"`), dan **tidak** ditambah lagi dari baris `PaymentTransaction type="refund"`.
4. **Refund tidak mengurangi kas dua kali** — refund mengurangi lewat tabel `Refund` saja, bukan lewat status `Payment=REFUNDED`. (Payment yang sudah REFUNDED tetap masuk sebagai "kas pernah masuk" agar inflow tidak hilang; lihat §6.)
5. **Refund tidak dobel dari beberapa tabel** — hanya `Refund`, bukan `PaymentTransaction`.
6. **Purchase bukan Expense** — tidak pernah masuk kas keluar pengeluaran; purchase = inventory → COGS saat terjual.
7. **Expense tidak dihitung dua kali** — `Expense` tidak ada di ledger kasir existing, jadi satu sumber. Bila kelak ada tabel cash-movement manual, Expense **tidak** boleh ditambahkan ulang di sana.
8. **Omzet bukan arus kas tambahan** — `Order.grandTotal` tidak pernah dijumlahkan ke kas.
9. **QRIS tidak masuk bucket kas fisik** — dipisah agar tidak mengklaim uang tunai/rekening yang belum terbukti.
10. **Cross-tenant/branch:** karena `PaymentTransaction` **tanpa `restaurantId`**, setiap drill-down wajib lewat relasi `payment` dan difilter `payment.restaurantId` + branch.

**Edge [Test]:** ada **1 payment collected pada order CANCELLED**. Revenue kanonik mengecualikan order CANCELLED, tetapi uang **benar-benar** berpindah → cashbook kas **memasukkan** baris ini dan **menandainya** agar selisih kas-vs-revenue terjelaskan (tidak dihitung sebagai revenue).

---

## 6. Rumus saldo dan keterbatasannya

**Net movement (periode):**
```
netMovement       = Σ collectedPayments.paidAt(in period)  −  Σ approvedRefunds.approvedAt(in period)  −  Σ expenses.spentAt(in period)
netCashMovement   = Σ KASIR collected                    −  Σ refunds on KASIR payments              −  Σ CASH expenses
netQRISMovement   = Σ QRIS collected                     −  Σ refunds on QRIS payments               −  Σ QRIS/TRANSFER/CARD expenses   (settlement UNAUDITED)
```
Semua pembulatan lewat `round2` (`src/lib/money.ts`); tanggal lokal-hari (pola `AuditLog`/`Report`).

**Saldo berjalan (running balance):**
```
runningBalance(t) = openingBalance + Σ netMovement(sampai t)
```
- **`openingBalance` TIDAK TERSEDIA.** `CashierShift.openingCash` hanya kas awal **satu shift**, bukan saldo awal tenant/branch/rekening. Tidak ada model saldo awal/rekening bank. **[Source]**
- Karena itu **saldo absolut belum dapat dihitung dengan andal** — laporan **tidak boleh** mengarang nilai saldo awal. Yang disajikan: **net movement per periode** + (opsional) **saldo per shift** memakai `expectedCash` yang memang ada datanya.
- **`closingCash`/`difference`** hanya valid per shift; bukan saldo kas berjalan lintas shift (uang bisa disetor/diambil antar shift — tidak tercatat).

**Keterbatasan lain:**
- **Refund attribution:** `refund.shiftId` null untuk QRIS/legacy (snapshot APPROVED shiftId NULL **[Test]**) → refund tidak bisa diatribusikan ke drawer lewat `shiftId`; gunakan order scope seperti `cashier-sales.service.ts`.
- **QRIS settlement:** tidak ada bukti dana masuk bank → bucket "unverified".
- **Shift attribution:** **3 dari 10** KASIR collected tanpa `shiftId` **[Test]** (legacy admin quick-mark) → tidak bisa diatribusikan ke drawer; masuk kas tenant tapi tidak ke shift.
- **Historical data:** transaksi lama tetap tampil apa adanya; tidak ada perubahan data historis.
- **Tax/service:** revenue kanonik memakai product basis; kas memakai jumlah payment aktual → selisih yang harus **dijelaskan**, bukan ditutup.

---

## 7. API / service / UI yang direncanakan

### 7.1 Service (read-model) **[Source rencana]**
- `src/services/accounting/cashbook.service.ts` + `cashbook.types.ts` (Zod v4, pola `audit.types.ts`/`expense.types.ts`).
- Fungsi:
  - `getCashbook(restaurantId, query, branchFilters)` → `{ items, summary, pagination, range }`.
  - `exportCashbook(restaurantId, query, branchFilters)` (cap 5000, pola `expense` export).
- **Menyusun items** dari 3 sumber (union, bukan engine baru):
  - `Payment` collected → `IN` (label `KASIR`/`QRIS`, `source: "PAYMENT"`, `status`, branch, order number, shift number, `date=paidAt`).
  - `Refund` APPROVED → `OUT` (`source: "REFUND"`, `date=approvedAt`, metode pembayaran induk, branch).
  - `Expense` → `OUT` (`source: "EXPENSE"`, `date=spentAt`, `method`, kategori, branch).
- **Summary:** `totalIn`, `totalOut`, `netMovement`, `cashIn`, `qrisIn`, `cashOut`, `qrisOut`, `expenseByMethod`, `collectedOnCancelledOrders` (penanda), `qrIsSettlement: "unverified"`.
- **Unifikasi penyajian** tapi **bukan** satu tabel baru — query per sumber lalu merge & sort di app layer (aman untuk volume).

### 7.2 API (ADMIN-only) **[Source rencana]**
- `GET /api/admin/accounting/cashbook` — list + summary.
- `GET /api/admin/accounting/cashbook/export` — CSV, scope/filter sama.
- Guard: `requireAdmin(branchHintFrom(request))` + `assertBranchInScope` untuk `branchId` eksplisit + `authorizedBranches(ctx)`.

### 7.3 UI **[Source rencana]**
- `src/app/admin/accounting/cashbook/page.tsx` (pola halaman `expenses` yang baru).
- Filter: rentang tanggal, tipe (`IN`/`OUT`), metode (`KASIR`/`QRIS`/`CASH`/`TRANSFER`/…), branch (via `ReportBranchFilter`/`useBranchContext`), pencarian + paginasi.
- Summary cards: Kas Masuk, Kas Keluar, **Net Movement**, + baris pemisah **QRIS (settlement unverified)**.
- Kolom: tanggal, sumber (Payment/Refund/Expense), tipe, metode, status, branch, order/shift, nominal.
- Loading/empty/error state; CSV export; **label jelas** "Kas ≠ Omzet/Revenue" dan "Saldo awal tidak tersedia".
- Nav: entri baru **"Buku Kas"** di grup **Finance** `src/app/admin/layout.tsx` (pola PHASE B).

---

## 8. Tenant / branch / security impact

- **Authorization:** seluruh endpoint baru `requireAdmin` (ADMIN-only), konsisten PHASE B.
- **Tenant:** `restaurantId` **dari sesi** (`ctx.restaurantId`), tidak pernah dari body/query.
- **Branch:** list/export difilter `authorizedBranches(ctx)`; `branchId` eksplisit divalidasi `assertBranchInScope`. `Payment.branchId`/`Refund.branchId`/`Expense.branchId` nullable → baris `branchId=null` tidak akan muncul untuk admin branch-scoped (sesuai pola report existing).
- **PaymentTransaction:** tanpa `restaurantId` → semua akses via `payment.restaurantId` (defense-in-depth).
- **Data sensitif:** detail PaymentTransaction (`rawData`) **tidak** diekspos ke CSV/UI; hanya ringkasan aman.
- **Audit trail untuk aksi manual:** Phase 1 cashbook **read-only** (tidak ada mutasi) → tidak perlu audit. Bila kelak ada *manual cash adjustment*/transfer/opening balance, **wajib** AuditLog (lihat §9) dan penjelasan risiko.

---

## 9. Database / migration impact

**PHASE C tahap pertama: TIDAK perlu migration** (read-model murni atas `Payment`, `Refund`, `Expense`, `CashierShift`) **[Source]**. Tidak ada tabel/field baru.

**Bila kelak perlu** (di luar scope minimal, butuh persetujuan terpisah):
| Fitur | Butuh migration? | Model/field | Risiko audit |
|---|---|---|---|
| Manual cash movement (setoran/penarikan/petty cash) | Ya | `CashMovement{restaurantId, branchId, direction IN/OUT, amount, occurredAt, reason, createdByUserId}` | Overstatement/understatement kas; butuh approval + AuditLog; bisa dobel dengan Expense/Refund bila tumpang tindih |
| Opening balance | Ya | `CashAccount`/`OpeningBalance{restaurantId, branchId, asOf, amount}` | Salah input → seluruh running balance salah permanen; butuh audit & koreksi eksplisit |
| Rekonsiliasi bank / settlement QRIS | Ya | `BankAccount`, `Settlement{provider, grossAmount, fee, netAmount, settledAt, ref}` + impor mutasi | Kompleks; butuh pencocokan; risiko menerima selisih tak terjelaskan |
| Transfer antar rekening | Ya | `CashTransfer{fromAccount, toAccount, amount, occurredAt}` | Hanya jika multi-akun; tanpa itu tidak relevan |

**Strategi:** semua di atas **additive**, production-safe, tanpa menyentuh tabel lama. **Tidak dijalankan** pada audit ini.

---

## 10. Risiko regresi dan pengujian

**Risiko regresi (semua rendah jika read-only):**
- **Tidak mengubah** `Payment`/`Refund`/`Expense`/`CashierShift`/`revenueWhere`/`computeRefundRevenue`/report engine → risiko regresi ≈ 0. **[Source]**
- **Risiko terbesar = double counting** bila `PaymentTransaction` dijumlahkan, atau refund dihitung dari dua tabel, atau omzet ditambahkan sebagai kas. **Mitigasi:** ikuti §5 secara ketat + test numerik.
- **Risiko klaim keliru** (QRIS dianggap uang tunai/bank) → dipisah + label `unverified`.
- **Risiko saldo fiktif** → jangan tampilkan running balance tanpa opening.

**Rencana pengujian (saat implementasi nanti):**
1. **Unit/service [Test nanti]:** `totalIn` (koleksi payment) == jumlah manual query `Payment collected`; `totalOut` == refund APPROVED + expense.
2. **Dedup [Test nanti]:** `totalIn` **tidak** berubah saat `PaymentTransaction` bertambah/duplikat; satu `Payment` dihitung sekali.
3. **Kas vs revenue [Test nanti]:** `netMovement` ≠ `netSales` dijelaskan; `collectedOnCancelledOrders` terhitung 1 (data saat ini).
4. **Isolasi tenant/branch [Test nanti]:** admin A tidak melihat data restoran lain; branch-scoped hanya branch-nya.
5. **CSV == list** (scope/filter sama), formula-injection guard, BOM.
6. **Regresi kanonik [Test nanti]:** `getSalesReport`/`computeRefundRevenue` tetap 517000/30000/487000 (tidak tersentuh).
7. **Static:** `tsc`/`build`/`git diff --check`.

---

## 11. Daftar file yang kemungkinan perlu diubah

**Baru:**
- `src/services/accounting/cashbook.service.ts`, `src/services/accounting/cashbook.types.ts`
- `src/app/api/admin/accounting/cashbook/route.ts`, `.../cashbook/export/route.ts`
- `src/services/cashbook.service.ts` (client wrapper, pola `expense.service.ts`)
- `src/app/admin/accounting/cashbook/page.tsx`

**Diubah (minimal):**
- `src/app/admin/layout.tsx` (tambah 1 entri nav "Buku Kas" di grup Finance)

**Tidak boleh diubah:**
- `prisma/schema.prisma` (tanpa migration), `payment.service.ts`, `approval.service.ts`, `shift.service.ts`, `cashier-sales.service.ts`, `report.service.ts`, `profitability.service.ts`, `expense.service.ts`, `money.ts` (dipakai ulang, bukan diubah).

---

## 12. Rekomendasi implementasi minimal & acceptance criteria

**Rekomendasi scope PHASE C minimal:** **Cashbook read-model, tanpa migration, tanpa fitur mutasi.**

In scope:
- Daftar kas masuk/keluar gabungan (Payment collected, Refund APPROVED, Expense) + summary in/out/net.
- Pemisahan tegas kas fisik (KASIR) vs QRIS (settlement unverified).
- Filter tanggal/tipe/metode/branch; pencarian + paginasi; CSV dengan scope sama.
- Label eksplisit: "Kas ≠ Omzet/Revenue", "Saldo awal tidak tersedia", "QRIS settlement belum terbukti".

**Out of scope (butuh persetujuan & migration terpisah):** manual cash movement, opening balance, transfer antar rekening, rekonsiliasi bank/settlement QRIS, approval workflow.

**Acceptance criteria (untuk fase implementasi nanti):**
1. `totalIn` == jumlah `Payment` dengan `status ∈ {PAID, REFUNDED}` (per baris payment), sesuai filter.
2. `totalOut` == `Σ Refund APPROVED` + `Σ Expense` sesuai filter.
3. `netMovement == totalIn − totalOut` (round2).
4. **Tidak ada** `PaymentTransaction` yang dijumlahkan ke total (dedup terbukti).
5. Satu `Payment`/`Refund`/`Expense` dihitung tepat **sekali**.
6. QRIS ditampilkan **terpisah** dari kas fisik; tidak pernah diklaim sebagai dana bank.
7. Running balance **tidak** ditampilkan sebagai angka absolut tanpa opening balance; jika ditampilkan, wajib ada penanda keterbatasan.
8. ADMIN-only; tenant dari sesi; branch scoped; non-admin ditolak.
9. CSV memakai scope/filter identik dengan halaman; tanpa `rawData`/data sensitif.
10. Tidak ada perubahan pada angka `getSalesReport`/`computeRefundRevenue`/Profitabilitas (517000/30000/487000 tetap) dan tanpa perubahan schema/data.

---

## Ringkasan

- **Fondasi lengkap, gap hanya read-model.** Semua sumber kas sudah ada (`Payment`, `Refund`, `Expense`, `CashierShift`); tidak ada model Cashbook (dikonfirmasi **[Source]**).
- **PHASE C minimal tidak butuh migration** dan tidak menyentuh engine apa pun → risiko regresi rendah.
- **Batas keandalan yang jujur:** saldo absolut **belum bisa** dihitung (tanpa opening balance/rekening), QRIS settlement **belum terbukti**, dan sebagian KASIR/refund **tanpa `shiftId`** (snapshot: 3/10 KASIR collected & 1 refund APPROVED) → tidak bisa diatribusikan ke drawer.
- **Bahaya utama = double counting** (`PaymentTransaction`, refund ganda, omzet sebagai kas) → §5 mengunci aturannya.

**Bukti kunci [Test] (read-only)**: A: KASIR PAID 9 (435000), QRIS PAID 7 (142000), KASIR REFUNDED 1 (30000); collected total 17 (1 di order CANCELLED); collected tanpa `paidAt` 0; KASIR collected tanpa `shiftId` 3; refund APPROVED 1 (30000, `shiftId` NULL, `approvedAt` terisi); PaymentTransaction `cashier_payment/PAID` 10×465000 + `webhook/PAID` 7×142000 + `refund/REFUNDED` 1×−30000 (bukti duplikasi); shifts OPEN 1/CLOSED 6; expense 0. Kanonik `totalSales 517000 / refund 30000 / netSales 487000`.

**STOP** — menunggu persetujuan. Tidak implementasi PHASE C, tanpa migration, tanpa perubahan data, tanpa commit/push/deploy.
