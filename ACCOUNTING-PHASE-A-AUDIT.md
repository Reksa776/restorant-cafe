# ACCOUNTING — PHASE A: AUDIT & PLANNING

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`) ✅ sesuai expected
**Mode:** AUDIT ONLY — tidak coding, tidak migration, tidak menulis database, tidak commit/push/deploy.
**Status working tree:** 21 file tracked `M` + 35 untracked (perubahan lokal PHASE 4–9B) — **tidak diubah oleh audit ini**.
**Tanggal:** 2026-10-09

> **Legend bukti:** **[Source]** = terbukti dari source code/schema. **[Test]** = terbukti dari runtime read-only/uji lokal. **[Belum diverifikasi]** = tidak dapat dipastikan dengan data/lingkungan saat ini.
> Audit ini **tidak mengubah** formula revenue/refund yang sudah dikonsolidasikan (PHASE 8B/9B).

---

## 1. Executive summary

Aplikasi ini **belum memiliki modul akuntansi**. Yang ada adalah **operational finance**: order/payment/refund,
shift kasir, purchase & inventory, dan **report kanonik** (Sales, Products, Purchases, Inventory, Shift-Sales,
Payments, Multi-Outlet, Customers, Reservations) ditambah **Profitabilitas** (gross profit berbasis COGS snapshot).

Tidak ada satu pun model/tabel untuk **Expense, Cashbook, Chart of Accounts, Journal, General Ledger,
Balance Sheet, Accounts Receivable/Payable** — dibuktikan oleh inventaris schema (28 model, tanpa model tsb) **[Source]**.

Yang **sudah tersedia dan layak dipakai ulang**:
- **Canonical revenue/refund engine** (`revenueWhere`, `computeRefundRevenue`) sebagai **satu-satunya source of truth** angka penjualan/net sales **[Source]**.
- **COGS historis** (`OrderItemCostSnapshot`) + **Profitabilitas** yang sudah menghitung `grossProfit`, `grossMarginPct`, `foodCostPct`, `retainedCogs` — jadi **gross profit sudah ada**; yang belum ada adalah **operating expense → net profit** **[Source]**.
- **Shift ledger** (`CashierShift` + `expectedCash/difference`) untuk **kas drawer**, dan **Purchase/Supplier** untuk sisi pengadaan **[Source]**.
- Utility uang (`src/lib/money.ts`), auth tenant/branch (`src/lib/auth-helpers.ts`), `AuditLog`.

**Kesimpulan utama:** kebutuhan accounting minimal yang **paling bernilai dan paling aman** adalah
**Expense Management + Cashbook + P&L sederhana (gross profit − opex)** yang **menumpang** pada engine revenue/COGS
yang ada. **Double-entry (COA/Journal/GL/Balance Sheet) dan AR/AP TIDAK disarankan** pada tahap ini (butuh model bisnis
dan fondasi jurnal yang belum ada).

---

## 2. Existing functionality

**Data model (Prisma) — 28 model, tanpa modul akuntansi [Source]:**
- Penjualan: `Order`, `OrderItem`, `OrderStatusHistory`, `OrderItemCostSnapshot` (COGS beku pada READY→COMPLETED).
- Pembayaran: `Payment` (`restaurantId`, `branchId`, `orderId`, `shiftId?`, `method`, `status`, `amount`, `paidAt`), `PaymentTransaction` (provider/type/status/amount/rawData — **tanpa `restaurantId`**, hanya `paymentId`).
- Refund: `Refund` (+`approvedAt`, `shiftId?`), `RefundItem` (`reversedCogs`), approval di `src/services/approval/approval.service.ts`.
- Kasir/shift: `CashierShift` (`openingCash`, `closingCash`, `expectedCash`, `difference`), `ShiftOverride`.
- Pengadaan/inventory: `Supplier`, `Purchase` (DRAFT/RECEIVED/CANCELLED, `total`, `receivedAt` — **tanpa status bayar**), `PurchaseItem` (`unitCost`), `PurchaseIngredient`, `StockMovement`, `BranchIngredient` (WAC), `Recipe`/`RecipeItem`.
- Lain: `AuditLog` (restaurantId/branchId/action/entity/details), `Restaurant`, `Branch`, `User`, `UserBranch`, `RestaurantSettings`, `Customer`, `Reservation`, `Table`, `Promo`, `WhatsApp*`.

**Services terkait finance [Source]:**
- `src/services/report/report.service.ts` — `revenueWhere`/`revenueScopeWhere`, `computeRefundRevenue`, `computeCustomerRevenue`, `getSalesReport`, `getProductReport`, `getPaymentReport`, `getMultiOutletReport`, `getPurchaseReport`, `getCustomerReport`, `getReservationReport`, `getProfitabilityReport` (via service terpisah).
- `src/services/profitability/profitability.service.ts` + `.types.ts` — `grossProfit`, `grossMarginPct`, `foodCostPct`, `cogs`, `historicalCogs`, `cogsReversal`, `retainedCogs`, `refundState`, `coverage`.
- `src/services/cashier-sales/cashier-sales.service.ts` — **shift/drawer ledger** (bukan revenue report; eksplisit).
- `src/services/shift/shift.service.ts` — `expectedCash = openingCash + Σ KASIR PAID − Σ APPROVED refund`.
- `src/services/purchase/purchase.service.ts`, `supplier.service.ts`, `costing.service.ts`, `stock/*`, `ingredient/*`.
- `src/lib/money.ts` (`round2`, `num`, `MONEY_EPSILON`), `src/services/audit/audit.service.ts`.

**API & UI [Source]:**
- API report: `/api/reports/{sales,products,purchases,inventory,shift-sales,payments,multi-outlet,customers,reservations,profitability,menu-engineering}`.
- Halaman: `/admin/reports/*`, `/admin/profitability`, `/admin/menu-engineering`, `/admin/purchasing/{purchases,suppliers}`, `/admin/cashier/sales`, `/admin/shifts`, `/admin/dashboard`.
- Nav report: `src/components/admin/reports/report-nav.tsx` (Penjualan, Produk, Pembelian, Inventory, Per Shift, Pembayaran, Customers, Reservations, Multi Outlet, Profitabilitas, Menu Engineering).

**Komentar desain penting [Source]:** `report.service.ts` §Purchase: *“Total Purchase Value … is NOT labelled profit/expense/COGS (accounting does not exist yet)”*; `cashier-sales.service.ts`: *“this is a SHIFT/DRAWER LEDGER, not an accounting revenue report”*.

**Snapshot data (read-only, restaurant A = “Restoran Bahagia”) [Test]:**
2 restaurants, 2 branches (MAIN, PERUM-1), 35 orders, **1 orderItem**, 46 payments, 29 PaymentTransactions,
2 refunds (1 APPROVED), 7 shifts (1 OPEN), 5 purchases (3 RECEIVED), 4 suppliers, 35 customers, 1 reservation, 44 AuditLogs.
Payment A by method/status: KASIR {PAID 9, UNPAID 11, REFUNDED 1, CANCELLED 7}, QRIS {PAID 7, PENDING 3, EXPIRED 4, CANCELLED 4}.

---

## 3. Gap analysis

| Area diminta | Status | Catatan |
|---|---|---|
| Order/OrderItem | **ADA** | Lengkap + COGS snapshot |
| Payment/PaymentTransaction | **ADA** | Payment tenant/branch-scoped; **PaymentTransaction tanpa `restaurantId`** |
| Refund & approval | **ADA** | Product-basis, `approvedAt`, cogs reversal |
| Cashier/shift/cash movement/closing | **SEBAGIAN** | Shift & `expectedCash/difference` ada; **tidak ada** model cash movement umum (petty cash / setoran / penarikan) |
| Sales Report / Revenue Report | **ADA** | Kanonik (`revenueWhere` + `computeRefundRevenue`) |
| Customer & Reservation Report | **ADA** | PHASE 9B |
| Expense / pengeluaran | **TIDAK ADA** | Tidak ada model maupun UI/API |
| Cashbook / buku kas | **TIDAK ADA (umum)** | Hanya shift ledger, tidak ada arus kas non-penjualan |
| Account / chart of accounts | **TIDAK ADA** | — |
| Journal / jurnal | **TIDAK ADA** | — |
| General ledger / buku besar | **TIDAK ADA** | — |
| Profit & Loss | **SEBAGIAN** | Gross profit ada; **net profit TIDAK** (tanpa opex) |
| Balance Sheet / neraca | **TIDAK ADA** | Butuh jurnal/COA |
| Accounts Receivable / piutang | **TIDAK ADA** | Semua penjualan dibayar di muka/saat order (tidak ada termin) |
| Accounts Payable / utang | **TIDAK ADA** | `Purchase` tidak punya status/field pembayaran; `Supplier` tanpa saldo |
| AuditLog | **ADA** | 44 baris; dipakai untuk approval/aksi |
| RestaurantSettings & tenant/branch auth | **ADA** | `branchHintFrom`/`authorizedBranches`/`requireAdmin` |

**Fitur yang sudah ada tetapi belum terhubung ke UI/API/report:**
- `OrderItemCostSnapshot` hanya disajikan lewat Profitabilitas (bukan di Sales/Purchase).
- `RefundItem.reversedCogs` dan `RefundItem` allocation hanya dipakai profitability.
- `PaymentTransaction.rawData` (jejak gateway) tidak disurface ke UI rekonsiliasi.
- `Supplier` ada tanpa laporan utang/aging (belum ada konsep AP).
- `PurchaseItem.unitCost` (historical) belum dipakai sebagai dasar **expense** apa pun.

---

## 4. Source of truth — sumber kebenaran setiap angka keuangan

**Perbedaan istilah (WAJIB):**
- **Omzet / Gross Sales** = Σ `Order.grandTotal` atas **revenue set** (order `createdAt` in period). Ini **bukan laba**.
- **Net Sales** = `productRevenue − refundRevenue` (canonical, refund by `approvedAt`, capped product basis). **Net Sales BUKAN profit.**
- **Cash flow (kas)** = uang yang benar-benar masuk/keluar drawer/akun (`Payment` PAID + `Refund` APPROVED). Berbeda dari revenue karena (a) pembayaran QRIS tanpa shift, (b) refund lintas periode, (c) shift lintas tengah malam.
- **COGS** = historical cost dari `OrderItemCostSnapshot` (SNAPSHOTTED), dikurangi `cogsReversal` untuk refund.
- **Operating Expense** = biaya operasional non-COGS (gaji, sewa, listrik, marketing…). **Tidak ada model-nya saat ini.**
- **Gross Profit** = `netSales − cogs` (sudah tersedia di Profitabilitas).
- **Net Profit** = `Gross Profit − Operating Expense` (**belum bisa dihitung**).

**Sumber per angka [Source]:**
| Angka | Sumber | Semantics |
|---|---|---|
| Omzet / Total Sales | `revenueWhere` (order `createdAt`) | status ≠ CANCELLED AND (PAID OR ada payment REFUNDED) |
| Discount/Tax/Service | `Order.subtotal/discount/tax/serviceCharge` | bagian order |
| Refund | `computeRefundRevenue` (refund `approvedAt`) | `LEAST(refunded/grandTotal,1) × (grandTotal − tax − serviceCharge)` |
| Net Sales | `computeRefundRevenue().total.netSales` | product − refund (bukan profit) |
| Kas diterima | `Payment` status PAID (per `method`, `shiftId`) | drawer/akun |
| COGS | `OrderItemCostSnapshot` | historical, reversal saat refund |
| Gross Profit | Profitabilitas | netSales − (cogs − cogsReversal) |
| Operating Expense | **—** | belum ada |
| AP/AR | **—** | belum ada |

**Risiko double counting yang harus dijaga:**
1. **Purchase value ≠ Expense.** `Purchase` adalah **pembelian inventory (aset)**; biaya menjadi **COGS saat terjual** (via snapshot). Jika purchase ditambahkan sebagai "expense" **dan** COGS dihitung, terjadi **double count**.
2. **Tax/service charge** terkumpul pada order; belum ada akun kewajiban pajak → jangan diperlakukan sebagai profit.
3. **Refund lintas periode** (atribusi `approvedAt`) vs **kas keluar refund** (`shiftId`) — dua basis berbeda; cashbook harus menyatakan basisnya.

**[Belum diverifikasi]** Kebijakan: apakah purchase `RECEIVED` harus diakui sebagai expense (cash basis) atau aset (accrual/inventory) — perlu keputusan produk.

---

## 5. Usulan fitur accounting minimal + prioritas

Pendekatan **bertahap**, additive, tanpa mengubah engine Order/Payment/Refund/Sales:

**Prioritas 1 — Expense Management** (nilai tertinggi, risiko rendah)
- Pencatatan pengeluaran operasional (kategori, jumlah, tanggal, metode bayar, branch, lampiran opsional, catatan).
- Menutup gap terbesar: tanpa ini tidak ada net profit.

**Prioritas 2 — Cashbook (arus kas sederhana)**
- Rekap **kas masuk** (penjualan KASIR/QRIS PAID) & **kas keluar** (refund APPROVED + expense berbayar) per branch/periode, plus **cash movement manual** (setoran bank, petty cash, modal).
- Menyatukan angka dari `Payment`, `Refund`, `CashierShift`, dan `Expense` — **read model**, bukan engine baru.

**Prioritas 3 — Profit & Loss sederhana**
- `Omzet → Net Sales → COGS → Gross Profit → Operating Expense (kategori) → Net Profit`.
- Menumpang Profitabilitas (gross profit) + Expense (opex). **Label jelas**: net sales ≠ profit.

**Prioritas 4 (opsional/tergantung kebijakan) — Chart of Accounts + Journal → General Ledger → Balance Sheet**
- Hanya jika bisnis benar-benar butuh **double-entry** (pajak, audit eksternal, multi-akun bank).
- Bukan fondasi yang ada sekarang → perubahan besar.

**Prioritas 5 (opsional) — Accounts Payable** (purchase belum dibayar) & **Receivable** (hanya jika ada penjualan termin/kredit — saat ini **tidak ada** model bisnis kredit).

---

## 6. Daftar file existing yang berpotensi digunakan ulang

- `src/services/report/report.service.ts` — `revenueWhere`, `revenueScopeWhere`, `computeRefundRevenue`, `resolveReportRange`, `buildCsv` (via `src/lib/csv`), pola filter/export.
- `src/services/profitability/profitability.service.ts` + `.types.ts` — gross profit & COGS.
- `src/services/purchase/purchase.service.ts`, `supplier.service.ts` — pengadaan & supplier.
- `src/services/shift/shift.service.ts`, `cashier-sales/cashier-sales.service.ts` — kas drawer.
- `src/services/approval/approval.service.ts` — pola approval (refund/shift override) untuk approval expense.
- `src/services/audit/audit.service.ts`, `src/lib/money.ts`, `src/lib/csv.ts`, `src/lib/auth-helpers.ts`.
- `src/components/admin/reports/report-nav.tsx`, `report-branch-filter.tsx`, pola halaman `src/app/admin/reports/purchases/page.tsx` & `profitability`.
- Prisma: `Payment`, `Refund`, `CashierShift`, `Purchase`, `Supplier`, `Order`, `OrderItemCostSnapshot`.

---

## 7. File/API/UI baru atau yang perlu diubah (fase implementasi nanti)

**Baru (usulan, additive):**
- `prisma/schema.prisma`: model `Expense`, `ExpenseCategory`, `CashbookEntry` (manual cash movement) + relasi `Restaurant`/`Branch`/`User`.
- `src/services/accounting/expense.service.ts`, `cashbook.service.ts`, `pnl.service.ts` (+ `.types.ts`).
- API: `/api/accounting/expenses` (+ `[id]`, `/export`), `/api/accounting/cashbook`, `/api/accounting/pnl` (+ `/export`).
- Halaman: `src/app/admin/accounting/expenses/page.tsx`, `.../cashbook/page.tsx`, `.../reports/pnl/page.tsx`.
- Nav: entri baru di `report-nav.tsx` (mis. “Keuangan”) atau grup sidebar Accounting.

**Diubah (minimal):**
- `report-nav.tsx` (tambah entri), `src/app/admin/reports/page.tsx` (bila P&L masuk grup report).
- **Tidak** mengubah: `Order`, `Payment`, `Refund`, `CashierShift`, `Purchase`, `revenueWhere`, `computeRefundRevenue`, `getSalesReport`, Profitabilitas, PHASE 9B.

---

## 8. Database dan migration impact

| Fitur | Model existing cukup? | Migration | Model/Relasi baru | Constraint/Index | Sejarah |
|---|---|---|---|---|---|
| Expense | Tidak | **Ya** | `Expense`(restaurantId, branchId?, categoryId, amount Decimal(12,2), spentAt, method, note, createdByUserId, status?) + `ExpenseCategory` | FK Restaurant/Branch/User; index `(restaurantId, spentAt)`, `(restaurantId, branchId, spentAt)`, `(restaurantId, categoryId)`; unique `(restaurantId, categoryName)` | additive; tidak menyentuh tabel lama |
| Cashbook manual | Tidak | **Ya** | `CashbookEntry`(restaurantId, branchId?, direction IN/OUT, amount, occurredAt, source, note, createdByUserId) | index `(restaurantId, occurredAt)`, `(restaurantId, branchId, occurredAt)` | additive |
| P&L | Ya (derive) | **Tidak** | (read-model; query dari Order/Payment/Refund/CostSnapshot/Expense) | — | none |
| COA/Journal/GL/BS | Tidak | **Ya (besar)** | `Account`, `JournalEntry`, `JournalLine` (+ tipe akun, periode) | unique `(restaurantId, code)`, index `(restaurantId, date)` | additive tapi invasi; **ditunda** |
| AP | Tidak | Ya | `PurchasePayment`/field `paidAmount` pada Purchase ATAU tabel `Payable` | index supplier/status | additive; **ditunda** |
| AR | Tidak | Ya | model piutang | — | **tidak relevan** (tidak ada penjualan kredit) |

**Catatan migration:**
- Semua usulan P1–P3 bersifat **additive** (tabel baru + relasi baru), **production-safe**, tanpa mengubah kolom/tabel existing → **data historis tidak terpengaruh**.
- `PaymentTransaction` **tidak punya `restaurantId`**; jika dipakai untuk rekonsiliasi lintas-tenant, scope harus via join ke `Payment` (opsional menambah `restaurantId`/index = additive, bukan wajib).
- **Tidak** ada migration/`db push`/seed dijalankan pada audit ini **[Source]** (`git diff -- prisma/` = 0).

---

## 9. Security, tenant/branch isolation, risiko regresi

- **Auth:** seluruh endpoint finance baru wajib `requireAdmin` (pola `src/lib/auth-helpers.ts`) + `restaurantId` dari sesi (bukan query) + `branchHintFrom`/`authorizedBranches`.
- **Tenant isolation:** setiap model baru wajib `restaurantId` + index; jangan mengandalkan join implisit. `PaymentTransaction` adalah contoh field tenant yang hilang → waspada.
- **Branch isolation:** `branchId` opsional/required sesuai entitas; filter `branchId IN branchFilters` konsisten dengan report lain.
- **Audit trail:** setiap mutasi Expense/Cashbook manual melalui `auditService` (entity, amount, actor) — jangan menyimpan rahasia.
- **Regresi:** risiko utama adalah **percampuran basis** (revenue vs cash vs purchase) dan **double counting** purchase vs COGS. Mitigasi: P&L hanya mencompose `computeRefundRevenue` + `Profitabilitas` + `Expense`; purchase **tidak** dihitung sebagai expense; label UI eksplisit.
- **Tidak menyentuh** engine kanonik → risiko regresi terhadap Sales/Profitabilitas **rendah** **[Source]**.

---

## 10. Implementation plan per subphase

- **A (ini):** Audit & planning — selesai (laporan ini).
- **B (P1 Expense):** schema `Expense`/`ExpenseCategory` + service + API + UI + audit + branch/tenant + CSV. Acceptance: CRUD expense tenant/branch-scoped, tercatat AuditLog.
- **C (P2 Cashbook):** `CashbookEntry` + read-model menggabungkan Payment PAID/Refund APPROVED/Expense + manual movement. Acceptance: saldo kas per periode = opening + in − out, konsisten dengan shift ledger.
- **D (P3 P&L):** service `pnl` menumpang Profitabilitas + Expense; UI + CSV; label “Net Sales ≠ Profit”. Acceptance: Gross Profit == Profitabilitas; Net Profit == Gross − opex; coverage COGS diwariskan.
- **E (opsional, kebijakan):** COA/Journal/GL/BS — hanya setelah persetujuan double-entry.
- **F (opsional):** AP (pembayaran purchase) & AR (bila ada kredit).

---

## 11. Acceptance criteria dan test plan

**Umum:** semua endpoint `requireAdmin`; tenant `restaurantId` dari sesi; filter branch benar; angka direkonsiliasi ke sumber kanonik.

**P1 Expense:** [Test] create/update/delete ter-scope; laporan periode/branch benar; CSV; AuditLog tercatat; **tidak** ada perubahan angka Sales/Profitabilitas.
**P2 Cashbook:** [Test] `saldo = opening + Σin − Σout`; revenue KASIR/QRIS PAID sesuai `Payment`; refund APPROVED mengurangi kas; Expense berbayar mengurangi kas; **tidak** double count.
**P3 P&L:** [Test] `GrossProfit == ProfitabilityService.summary.grossProfit` untuk scope sama; `NetProfit == GrossProfit − Σ Expense(kategori)`; periode & branch konsisten; label UI benar.

**Uji regresi (wajib):** setelah setiap subphase — `npx tsc --noEmit`, `npm run build`, `git diff --check`,
serta memastikan Sales/Profitabilitas/Customer/Reservation **tidak berubah** (equality check kanonik).

**Baseline terukur saat ini [Test]:** canonical all-time restaurant A: product **517000**, refund **30000**, net **487000** (dari PHASE 9B/F5 + re-cek).

---

## 12. Temuan yang belum bisa diverifikasi

1. **Kebijakan pengakuan purchase** (aset/inventory vs expense) — **[Belum diverifikasi]**, keputusan produk.
2. **Pajak & service charge** — apakah `tax` adalah kewajiban (PPN/utang pajak) atau bagian omzet; belum ada model kewajiban. **[Belum diverifikasi]**.
3. **Kas QRIS** — apakah masuk rekening bank (bukan kas fisik) dan butuh rekonsiliasi settlement gateway; `PaymentTransaction` belum disurface. **[Belum diverifikasi]**.
4. **AP/AR** — tidak ada data termin/kredit; apakah bisnis butuh utang supplier (purchase belum dibayar) belum jelas. **[Belum diverifikasi]**.
5. **COGS coverage** — sebagian order mungkin `LEGACY/UNCOVERED`; pengaruh ke net profit perlu diukur per periode. **[Belum diverifikasi]**.
6. **Akun bank multi-rekening** — belum ada. **[Belum diverifikasi]**.

---

## 13. Rekomendasi scope implementasi pertama

**Rekomendasi: mulai dari PHASE B = Expense Management saja** (paling kecil, additive, aman, langsung menambah nilai),
lalu **PHASE C (Cashbook)** dan **PHASE D (P&L sederhana)**. Tunda **COA/Journal/GL/Balance Sheet** dan **AP/AR**
sampai ada kebutuhan/keputusan bisnis eksplisit.

**Non-goals (jangan dikerjakan sekarang):** double-entry accounting, balance sheet, AR, akun bank multi-rekening,
menghitung `Purchase` sebagai expense (double count), mengubah engine order/payment/refund/sales.

**Guardrail implementasi nanti:** additive migration, `restaurantId`+`branchId` scope, `requireAdmin`, AuditLog,
reuse `computeRefundRevenue`/Profitabilitas/`money.ts`, dan **label eksplisit** bahwa Net Sales ≠ Profit.

---

## Ringkasan prioritas & urutan implementasi

| Prioritas | Fitur | Nilai | Risiko | Migration |
|---|---|---|---|---|
| **P1** | Expense Management | Tinggi | Rendah | Ya (tabel baru) |
| **P2** | Cashbook | Tinggi | Rendah–sedang | Ya (tabel baru) |
| **P3** | P&L sederhana | Tinggi | Rendah (derive) | Tidak |
| P4 | COA/Journal/GL/Balance Sheet | Sedang (kebijakan) | Tinggi | Ya (besar) |
| P5 | AR/AP | Rendah (belum ada model bisnis) | Sedang | Ya |

**Urutan:** B (Expense) → C (Cashbook) → D (P&L) → evaluasi apakah P4/P5 diperlukan.

---

## Integrity statement (audit ini)

- **Perubahan:** tidak ada source/schema/migration/seed/data yang diubah/dihapus; tanpa `git reset`/`git clean`.
- **Migration/DB:** tanpa migration baru; tanpa reset; tanpa penulisan data (`git diff -- prisma/` = 0); snapshot hanya `count` read-only.
- **Git:** HEAD tetap `d7f29ac`; tanpa stage/commit/push/deploy; working tree PHASE 4–9B tetap utuh.
- Probe sementara dihapus (`ls _acc*.ts` → none). Tidak menjalankan build/typecheck (tidak ada perubahan code).

**STOP — menunggu persetujuan sebelum implementasi.**
