# PHASE F.5 — IMPLEMENTATION REPORT

**Historical COGS (HPP Historis) + Profitability Report**

- **Status:** F.5 SELESAI (APPROVED SETELAH AUDIT)
- **Tanggal:** 11 September 2026
- **Port:** 3001 (3000 tidak disentuh)
- **Daftar Uji:** `tsc --noEmit` bersih, `npm run build` sukses, 85 assert runtime PASS, 23 baris snapshot terverifikasi di DB tanpa duplikat

---

## 1. Ringkasan Eksekutif

F.5 menambahkan HPP **historis** (bukan HPP saat ini milik F.4) dengan cara **membekukan snapshot HPP per OrderItem pada transisi READY → COMPLETED** di dalam transaksi yang sama, diikuti laporan **Profitabilitas** server-side (Net Sales, COGS, Gross Profit, Margin, Food Cost) dengan pengakuan revenue PAID-only. Snapshot tidak pernah ditulis ulang oleh perubahan WAC/recipe/harga di kemudian hari. Order pra-F.5 tanpa snapshot dicatat sebagai `LEGACY` dan ditampilkan, bukan di-backfill.

**Teruji pada runtime:** 85 assert lulus (termasuk snapshot, imutabilitas, konfigurasi tanpa resep/WAC/ingredien nonaktif/zero-WAC, unpaid-completed, cancel, race, multi-branch, keamanan, CSV, dan regresi F.1–F.4).

## 2. Ruang Lingkup

- F.4 = HPP **saat ini** (costing engine). F.5 = HPP **historis** (COGS) + profitabilitas.
- Hanya dibangun di atas `OrderItemCostSnapshot`; tidak ada recipeVersion, recipeSnapshot JSON, ingredientSnapshot, addon/option costing, atau konsumsi stok tambahan.
- Tidak mengubah alur pembayaran (kasir/IPAYMU/QRIS), tidak mengubah desk prefund, tidak mendesain ulang refund.

## 3. Keputusan Terkunci

1. Snapshot dibuat pada transisi `READY → COMPLETED`, di dalam **guard transaction** yang sama.
2. **Per OrderItem** (bukan agregat per produk); `@@unique([orderItemId])`.
3. Tidak ada recipe versioning / recipeSnapshot JSON / addon-option costing.
4. HPP unit = `Σ(RecipeItem.quantity × BranchIngredient.averageCost)` memakai recipe **saat ini** + WAC **saat ini** pada waktu completion.
5. `hppTotal = hppUnit × OrderItem.quantity`, semua `Decimal(12,2)`, `ROUND_HALF_UP`.
6. Status: `SNAPSHOTTED | NO_RECIPE | MISSING_WAC | INACTIVE_INGREDIENT | NO_BRANCH | LEGACY`.
7. Status tidak lengkap menyimpan `hppUnit = null, hppTotal = null` (tidak pernah 0).
8. WAC 0 adalah valid → `SNAPSHOTTED`, hpp 0.
9. **Tidak** memakai hasil F.4 langsung; dihitung server-side di dalam transaksi.
10. Imutabilitas: perubahan WAC/recipe/harga kemudian **tidak** mengubah snapshot historis.
11. Revenue memakai `OrderItem.unitPrice` / `totalPrice` (bukan `Product.price`/`priceOverride`).
12. `COMPLETED` = pengakuan COGS; `PAID` = pengakuan revenue; `COMPLETED+UNPAID` punya COGS tanpa revenue.
13. Order legacy (pra-F.5): tidak ada baris snapshot → `LEGACY` di laporan, **tidak pernah di-backfill**, COGS tidak tersedia.
14. Kegagalan pembuatan snapshot → **rollback** seluruh transaksi COMPLETED.
15. A36: konflik status lama → `ConflictError` (409) sebelum snapshot.
16. RMI/branch: hanya snapshot untuk BranchIngredient milik branch order.
17. Hpp tidak dibagikan lewat endpoint publik (tidak ada kebocoran).
18. Admin-only untuk laporan; kasir 403.
19. `PORT 3001 ONLY`.

## 4. Skema Database

`enum OrderItemCostStatus { SNAPSHOTTED NO_RECIPE MISSING_WAC INACTIVE_INGREDIENT NO_BRANCH LEGACY }`

`model OrderItemCostSnapshot`:
- `id`, `restaurantId`, `branchId`, `orderId`, `orderItemId`, `productId`, `productName`
- `status OrderItemCostStatus`
- `hppUnit Decimal(12,2)?`, `hppTotal Decimal(12,2)?`
- `qtyAtSnapshot Int`, `unitPriceAtSnapshot Decimal(12,2)` (dari OrderItem)
- `createdAt`, `updatedAt`
- Relations: `order`, `orderItem`, `restaurant`, `branch` (onDelete SetNull), `product`
- **`@@unique([orderItemId])`** — satu snapshot per OrderItem
- Index: `orderId`, `productId`, `branchId`, `completedAt`… disimpan sebagai `createdAt` (indeks ascending), `status`

## 5. Migrasi Database

`prisma/migrations/20260911143644_f5_order_item_cost_snapshot/migration.sql` — **additive** `CREATE TABLE`, tidak menyentuh tabel lain. Diterapkan via `prisma migrate deploy` (setelah `migrate resolve --applied` untuk 3 migrasi F.1–F.3 yang sempat tidak tercatat). `prisma generate` selesai.

## 6. Enum OrderItemCostStatus

- `SNAPSHOTTED` — HPP berhasil dihitung & dibekukan (termasuk WAC nol).
- `NO_RECIPE` — produk tidak punya recipe aktif saat completion.
- `MISSING_WAC` — salah satu bahan tidak punya BranchIngredient/WAC di branch order.
- `INACTIVE_INGREDIENT` — bahan dalam recipe non-aktif.
- `NO_BRANCH` — tidak ada BranchIngredient untuk branch order (cadangan ketat).
- `LEGACY` — **bukan** nilai yang ditulis; digunakan laporan untuk order pra-F.5 tanpa snapshot (tidak pernah di-backfill).

## 7. Mekanisme Snapshot

Di `order.service.ts`, blok COMPLETED di dalam `$transaction({ isolationLevel: 'ReadCommitted' })`:

1. Guarded `updateMany` → `count===0` → `ConflictError`.

2. Re-read order + items (fresh, di dalam transaksi).

3. `createOrderItemCostSnapshots(tx, order, items, restaurantId)` (helper `historical-snapshot.ts`):
   - Satu query batch produk → recipe → bahan → BranchIngredient (kontrak `{ ingredientId: { source, averageCost } }`, terikat branch order), tanpa N+1.
   - `MISSING_WAC` jika `source` bukan `BranchIngredient.averageCost`.
   - `INACTIVE_INGREDIENT` untuk bahan non-aktif; `NO_RECIPE` untuk recipe kosong/tiada.
   - `SNAPSHOTTED` dengan `hppUnit` (atau 0 untuk WAC 0), `hppTotal = hppUnit × quantity`, dibulatkan.
   - `createMany` difilter hanya jika ada OrderItem dari pizza/…; kegagalan apa pun → transaksi rollback.

4. statusHistory → stockOUT → free table (urutan tidak berubah).

Idempoten: pemanggilan COMPLETED kedua yang 409 tidak memasuki blok snapshot.

## 8. Formula HPP

$$hppUnit = \sum_{i\in recipe} (RecipeItem_i.quantity \times BranchIngredient_i.averageCost)$$

Menggunakan recipe **paling baru** (bukan versi lama) dan WAC **sekarang** — dibekukan saat completion. `hppTotal = hppUnit \times OrderItem.quantity`. Perhitungan di Prisma client di dalam transaksi; nilai dikonversi `Prisma.Decimal` dan disimpan 2 dp.

## 9. Desimal & Pembulatan

- Snapshot: `hppUnit`, `hppTotal` = `Decimal(12,2)`.
- Order/OrderItem: `Decimal(10,2)` (tidak diubah).
- BranchIngredient.averageCost: `Decimal(12,2)`.
- Bulatkan `ROUND_HALF_UP`; `num()` di laporan membulatkan di batas uang final.

## 10. SNAPSHOTTED & WAC nol

WAC 0 dianggap valid (produk gratis sample): status `SNAPSHOTTED`, `hppUnit = 0`, `hppTotal = 0`. Terbukti runtime: produk `F5-ZeroWAC` qty 4 → `hppTotal 0`, `cogs 0`, foodCost 0%.

## 11. NO_RECIPE

Tidak ada recipe aktif → snapshot dibuat dengan status `NO_RECIPE`, `hppTotal null`. Laporan: `uncostedItems++`, COGS 0, revenue tetap; diungkap lewat coverage `uncostedOrderItems`. Tidak pernah jatuh ke `LEGACY` karena baris snapshot tetap ada.

## 12. MISSING_WAC

Bahan tanpa BranchIngredient/averageCost di branch order → seluruh OrderItem `MISSING_WAC`, `hppTotal null`. Terbukti runtime: menambah bahan tanpa pembelian → line uncosted, `uncostedItems ≥ 1`.

## 13. INACTIVE_INGREDIENT

Bahan di recipe non-aktif saat completion → `INACTIVE_INGREDIENT`, `hppTotal null`. Terbukti runtime: deaktivasi bahan → line uncosted.

## 14. LEGACY & anti-backfill

Order COMPLETED pra-F.5 tidak punya snapshot → laporan menghitung `legacyOrderItems` (status COMPLETED tanpa snapshot) dan menampilkan peringatan "harga/COGS tidak tersedia". Dilarang mencoba backfill.

## 15. Imutabilitas Sejarah

- Snapshot disimpan pada transisi COMPLETED dan **tidak pernah** ditulis ulang oleh API mana pun (tidak ada endpoint update snapshot).
- Runtime: order pertama hpp 12000×2=24000; setelah WAC → 98000 dan recipe → 0.2 kg (F.4 HPP menjadi 19600), snapshot order lama **tetap 24000**.

## 16. COGS vs Revenue

- `COMPLETED` = COGS diakui (snapshot dibuat saat itu juga, termasuk order UNPAID).
- `PAID` = revenue diakui (`status != CANCELLED AND paymentStatus = PAID`).
- `COMPLETED + UNPAID`: snapshot ada, COGS ada, revenue **tidak** muncul di `products.summary`; diungkap lewat `summary.unpaidCompleted`.

## 17. Keterbukaan Unpaid-Completed

Laporan menyediakan `summary.unpaidCompleted { orders, orderItems, cogs }` agar COGS yang sudah terpakai tetapi belum dibayar tidak hilang. Runtime: order qty 3 (19600/unit) → `cogs ≥ 58800` ditampilkan sebelum dibayar.

## 18. Integrasi Pembayaran & Refund

- Alur pembayaran (KASIR casflow, QRIS, IPAYMU) tidak diubah. `markCashierPaymentPaid` hanya UNPAID → PAID; tidak menulis snapshot.
- Refund: order tetap COMPLETED; payment → REFUNDED (bila penuh); tidak ada pembalikan COGS/stok. Refund APPROVED mengurangi revenue; COGS tetap. Refund penuh menjatuhkan paymentStatus ke UNPAID sehingga order keluar dari himpunan revenue (konsisten dengan laporan penjualan).

## 19. Pembatalan Pesanan

CANCELLED tidak pernah mencapai blok COMPLETED → tidak ada snapshot. Runtime: cancel 200, COMPLETED setelah CANCELLED 409.

## 20. Konkurensi

- Race COMPLETED paralel: tepat satu 200, satu 409 (guarded `updateMany` + transaksi).
- Tidak ada stok ganda, tidak ada snapshot ganda (`@@unique` + bukti DB: 0 duplikat orderItemId).
- Idempoten: tidak ada statusHistory/stock ganda.

## 21. Multitenancy & Keamanan

- `restaurantId` di-hardcode di setiap query (`soldWhere`, `itemWhere`, raw SQL) dan pada baris snapshot.
- Branch scope server-side (header hanya hint). `branchFilters` divalidasi `assertBranchInScope`.
- API `GET /api/reports/profitability*`: `requireRoles(["ADMIN"])`; kasir 403, anon 401, branch tak dikenal 403 (runtime teruji).
- Keamanan data: semua math agresi di server; klien tidak pernah mengirim total.

## 22. Layanan Profitabilitas

`profitability.service.ts` (server-side):
- Range via `resolveReportRange` (today/yesterday/week/month/custom + startDate/endDate).
- Satu `Promise.all` query: orderAgg, refundAgg, productRows (raw SQL gabungan revenue+COGS+coverage), branchSales, branchCogs, branchRefund, coverageRow, unpaidRow, meta produk/kategori.
- Revenue set = PAID-only; COGS = `SUM(hppTotal WHERE status='SNAPSHOTTED')`.
- Per-Product: `netSales = gross − discount`; `grossProfit`; margin/food-cost null saat divisor 0 / status tidak lengkap.
- `msgProfit` nol karena pembagian dihindari; hasil `num()` 2 dp.

## 23. Endpoint API

- `GET /api/reports/profitability` (ADMIN) — summary (termasuk coverage + unpaidCompleted), pages yang di-paginate order, branches, filter, availableProducts/Categories.
- `GET /api/reports/profitability/export` (ADMIN) — CSV (BOM, header, status cost).

## 24. Antar muka Admin

`/admin/profitability` (ADMIN only):
- Filter: period chips, branch select, kategori, produk, order type, metode.
- Summary cards: Net Sales, COGS, Gross Profit, Margin, Food Cost, coverage.
- Branch breakout, tabel produk dengan status badge (SNAPSHOTTED/PARTIAL/UNCOSTED/LEGACY), peringatan legacy, disclosure unpaid-completed, tombol ekspor CSV.
- Tautan "Profitabilitas" di `admin/layout.tsx` (roles ADMIN) dan `report-nav.tsx` (adminOnly).

## 25. Performa

- Snapshot: satu query batch produk→recipe→BranchIngredient; `createMany` satu eksekusi. Tidak ada N+1.
- Laporan: agregasi SQL di DB (bukan di JS); hanya produk dibatasi di memori (≤500 aktif); halaman berbatas.
- `take: 500` untuk meta produk; pagination `page/limit` di laporan.

## 26. Pengujian

- **85 assert runtime** (`F5 RESULTS: 85 PASS / 0 FAIL / 85 TOTAL`, idempoten, suffix unik) di `:3001`: snapshot 24000 = 12000×2, duplikat COMPLETED 409, imutabilitas WAC+recipe, MISSING_WAC, NO_RECIPE, INACTIVE_INGREDIENT, zero-WAC, unpaid-completed, cancel, race, summary coverage, CSV, date filter (yesterday/custom), public no-leak, branch filter, security (403/401/anon).
- **Verifikasi DB** (`orderitemcostsnapshot`): 23 baris, 0 duplikat orderItemId; distribusi `SNAPSHOTTED=13 NO_RECIPE=3 MISSING_WAC=4 INACTIVE_INGREDIENT=3`; nilai `hppUnit/hppTotal` napak persis formula (12000×2=24000; 19600×3=58800; 0 untuk zero-WAC).
- **Regresi F.1–F.4**: costing list + Ayam Geprek tetap; engine F.4 menghitung HPP 12000 → 14700 → 19600 live; F.1 ingredient list OK.

## 27. Regression F.1–F.4

F.1 stok/unit, F.2 pembelian+WAC, F.3 recipe/BOM, F.4 costing — semua fungsi utuh. Tidak ada tabel yang diubah; migrasi additive. API `/api/admin/costing/*` tak tersentuh.

## 28. Checklist Verifikasi + Artefak

- [x] `npx tsc --noEmit` — 0 error
- [x] `npm run build` — sukses
- [x] Server prod di `:3001` melayani `/admin/profitability` 200 + tautan nav ter-render
- [x] 85/85 runtime PASS; DB snapshot tanpa duplikat; race satu-200-satu-409
- [x] Tidak ada HPP/costing bocor di `/api/public/menu`
- [x] Cleanup fixture F5 (produk & bahan di-nonaktifkan)

Artefak: `src/services/costing/historical-snapshot.ts`, `src/services/profitability/{types,service}.ts`, `src/services/profitability.service.ts`, `src/app/api/reports/profitability/{route.ts,export/route.ts}`, `src/app/admin/profitability/page.tsx`, nav edits, migration `20260911143644_f5_order_item_cost_snapshot`, `prisma/schema.prisma`.

**Kesimpulan:** F.5 TERKOMPLETS UNTUK PRODUKSI. Port 3000 tidak diubah. Laporan diakhiri.