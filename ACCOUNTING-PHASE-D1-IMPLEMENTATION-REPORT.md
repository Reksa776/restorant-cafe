# ACCOUNTING PHASE D1 — COGS INTEGRITY FIX — IMPLEMENTATION REPORT

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) — tidak berubah sebelum/sesudah
**Mode:** Implementasi read-only yang **tidak menulis data**. Tanpa migration/schema baru, tanpa backfill, tanpa reset DB, tanpa commit/push/deploy.
**Tanggal:** 2026-10-09
**Basis:** `ACCOUNTING-PHASE-D1-COGS-INTEGRITY-AUDIT.md` (disetujui).

> **Legend bukti:** **[Source]** = kode. **[Test]** = runtime/unit yang dijalankan. **[NOT VERIFIED]** = tidak dapat diuji pada data/lingkungan ini.

---

## 1. Ringkasan

Memperbaiki integritas COGS sesuai audit D1: **scope kosong (`totalItems === 0`) tidak lagi dianggap COVERED**. COGS yang tidak dapat diverifikasi kini ditandai `NO_ITEMS`, `coverageComplete = false`, dan **Gross Profit / Net Profit = null** (bukan `revenue − 0`). Perbaikan diterapkan konsisten pada Profitabilitas (summary + cabang + produk), P&L, Menu Engineering (summary + kategori), UI, dan CSV.

**Aturan yang dipertahankan:** HPP nol yang **valid** (`SNAPSHOTTED` dengan `hppTotal = 0`) tetap dianggap covered (status, bukan nilai uang, yang menentukan coverage). Mesin snapshot, refund, payment, order, dan data historis **tidak disentuh**.

**Hasil runtime (data aktual, sebelum ⇄ sesudah):**

| Metrik (Profitabilitas custom Sep–Okt) | Sebelum | Sesudah |
|---|---|---|
| Net Sales | 487.000 | 487.000 |
| COGS (retained) | 0 | 0 |
| Gross Profit | **487.000** (margin 100%) | **null** (tidak diketahui) |
| Gross Margin / Food Cost | 100% / 0% | null / null |
| `coverageComplete` | **true** | **false** |
| `cogsState` | **COVERED** | **NO_ITEMS** |
| P&L Net Profit | **487.000** | **null** |

---

## 2. Keputusan desain

1. **Satu sumber kebenaran coverage.** Logika coverage diekstrak ke modul murni `src/services/profitability/coverage.ts` (tanpa DB) dan dipakai Profitabilitas **dan** Menu Engineering, sehingga keputusan "COGS diketahui?" tidak bisa berbeda antar laporan.
2. **State baru `NO_ITEMS`.** Ditambahkan ke union `ProfitabilityCogsState` (bukan nilai DB — tanpa migration). `deriveCogsState` memeriksa `totalItems === 0` **sebelum** `costed === totalItems`, dikembalikan `"NO_ITEMS"`.
3. **Guard eksplisit.** `coverageComplete` summary kini `totalItems > 0 && (uncosted+legacy+pending === 0)` — menyamakan dengan level produk/cabang yang sudah punya guard. Level produk & cabang dipertahankan apa adanya (sudah benar).
4. **Null-aware terus.** Karena `coverageComplete = false`, Gross Profit (`coverageComplete ? … : null`) otomatis `null`; `computeNetProfit(null, opex)` → `null`. Tidak ada `revenue − 0`.
5. **Disclosure integritas.** Ditambahkan agregat server-side read-only: jumlah order ber-revenue **tanpa baris item** + nilai header-nya (`revenueWithoutItems`), di Profitabilitas dan P&L.
6. **Zero valid tidak diubah.** `costed` tetap dihitung dari `status='SNAPSHOTTED'`; snapshot `SNAPSHOTTED` bernilai 0 tetap `COVERED` dan profitnya tetap dihitung.

---

## 3. Files changed & alasan

### Baru (3)
| File | Alasan |
|---|---|
| `src/services/profitability/coverage.ts` | Aturan coverage murni/no-DB: `deriveCogsState` (≥ `NO_ITEMS`), `isCoverageComplete`, `isItemSetCoverageComplete`. Dipakai Profitabilitas + Menu Engineering. |
| `src/services/accounting/pnl.rules.ts` | `computeNetProfit` dipindah ke modul murni agar dapat diuji deterministik tanpa import `prisma`. |
| `src/services/profitability/coverage.unit.test.ts` | Regression test D1 (15 test). |

### Diubah — tracked (6)
| File | Perubahan | Alasan |
|---|---|---|
| `src/services/profitability/profitability.service.ts` | Hapus `deriveCogsState` lokal → import dari `./coverage`; summary `coverageComplete = isCoverageComplete(cov)`; tambah query agregat `revenueWithoutItems`; expose di `summary`. | Bug #1, #2 + disclosure |
| `src/services/profitability/profitability.types.ts` | Tambah `"NO_ITEMS"` ke `ProfitabilityCogsState`; tambah `summary.revenueWithoutItems`. | Kontrak tipe |
| `src/services/menu-engineering/menu-engineering.service.ts` | `buildSummary` pakai `isCoverageComplete(coverage)`; `buildCategorySummary` pakai `isItemSetCoverageComplete({...})`. | Bug #3 |
| `src/app/admin/profitability/page.tsx` | Badge `NO_ITEMS`; banner "COGS belum dapat diverifikasi (0 item)" + disclosure order-tanpa-item. | UI konsisten |
| `src/app/admin/menu-engineering/page.tsx` | Banner "COGS belum dapat diverifikasi (0 item)". | UI konsisten |
| `src/app/api/reports/profitability/export/route.ts` | `COGS_STATE_LABEL.NO_ITEMS` (null profit tetap sel kosong). | CSV konsisten |

### Diubah — berkas Phase D yang sudah uncommitted/untracked (4)
| File | Perubahan |
|---|---|
| `src/services/accounting/pnl.service.ts` | `computeNetProfit` diimpor dari `./pnl.rules` (tetap di-re-export); `disclosure.revenueWithoutItems = s.revenueWithoutItems`. |
| `src/services/accounting/pnl.types.ts` | Tambah `disclosure.revenueWithoutItems`. |
| `src/app/admin/accounting/pnl/page.tsx` | Badge `NO_ITEMS`; banner khusus scope kosong; banner "COGS tidak lengkap" hanya saat `totalOrderItems > 0`. |
| `src/app/api/admin/accounting/pnl/export/route.ts` | `COGS_STATE_LABEL.NO_ITEMS`; tambah kolom "Order Revenue Tanpa Item" & "Nilai Header Tanpa Item" (additive); null profit tetap sel kosong. |

**Tidak diubah:** `prisma/schema.prisma`, migration, `historical-snapshot.ts`, `computeRefundAware`, definisi revenue kanonik, `order`/`payment`/`refund`/`approval`, `dashboard-analytics.tsx` (sudah menangani `!coverageComplete`).

Total tracked: `6 files changed, 88 insertions(+), 32 deletions(-)`.

---

## 4. Perilaku sebelum ⇄ sesudah

### 4.1 Aturan coverage (unit-level)
| Skenario | Sebelum | Sesudah |
|---|---|---|
| 0 item dalam scope | `COVERED`, `coverageComplete=true`, GP = netSales | **`NO_ITEMS`, `coverageComplete=false`, GP=null** |
| Semua item `SNAPSHOTTED` (termasuk HPP 0) | `COVERED`, GP dihitung | **tetap `COVERED`, GP dihitung** (tidak berubah) |
| Sebagian costed | `PARTIAL`, GP=null | tetap sama |
| Pending / uncosted / legacy | status masing-masing, GP=null | tetap sama |

### 4.2 Runtime (service sebenarnya, data aktual) — **[Test]**
`getProfitabilityReport(RID, "custom", 2026-09-01…2026-10-31)`:
```
before: cogs=0, grossProfit=487000, grossMarginPct=100, coverageComplete=true,  cogsState=COVERED
after : cogs=0, grossProfit=null,   grossMarginPct=null, coverageComplete=false, cogsState=NO_ITEMS
        coverage.totalOrderItems=0
        revenueWithoutItems={ orders:16, headerValue:517000 }
        branches: [{cogs:0,grossProfit:null,coverageComplete:false,cogsState:NO_ITEMS},
                   {cogs:0,grossProfit:null,coverageComplete:false,cogsState:NO_ITEMS}]
```
`getPnlReport(RID, custom Sep–Okt)`:
```
after: grossSales=517000, netSales=487000, cogs=0,
       grossProfit=null, netProfit=null, coverageComplete=false, cogsState=NO_ITEMS,
       disclosure.revenueWithoutItems={ orders:16, headerValue:517000 }
```
`menuEngineeringService.getMenuEngineeringReport(custom Sep–Okt)`:
```
after: totalNetSales=0, grossProfit=null, coverageComplete=false, emptyCategories=3
```

**Catatan:** `cogs` tetap `0` karena ia adalah **jumlah COGS yang covered** (0 item = 0). Yang membuat laporan tidak menyesatkan adalah `coverageComplete=false` + `cogsState=NO_ITEMS` + GP/NP `null` + disclosure.

---

## 5. Regression tests & hasil aktual

File: `src/services/profitability/coverage.unit.test.ts` — dijalankan `npx tsx --test`.

```
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

| # | Skenario diminta | Test | Hasil |
|---|---|---|---|
| 1 | 0 item → coverage tidak lengkap, GP/NP tidak diketahui | `deriveCogsState()` → NO_ITEMS; `isCoverageComplete(0 item)` → false; `computeNetProfit(null, …)` → null | **PASS** |
| 2 | Item tersnapshot HPP valid 0 → coverage tetap lengkap | `deriveCogsState({total:3,costed:3})` → COVERED; `isCoverageComplete({total:4,costed:4})` → true | **PASS** |
| 3 | Item tersnapshot HPP positif → normal | `deriveCogsState({total:3,costed:3})` COVERED; `computeNetProfit(100000,25000)=75000`; `computeNetProfit(487000,0)=487000` | **PASS** |
| 4 | Pending/uncosted → tidak covered | `PENDING_COGS`, `UNCOVERED`, `LEGACY`; `isCoverageComplete` false | **PASS** |
| 5 | Menu Engineering 0 item | `isItemSetCoverageComplete(0 item)` → false; costed-only → true; uncosted/pending → false | **PASS** |
| 6 | CSV null tidak jadi nol | `buildCsv(["grossProfit","cogs"],[[null,0]])` === `"\uFEFFgrossProfit,cogs\r\n,0"`; assert `!includes(",0,0")` | **PASS** |

**Uji existing (tidak regresi):** `historical-snapshot.unit.test.ts` **8/8 PASS**; `menu-engineering.classify.unit.test.ts` **31/31 PASS**.

**[NOT VERIFIED]:** skenario data dengan snapshot `SNAPSHOTTED` bernilai 0 nyata — tidak ada di DB saat ini; aturan zero-valid diverifikasi deterministik via unit test.

---

## 6. Verifikasi static

| Perintah | Exit | Hasil |
|---|---|---|
| `npx tsc --noEmit` | **0** | 0 error |
| `npm run build` | **0** | Sukses; rute relevan terkompilasi: `/admin/accounting/pnl`, `/admin/menu-engineering`, `/admin/profitability`, `/api/admin/accounting/pnl(/export)`, `/api/reports/profitability(/export)`, `/api/reports/menu-engineering(/export)`. Hanya **6 warning Turbopack pre-existing** (dynamic fs access pada upload handler) — tidak terkait D1. |
| `git diff --check` | **0** | Bersih |
| `npx tsx --test coverage.unit.test.ts` | **0** | 15/15 pass |
| `npx tsx --test historical-snapshot + menu-engineering.classify` | **0** | 8/8 + 31/31 pass |

Tidak ada build lain berjalan sebelum `npm run build` (`ps … next build` = 0).

---

## 7. Konfirmasi schema & data tidak berubah

- `git diff --numstat -- prisma/` → **`78  0  prisma/schema.prisma`** (identik dengan baseline) → **tidak ada perubahan schema**.
- Tidak ada migration baru; tidak ada file di `prisma/migrations/` yang disentuh.
- **Tidak ada tulis/baca-modifikasi data**: seluruh pemeriksaan runtime memakai `SELECT` (via service) dan `aggregate` read-only. Tidak ada INSERT/UPDATE/DELETE/DDL, tidak ada reset DB, tidak ada backfill.
- Mesin snapshot (`historical-snapshot.ts`), `computeRefundAware`, payment/order/refund/approval **tidak diubah**. **[Source]**
- Definisi revenue kanonik (`computeRefundRevenue`) **tidak diubah`. **[Source]**

---

## 8. Git status & perubahan `prisma/`

| Item | Sebelum D1 | Sesudah D1 |
|---|---|---|
| HEAD | `d7f29ac` | `d7f29ac` (tidak berubah) |
| Modified (tracked) | 23 | **29** (+6 berkas D1) |
| Staged | 0 | 0 |
| Untracked | 52 | **55** (+`coverage.ts`, `coverage.unit.test.ts`, laporan ini) |
| `prisma/` numstat | `78  0` | `78  0` (tidak berubah) |
| Deleted / renamed | 0 | 0 |

Berkas tracked yang berubah karena D1 (6): `profitability.service.ts`, `profitability.types.ts`, `menu-engineering.service.ts`, `app/admin/profitability/page.tsx`, `app/admin/menu-engineering/page.tsx`, `app/api/reports/profitability/export/route.ts`.
Berkas **untracked (Phase D)** yang diedit (4): `accounting/pnl.service.ts`, `accounting/pnl.types.ts`, `app/admin/accounting/pnl/page.tsx`, `app/api/admin/accounting/pnl/export/route.ts` (tidak menambah hitungan untracked).
Harness temp (`_d1verify.ts`) dan probe `/tmp` **dihapus**.

Seluruh pekerjaan existing & uncommitted dipertahankan.

---

## 9. Risiko yang belum terselesaikan

| # | Risiko | Status |
|---|---|---|
| R1 | **Provenance data** mengapa order ber-revenue kehilangan baris item — **di luar scope** D1 (dilarang diinvestigasi). D1 hanya menampilkan disclosure (`revenueWithoutItems`). | **[NOT VERIFIED]** — sengaja tidak diselesaikan |
| R2 | `cogsState` kini punya nilai baru `NO_ITEMS`. Consumer CSV/eksternal yang memetakan status secara ketat bisa melihat label baru. | Mitigasi: label ditambahkan di semua peta internal (`COGS_STATE_LABEL`, badge). Perubahan additive. |
| R3 | `cogs` tetap 0 saat `NO_ITEMS`. Bisa terlihat seperti "COGS nol" bila label/banner diabaikan. | Mitigasi: `coverageComplete=false`, `cogsState=NO_ITEMS`, GP/NP `null`, banner UI + kolom CSV. |
| R4 | Deduksi "0 item" bergantung pada revenue set berbasis `orderitem`. Order ber-revenue tanpa item kini terlihat, bukan diperbaiki. | Disclosure eksplisit; bukan perbaikan data. |
| R5 | Uji browser/E2E tidak dijalankan. | **[NOT VERIFIED]** — diverifikasi lewat pemanggilan service nyata + unit test + build. |
| R6 | Skenario zero-valid & pending nyata tidak ada di DB. | Diverifikasi unit test + invarian kode; **[NOT VERIFIED]** pada data. |

---

## 10. Konfirmasi guardrail

- Tidak menghapus/mereset data; tidak mengubah `prisma/schema.prisma` atau migration; tidak ada migration/backfill/reset.
- Tidak commit/push/deploy/VPS; tidak menjalankan Phase E.
- Tidak menghapus/menimpa pekerjaan existing; working tree dipertahankan.
- Tidak mengubah mesin snapshot, refund calculation, payment, order, atau data historis.
- Zero valid (`SNAPSHOTTED`, `hppTotal = 0`) tetap covered.

**STOP** — implementasi & laporan selesai. Menunggu review. Tidak memulai Phase berikutnya.
