# M1 — SOLUTION PROPOSAL (Menu Engineering Net-Sales Basis)

**Repo:** `/home/reksa/restorant-cafe`
**Sumber temuan:** `FINAL-ACCOUNTING-READINESS-AUDIT.md` §7 & §14 (M1, Medium)
**Jenis dokumen:** **PROPOSAL SAJA — tanpa implementasi.**
**Batasan dipatuhi:** tidak mengubah revenue/OrderItem/snapshot/COGS/data historis/P&L; tidak menulis kode; tidak commit/push/deploy; tidak memulai fase lain; pekerjaan uncommitted dipertahankan.
**Prinsip:** bedakan **FAKTA TERVERIFIKASI** vs **ASUMSI**. `revenueWithoutItems.orders > 0` ⇒ gross/net profit = **unknown**, bukan 0. Tidak ada atribusi revenue ke produk yang tidak punya baris item.

---

## 1. Fakta Terverifikasi (dari source, bukan asumsi)

| # | Fakta | Bukti |
|---|---|---|
| F1 | ME `summary.totalNetSales` = Σ `netSales` baris produk dengan `qtySold > 0` (**basis item**) | `menu-engineering.service.ts` → `buildSummary`: `sold.filter(...).reduce((s,r) => s + r.netSales, 0)` |
| F2 | `row.netSales` ME berasal dari `ProfitabilityProductRow.netSales`, yang dihitung dari `JOIN orderitem` (**item-based**) | `menu-engineering.service.ts` (`hist?.netSales ?? 0`); `profitability.service.ts` L175–201 (`FROM orderitem oi JOIN order o LEFT JOIN snapshot`) |
| F3 | Profitabilitas/P&L `summary.netSales` = `computeRefundRevenue().total.netSales` = Σ `(grandTotal − tax − serviceCharge) − refundShare` per **order header** (**header-based, tidak butuh OrderItem**) | `profitability.service.ts` L376; `report.service.ts` L244–247, L334–336 |
| F4 | Di dalam Profitabilitas sendiri sudah ada dua basis: `summary.netSales` (header) vs `productSummary.totalNetSales` (item) | `profitability.service.ts` L457–458 (`productSummary.totalNetSales` = Σ product rows) |
| F5 | ME **tidak** mengekspos `revenueWithoutItems`; hanya menyalin `coverage` | `menu-engineering.service.ts` return: `coverage: firstProfitability.summary.coverage` |
| F6 | D1 `revenueWithoutItems` **sudah tersedia** di Profitabilitas & P&L dan dipakai untuk disclosure | `profitability.service.ts` L130, L640–643; `pnl.service.ts` L169; `pnl.types.ts` L133 |
| F7 | Warning UI ME hanya muncul bila `totalOrderItems === 0` **DAN** `totalNetSales > 0` | `menu-engineering/page.tsx` L~330 |
| F8 | ME CSV meng-ekspor kolom per-produk `"Net Sales"` (basis item — sah untuk baris produk) | `api/reports/menu-engineering/export/route.ts` header |
| F9 | Runtime terdampak: 16 order ber-revenue tanpa OrderItem (Rp517.000), 0 snapshot ⇒ ME `totalNetSales=0`, Profitabilitas/P&L `netSales=487000`, keduanya `coverageComplete=false`, `grossProfit=null` | `FINAL-ACCOUNTING-READINESS-AUDIT.md` §7, §11 |

**ASUMSI (belum perlu dibuktikan untuk proposal):** angka 487000/517000 adalah kondisi data saat audit; proposal dirancang agar benar untuk **semua** periode (termasuk saat `revenueWithoutItems=0`).

---

## 2. Akar Masalah (root cause)

Bukan bug aritmetika, melainkan **dua definisi "Net Sales" yang valid namun berbeda**:

- **Header / order basis** (Profitabilitas & P&L headline): `grandTotal − tax − serviceCharge − refundShare`. Mengukur **nilai penjualan produk pada level order**, termasuk order yang kehilangan baris item.
- **Item / product-attributed basis** (Mechanism ME headline & baris produk): Σ kontribusi per `productId`. Mengukur **atribusi penjualan ke produk** — tidak mungkin memuat order tanpa item karena tidak ada produk untuk diatribusikan.

Pada kondisi normal (setiap order punya item), keduanya **identik**. Perbedaan hanya muncul pada insiden "order ber-revenue tanpa OrderItem" (D1/D2). Jadi M1 adalah **divergensi label**, bukan divergensi data: ME memberi label "Total Net Sales" pada angka basis item, sementara laporan lain memberi label sama pada angka basis header.

**Konsekuensi interpretasi (didokumentasikan di audit):** ME menampilkan `Total Net Sales = Rp0` **tanpa penjelasan**, karena guard UI F7 mensyaratkan `totalNetSales > 0` sehingga tidak terpicu; sedangkan Profitabilitas/P&L menampilkan `Rp487.000` + peringatan. Operator yang membandingkan dua layar bisa menyimpulkan "penjualan nol" secara keliru.

---

## 3. Opsi Solusi

Semua opsi **tidak menyentuh** revenue/OrderItem/snapshot/COGS dan **tidak** membuat DML/DDL.

---

### Opsi 1 — Pertahankan basis item + disclosure `revenueWithoutItems` + label basis eksplisit

**Inti:** Angka tidak diubah sama sekali. Yang berubah hanya **penamaan & keterbacaan**.

- Tetap: `totalNetSales` = Σ baris produk (item-based).
- Tambah di `summary`: `revenueWithoutItems` (disalin dari Profitabilitas; **tanpa query baru** — `firstProfitability` sudah memuatnya).
- Ubah label UI/CSV: `"Total Net Sales"` → `"Total Net Sales (Produk)"` / `"Net Sales — basis produk"`, plus catatan kaki: "Order ber-revenue tanpa baris item tidak dapat diatribusikan ke produk; nilainya Rp X (N order) dan dikecualikan dari angka ini."
- Perbaiki guard F7 agar peringatan tetap muncul walau `totalNetSales = 0` (kondisi: `coverage.totalOrderItems === 0 && (summary.totalNetSales > 0 || revenueWithoutItems.orders > 0)`).

**Dampak angka & interpretasi:** angka identik dengan sekarang (ME tetap 0). Interpretasi **membaik drastis** — pembaca tahu 0 itu "tidak ada item untuk diatribusikan", bukan "tidak ada penjualan", dan tahu ada Rp517.000 di level order.

**Konsistensi Profitabilitas/P&L:** Konsisten secara **eksplisit** — ME menyatakan basisnya item dan menyebut angka basis header (Rp X, N order) yang sama dengan disclosure P&L. Tidak ada klaim angka yang bertentangan.

**Risiko data historis:** **Nol.** Hanya membaca `revenueWithoutItems` yang sudah dihitung. Tidak ada backfill, tidak menyentuh order/snapshot.

**Risiko tenant/branch:** **Nol tambahan.** `revenueWithoutItems` berasal dari Profitabilitas yang sudah tenant+`branchFilters`-scoped (mengikuti `branchId` ME). Perlu memastikan ME menyampaikan `branchFilters` yang sama — sudah terjadi (`fetchAllProfitability(..., branchFilters)`).

**File yang perlu diubah:**
- `src/services/menu-engineering/menu-engineering.types.ts` — tambah `summary.revenueWithoutItems {orders, headerValue}` (+ opsional `netSalesBasis`).
- `src/services/menu-engineering/menu-engineering.service.ts` — salin disclosure di `buildSummary`/return.
- `src/app/admin/menu-engineering/page.tsx` — label kartu + peringatan (guard F7) + teks disclaimer.
- `src/app/api/reports/menu-engineering/export/route.ts` — header/label CSV (opsional baris disclosure).
- (Opsional) `src/app/admin/reports/report-nav.tsx` — tidak wajib.

**Migration:** **Tidak perlu.** Semua data tersedia; murni DTO + tampilan.

**Test yang diperlukan:**
- Unit test murni: salinan `revenueWithoutItems` map benar; label/flag basis (`netSalesBasis === "PRODUCT"`).
- Regression test: periode dengan `revenueWithoutItems = 0` ⇒ ME `totalNetSales` tetap sama seperti sebelum patch (tidak ada dampak angka).
- Tidak butuh test DB baru (query tidak berubah).

**Risiko regression:** **Sangat rendah.** Additive field + perubahan teks. Satu-satunya risiko: konsumen lama yang membaca `summary.totalNetSales` tetap benar (tidak berubah).

---

### Opsi 2 — Paksa ME `summary.totalNetSales` = header net sales (samakan dengan Profitabilitas/P&L)

**Inti:** `totalNetSales` ME mengambil `firstProfitability.summary.netSales` (header), mis. 487000 — **tanpa** mengalokasikan ke produk mana pun.

**Dampak angka & interpretasi:** ME `totalNetSales` **berubah** 0 → 487000. Interpretasi jadi salah kaprah: kartu "Total Net Sales" akan terlihat seperti total penjualan produk, padahal baris-baris produk di bawahnya berjumlah 0. Terbentuk **selisih tak terjelaskan** Rp487.000 antara summary dan tabel produk. Tanpa label tambahan, pembaca justru bisa menyimpulkan atribusi yang tidak ada.

**Konsistensi Profitabilitas/P&L:** Angka **sama**, tetapi ME menjadi `summary.netSales` (header) sementara `productSummary`-nya tetap item-based — memindahkan divergensi ke dalam ME sendiri (summary vs tabel), bukan menghilangkannya. Wajib tetap ada disclosure agar tidak menyesatkan.

**Risiko data historis:** **Nol** (read-only, tidak backfill). Namun ME jadi menampilkan revenue yang **tidak dapat diatribusikan ke produk** sebagai headline produk — risiko pelaporan.

**Risiko tenant/branch:** Nol tambahan bila memakai `firstProfitability.summary.netSales` (sudah scoped). Perlu memastikan filter branch ME benar-benar identik dengan panggilan Profitabilitas (saat ini ya).

**File yang perlu diubah:**
- `src/services/menu-engineering/menu-engineering.service.ts` — `buildSummary` ganti basis sumber + terima `summary.netSales`.
- `menu-engineering.types.ts` — dokumen ulang semantik `totalNetSales` (breaking meaning).
- `menu-engineering/page.tsx`, `export/route.ts` — label + disclaimer "termasuk order tanpa item".
- Tidak bisa menghindari disclosure; tetap butuh field `revenueWithoutItems`.

**Migration:** **Tidak perlu.**

**Test:** unit test baru yang menegaskan `totalNetSales` = header dan `Σ rows ≠ totalNetSales` saat ada order tanpa item; regression test periode normal (`Σ rows === totalNetSales`).

**Risiko regression:** **Medium-tinggi.** Mengubah arti field yang sudah dikonsumsi UI/CSV; setiap periode dengan order tanpa item akan menampilkan ketidaksesuaian summary-vs-tabel. Menyalahi prinsip audit: "jangan mengarang atribusi revenue ke produk."

---

### Opsi 3 (REKOMENDASI) — Pertahankan basis item untuk produk, tampilkan basis header sebagai **reference**, dan jadikan basis eksplisit di seluruh permukaan

**Inti:** Kombinasi aman = Opsi 1 + **reference total berbasis header** yang diberi label berbeda, sehingga pengguna bisa merekonsiliasi ke Profitabilitas/P&L **tanpa** memalsukan atribusi produk.

- `summary.totalNetSales` **tetap** basis item (0 pada insiden) — **tidak ada perubahan angka / breaking change**.
- Tambah field additive:
  - `summary.netSalesBasis: "PRODUCT"` (kontrak eksplisit),
  - `summary.netSalesHeaderBasis: number` (dari `firstProfitability.summary.netSales`, mis. 487000),
  - `summary.revenueWithoutItems: {orders, headerValue}` (dari Profitabilitas — query baru **tidak** diperlukan).
- UI: kartu "Total Net Sales (Produk)" + kartu/baris kecil "Net Sales (basis order) — referensi" + banner disclosure `N order, Rp X tanpa baris item; profit tidak dapat diverifikasi`.
- Guard F7 diperbaiki agar banner muncul baik saat `totalNetSales = 0` maupun `> 0`.
- CSV produk tetap basis item untuk kolom per-produk (sah & sesuai tabel); tambahkan baris/disclosure di akhir atau metadata.

**Dampak angka & interpretasi:** Angka produk **tidak berubah**; interpretasi menjadi **lengkap dan dapat direkonsiliasi** (pembaca melihat 0 produk + reference header 487000 + penjelasan 16 order). Selisih produk-vs-header **dinyatakan sebagai selisih basis**, bukan disembunyikan.

**Konsistensi Profitabilitas/P&L:** **Tertinggi.** ME memakai angka header yang **persis sama** dengan Profitabilitas/P&L (`Profitabilitas summary.netSales`), dan `revenueWithoutItems` identik. Dua basis dinyatakan eksplisit di ketiga laporan.

**Risiko data historis:** **Nol.** Read-only + reuse agregat D1. Tidak backfill/snapshot.

**Risiko tenant/branch:** **Nol tambahan** — semua nilai berasal dari `firstProfitability` yang sudah tenant + `branchFilters` scoped. `branchId NULL` tetap mengikuti kontrak laporan sumber (didokumentasikan).

**File yang perlu diubah:**
- `src/services/menu-engineering/menu-engineering.types.ts` — `MenuEngineeringSummary`: `+netSalesBasis`, `+netSalesHeaderBasis`, `+revenueWithoutItems`.
- `src/services/menu-engineering/menu-engineering.service.ts` — `buildSummary` terima `firstProfitability.summary` dan isi field additive (tanpa query baru).
- `src/app/admin/menu-engineering/page.tsx` — relabel kartu, reference header, banner disclosure, perbaikan guard F7.
- `src/app/api/reports/menu-engineering/export/route.ts` — label kolom per-produk + baris disclosure basis.
- Tidak wajib: `report-nav.tsx`.

**Migration:** **Tidak perlu.** Semua berasal dari engine Profitabilitas yang sudah ada.

**Test yang diperlukan:**
- Unit test murni (extend `menu-engineering.classify.unit.test.ts` atau file basis-specific): 
  - `netSalesBasis === "PRODUCT"`;
  - `totalNetSales` = Σ baris produk (item-based);
  - `netSalesHeaderBasis` = nilai header yang diteruskan;
  - `revenueWithoutItems` diteruskan apa adanya;
  - periode normal `revenueWithoutItems = 0` ⇒ `totalNetSales === netSalesHeaderBasis`.
- Regression: pastikan tidak ada perubahan pada `totalNetSales`, `grossProfit`, `coverageComplete` (field lama).
- (Opsional, fase lain) test route export memuat baris disclosure.

**Risiko regression:** **Rendah.** Additive & tidak mengubah semantik field lama; UI berubah teks/komponen. Risiko utama hanya duplikasi penamaan — dikelola dengan `netSalesBasis`.

---

## 4. Perbandingan

| Kriteria | Opsi 1 (label+disclosure) | Opsi 2 (samakan header) | Opsi 3 (produk + reference header) |
|---|---|---|---|
| Angka ME berubah | Tidak | Ya (0→header) | Tidak |
| Bisa direkonsiliasi ke P&L | Sebagian (angka disebut di teks) | Ya tapi tabel tak cocok | **Ya, eksplisit dua basis** |
| Memalsukan atribusi produk | Tidak | **Ya-ish** (summary ≠ tabel) | Tidak |
| Breaking change | Tidak | Ya (arti field) | Tidak |
| Perlu migration | Tidak | Tidak | Tidak |
| Query baru | Tidak | Tidak | Tidak |
| Risiko regression | Sangat rendah | Medium-tinggi | Rendah |
| Risiko data historis | Nol | Nol | Nol |
| Risiko tenant/branch | Nol | Nol | Nol |
| Test baru | Ringan | Sedang | Ringan |
| Sesuai prinsip audit | Ya | **Tidak** | Ya |

---

## 5. Rekomendasi

**Pilih Opsi 3.** Alasan:

1. **Tidak mengubah angka & tidak mengarang atribusi** (prinsip inti audit D1/D2).
2. **Merekonsiliasi penuh** ke Profitabilitas/P&L dengan menampilkan angka header yang identik + disclosure `revenueWithoutItems` yang identik, tanpa query/migration baru.
3. **Backward-compatible** (additive) → risiko regression & deploy rendah, konsisten dengan permukaan accounting uncommitted yang sudah ada.
4. Memperbaiki cacat interpretasi yang nyata: saat ini ME bisa menampilkan "Total Net Sales Rp0" tanpa penjelasan karena guard F7 (`totalNetSales > 0`) tidak terpicu.

**Jika reviewer menolak menambah field baru:** jalankan **Opsi 1 minimal** (disclosure + relabel + perbaikan guard F7) — sudah menghilangkan risiko menyesatkan, hanya kurang eksplisit dalam rekonsiliasi angka.

**Prioritas:** P2 (sesuai audit), **setelah** keputusan P1 (perlakukan periode terdampak sebagai COGS UNKNOWN) dan **sebelum/sesuai** urutan commit+deploy migration Expense (M3) — tidak ada dependensi teknis antara M1 dan migration Expense.

---

## 6. Yang TIDAK dilakukan pada proposal ini

- Tidak ada perubahan source, schema, migration, DB, seed.
- Tidak ada perubahan revenue/OrderItem/snapshot/COGS/historis/P&L.
- Tidak ada commit/push/deploy/VPS; tidak memulai fase lain.
- Tidak menghapus/menimpa pekerjaan uncommitted.

---

**STATUS: PROPOSAL SELESAI — STOP & tunggu review. Pilih opsi sebelum implementasi.**
