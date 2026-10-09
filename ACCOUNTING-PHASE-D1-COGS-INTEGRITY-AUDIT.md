# ACCOUNTING PHASE D1 — COGS ZERO-VALUE INTEGRITY AUDIT

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) — tidak berubah sebelum/sesudah audit
**Mode:** **AUDIT ONLY (read-only)**. Tanpa coding, tanpa perubahan source/schema/migration/konfigurasi, tanpa tulis DB, tanpa reset DB, tanpa commit/push/deploy/VPS.
**Tanggal:** 2026-10-09
**Referensi kode:** `src/services/costing/historical-snapshot.ts`, `src/services/profitability/profitability.service.ts`, `src/services/profitability/profitability.types.ts`, `src/services/accounting/pnl.service.ts`, `src/services/menu-engineering/menu-engineering.service.ts`, `prisma/schema.prisma`, `src/services/order/order.service.ts`.

> **Legend bukti:** **[Source]** = kode/schema diperiksa langsung. **[Test]** = runtime read-only (SELECT) / pemanggilan service sebenarnya. **[NOT VERIFIED]** = tidak dapat dipastikan dari lingkungan/data ini — jangan dianggap PASS.

---

## 0. Ringkasan eksekutif

**Gejala yang dilaporkan:** P&L/Profitabilitas menampilkan `cogs = 0`, `coverageComplete = true`, `cogsState = "COVERED"`, sehingga Gross Profit = Net Sales.

**Temuan utama (CONFIRMED):** Di lingkungan data saat ini, angka tersebut **bukan** akibat "semua item punya snapshot HPP bernilai nol". Yang terjadi adalah **tidak ada satu pun baris `orderitem` di dalam revenue set** (0 item), dan **tabel `orderitemcostsnapshot` kosong (0 baris)**. Akibatnya:

1. COGS = `SUM(hppTotal WHERE status='SNAPSHOTTED')` atas 0 item → **0**.
2. `coverageComplete` level **summary** dihitung `(uncosted + legacy + pending === 0)` — **tanpa guard `totalItems > 0`** — sehingga **benar secara hampa (vacuous)** ketika tidak ada item.
3. `deriveCogsState()` mengembalikan **`"COVERED"`** ketika `totalItems === 0`.
4. Gross Profit = `netSales − retainedCogs` = `netSales − 0` → **tampak 100% margin**.

**Reproduksi aktual (memanggil service sebenarnya, read-only):** periode `custom` 2026-09-01…2026-10-31 →
`netSales=487000, cogs=0, grossProfit=487000, grossMarginPct=100, foodCostPct=0, coverageComplete=true, cogsState="COVERED", coverage.totalOrderItems=0`. P&L: `netProfit=487000`. Ini persis mereproduksi gejala. **[Test]**

**Inkonsistensi internal yang membuktikan cacat logika:** pada data yang sama, **baris per-cabang** melaporkan `coverageComplete=false` **tetapi** `cogsState="COVERED"` dan `cogs=0`. Level produk/cabang sudah memakai guard `totalItems > 0 && costed === totalItems`; level **summary tidak**. **[Source][Test]**

**Zero valid vs belum tersedia:** kode **memang** tidak pernah mengubah HPP tak tersedia menjadi `0` (status `NULL`). Namun **agregat `cogs`** memakai `COALESCE(..., 0)`, sehingga dari angka `cogs` saja **tidak bisa** membedakan "benar-benar nol" dari "tak ada data". Hanya `coverage` yang membedakannya — dan di jalur summary, `coverage` itu justru ter-kosong-hampa.

**Sifat temuan:** ada **dua lapis** — (A) kondisi **data** (order ber-revenue tanpa baris item & tanpa snapshot) dan (B) **cacat logika** summary (vacuous coverage). Keduanya harus ditangani agar GP/NP tidak menyesatkan.

---

## 1. Metodologi & bukti

- **Source inspection** atas jalur snapshot → COGS → Gross Profit → P&L (daftar file di atas). **[Source]**
- **Query read-only (SELECT)** langsung ke DB MySQL `restaurant_app` via harness sementara (`_accD1audit.mjs`) yang **dijalankan lalu dihapus**. Tidak ada INSERT/UPDATE/DELETE/DDL. Tidak ada credential/personal data yang ditampilkan (hanya agregat + id/nama entitas bisnis). **[Test]**
- **Reproduksi service sebenarnya** (`profitabilityService.getProfitabilityReport`, `getPnlReport`) via harness sementara (`_accD1verify.ts`) yang juga **dihapus**. **[Test]**

---

## 2. Cara `OrderItemCostSnapshot` dibuat & bagaimana `hppTotal` dihitung

**[Source]** `src/services/costing/historical-snapshot.ts`:

- Snapshot dibuat **hanya sekali**, di dalam transaksi ter-guard `READY → COMPLETED` (`src/services/order/order.service.ts` memanggil `createOrderItemCostSnapshots` pada blok COMPLETED). Tidak ada endpoint yang menulis ulang snapshot.
- `computeHistoricalHpp()`:
  - **MANUAL** (`BranchProduct.costingMode = 'MANUAL'`) → `hpp = BranchProduct.manualHpp`; `manualHpp = 0` **valid** (status `SNAPSHOTTED`), `null` → `MISSING_WAC` (bukan 0). Recipe/WAC diabaikan.
  - **INGREDIENT** → `hpp = Σ(RecipeItem.quantity × BranchIngredient.averageCost)` untuk recipe **aktif saat completion**. Recipe kosong/tiada → `NO_RECIPE`; ingredient non-aktif → `INACTIVE_INGREDIENT`; BranchIngredient/WAC hilang → `MISSING_WAC`; tanpa branch → `NO_BRANCH`. **Semua status ini menyimpan `hppUnit/hppTotal = NULL`, tidak pernah 0.**
  - `averageCost = 0` (WAC nol) → **`SNAPSHOTTED` dengan HPP 0** — zero valid.
- `buildSnapshotRows()` → `hppUnit = hpp`; `hppTotal = hppUnit × OrderItem.quantity` (dibulatkan `ROUND_HALF_UP`, 2 dp). Addon/option mini-BOM (H4.3) ditambahkan; selection tidak lengkap → `NULL` (bukan base-only, bukan 0).
- Satu snapshot per `OrderItem` (`orderItemId @unique`). `OrderItemCostSnapshot.orderItem` memakai **`onDelete: Cascade`**. **[Source]**

**Kesimpulan §2:** secara desain, "belum tersedia" **tidak** pernah ditulis sebagai 0; hanya WAC/manual yang benar-benar nol yang menghasilkan snapshot `SNAPSHOTTED` bernilai 0.

---

## 3. Temuan data aktual (agregat aman, tanpa data pribadi)

**[Test]** DB `restaurant_app` saat audit:

| Metrik | Nilai |
|---|---|
| `restaurant` | 2 |
| `product` | 8 (hanya 1 memiliki recipe aktif: "Ayam Geprek", 5 `recipeitem`) |
| `recipe` / `recipeitem` | 1 / 5 |
| `branchproduct` | 10 — **semua `costingMode='INGREDIENT'`, `manualHpp` = NULL** |
| `branchingredient` | 5 — **semua `averageCost > 0`** (tidak ada WAC nol) |
| `order` | 35 |
| `orderitem` | **1** |
| `orderitemcostsnapshot` | **0** |
| `payment` | 46 (16 order ber-`paymentStatus='PAID'`; 1 `refund` APPROVED 30.000) |
| `expense` | 0 |

Distribusi item per order: **34 order memiliki 0 item**, **1 order memiliki 1 item**. `orderstatushistory` menunjukkan 16 transisi `COMPLETED` dan `stockmovement` = 16 — artinya order-order itu **benar-benar diproses** (bukan draft), namun **tidak ada baris item/snapshot-nya**. **[Test]**

**Revenue set** (`status<>'CANCELLED' AND (paymentStatus='PAID' OR ada payment REFUNDED)`):

| Basis | Order | Total |
|---|---|---|
| Order-level (header) | 15 (PAID-only) | `subtotal = grandTotal = 487.000` |
| Order-level + refunded | 16 | `517.000` |
| **Item-level (JOIN `orderitem`)** | **0 item** | **item gross = 0** |
| Order ber-revenue **tanpa item** | **16** | **517.000** |

Satu-satunya `orderitem` (`productId` = "Es Teh", qty 1, total 8.000) milik order ber-status **`READY` / `UNPAID`** → **di luar revenue set**, dan **tidak punya snapshot**. **[Test]**

Hasil agregat **coverage** (semua order ber-revenue, all-time): `totalOrderItems=0, costedOrderItems=0, uncostedOrderItems=0, legacyOrderItems=0, pendingOrderItems=0`. **[Test]**

> Catatan: 16 order COMPLETED + 1 READY dsb. menjelaskan mengapa *revenue* ada di level **order** (header) tetapi *COGS/coverage* di level **item** kosong — lihat §4 dan §9.

---

## 4. Arti `coverageComplete` dan `cogsState="COVERED"`

**[Source]** `profitability.service.ts`:

```ts
function deriveCogsState(c) {
  if (c.totalItems === 0 || c.costed === c.totalItems) return "COVERED";  // ← 0 item ⇒ COVERED
  if (c.costed > 0) return "PARTIAL";
  if (c.pending > 0) return "PENDING_COGS";
  if (c.uncosted > 0) return "UNCOVERED";
  return "LEGACY";
}
```

- **Level produk:** `coverageComplete = totalItems > 0 && costed === totalItems` → **ada guard**. ✅
- **Level cabang:** `bCoverageComplete = bTotal > 0 && bCosted === bTotal` → **ada guard**. ✅
- **Level summary:** `coverageComplete = (uncosted + legacy + pending === 0)` → **TIDAK ada guard `totalItems > 0`**. ❌

**Arti yang benar:** `COVERED`/`coverageComplete=true` seharusnya berarti "setiap item relevan sudah `SNAPSHOTTED`". Namun implementasi saat ini juga menganggap **"tidak ada item sama sekali"** sebagai COVERED (kondisi hampa). Inilah yang terjadi: 0 item → summary `coverageComplete=true` + `cogsState="COVERED"` + `cogs=0`. **[Source][Test]**

Bug logika yang sama ada di **Menu Engineering** (`menu-engineering.service.ts`): summary dan per-kategori memakai `uncosted + legacy + pending === 0` **tanpa** guard `totalItems>0`. **[Source]**

---

## 5. Zero valid vs HPP belum tersedia

| Situasi | Status snapshot | `hppTotal` | Perlakuan agregat | Catatan |
|---|---|---|---|---|
| WAC bahan = 0 / `manualHpp = 0` | `SNAPSHOTTED` | `0` | `costed++`, masuk COGS sebagai 0 | **Zero VALID** — bukan error |
| Recipe kosong/tiada | `NO_RECIPE` | `NULL` | `uncosted++`, coverage turun | Bukan 0 |
| WAC/BranchIngredient hilang | `MISSING_WAC` | `NULL` | `uncosted++` | Bukan 0 |
| Bahan non-aktif | `INACTIVE_INGREDIENT` | `NULL` | `uncosted++` | Bukan 0 |
| Tanpa branch | `NO_BRANCH` | `NULL` | `uncosted++` | Bukan 0 |
| COMPLETED tanpa baris snapshot | tidak ada baris | — | `legacy++` | Bukan 0 |
| PAID belum COMPLETED tanpa snapshot | tidak ada baris | — | `pending++` | Bukan 0 |
| **Tidak ada item sama sekali** | tidak ada baris | — | **totalItems=0 ⇒ COVERED (hampa)** | **CACAT** — lihat §4 |

Kode **tidak** mengubah "belum tersedia" menjadi 0 pada level baris. Tetapi pada level **agregat**, `cogs` memakai `COALESCE(SUM(CASE WHEN status='SNAPSHOTTED' THEN hppTotal ELSE 0 END), 0)` → `cogs=0` untuk **kedua** situasi (nol valid maupun tidak ada data). **Pembeda satu-satunya adalah `coverage`**, dan di jalur summary pembeda itu justru ter-kosong-hampa. **[Source]**

---

## 6. Apakah semua item memiliki snapshot tetapi nilainya nol?

**TIDAK.** **[Test]**

- `orderitemcostsnapshot` = **0 baris** (bukan banyak snapshot bernilai nol).
- `orderitem` di DB = **1 baris**, dan baris itu **di luar revenue set** serta **tidak punya snapshot**.
- Karena itu, `cogs=0` di sini **bukan** manifestasi "zero valid", melainkan **tidak ada item sama sekali** dalam scope.

> Koreksi klaim sebelumnya: laporan `ACCOUNTING-PHASE-D-IMPLEMENTATION-REPORT.md` menyatakan "`OrderItemCostSnapshot.hppTotal` saat ini 0". Berdasarkan data aktual, pernyataan yang akurat adalah **"tidak ada baris snapshot sama sekali dan 0 item dalam revenue set"** — bukan snapshot-snapshot bernilai 0.

---

## 7. Relasi produk/varian/recipe/costing yang menentukan HPP

**[Source]**

```
Product ──(1:0..1 aktif)── Recipe ──(n)── RecipeItem ──(qty)── Ingredient
                                                                  │
Branch ──(n)── BranchIngredient { averageCost = WAC }  ◀─────────┘
Product ──(n per branch)── BranchProduct { costingMode, manualHpp }
                                      │
                                      └─ INGREDIENT → Σ(qty × WAC)
                                      └─ MANUAL     → manualHpp (0 valid)
```

- **Tidak ada model "varian" terpisah.** Produk yang dapat dijual adalah `Product`. Addon/option membawa mini-BOM sendiri (`ProductAddonIngredient`/`ProductOptionIngredient` via `addon/optioningredient`) dan di-fold ke HPP saat completion (H4.3).
- HPP historis **hanya** bisa diketahui bila: (a) branch diketahui, (b) mode MANUAL punya `manualHpp`, atau (c) mode INGREDIENT punya recipe aktif dengan **semua** bahan memiliki `BranchIngredient.averageCost` di branch tersebut.
- Di data ini: 7 dari 8 produk **tidak punya recipe**; bila salah satu dari produk tanpa recipe itu terjual dan diselesaikan, snapshot-nya akan berstatus **`NO_RECIPE` (`NULL`)** — dan itu **menurunkan** coverage, bukan menghasilkan 0. Namun karena tidak ada item yang tersnapshot sama sekali, jalur itu tidak terpicu. **[Test]**

---

## 8. Bisakah produk tanpa data biaya menghasilkan snapshot nol tetapi dianggap covered?

- **Per produk: TIDAK.** Produk tanpa recipe → `NO_RECIPE` dengan `hppTotal = NULL`; dihitung `uncosted` → menurunkan coverage. Produk tanpa WAC → `MISSING_WAC` (NULL). Tidak ada jalur kode yang membuat produk berbiaya tidak diketahui menjadi `SNAPSHOTTED` bernilai 0.
- **Per agregat: YA (cacat).** Ketika **tidak ada item sama sekali** dalam scope, summary menyatakan `COVERED` dan `coverageComplete=true` secara hampa (§4). Inilah yang membuat "produk tanpa data biaya" **tampak** terlindungi: bukan karena tiap produk dinilai 0, tetapi karena **tidak ada produk/item yang dinilai sama sekali**.

---

## 9. Dampak terhadap Gross Profit dan P&L

**[Test]** dampak nyata pada lingkungan ini:

| Metrik | Nilai aktual | Nilai bila coverage benar |
|---|---|---|
| Net Sales | 487.000 | 487.000 |
| COGS (retained) | 0 | **Tidak diketahui** |
| Gross Profit | **487.000** (margin 100%) | **NULL / tidak diketahui** |
| Food Cost % | **0%** | NULL |
| Net Profit (P&L) | **487.000** | **NULL** |

- **Overstatement COGS→GP→NP:** COGS dilaporkan 0 padahal tidak diketahui → GP dan NP terlalu tinggi; margin 100% dan food cost 0% menyesatkan keputusan harga/menu.
- **Produk kosong:** tabel produk profitabilitas mengembalikan **0 baris** sementara summary menampilkan 487.000 — inkonsistensi yang terlihat oleh admin.
- **Inkonsistensi lintas level:** summary `coverageComplete=true` tetapi cabang `coverageComplete=false` → admin menerima dua jawaban berbeda untuk data yang sama.
- **Menu Engineering** mewarisi cacat yang sama (summary/kategori), sehingga klasifikasi Star/Puzzle/… berbasis profit berpotensi salah ketika item kosong.
- **Bangun UI:** halaman P&L hanya menampilkan banner "COGS tidak lengkap" bila `!coverageComplete`; karena summary `true`, **banner tidak muncul** → admin tidak mendapat peringatan bahwa COGS belum terverifikasi.

---

## 10. Akar masalah: terkonfirmasi vs belum

**Terkonfirmasi (kode):**
1. **K1** — Summary `coverageComplete` di `profitability.service.ts` **tidak** memiliki guard `totalItems > 0` (level produk & cabang memilikinya) → vacuous `true` saat 0 item.
2. **K2** — `deriveCogsState()` mengembalikan `"COVERED"` untuk `totalItems === 0`.
3. **K3** — Cacat yang sama di `menu-engineering.service.ts` (summary & kategori).
4. **K4** — `cogs` agregat `COALESCE(...,0)` tidak dapat membedakan zero valid dari tidak-ada-data; pembeda `coverage` gagal di jalur summary.

**Terkonfirmasi (kondisi data):**
5. **D1** — Tabel `orderitemcostsnapshot` **kosong (0 baris)**.
6. **D2** — Semua order ber-revenue (16 order, 517.000) memiliki **0 baris item**; total `orderitem` di DB = 1 (di luar scope).
7. **D3** — `coverage.totalOrderItems = 0` dengan **revenue > 0** → memicu K1/K2/K4 secara nyata.

**Belum terkonfirmasi (provenance data):**
8. **U1** — **Mengapa** `orderitem` hilang dari order-order tersebut. Tidak ada jejak `DELETE/PURGE/RESET` di `auditlog` (44 entri, semua normal: payment/shift/refund/user). Kedua jalur pembuatan order di `order.service.ts` **selalu** membuat item bersarang (`items: { create: orderItems }`), jadi aplikasi **tidak** membuat order tanpa item. Kandidat yang belum terbukti: re-seed/bulk-import test, pembersihan DB langsung di luar aplikasi, atau snapshot/order item terhapus sebelumnya (cascade `OrderItemCostSnapshot` dari `OrderItem`). **Perlu investigasi terpisah — jangan diasumsikan.** **[NOT VERIFIED]**

**Kesalahan interpretasi sebelumnya (koreksi):** deskripsi "snapshot HPP `hppTotal` saat ini 0" keliru; yang benar adalah "tidak ada snapshot dan tidak ada item dalam scope". **[Test]**

---

## 11. Risiko

| # | Risiko | Bila terpicu |
|---|---|---|
| R1 | GP/NP **overstated** ketika `totalItems=0` & revenue>0 | Keputusan harga/menu salah |
| R2 | Bila ada **sebagian** item tak tersnapshot, summary tetap pakai guard? | Tidak — `coverageComplete` tetap `false` bila ada `uncosted/legacy/pending` → GP null (benar). Risiko hanya pada kasus **0 item**. |
| R3 | **Menu Engineering** mewarisi cacat | Klasifikasi menu salah |
| R4 | Admin tidak melihat banner peringatan (karena `coverageComplete=true`) | Rasa aman yang keliru |
| R5 | Data anomaly (order tanpa item) berulang pada seed/import | laporan keuangan menyesatkan secara sistematis |
| R6 | Zero valid (WAC/manual = 0) | **Bukan risiko** — perilaku saat ini benar; **jangan diubah** |

---

## 12. Rekomendasi minimal (belum diimplementasikan — menunggu persetujuan)

**R-1 (inti):** Tambahkan guard `totalItems > 0` pada `coverageComplete` level **summary** Profitabilitas — menyamakan dengan level produk/cabang.
`coverageComplete = cov.totalOrderItems > 0 && (uncosted+legacy+pending === 0)`.
Konsekuensi: saat 0 item & revenue>0 → `coverageComplete=false` → `grossProfit=null` → GP/NP "Tidak diketahui" (bukan 100% margin).

**R-2 (state kosong eksplisit):** `deriveCogsState` untuk `totalItems === 0` sebaiknya **tidak** mengembalikan `"COVERED"`. Opsi paling aman: **tambahkan indikator aditif** (mis. `coverage.hasItems`/`emptyScope: true`) daripada mengubah nilai enum historis; bila mengubah enum, tambah nilai baru (mis. `NO_ITEMS`) dan pastikan konsumen UI/ekspor ditinjau. Ini **mengubah perilaku hanya untuk kasus degenerate (0 item)** — harus dinyatakan sebagai perubahan perilaku yang disengaja.

**R-3 (validasi data-integrity, read-only):** Tambahkan disclosure **"order ber-revenue tanpa item"** (jumlah order + nilai) pada Profitabilitas/P&L, sehingga anomali U1 terlihat langsung. Implementasi: query agregat order-level vs item-level; tidak mengubah angka historis.

**R-4 (konsistensi menu engineering):** Terapkan guard yang sama (R-1) pada summary & kategori `menu-engineering.service.ts`.

**R-5 (UI):** Ketika `coverage.totalOrderItems === 0` (dan/atau `emptyScope`), tampilkan peringatan eksplisit "COGS belum terverifikasi — tidak ada item dalam scope", bukan "COVERED".

**Yang TIDAK boleh diubah:** semantik zero valid (WAC/manual = 0 tetap `SNAPSHOTTED`/COVERED dan GP dihitung), mesin snapshot, `computeRefundAware`, definisi revenue kanonik, dan **jangan** backfill snapshot. Tidak perlu migration/schema baru.

> **Catatan keputusan:** R-1 memperbaiki cacat vacuous **tanpa** menyentuh zero valid — order dengan semua item `SNAPSHOTTED` (termasuk bernilai 0) tetap `coverageComplete=true` dan GP tetap dihitung. Ini aman untuk data historis.

---

## 13. File yang mungkin perlu diubah (jika kelak disetujui)

| File | Perubahan minimal |
|---|---|
| `src/services/profitability/profitability.service.ts` | Guard `totalItems > 0` pada `coverageComplete` summary; penyesuaian `deriveCogsState` untuk 0 item (R-1/R-2) |
| `src/services/profitability/profitability.types.ts` | Opsional: field indikator aditif (`emptyScope`/`hasItems`) atau nilai enum baru |
| `src/services/accounting/pnl.service.ts` (+ `pnl.types.ts`) | Teruskan indikator/disclosure; `grossProfit`/`netProfit` null saat summary tidak lengkap |
| `src/services/menu-engineering/menu-engineering.service.ts` | Guard yang sama pada summary & kategori (R-4) |
| `src/app/admin/profitability/page.tsx`, `src/app/admin/accounting/pnl/page.tsx`, `src/components/admin/analytics/dashboard-analytics.tsx`, halaman menu-engineering | Banner/state "COGS belum terverifikasi (0 item)" (R-5) |
| `src/app/api/reports/profitability/export/route.ts`, `src/app/api/admin/accounting/pnl/export/route.ts` | Konsistensi status pada CSV |
| `src/services/costing/historical-snapshot.unit.test.ts` (+ tes coverage baru) | Tes untuk zero valid **dan** kasus 0 item |

**Tidak boleh diubah:** `prisma/schema.prisma`, migration, `historical-snapshot.ts` (logika snapshot), `order`/`payment`/`refund`/`approval`.

---

## 14. Test plan (saat implementasi disetujui)

1. **Unit — coverage 0 item:** `deriveCogsState({totalItems:0,...})` tidak lagi `"COVERED"` (atau beri indikator `emptyScope=true`); `coverageComplete=false` saat totalItems=0.
2. **Unit — zero valid tetap benar:** order dengan semua item `SNAPSHOTTED` dan `hppTotal=0` → `coverageComplete=true`, `cogs=0`, `grossProfit=netSales` (tidak regresi).
3. **Unit — P&L null-aware:** `computeNetProfit(null, opex) === null`; `getPnlReport` menurunkan `grossProfit/netProfit = null` saat coverage tidak lengkap.
4. **Unit — menu engineering:** summary/kategori dengan 0 item → `coverageComplete=false`, `grossProfit=null`.
5. **Runtime read-only (regresi data saat ini):** periode custom 2026-09-01…2026-10-31 → setelah fix `coverageComplete=false`, `grossProfit=null`, `netProfit=null`, dan tidak lagi 487.000/100%.
6. **Konsistensi lintas level:** summary vs cabang vs produk harus sepakat soal kelengkapan (tidak lagi `true` vs `false` untuk data yang sama).
7. **Disclosure data:** jumlah/nilai order ber-revenue tanpa item terhitung benar (16 order / 517.000 pada data ini).
8. **Regresi engine kanonik:** Sales Report & Profitabilitas untuk skenario normal (ada item tersnapshot) tidak berubah; `prisma/schema.prisma` numstat tetap `78/0`.
9. **Static:** `npx tsc --noEmit`, `git diff --check`.

---

## 15. Git status sebelum/sesudah & konfirmasi

| Item | Sebelum audit | Sesudah audit |
|---|---|---|
| HEAD | `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` | `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (**tidak berubah**) |
| Modified (tracked) | 23 | 23 (**tidak berubah**) |
| Staged | 0 | 0 |
| Untracked | 53 (51 pre-existing + 2 harness temp) | **52** (51 pre-existing + 1 laporan ini; 2 harness temp dihapus) |
| `prisma/` numstat | `78  0  prisma/schema.prisma` | `78  0  prisma/schema.prisma` (**tidak berubah**) |
| Perubahan source/schema/migration/config | — | **tidak ada** |
| Tulis/ubah data DB | — | **tidak ada** (hanya SELECT) |
| Reset DB / migration / commit / push / deploy | — | **tidak ada** |
| Harness temp | `_accD1audit.mjs`, `_accD1verify.ts` | **dihapus** |

Konfirmasi: audit murni read-only. Seluruh perubahan existing & uncommitted dipertahankan; tidak ada source/schema/data yang disentuh.

---

## 16. Kesimpulan

- `cogs=0` + `coverageComplete=true` pada data ini disebabkan **tidak ada item dalam revenue set** (0 `orderitem`, 0 snapshot) — **bukan** snapshot HPP bernilai nol.
- **Cacat logika terkonfirmasi:** `coverageComplete` summary Profitabilitas (dan Menu Engineering) **tidak** memakai guard `totalItems > 0`; `deriveCogsState` memetakan 0 item ke `"COVERED"`. Akibatnya Gross Profit = Net Sales (margin 100%), Net Profit P&L = 487.000.
- **Koreksi penting:** zero valid (WAC/manual = 0) adalah perilaku yang **benar** dan tidak boleh diubah; yang salah adalah perlakuan "0 item" yang hampa.
- **Provenance data (U1)** — mengapa order ber-revenue kehilangan baris item/snapshot — **belum terkonfirmasi** dan perlu investigasi terpisah; jangan menyimpulkan tanpa bukti.
- Rekomendasi minimal: guard `totalItems > 0`, state "kosong" eksplisit, disclosure order-tanpa-item, konsistensi menu engineering & UI — **tanpa** migration/schema/backfill.

**STOP** — laporan selesai. Menunggu review & persetujuan sebelum coding. Tidak ada perbaikan dilakukan selama audit.
