# ACCOUNTING — PHASE D: PROFIT & LOSS — IMPLEMENTATION REPORT

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) ✅ tidak berubah sebelum/sesudah
**Mode:** Implementasi P&L sebagai **read-model komposisi**. Tanpa migration, tanpa perubahan `prisma/schema.prisma`, tanpa tulis DB/data historis, tanpa commit/push/deploy.
**Tanggal:** 2026-10-09
**Referensi:** `ACCOUNTING-PHASE-D-AUDIT.md` (disetujui).

> **Legend bukti:** **[Source]** = kode/schema. **[Test]** = runtime read-only (SELECT) via harness `_accDverify.ts` yang dijalankan lalu **dihapus**. **[NOT VERIFIED]** = skenario tidak dapat diuji karena data/sesi.

---

## 1. File yang dibuat / diubah

### Baru (6)
| File | Isi |
|---|---|
| `src/services/accounting/pnl.types.ts` | Schema Zod (`PnlQuerySchema`) + tipe hasil (`PnlReport`, `PnlSummary`). |
| `src/services/accounting/pnl.service.ts` | Read-model P&L: komposisi Profitabilitas + agregasi Expense; helper `computeNetProfit` (null-aware). |
| `src/services/pnl.service.ts` | Client wrapper (axios), pola `cashbook.service.ts`. |
| `src/app/api/admin/accounting/pnl/route.ts` | `GET` list (ADMIN-only). |
| `src/app/api/admin/accounting/pnl/export/route.ts` | `GET` CSV (ADMIN-only, scope sama). |
| `src/app/admin/accounting/pnl/page.tsx` | Halaman `/admin/accounting/pnl`. |

### Diubah (1, tracked)
| File | Perubahan |
|---|---|
| `src/app/admin/layout.tsx` | +2 baris: `// ACCOUNTING PHASE D …` + entri nav **"Laba Rugi"** (`/admin/accounting/pnl`, ikon `TrendingUp`, `roles:["ADMIN"]`) di grup **Finance**. (Ikon `TrendingUp` sudah diimpor sebelumnya.) Diff total file = 7 insertions (mencakup PHASE B/C/D; PHASE D menambah 2). |

### Tidak diubah (dikonfirmasi)
`prisma/schema.prisma` (tetap `78/0`), `report/report.service.ts` (engine kanonik), `profitability/profitability.service.ts` (COGS/gross profit), `accounting/expense.service.ts`, `accounting/cashbook.service.ts` & `cashbook/export/route.ts` (**hash identik** dengan sesudah patch PHASE C: `19cade79…` / `1d4e8c72…`), `approval`, `payment`, `order`, `cashier-sales`. **[Source]**

---

## 2. Arsitektur & fungsi existing yang digunakan kembali

P&L **tidak membuat engine baru**. Alurnya:

```
getPnlReport(restaurantId, query, branchFilters)
        │
        ├─ resolveReportRange(period, startDate, endDate)        ← report.service.ts (kanonik)
        │
        ├─ profitabilityService.getProfitabilityReport(...)      ← COGS, coverage, refund reversal,
        │      └─ computeRefundRevenue / OrderItemCostSnapshot      NET SALES, GROSS PROFIT
        │
        └─ prisma.expense.aggregate/groupBy (scoped + periode)   ← Expense PHASE B → Operating Expenses
                                                                    → Net Profit = GP − Opex (null-aware)
```

- **Revenue / Net Sales** → `computeRefundRevenue` via Profitabilitas (`netSales` kanonik, basis produk).
- **Gross Sales** → `summary.totalSales` (alias `grossRevenue`, Σ `grandTotal` atas revenue set).
- **COGS / reversal / coverage / Gross Profit** → Profitabilitas (`retainedCogs = historicalCogs − cogsReversal`; `grossProfit` **null** bila coverage tidak lengkap).
- **Operating Expenses** → agregasi `Expense` (tenant + branch scoped) dengan batas `spentAt` **diselaraskan** ke range report memakai semantik hari-lokal yang sama dengan modul Expense (`startOfLocalDay`/`endOfLocalDay`) — **tidak mengubah basis tanggal existing**.
- **Net Profit** = `grossProfit − opex`, atau **null** bila `grossProfit` null. Diimplementasikan sebagai fungsi murni `computeNetProfit` agar dapat diuji deterministik.
- **Purchase tidak pernah** dimasukkan sebagai Opex (`disclosure.purchaseExcluded = true`).

`pnl.types.ts` hanya mengimpor **tipe** dari Profitabilitas (erased di client bundle); `pnl.service.ts` dijalankan server-side.

---

## 3. Hasil seluruh test (dengan status)

Harness read-only `_accDverify.ts` → **TOTAL 23, PASS 23, FAIL 0, HARNESS_EXIT=0**. (Harness dihapus setelah dipakai.)

```
PNL_ALL={"grossSales":517000,"netSales":487000,"cogs":0,"grossProfit":487000,
         "opex":0,"netProfit":487000,"coverageComplete":true,"cogsState":"COVERED","opexCount":0}
```

| # | Uji diminta | Hasil | Bukti |
|---|---|---|---|
| 1 | Gross Profit P&L == Profitabilitas (scope identik) | **PASS** | T1 `[487000 vs 487000]` |
| 2 | Net Sales P&L == kanonik Sales Report | **PASS** | T2 `[487000 vs 487000]`; T2b grossSales==totalSales `[517000]` |
| 3 | Opex == Σ Expense (periode/tenant/branch) | **PASS** | T3 `[pnl=0/0 raw=0/0]` |
| 4 | Net Profit == Gross Profit − Opex | **PASS** | T4 `[487000]` + T5d unit |
| 5 | Coverage tidak lengkap ⇒ GP & NP `null` | **PASS (rule)** + **NOT VERIFIED (data)** | T5a/T5b invariant PASS; T5d `computeNetProfit(null,1000)===null` PASS; **T5c NOT VERIFIED** — tidak ada order PAID-not-COMPLETED ber-item tanpa snapshot di data |
| 6 | Fully refunded COMPLETED pertahankan perilaku refund/COGS | **PASS** | T6 `[gp 30000 vs 30000; ns 30000 vs 30000]` (komposisi == Profitabilitas) |
| 7 | Refund periode berbeda ikut basis `approvedAt` | **PASS (in-period)** + **NOT VERIFIED (cross-period)** | T7a `[refund=30000, pnlRefund=30000 @2026-09-07]`; **T7b NOT VERIFIED** — order day == approval day (2026-09-07) |
| 8 | CANCELLED & unpaid ikut revenue set kanonik | **PASS** | T8 today/week/month/custom `[ns 487000/487000, gs 517000/517000]`; `CANCELLED_ORDERS=7, NON_REVENUE_ORDERS=13` |
| 9 | Isolasi tenant & branch | **PASS** | T9a `[main=150000 < all=517000]`; T9b foreign tenant semua 0 |
| 10 | CSV == list (filter sama) | **PASS** | T10a deterministik identik; T10b header cols==row cols `[20/20]`; T10c null→sel kosong, 0 tetap 0 |
| 11 | Tidak ada regression Sales Report & Profitabilitas | **PASS** | T11 `[517000/30000/487000]`; Profitabilitas net == Sales net `[487000]` |
| 12 | `tsc` / `build` / `git diff --check` | **PASS** | lihat §5 |

**NOT VERIFIED (dilaporkan jujur, bukan PASS):**
- **T5c** — memaksa scope `PENDING_COGS`/coverage tidak lengkap: **tidak ada data** (restaurant A all-time `cogsState=COVERED`). Aturan null tetap diverifikasi deterministik (T5d) + invariant (T5a/T5b).
- **T7b** — refund lintas periode: order & approval pada hari yang sama (2026-09-07), sehingga aspek lintas-periode tidak terpicu.
- Uji runtime non-admin 403 (butuh sesi NextAuth) — hanya **[Source]** (`requireAdmin`).
- UI interaktif di browser — tidak dijalankan; halaman lolos typecheck & build.

---

## 4. Perbandingan angka P&L vs Sales Report vs Profitabilitas

| Metrik | P&L (all-time) | Sales Report | Profitabilitas | Selisih |
|---|---|---|---|---|
| Gross Sales / totalSales | 517000 | 517000 | 517000 (`totalSales`) | 0 |
| Refund | 30000 | 30000 | 30000 (`refundReversal`) | 0 |
| Net Sales | 487000 | 487000 | 487000 | 0 |
| COGS (ditahan) | 0 | — | 0 (`retainedCogs`) | 0 |
| Gross Profit | 487000 | — | 487000 | 0 |
| Operating Expenses | 0 | — | — (tidak ada di Profitabilitas) | — |
| Net Profit | 487000 | — | — | — |

Cabang MAIN: Gross Sales pnl = 150000 (< all 517000). Foreign tenant B: semua 0.

**Catatan angka:** `cogs = 0` **bukan** artefak P&L — ia mewarisi Profitabilitas (`OrderItemCostSnapshot.hppTotal` saat ini 0 pada data uji dengan `coverageComplete=true`). Karenanya Gross Profit = Net Sales dan Net Profit = Gross Profit (karena Expense 0 baris). Ini konsisten 1:1 dengan halaman Profitabilitas. **[Test]**

---

## 5. Verifikasi static

| Perintah | Exit status | Hasil |
|---|---|---|
| `npx tsc --noEmit` | **0** | 0 error |
| `npm run build` (tanpa build lain berjalan) | **0** | Sukses; 3 rute P&L terkompilasi (`/admin/accounting/pnl`, `/api/admin/accounting/pnl`, `/api/admin/accounting/pnl/export`). Hanya 6 warning Turbopack pre-existing (dynamic fs pada upload handler) — tidak terkait PHASE D |
| `git diff --check` | **0** | Bersih |

---

## 6. Risiko & keterbatasan

- **Net Profit belum final (disclosure wajib).** Hanya `Expense` yang dihitung sebagai biaya operasional; payroll/sewa/penyusutan/dll. belum tercatat. UI menampilkan peringatan; `disclosure.netProfitProvisional = true` selalu.
- **Expense kosong (0 baris) saat ini** → Net Profit == Gross Profit; UI menampilkan banner ("belum ada pengeluaran"). `disclosure.expenseDataEmpty`.
- **COGS coverage** diwarisi; bila tidak lengkap → Gross Profit & Net Profit `null` ("Tidak diketahui"), **bukan** dihitung dengan HPP 0.
- **Basis tanggal campur** (revenue `order.createdAt`; refund `refund.approvedAt`; COGS `order.createdAt`; expense `spentAt`) — didokumentasikan di UI & `disclosure.dateBasis`.
- **Refund COGS**: partial refund melepas COGS, full refund menahan seluruh COGS (perilaku existing dipertahankan, tidak diubah).
- **Purchase bukan Opex** (double-count dihindari).
- **Batas periode Expense** diselaraskan hari-lokal tanpa mengubah basis existing.
- **Regresi:** risiko rendah — seluruh engine existing tidak disentuh; P&L murni menambah service/route/page + 1 entri nav. Test #1/#2/#11 membuktikan keselarasan 1:1.
- **Interpretasi "Gross Sales":** memakai `totalSales` (Σ `grandTotal`, termasuk pajak & service), sesuai audit §2; Net Sales tetap basis produk kanonik (keduanya ditampilkan terpisah).
- **Belum terverifikasi:** non-admin runtime; UI browser; skenario data T5c/T7b.

---

## 7. Dampak database / migration

**TIDAK ADA migration / perubahan schema / tulis data.** P&L adalah read-model atas tabel existing (`order`, `orderitem`, `orderitemcostsnapshot`, `refund`, `refunditem`, `payment`, `expense`). `git diff --numstat -- prisma/` tetap `78  0  prisma/schema.prisma`. **[Source]**

---

## 8. Git status sebelum / sesudah

| Item | Sebelum | Sesudah |
|---|---|---|
| HEAD | `d7f29ac` | `d7f29ac` (tidak berubah) |
| Modified (tracked) | 23 | 23 |
| Untracked | 49 | 50 (+`src/services/pnl.service.ts`; file P&L lain berada di direktori untracked yang sudah ada) |
| Staged | 0 | 0 |
| Deleted | 0 | 0 |
| `prisma/` numstat | 78/0 | 78/0 (tidak berubah) |

`find src prisma -newermt` (60 menit) → hanya file P&L baru + `layout.tsx`; dua file cashbook yang tampak adalah artefak patch PHASE C sebelumnya dan **hash-nya tidak berubah** (`19cade79…`, `1d4e8c72…`). Harness temp `_accDverify.ts` dihapus (`_acc*.ts`/`_p9b*.ts` → none). Working tree tidak dibersihkan/diubah; seluruh pekerjaan existing & uncommitted utuh.

---

## 9. Konfirmasi guardrail

- Tidak membuat duplicate revenue/refund/COGS/profitability/Expense/Cashbook engine.
- Tidak mengubah definisi/angka report existing (Sales 517000/30000/487000, Profitabilitas tetap).
- Tidak ada migration / perubahan `prisma/schema.prisma`.
- Purchase tidak dimasukkan sebagai Operating Expense.
- Coverage tidak lengkap ⇒ Gross Profit & Net Profit `null`.
- `restaurantId` dari sesi, ADMIN authorization, branch scoping existing (`requireAdmin` + `assertBranchInScope` + `authorizedBranches`).
- Batas tanggal Expense diselaraskan tanpa mengubah basis tanggal existing.
- Aturan refund & fully refunded order tidak diubah.
- Fitur PHASE 4–9B / Cashier / Payment / iPaymu / WhatsApp tidak diubah.
- Tidak ada commit/push/deploy/ubah VPS/reset DB; working tree dipertahankan.

**STOP** — implementasi & verifikasi selesai. Tidak melanjutkan ke PHASE E, tanpa commit/push/deploy.
