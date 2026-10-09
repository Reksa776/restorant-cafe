# ACCOUNTING — PHASE D: PROFIT & LOSS (P&L) — AUDIT & PLAN

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) ✅ tidak berubah sebelum/sesudah
**Mode:** **AUDIT ONLY (read-only)**. Tanpa coding, tanpa perubahan file source/schema, tanpa migration, tanpa tulis DB, tanpa commit/push/deploy/VPS, tanpa reset DB.
**Tanggal:** 2026-10-09
**Referensi dibaca:** `ACCOUNTING-PHASE-A-AUDIT.md`, `ACCOUNTING-PHASE-B-IMPLEMENTATION-REPORT.md`, `ACCOUNTING-PHASE-C-FINAL-REVIEW.md`, implementasi aktual (lihat §1).

> **Legend bukti:** **[Source]** = diperiksa langsung pada kode/schema. **[Test]** = runtime read-only (SELECT) bila dijalankan. **[NOT VERIFIED]** = tidak dapat dipastikan dari lingkungan/data saat ini (jangan dianggap PASS).

---

## 0. Ringkasan eksekutif

- **Gross Profit SUDAH ADA** di Profitabilitas (`profitability/profitability.service.ts`) sebagai `netSales − retainedCogs`, dengan **COGS dari `OrderItemCostSnapshot`** dan **refund-aware reversal**. Yang **belum ada** hanyalah **Operating Expenses → Net Profit**. **[Source]**
- **P&L PHASE D tidak memerlukan migration/schema baru** — murni read-model yang **mencompose** engine kanonik yang ada (Revenue: `revenueWhere`/`computeRefundRevenue`; COGS/Gross Profit: Profitabilitas; Opex: `Expense`). **[Source]**
- **Jangan menyebut hasil sebagai "net profit final".** Data belum mencakup seluruh biaya (mis. payroll penuh, sewa, penyusutan) dan **COGS bisa tidak lengkap (legacy/pending)**; `Expense` saat ini **0 baris**. Batasan ini wajib tampil di UI/CSV. **[Source][Test]**
- **Tidak ada engine baru.** P&L = komposisi; angka inti diwarisi apa adanya.

---

## 1. Existing functionality & lokasi file/fungsi

| Area | Artefak aktual | Peran untuk P&L |
|---|---|---|
| Canonical revenue | `src/services/report/report.service.ts` → `revenueWhere` (**L199**), `revenueScopeWhere`, `computeRefundRevenue` (**L274**), `computeCustomerRevenue`; fragmen SQL kanonik `paidRevenueSql`/`revenueSetSql`/`productRevenueSql`/`refundRevenueSql`/`approvedRefundsSql`/`aliasBranchSql` (**~L513–620**) | Sumber **Gross/Net Sales & Refund** |
| Sales report | `getSalesReport` (**L1241**), `summary` (**L1644–1666**): `totalSales`, `grossSales`, `totalTax`, `totalServiceCharge`, `totalDiscount`, `totalRefund`, `netSales` (= `computeRefundRevenue().total.netSales`), `grossRevenue`, `refundReversal` | Definisi "canonical" yang harus diselaraskan |
| Multi-outlet | `getMultiOutletReport` (**L2350**) | Konsumen revenue lain (jangan diubah) |
| Profitabilitas / COGS / **Gross Profit** | `src/services/profitability/profitability.service.ts` → `getProfitabilityReport` (**L62**), `computeRefundAware` (private); tipe di `profitability.types.ts` | **Sumber COGS + Gross Profit** |
| COGS historis | `OrderItemCostSnapshot` (`prisma/schema.prisma` **L1033**), status enum `OrderItemCostStatus` (**L118**); ditulis `src/services/costing/historical-snapshot.ts` (`createOrderItemCostSnapshots`) | Basis COGS beku |
| Refund + reversal | `Refund` (**L422**), `RefundItem` (**~L480**, `reversedCogs`); approval `src/services/approval/approval.service.ts` | Refund & COGS reversal |
| Order | `Order` (**L833**): `subtotal`, `discount`, `tax`, `serviceCharge`, `grandTotal`, `status`, `paymentStatus`, `branchId?`, `createdAt` | Basis omzet |
| Expense (PHASE B) | `src/services/accounting/expense.service.ts` → `buildExpenseWhere`, `listExpenses`, `exportExpenses`; model `Expense` (**~L1583**), `ExpenseMethod` | **Sumber Operating Expenses** |
| Cashbook (PHASE C) | `src/services/accounting/cashbook.service.ts` | **Bukan** sumber P&L (kas ≠ akrual) |
| Dashboard revenue | `src/services/order/order.service.ts` `getDashboardStats` → `revenueWhere(...)` (**L2035**) | Konsumen revenue lain |
| API Profitabilitas | `src/app/api/reports/profitability/route.ts`, `.../export/route.ts` | Pola API yang akan ditiru |
| UI Profitabilitas | `src/app/admin/profitability/page.tsx` (ringkasan, badge coverage, banner refund/unpaid/legacy) | Pola UI yang akan ditiru |
| Nav | `src/app/admin/layout.tsx` grup **Finance** (**L130–141**: Pengeluaran, Buku Kas); `src/components/admin/reports/report-nav.tsx` (memuat "Profitabilitas", "Menu Engineering") | Tempat menautkan P&L |
| Client wrappers | `src/services/profitability.service.ts`, `src/services/report.service.ts` (axios, bukan engine) | Pola wrapper klien |

**Tidak ditemukan** service/model `pnl`/`P&L`/`laba` (grep "Laba/pnl/P&L" → hanya komentar & laporan audit). Jadi P&L harus **dibuat sebagai komposisi**. **[Source]**

---

## 2. Definisi setiap metrik & sumber data

**Revenue set kanonik** (`revenueSetSql`, report.service.ts): `status <> 'CANCELLED' AND (paymentStatus = 'PAID' OR EXISTS payment REFUNDED)`. Order yang **fully refunded** tetap di set agar revenue dibalik (bukan hilang) dan COGS-nya tetap terwakili. **[Source]**

| Metrik P&L | Definisi kanonik (yang harus dipakai) | Sumber | Catatan |
|---|---|---|---|
| **Gross Sales / Gross Revenue** | `Σ Order.grandTotal` atas revenue set, `Order.createdAt` ∈ range = `getSalesReport().summary.totalSales` (alias `grossRevenue`) | `report.service.ts` | Termasuk tax + service (setelah diskon). **Bukan** profit. `grossSales` (Σ `subtotal`) tersedia terpisah bila perlu. |
| **Refund** | `Σ Refund.amount`, `status='APPROVED'`, `approvedAt` ∈ range (attribusi tanggal approval, H4.5-B1) → `summary.refundReversal`/`totalRefund` | `computeRefundRevenue`/`getSalesReport` | Basis **produk** (proporsional) untuk Net Sales: `refundRevenueSql` = `LEAST(refunded/grandTotal,1) × (grandTotal−tax−serviceCharge)`. Dua angka berbeda (raw vs product-basis) — jangan tertukar. |
| **Net Sales** | `computeRefundRevenue().total.netSales` = `Σ(grandTotal − tax − serviceCharge) − Σ product-basis refund` | `report.service.ts` | **Basis produk**, bukan `totalSales − refund`. Wajib memakai nilai kanonik ini. |
| **COGS (historikal)** | `Σ OrderItemCostSnapshot.hppTotal` dengan `status='SNAPSHOTTED'`, item pada revenue set (`Order.createdAt` ∈ range) = Profitabilitas `summary.cogs`/`historicalCogs` | `profitability.service.ts` | Item tanpa snapshot (LEGACY/PENDING/UNCOVERED) **tidak** menyumbang COGS (bukan 0) dan menurunkan coverage. |
| **COGS reversal (refund)** | Partial refund melepas COGS (`RefundItem.reversedCogs` eksak; fallback pro-rata); **full refund tidak melepas apa pun** | `computeRefundAware` | `cogs` dan `retainedCogs = cogs − cogsReversal`. |
| **COGS dipakai Gross Profit** | `retainedCogs` (historikal − reversal) | Profitabilitas | Hanya valid bila `coverageComplete`. |
| **Gross Profit** | `netSales − retainedCogs`, **null** bila coverage tidak lengkap | Profitabilitas `summary.grossProfit` | Sudah ada; **jangan** reimplementasi. |
| **Operating Expenses** | `Σ Expense.amount` dengan `restaurantId` + branch scope, `spentAt` ∈ range | `expense.service.ts` (`buildExpenseWhere`) | Hanya biaya **non-COGS**. `method` (CASH/TRANSFER/…) tidak memengaruhi total P&L. |
| **Net Profit** | `Gross Profit − Operating Expenses` | komposisi | **null** bila Gross Profit null (COGS tidak lengkap). **Bukan** angka final bila data biaya belum lengkap. |

**Catatan konflik definisi (WAJIB ditegaskan di UI):** `totalSales` (Gross, incl. tax/service) **tidak** sama dengan `netSales` (basis produk). `Gross Sales − Refund ≠ Net Sales` kecuali tax/service = 0. Karena itu P&L harus **menampilkan garis Gross Sales dan Net Sales sebagai nilai kanonik masing-masing**, bukan menghitung Net Sales dari Gross Sales.

---

## 3. Kesesuaian tanggal (date basis)

| Komponen | Basis tanggal | Kode |
|---|---|---|
| Revenue (product) | `Order.createdAt` ∈ range | `revenueSetSql` + `o.createdAt >= start/<= end` |
| Refund | `Refund.approvedAt` ∈ range (order boleh dari periode sebelumnya) | `approvedRefundsSql` |
| COGS | mengikuti **order** (`o.createdAt` ∈ range) — `itemWhere` di Profitabilitas | `profitability.service.ts` |
| COGS reversal | mengikuti `Refund.approvedAt` ∈ range | `computeRefundAware` |
| Operating Expense | `Expense.spentAt` ∈ range ( **local-day**: `toStartOfDay`/`toEndOfDay` ) | `expense.service.ts` |
| Range resolver | `resolveReportRange(period, startDate, endDate)` (dipakai report & Profitabilitas) | `report.service.ts` |

**Implikasi:** satu periode P&L mencampur beberapa basis — order-creation (revenue & COGS), approval-date (refund & reversal), dan calendar-day (expense). **Penting:** `expense.service` memakai `toStartOfDay/toEndOfDay` (batas hari lokal), sedangkan `resolveReportRange` menghasilkan `range.start/end`. P&L **wajib** menyelaraskan batas periode Opex dengan range yang sama (konversi tanggal kalender → awal/akhir hari) agar tidak ada order/expense di batas hari yang jatuh di luar/dalam secara tak konsisten.

---

## 4. Filter tenant/branch & authorization

- **Tenant:** seluruh query kanonik memakai `restaurantId` (`o.restaurantId = …`, `r.restaurantId = …`); tidak pernah dari klien. **[Source]**
- **Branch:** report/profitability memakai `branchFilters` (`branchId IN (…)` via `aliasBranchSql` / `Prisma.join`). `Expense` juga memakai `branchFilters` dan **wajib** punya `branchId`. Order/Payment/Refund `branchId` **nullable** → baris `branchId=null` tidak muncul untuk admin branch-scoped (pola sama dengan report existing). **[Source]**
- **Authorization:** `/api/reports/profitability` + export memakai `requireRoles(["ADMIN"], …)` → **ADMIN-only** (karena mengekspos HPP/COGS/margin). Branch eksplisit divalidasi via `requireRoles`/`requireRestaurantContext`; fallback `authorizedBranches(ctx)`. **[Source]**
- **P&L mengekspos COGS + Operating Expense → harus ADMIN-only** (pola Profitabilitas/Expense), dengan `authorizedBranches(ctx)` untuk scope branch. **[Source]**

---

## 5. Penanganan refund, order cancelled, unpaid, dan COGS tidak tersedia

| Kasus | Perilaku kanonik | Konsekuensi P&L |
|---|---|---|
| **Refund APPROVED** | Dikurangkan dari revenue pada basis produk via `approvedAt`; reversal COGS hanya untuk partial refund | Net Sales turun di periode approval; `retainedCogs` sesuai |
| **Refund PENDING/REJECTED** | **Tidak** dihitung | Tidak memengaruhi P&L |
| **Order CANCELLED** | Dikecualikan dari revenue set (`status <> 'CANCELLED'`) | Tidak ada revenue/COGS |
| **Fully refunded COMPLETED** | Tetap di set: `netSales = 0`, `retainedCogs` = **seluruh** COGS (tidak dilepas) | **Gross Profit negatif secara sengaja**; jangan "dinolkan" |
| **Unpaid/PENDING/FAILED/EXPIRED** | Bukan revenue (kecuali ada payment REFUNDED) | Bukan P&L |
| **COMPLETED tapi belum dibayar** | `unpaidCompleted` (disclosure) — COGS terjadi tanpa revenue | **Tidak** masuk gross profit; tetap disclosure |
| **COGS tidak tersedia** (LEGACY / PENDING_COGS / UNCOVERED) | `coverageComplete=false` → `grossProfit = null` | **Gross Profit & Net Profit = null/Tidak diketahui**; **jangan** `revenue − 0` |
| **Legacy refund tanpa `RefundItem`** | Reversal pro-rata (aproksimasi by design) | COGS sedikit approksimatif — beri label |

---

## 6. Gap & risiko salah hitung / double-counting

| # | Risiko | Detail | Mitigasi |
|---|---|---|---|
| **G1** | **Salah basis Net Sales** | `totalSales − refund` (basis incl. tax) ≠ `netSales` (basis produk) | Pakai **nilai kanonik** `netSales`; tampilkan Gross Sales & Net Sales terpisah, jangan hitung ulang |
| **G2** | **COGS tak lengkap diperlakukan 0** | coverage tidak lengkap → `grossProfit=null` | Warisi `coverageComplete`; Net Profit **null** bila Gross Profit null |
| **G3** | **Perbedaan batas periode Opex** | `spentAt` local-day vs `resolveReportRange` | Selaraskan batas start/end hari sebelum agregasi |
| **G4** | **Purchase dianggap opex** | `Purchase` = persediaan → COGS saat terjual; menambahkannya ke opex **double-count** | **Jangan** masukkan Purchase ke Operating Expenses (schema Expense sudah menegaskan ini, **L1547**) |
| **G5** | **Opex tidak lengkap** | `Expense` = **0 baris** saat ini → Net Profit == Gross Profit | Label "Net Profit belum final; biaya di luar Expense belum tercatat" |
| **G6** | **Basis tanggal campur** | order-creation vs approval-date vs calendar-day | Dokumentasikan basis tiap garis di UI/CSV |
| **G7** | **Refund vs Cashbook** | Kas ≠ akrual (Cashbook = pergerakan uang) | Jangan menyatukan P&L dengan Cashbook |
| **G8** | **Branch null** | Order/Refund nullable branch → hilang untuk admin ter-scope | Jelaskan (pola PHASE C) |
| **G9** | **Duplikasi engine** | Membuat perhitungan revenue/COGS sendiri | Dilarang — compose `computeRefundRevenue` + `profitabilityService` + `Expense` |
| **G10** | **Refund COGS "dibalik" keliru** | Full refund sengaja menahan seluruh COGS | Jangan mengubah `computeRefundAware` |

---

## 7. File yang perlu diubah pada tahap implementasi

**Baru (pola PHASE B/C + Profitabilitas):**
- `src/services/accounting/pnl.service.ts` (+ `pnl.types.ts`) — read-model **komposisi**: panggil `computeRefundRevenue` / `profitabilityService.getProfitabilityReport` untuk revenue/COGS/gross profit, tambah agregasi `Expense` (reuse `buildExpenseWhere` atau query serupa) untuk Opex, hitung Net Profit (null-aware).
- `src/app/api/admin/accounting/pnl/route.ts` (+ `/export/route.ts`) — ADMIN-only, tenant+branch scoped, CSV via `src/lib/csv.ts`.
- `src/app/admin/accounting/pnl/page.tsx` — UI (kartu Gross Sales/Net Sales/COGS/Gross Profit/Opex/Net Profit + banner coverage/refund/unpaid + label "belum final").
- `src/services/pnl.service.ts` — client axios wrapper.

**Diubah (minimal):**
- `src/app/admin/layout.tsx` — 1 entri nav "Laba Rugi" di grup **Finance** (ADMIN).
- (Opsional) `src/components/admin/reports/report-nav.tsx` — tautan ke P&L bila ingin masuk grup report.

**Tidak boleh diubah:** `report.service.ts` (engine kanonik), `profitability.service.ts` (COGS/gross profit), `expense.service.ts` (kecuali mengekspor fungsi agregat yang dipakai bersama — sebaiknya **tidak**), `approval`/`payment`/`order`/`cashier-sales`, `prisma/schema.prisma`, engine PHASE 4–9B.

---

## 8. Database / migration impact

**TIDAK PERLU migration / perubahan schema.** Semua angka sudah ada di tabel existing (`order`, `orderitem`, `orderitemcostsnapshot`, `refund`, `refunditem`, `payment`, `expense`). P&L adalah **read-model agregasi** (sama seperti Cashbook PHASE C). Tidak ada tabel/field baru, tidak ada backfill, tidak ada tulis data. **[Source]**

*(Bila kelak ingin biaya di luar `Expense` — payroll, sewa, penyusutan, COGS dari purchase berjalan — itu fitur terpisah dengan migration & approval sendiri.)* **[Source]**

---

## 9. API, UI, CSV, security, regression impact

- **API:** `GET /api/admin/accounting/pnl` (+ `/export`) — pola Profitabilitas/Expense: `requireAdmin`/`requireRoles(["ADMIN"])`, `restaurantId` dari sesi, `branchFilters` via `authorizedBranches`, validasi branch eksplisit via `assertBranchInScope`. Zod query (period/startDate/endDate/branchId) pola `expense.types.ts`.
- **UI:** halaman ringkas + tabel rincian; **loading/error/empty** state (pola `profitability/page.tsx`); badge **COGS coverage** (COVERED/PARTIAL/PENDING/UNCOVERED/LEGACY) agar Net Profit null terjelaskan; banner refund/unpaid/legacy; **peringatan**: "Net Profit belum final (bukan seluruh biaya tercatat)", "Kas ≠ Laba", "Refund COGS: full refund menahan COGS".
- **CSV:** `buildCsv` (BOM+CRLF, formula-injection guard), header pasti + kolom status coverage; **scope/filter sama** dengan list; null COGS → sel kosong (**bukan 0**).
- **Security:** ADMIN-only (exposes HPP/COGS + opex); tanpa data sensitif; tenant dari sesi; branch scoped.
- **Regression:** risiko **rendah** bila hanya menambah service/route/halaman baru + 1 entri nav. Angka existing (Sales 517000/30000/487000, Profitabilitas) **tidak disentuh**. Risiko utama = **duplikasi engine** (G9) dan **salah basis** (G1/G2) — dimitigasi dengan komposisi murni.

---

## 10. Implementation plan bertahap & test plan

### 10.1 Plan bertahap (rekomendasi)
1. **Service read-model** `pnl.service.ts`: 
   - Revenue/COGS/Gross Profit **diambil dari** `profitabilityService.getProfitabilityReport(restaurantId, period, {startDate,endDate,branchFilters, filters})` untuk konsistensi 1:1 dengan halaman Profitabilitas (termasuk `netSales`, `historicalCogs`, `cogsReversal`, `retainedCogs`, `grossProfit`, `coverage*`, `refundState`, `unpaidCompleted`).
   - **Opex:** agregasi `Expense` (`restaurantId` + `branchFilters` + `spentAt` dalam range yang **selaras** dengan Profitabilitas).
   - **Net Profit:** `grossProfit === null ? null : round2(grossProfit − opex)`; sertakan `opexByCategory` (reuse pola `listExpenses`).
   - Sertakan **disclosure**: `cogsCoverageComplete`, `opexNote` (Expense-driven only), `purchaseExcluded: true`.
2. **API** list + export (ADMIN, branch scoped, Zod).
3. **UI** halaman + entri nav.
4. **Client wrapper**.

### 10.2 Test plan (saat implementasi)
1. **Gross Profit == Profitabilitas** `summary.grossProfit` untuk scope sama. **[Test nanti]**
2. **Net Sales == `computeRefundRevenue().total.netSales`** (== Sales Report `netSales`). **[Test nanti]**
3. **Opex == `Σ Expense`** dengan `spentAt` ∈ range + branch. **[Test nanti]**
4. **Net Profit == Gross Profit − Opex**, dan **null** saat coverage incomplete. **[Test nanti]**
5. **Fully refunded COMPLETED** → netSales 0, retainedCogs > 0, gross profit negatif (tidak dinolkan). **[Test nanti]**
6. **Refund lintas periode** (order Agustus, refund September) terlihat di September sesuai basis approval. **[Test nanti]**
7. **Isolasi tenant/branch** (foreign tenant → 0; admin scoped → hanya cabangnya). **[Test nanti]**
8. **CSV == list** (jumlah/scope), null COGS → sel kosong. **[Test nanti]**
9. **Regresi kanonik:** Sales/Profitabilitas tetap 517000/30000/487000. **[Test nanti]**
10. **Static:** `tsc`/`build`/`git diff --check`. **[Test nanti]**

### 10.3 Batasan yang wajib dinyatakan (jangan klaim final)
- **Net Profit bukan final** selama: (a) `coverageComplete=false` (COGS tidak lengkap) → gross profit null; (b) biaya di luar `Expense` (payroll, sewa, penyusutan, dll.) belum tercatat; (c) **`Expense` = 0 baris** saat ini.
- **Purchase bukan opex** (double-count bila dimasukkan).
- **Basis tanggal campur** (order-creation vs approval-date vs calendar-day) — bukan kesalahan, tetapi harus dijelaskan.
- P&L bersifat **akrual/berbasis revenue**, **bukan** laporan kas (lihat Cashbook PHASE C).

---

## 11. Verifikasi lingkungan (read-only)

| Perintah | Exit | Hasil |
|---|---|---|
| `npx tsc --noEmit` | **0** | 0 error |
| `npm run build` (tanpa build lain berjalan) | **0** | Sukses; route `profitability`, `accounting/cashbook`, `accounting/expenses` terkompilasi. 6 **warning Turbopack** pre-existing (dynamic fs access di upload handler) — tidak terkait PHASE D |
| `git diff --check` | **0** | Bersih |
| `ps aux \| grep "[n]ext build"` sebelum build | 0 | Tidak ada build lain |

**NOT VERIFIED (tidak dijalankan / data tidak tersedia):**
- Uji runtime non-admin 403 (butuh sesi NextAuth) — hanya terbukti **[Source]**.
- Jalur Opex dengan data nyata — tabel **Expense = 0 baris**; hanya struktural/logika **[Source]**.
- UI interaktif di browser — tidak dijalankan.
- Angka P&L aktual — belum ada implementasi (fase audit).

---

## 12. Git integrity (sebelum ⇄ sesudah)

| Item | Nilai |
|---|---|
| HEAD | `d7f29ac` (tidak berubah) |
| Modified (tracked) | 23 (tidak berubah) |
| Untracked | 48 (laporan audit ini menambah 1 `.md`) |
| Staged | 0 |
| `prisma/` numstat | `78  0  prisma/schema.prisma` (tidak berubah) |
| Source file diubah selama audit | **none** (audit murni read-only) |
| Harness temp | none |
| DB writes / migration / reset | **tidak ada** |

Working tree **tidak dibersihkan/diubah**; seluruh pekerjaan existing & uncommitted utuh.

---

## 13. Kesimpulan

- **P&L dapat dibangun sebagai read-model komposisi tanpa engine/migration baru**: Revenue dari `computeRefundRevenue`/`getSalesReport`, COGS + **Gross Profit** dari Profitabilitas, Opex dari `Expense`.
- **Net Profit = Gross Profit − Opex**, **null-aware**, dan **wajib dilabeli belum final** (COGS coverage & kelengkapan biaya).
- **Risiko utama**: salah basis Net Sales (G1), COGS tak lengkap diperlakukan 0 (G2), dan memasukkan Purchase sebagai opex (G4) — semuanya dapat dihindari dengan komposisi murni + label eksplisit.

**STOP** — menunggu review & persetujuan. Tidak implementasi PHASE D.
