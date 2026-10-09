# FINAL ACCOUNTING READINESS AUDIT

**Repo:** `/home/reksa/restorant-cafe` — **Status:** SELESAI (audit-only, menunggu review)
**Fokus:** kesiapan accounting setelah Phase D1, D2, dan Integrity Monitoring.
**Batasan dipatuhi:** tanpa perubahan source/schema/migration/DB; tanpa membuat/memperbaiki OrderItem/snapshot historis; tanpa mengubah revenue/payment/refund/COGS/P&L; tanpa commit/push/deploy/VPS; tidak memulai Phase E; pekerjaan uncommitted dipertahankan.
**Prinsip:** membedakan **FAKTA TERVERIFIKASI**, **ASUMSI**, dan **LIMITATION**. Data revenue tanpa OrderItem **tidak** dianggap COGS nol/laba valid. `codeDeployUnproven: true` **tidak** dianggap bukti kapan engine snapshot aktif.

---

## 1. Git Status Sebelum Audit (baseline)

| Item | Nilai |
|---|---|
| HEAD | `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` |
| Modified tracked | **29** |
| Staged | **0** |
| Untracked | **60** |
| Diff Prisma | `prisma/schema.prisma` **+78/−0** (hanya `Expense`, `ExpenseCategory`, enum `ExpenseMethod`) + folder migration baru `prisma/migrations/20261009_add_expense_management/` (untracked) — **tidak ada** perubahan schema untuk D1/D2/Integrity |

---

## 2. Ringkasan Status per Area

| # | Area | Status | Basis |
|---|---|---|---|
| 1 | Canonical revenue & refund | **PASS** | Satu predikat `revenueWhere`/`revenueScopeWhere` + `computeRefundRevenue`; konsumsi konsisten (Sales, Dashboard, Product, Profitabilitas, P&L, Integrity) |
| 2 | COGS snapshot & coverage | **PASS WITH LIMITATION** | Aturan D1 benar (`NO_ITEMS` ∈ bukan-COVERED); 0 snapshot historis → tidak dapat diuji dengan data nyata |
| 3 | Profitability summary & branch | **PASS WITH LIMITATION** | `grossProfit=null` saat coverage tak lengkap; branch breakdown ada (2 cabang) |
| 4 | P&L & export | **PASS** | `netProfit=null` diteruskan; CSV null → sel kosong |
| 5 | Menu Engineering | **PASS WITH LIMITATION** | Guard coverage benar; basis net sales **item-based** berbeda dari Profitabilitas/P&L saat order tanpa item (lihat M1) |
| 6 | Integrity Monitoring C1/C2/C3 | **PASS WITH LIMITATION** | C1/C2/C3 berjalan & tenant-scoped; F2 (deploy window) & F5/F6/F7 terbuka |
| 7 | Tenant & branch scope | **PASS WITH LIMITATION** | `restaurantId` dari sesi; filter branch konsisten setelah patch; `branchId NULL` dikecualikan saat filter branch (didokumentasikan) |
| 8 | Response API / empty / error state | **PASS WITH LIMITATION** | Inspeksi kode: `errorResponse`/`AppError` konsisten; empty-state UI ada; **HTTP terautentikasi belum diuji** |
| 9 | Regression perubahan accounting uncommitted | **PASS WITH LIMITATION** | Tidak ada regresi formula terdeteksi (lintas-laporan konsisten); risiko **deploy ordering** (schema+migration) |
| 10 | Unit test & coverage tersedia | **PASS WITH LIMITATION** | 67 tes murni lulus; **tidak ada** tes DB/service untuk profitability/P&L/report/cashbook/expense |

**Tidak ada BLOCKED di level kode.** Satu kondisi **DATA kritis** (tak dapat direkonstruksi) di §11.

---

## 3. Canonical Revenue & Refund — PASS

**FAKTA TERVERIFIKASI:**
- `src/services/report/report.service.ts`: `revenueWhere` (L199) = `reportBaseWhere` (`status != CANCELLED`) AND (`paymentStatus = PAID` OR ada payment `REFUNDED`); `revenueScopeWhere` (L220) = set yang sama tanpa batas tanggal (atribusi refund by `approvedAt`); `computeRefundRevenue` untuk net sales.
- Pemakaian: `getSalesReport` (L1250), `getProductReport` (L1758), `order.service.getDashboardStats` (L2035), `integrity.service` C1 (`revenueScopeWhere`) — **tidak ada predikat revenue kedua**.
- Konsistensi runtime lintas laporan (tenant A, custom 1 Sep–9 Okt 2026): Profitabilitas `totalSales=517000`, P&L `grossSales=517000`, Integrity C1 `headerValue=517000`, `orders=16` — **identik**. Net sales `487000` identik di Profitabilitas & P&L.
- Refund-aware: reversal tersedia (`cogsReversal`, `refundReversal`), `refundState` diekspos.

**LIMITATION:** Basis `cashier-sales` adalah pembatas historis (Phase 7/8) di luar scope D1/D2/Integrity; tidak diuji ulang di sini.

---

## 4. COGS Snapshot & Coverage — PASS WITH LIMITATION

**FAKTA TERVERIFIKASI:**
- Snapshot ditulis sekali pada transisi non-COMPLETED → COMPLETED, per item (`order.service.ts` ~L1722 → `createOrderItemCostSnapshots`), di transaksi yang sama; item berbiaya tak lengkap tetap dapat baris (HPP NULL).
- `coverage.ts`: `deriveCogsState` memetakan `totalItems === 0 → NO_ITEMS` (dicek sebelum `costed === total`); `isCoverageComplete` mensyaratkan `totalOrderItems > 0`; `isItemSetCoverageComplete` untuk kategori. Dipakai Profitabilitas **dan** Menu Engineering (satu sumber aturan).
- Runtime: coverage `{totalOrderItems:0, costed:0, uncosted:0, legacy:0, pending:0}` → `cogsState=NO_ITEMS`, `coverageComplete=false`, `grossProfit=null` (bukan `netSales − 0`).

**LIMITATION:** DB saat ini **0 snapshot** dan **1 orderitem**, sehingga jalur COVERED/PARTIAL/LEGACY/PENDING tidak dapat divalidasi dengan data nyata; hanya divalidasi via unit test murni.

---

## 5. Profitability Summary & Branch — PASS WITH LIMITATION

**FAKTA TERVERIFIKASI:**
- `summary.grossProfit` = `coverageComplete ? netSales − retainedCogs : null`; `foodCostPct`/`grossMarginPct` null saat tak lengkap.
- Branch breakdown ada: tenant A menghasilkan **2 baris cabang**; branch coverage memakai `deriveCogsState` per cabang.
- Runtime: `grossProfit=null`, `coverageComplete=false`, `cogsState=NO_ITEMS` — sesuai kaidah "COGS tak diketahui ≠ 0".

**LIMITATION:** branch dir dengan coverage tidak dapat diuji (snapshot 0).

---

## 6. P&L & Export — PASS

**FAKTA TERVERIFIKASI:**
- P&L mencompose engine kanonik: `grossSales/netSales/cogs/grossProfit` dari Profitabilitas; `netProfit = computeNetProfit(grossProfit, opex)` → null bila GP null.
- Runtime: `grossSales=517000`, `netSales=487000`, `cogs=0`, `grossProfit=null`, `operatingExpenses=0`, `netProfit=null`, `coverageComplete=false`, `cogsState=NO_ITEMS`.
- `disclosure`: `netProfitProvisional=true`, `expenseDataEmpty=true`, `purchaseExcluded=true`, `revenueWithoutItems={orders:16, headerValue:517000}`, `dateBasis` eksplisit.
- Export `GET /api/admin/accounting/pnl/export`: memakai **panggilan service yang sama** dengan list; `grossProfit ?? ""` dan `netProfit ?? ""` → **sel kosong, bukan 0**; `COGS_STATE_LABEL[NO_ITEMS]` diekspor; CSV helper anti formula-injection.

**LIMITATION:** belum ada tes otomatis untuk route export; diverifikasi lewat inspeksi kode.

---

## 7. Menu Engineering — PASS WITH LIMITATION

**FAKTA TERVERIFIKASI:**
- `buildSummary` memakai `isCoverageComplete` (D1) → `grossProfit=null` saat coverage tak lengkap; kategori memakai `isItemSetCoverageComplete`; klasifikasi & insight dari `menu-engineering.constants.ts` (diuji).
- Runtime: `totalNetSales=0`, `grossProfit=null`, `coverageComplete=false`, `productCount=6`.

**TEMUAN (M1, Medium):** `netSales` ME adalah **item-based** (Σ baris produk dengan `qtySold>0`) = **0**, sedangkan Profitabilitas/P&L `netSales` = **487000** (basis header order) untuk periode & tenant yang sama. Keduanya konsisten internal dan sama-sama menandai coverage tidak lengkap, tetapi **label "Net Sales" berbeda angka** pada kondisi order tanpa item (konsekuensi insiden D1/D2). ME juga **tidak** mengekspos disclosure `revenueWithoutItems`.

---

## 8. Accounting Integrity Monitoring (C1/C2/C3) — PASS WITH LIMITATION

**FAKTA TERVERIFIKASI:**
- C1 = `revenueScopeWhere` + `items:{none:{}}` → `orders=16`, `headerValue=517000`, status `CRITICAL` (sesuai disclosure Profitabilitas/P&L).
- C2 = item COMPLETED tanpa snapshot, dipisah `legacyExpected`/`anomaly`/`unknownCompletion` memakai cutoff **terbukti** (`20260911143644_f5_order_item_cost_snapshot`, `appliedAt=2026-09-11T16:06:57.831Z`), `codeDeployUnproven:true`; runtime `items=0`, status `OK`.
- C3 = rekonsiliasi relasional; invariant dipisah `BRANCH_SCOPED` vs `TENANT_WIDE` (patch F1); runtime `reconciled=true`, `branchReconciled=true`, `tenantReconciled=true`, counts `35/1/0`.
- Tenant B: seluruh 0 → isolasi tenant terbukti.

**LIMITATION:**
- **F2:** cutoff = waktu migration, **bukan** bukti waktu deploy engine; teramati completion nyata +7–11 menit pasca-cutoff → risiko false positive CRITICAL pada jendela deploy. `codeDeployUnproven:true` hanya menyatakan ketidakpastian, **bukan** bukti.
- **F5/F6/F7** terbuka (invariant mustahil di bawah FK; orphan `orderitem` tak terdeteksi; `SNAPSHOTS_EXCEED_ORDER_ITEMS` dapat double-report).
- **HTTP terautentikasi belum diuji.**

---

## 9. Tenant & Branch Scope — PASS WITH LIMITATION

**FAKTA TERVERIFIKASI:**
- `restaurantId` selalu dari sesi (`requireAdmin`/`requireRoles`); tidak pernah dari query/body.
- Integrity: setiap raw SQL berpredikat tenant; `orderitem` di-scope via `JOIN order`.
- Setelah patch F1, invariant yang punya relasi Order memakai scope Order/branch yang sama dengan `counts`; sample mengikuti scope; `snapBranchSql` dihapus.
- Runtime tenant B → 0 (tidak ada kebocoran).

**LIMITATION / RISIKO:** saat filter branch aktif, order dengan `branchId NULL` **dikecualikan** (kontrak `branchId IN (...)`); tenant A punya **1 order `branchId NULL`** → Σ cabang (22+12=34) ≠ total tenant (35). Konsisten dengan kontrak, tetapi harus dipahami operator. Jalur HTTP branch-scoped belum diuji.

---

## 10. Response API / Empty / Error State — PASS WITH LIMITATION

**FAKTA TERVERIFIKASI (inspeksi kode):**
- Route accounting memakai `successResponse`/`errorResponse` + `AppError` mapping (P&L, export, expenses, cashbook, integrity); `ValidationError` → 400 sebelum query.
- Empty/unknown ditangani eksplisit: `grossProfit/netProfit/margin/foodCost` = `null` → UI menampilkan peringatan (`profitability/page.tsx` L150/316–318/352; `accounting/pnl/page.tsx` L359–361/375–376; `menu-engineering/page.tsx` L176/357); CSV null → sel kosong.
- Integrity mengembalikan `status OK/WARN/CRITICAL/UNKNOWN` + `scopeNote`.

**LIMITATION:** tidak ada pengujian HTTP end-to-end (tanpa sesi); konsistensi error/empty hanya diverifikasi lewat kode.

---

## 11. Data Historis yang Belum Dapat Direkonstruksi — **KRITIS (DATA)**

**FAKTA TERVERIFIKASI (read-only DB):**
- **16 order ber-revenue tanpa OrderItem** (Rp517.000) pada tenant A; **0 baris `OrderItemCostSnapshot`**; **1 orderitem** tersisa; 0 order COMPLETED yang masih ber-item.
- Menurut D2, baris `OrderItem` hilang melalui restore/import logis (bukan jalur aplikasi); snapshot ikut ter-cascade.
- **Konsekuensi:** COGS historis order-order COMPLETED tersebut **tidak dapat direkonstruksi**; Gross/Net Profit untuk periode yang didominasi order-order itu **permanen `null`**; Menu Engineering `totalNetSales` bisa **0**.

**ATURAN yang dijaga:** sistem **tidak** memperlakukan revenue tanpa item sebagai COGS 0 / laba valid (`NO_ITEMS`, `grossProfit=null`, disclosure `revenueWithoutItems`). **Tidak** boleh backfill/recreate snapshot.

---

## 12. Regression Perubahan Accounting Uncommitted — PASS WITH LIMITATION

**FAKTA TERVERIFIKASI:**
- Permukaan uncommitted: 29 file tracked modified + `src/services/accounting/` (baru), `src/app/admin/accounting/` (baru), `src/app/api/admin/accounting/` (baru), migration `20261009_add_expense_management/`.
- File "shadow" (`report.service.ts`, `pnl.service.ts`, `cashbook.service.ts`, `profitability.service.ts`, `menu-engineering.service.ts`, `customer.service.ts`) adalah **client-side API wrapper**, bukan duplikasi logika server — **tidak ada** engine kedua.
- Konsistensi lintas-laporan pada runtime idenik untuk gross sales/net sales/C1 → tidak ada divergensi formula yang terdeteksi.

**TEMUAN (M3, Medium):** schema `+78` + migration Expense **belum di-commit**. Risiko **deploy ordering**: jika kode accounting di-deploy tanpa menjalankan `prisma migrate deploy` untuk `20261009_add_expense_management`, jalur Expense/P&L gagal. Migration bersifat additive (aman diterapkan lebih dulu).

---

## 13. Unit Test & Coverage yang Tersedia (hasil aktual)

Dijalankan pada audit ini (DB-free):

| File | Hasil |
|---|---|
| `src/services/profitability/coverage.unit.test.ts` | (D1) lulus |
| `src/services/accounting/integrity.unit.test.ts` | (F1–F4) lulus |
| `src/services/costing/historical-snapshot.unit.test.ts` | (G.1) lulus |
| `src/services/menu-engineering/menu-engineering.classify.unit.test.ts` | (F.6) lulus |
| **Total** | **67 pass / 67, 0 fail** (`tsx --test`) |

**Tidak dijalankan / tidak diklaim:** `tsc`/`build` (lulus pada fase patch sebelumnya; **tidak** dijalankan ulang di audit ini), tes DB/service accounting, tes otomatis route export/expense/cashbook, tes HTTP terautentikasi. **GAP:** tidak ada unit test untuk `profitability.service`, `accounting/pnl.service`, `report.service`, `cashbook.service`, `expense.service` (DB-bound). Pemeriksaan runtime di audit ini bersifat **read-only ad-hoc**, bukan test suite.

---

## 14. Temuan: Kritis / Medium / Low

### KRITIS
- **C-1 (DATA):** 16 order ber-revenue tanpa OrderItem (Rp517.000) + 0 snapshot → COGS & profit historis **tak dapat direkonstruksi**; periode terdampak permanen `grossProfit=null`. (Bukan bug kode; risiko bisnis/reporting.)

### MEDIUM
- **M1:** Menu Engineering `totalNetSales=0` vs Profitabilitas/P&L `netSales=487000` untuk periode & tenant sama (basis item vs header); ME tanpa disclosure `revenueWithoutItems`.
- **M2:** Klasifikasi `anomaly → CRITICAL` C2 bertumpu pada cutoff migration; waktu deploy engine **tidak terbukti** (ada aktivitas completion +7–11 menit pasca-cutoff).
- **M3:** Schema `+78` + migration Expense uncommitted → risiko deploy ordering.

### LOW
- **L1:** Invariant C3 bersifat defense-in-depth (4 mustahil di bawah FK/unique); orphan `orderitem` tanpa order tidak terdeteksi (tak dapat tenant-scope); `SNAPSHOTS_EXCEED_ORDER_ITEMS` dapat double-report.
- **L2:** Tidak ada tes otomatis service-level accounting (hanya aturan murni).
- **L3:** `branchId NULL` (1 order) di luar penjumlahan cabang (kontrak, perlu disosialisasikan).
- **L4:** Duplikasi nama file wrapper klien vs server berpotensi membingungkan (bukan bug).

---

## 15. Risiko Tenant / Branch

| Risiko | Status |
|---|---|
| Kebocoran antar-tenant | **Tidak ditemukan** — `restaurantId` dari sesi; raw SQL berpredikat tenant; tenant B = 0 |
| Kebocoran antar-cabang (Integrity) | **Diperbaiki (F1)** — sample mengikuti scope; tenant-wide sample hanya tanpa filter branch |
| `branchId NULL` tak terhitung di cabang | **Ada** (kontrak `branchId IN`); didokumentasikan di `scopeNote` |
| Jalur HTTP branch-scoped/admin | **Belum diuji** (limitasi, bukan asumsi lulus) |

---

## 16. Rekomendasi Prioritas & Dependensi

| Prioritas | Rekomendasi | Dependensi |
|---|---|---|
| **P1** | Perlakukan periode terdampak sebagai **COGS UNKNOWN**; jangan backfill/recreate snapshot; dokumentasikan ke operator | — (keputusan bisnis) |
| **P1** | Bila akan commit/deploy: jalankan migration `20261009_add_expense_management` **bersamaan** dengan schema/kode accounting | Persetujuan commit |
| **P2** | Tambah disclosure `revenueWithoutItems` (atau basis revenue seragam) di Menu Engineering; selaraskan label "Net Sales" | Keputusan reviewer (M1) |
| **P2** | Kumpulkan bukti waktu deploy engine snapshot (mis. timestamp startup / `MIN(snapshot.createdAt)`) atau tandai jendela pasca-cutoff sebagai WARN | Keputusan reviewer (M2) |
| **P3** | Tambah unit/integration test untuk `profitability.service`, `pnl.service`, export, cashbook, expense | — |
| **P3** | Tambah tes HTTP ber-sesi (ADMIN & branch-scoped) & seed uji untuk invariant C3 | Izin sesi/DB uji |
| **P3** | Bersihkan F5/F6/F7 (orphan item, double-report, invariant mustahil) | — |

---

## 17. Git Status Sesudah Audit

| Item | Sesudah |
|---|---|
| HEAD | `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (**tidak berubah**) |
| Modified tracked | **29** (tidak berubah) |
| Staged | **0** |
| Untracked | **60 → 61** (hanya +1 laporan ini) |
| Diff Prisma | **tidak berubah** (`+78/−0`) |

**Konfirmasi:** seluruh pemeriksaan bersifat read-only (`SELECT`/`grep`/`git` + pemanggilan service read-only); tidak ada DML/DDL/seed/migration/reset/backfill; tidak menyentuh OrderItem/snapshot; tidak mengubah revenue/payment/refund/COGS/P&L; tidak commit/push/deploy/VPS; tidak memulai Phase E; temp file audit dihapus.

---

## 18. Kesimpulan

Accounting **siap secara arsitektur** (revenue/refund kanonik tunggal, COGS-unknown tidak pernah jadi 0, P&L/export aman, Integrity tenant-scoped, konsistensi lintas-laporan terbukti). **Blocker sebenarnya bersifat DATA + proses**, bukan kode: COGS historis tak dapat direkonstruksi (16 order) dan permukaan accounting uncommitted (+migration) perlu urutan deploy yang benar. Medium terbuka: M1 (basis Menu Engineering), M2 (deploy-window cutoff), M3 (deploy ordering).

**STATUS: AUDIT SELESAI — STOP & tunggu review. Tidak ada implementasi temuan.**
