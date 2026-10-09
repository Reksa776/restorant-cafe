# ACCOUNTING PHASE D2 — MISSING ORDERITEM ROOT-CAUSE AUDIT

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) — tidak berubah sebelum/sesudah
**Mode:** **AUDIT ONLY (read-only)**. Tanpa perubahan source/schema/migration/konfigurasi, tanpa tulis DB, tanpa seed/reset/backfill, tanpa commit/push/deploy/VPS.
**Tanggal:** 2026-10-09
**Referensi:** `ACCOUNTING-PHASE-D1-COGS-INTEGRITY-AUDIT.md`, `ACCOUNTING-PHASE-D1-IMPLEMENTATION-REPORT.md`.
**DB target:** MariaDB lokal `restaurant_app` (`host=localhost:3306`, `@@system_time_zone=WIB`).

> **Legend bukti:** **[Source]** = kode/schema/git. **[Test]** = runtime read-only (SELECT/SHOW) atau grep. **[__/NOT VERIFIED]** = tidak dapat dipastikan dari bukti saat ini.

> **Prinsip:** tidak ada kandidat penyebab yang dinyatakan CONFIRMED tanpa bukti. Setiap kandidat diberi status **CONFIRMED / LIKELY / POSSIBLE / RULED OUT / NOT VERIFIED**.

---

## 0. Ringkasan eksekutif

- Order-order ber-revenue **benar-benar order aplikasi** dengan siklus hidup penuh (payment, riwayat `COMPLETED`, `stockmovement ORDER_COMPLETED`) — sehingga pada suatu titik mereka **memiliki `OrderItem`**. Kini baris `OrderItem`-nya **hilang**, dan `OrderItemCostSnapshot` kosong (konsisten dengan *cascade* dari `OrderItem`). **[Test]**
- **Aplikasi tidak dapat membuat order tanpa item**: satu-satunya jalur produksi (`order.service.ts`) membuat header `order` **dan** `items: { create: … }` di **transaksi yang sama**. Tidak ada jalur produksi yang mem-`delete` Order/OrderItem. **[Source]**
- **Tidak ada jejak penghapusan** di `AuditLog` (44 entri; hanya payment/shift/refund/branch-product), dan `log_bin = OFF` (tanpa binlog). **[Test]**
- **Temuan forensik kuat:** *semua* tabel dasar memiliki `CREATE_TIME` identik **2026-09-12 13:41 WIB** (06:41 UTC), sementara `_prisma_migrations` **mempertahankan** `finished_at` lama (2026-09-05…09-11) dan migrasi berikutnya berjalan normal. Ini adalah *signature* **restore/import dump logis**, **bukan** `prisma migrate reset` (reset akan menulis ulang seluruh `finished_at`). Baris historis (auditlog 09-07…09-11) pun lebih tua dari `CREATE_TIME` tabel → **data diimpor**. **[Test]**
- **Kandidat utama (LIKELY):** hilangnya `OrderItem` berasal dari **jalur restore/import database** (dataset yang dipulihkan tidak memuat `orderitem`/`orderitemcostsnapshot`), bukan dari bug aplikasi. **[LIKELY]**
- **Tidak dapat disimpulkan** perintah/artefak persis dan alasan sumber/import kehilangan item (tidak ada dump `restaurant_app`, tanpa binlog/general log, audit log tidak mencatat operasi level DB). **[NOT VERIFIED]**
- **Kandidat kode yang dituduh di awal sudah dieliminasi** (app bug, cascade penghapusan parent, migration destruktif, seed). Sisa kandidat yang belum bisa dikesampingkan: **penghapusan massal `orderitem` bertarget** (manual SQL) — **[POSSIBLE/NOT VERIFIED]**.

---

## 1. Ruang lingkup & metode (read-only)

- **Source inspection:** `order.service.ts`, `historical-snapshot.ts`, `schema.prisma`, `prisma/migrations/*`, seed, `src/services/reservation/*`, `scripts/*`.
- **Git history** (tanpa checkout/reset): `git log`, `git show --stat` atas commit kolasi `f835e13`.
- **Query read-only** ke MariaDB: agregat, `SHOW CREATE TABLE`, `information_schema.TABLES`, `_prisma_migrations`, `SHOW VARIABLES`, `SHOW DATABASES` — **tanpa INSERT/UPDATE/DELETE/DDL**.
- **Sistem:** pencarian dump/backup (`~/backups`), shell history, akses error log (ditolak izin).
- Tidak ada credential/data pribadi yang ditampilkan; hanya agregat + id/nama entitas bisnis.

---

## 2. Temuan kode & schema

### 2.1 Jalur create/update/delete Order & OrderItem
| Jalur | Lokasi | Membuat item? |
|---|---|---|
| Create order (kasir/checkout) | `src/services/order/order.service.ts` **L495** `tx.order.create({ data: { …, items: { create: orderItems } } })` | **Ya**, nested, transaksi sama **[Source]** |
| Create order (customer) | `order.service.ts` **L1237** — pola identik `items: { create: orderItems }` | **Ya** **[Source]** |
| Snapshot HPP | `order.service.ts` → `createOrderItemCostSnapshots` pada transisi `READY→COMPLETED` | Turunan dari item **[Source]** |

- **Tidak ada** jalur produksi lain yang membuat order: pencarian repo-wide `order.create(`/`order.createMany(` hanya menemukan `order.service.ts` (2) + file test reservasi (2). **[Source/Test]**
- **Tidak ada** `deleteOrder`/`order.delete`/`orderItem.delete` di kode produksi. Semua `deleteMany` order/item berada di **test/fixtures/e2e scripts**. **[Source]**

### 2.2 Foreign key & cascade (constraint DB aktual)
`SHOW CREATE TABLE` (read-only): **[Test]**

| Tabel | FK | Delete rule |
|---|---|---|
| `orderitem` | `orderitem_orderId_fkey → order.id` | **ON DELETE CASCADE** |
| `orderitem` | `orderitem_productId_fkey → product.id` | (tanpa rule → **RESTRICT**) |
| `orderitemcostsnapshot` | `orderitemcostsnapshot_orderItemId_fkey → orderitem.id` | **ON DELETE CASCADE** |
| `orderitemcostsnapshot` | `orderitemcostsnapshot_orderId_fkey → order.id` | (tanpa rule) |
| `order` | `order_customerId_fkey → customer.id` | (tanpa rule) |

**Implikasi:** menghapus/`TRUNCATE` seluruh baris `orderitem` akan **memicu cascade** ke `orderitemcostsnapshot` dan **meninggalkan** `order`, `payment`, `orderstatushistory`, `stockmovement`, `customer` — yaitu **persis** keadaan yang teramati. Menghapus `order` justru **juga** akan menghapus item; jadi urutan bukti (order tetap, item hilang) menunjuk pada **penghapusan item secara langsung/terpisah**.

### 2.3 Migration
- Tidak ada SQL destruktif terhadap order/orderitem: grep `DROP TABLE|DELETE FROM|TRUNCATE|DROP COLUMN|RENAME` di `prisma/migrations/` hanya menemukan **komentar** pada `20261009_add_expense_management`. **[Source]**
- Commit `f835e13` ("align F1-F5 migration collations", 2026-09-11 23:02 WIB) **mengubah file migrasi yang sudah diterapkan** (menambah `ON DELETE RESTRICT` pada beberapa FK, menyelaraskan collation). Mengedit migrasi yang sudah *applied* menyebabkan **drift** pada `prisma migrate dev`. **[Source]** — relevan untuk hipotesis restore/reset (§5).

### 2.4 Script/fixture/seed
| Sumber | Perilaku | Dampak pada dataset nyata |
|---|---|---|
| `prisma/seed.ts` | Membuat restaurant/user/category/product/table/promo — **tidak ada order** | **Tidak relevan** **[Source]** |
| `scripts/phase-*-harness.ts` (b,c,d,g,h0..h4) | Cleanup `orderItem.deleteMany` **lalu** `order.deleteMany`, dibatasi tenant uji (`name startsWith M`, atau restaurant yang dibuat sendiri) | **RULED OUT** untuk dataset ini (order riil tetap ada) **[Source]** |
| `reservation.purchase.fixtures.ts` `cleanupPurchases()` | Hapus refund/payment/history/**orderitem**/order/product/category per `restaurantId` yang diberikan | Dipanggil hanya oleh test dengan `[restA, restB]`/`ids` milik test → **RULED OUT** **[Source]** |
| `scripts/e2e-shift-monitoring.mjs` L276, `e2e-cashier-sales.mjs` L634 | `DELETE FROM orderstatushistory … ; DELETE FROM orderitem … ; DELETE FROM order …` untuk `created.orders` | Menghapus **history juga**; dataset ini masih punya history → **RULED OUT** **[Source/Test]** |
| `reservation.payment.test.ts` `seedReservation` | `prisma.order.create` **tanpa items** (header saja) | Hanya untuk restaurant uji yang dibuat test; dibersihkan di `after()` → **RULED OUT** untuk order riil **[Source]** |
| Script raw SQL `INSERT INTO \`order\`` | `scripts/e2e-kasir-payment-branding-v2.mjs` L413/L446 — order **PENDING/UNPAID** untuk tenant *foreign*/branch uji, di-`DELETE` di cleanup | Tidak cocok (order riil status PAID/COMPLETED, tetap ada) **[Source/Test]** |
| Import script order (Prisma) | **Tidak ditemukan** | — **[NOT VERIFIED]** |

### 2.5 AuditLog & OrderStatusHistory
- `AuditLog`: 44 entri, **tidak ada** aksi delete/wipe (`PAYMENT_RECEIVED` 10, `SHIFT_OPENED` 7, `SHIFT_CLOSED` 6, `BRANCH_PRODUCT_UPDATED` 10, `REFUND_REQUESTED/APPROVED`, `USER_*`, `BRANCH_CREATED`). **[Test]**
- **Catatan:** audit log aplikasi hanya mencatat aksi lewat service; operasi SQL di luar aplikasi (restore, TRUNCATE manual) **tidak** akan tercatat. Jadi absennya aksi delete **tidak** membuktikan tidak ada penghapusan DB.
- `OrderStatusHistory`: 108 baris (PENDING 35, CONFIRMED 12, PROCESSING 21, READY 17, COMPLETED 16, CANCELLED 7) — **lengkap**, termasuk untuk order yang item-nya hilang. **[Test]**

---

## 3. Timeline / bukti yang tersedia

### 3.1 Rekonsiliasi data (agregat aman)
| Metrik | Nilai | Bukti |
|---|---|---|
| `order` | 35 | **[Test]** |
| `orderitem` | **1** (hanya untuk order Oct-06) | **[Test]** |
| `orderitemcostsnapshot` | **0** | **[Test]** |
| Order ber-revenue (PAID/refunded) | **16 order / Rp517.000** — **0 item** | **[Test]** |
| Order dengan item | 34 order = 0 item; **1 order = 1 item** | **[Test]** |
| Order PAID | 15; **semua** punya baris `payment`; 13 punya history `COMPLETED`; **8** punya `stockmovement ORDER_COMPLETED` | **[Test]** |
| `payment` / `paymenttransaction` | 46 / 29; 33 order tertaut payment | **[Test]** |
| Orphan order (customer hilang) | 0 | **[Test]** |
| Refund | 2 (1 APPROVED 30.000; 1 PENDING 30.000) — keduanya menunjuk order **0 item** | **[Test]** |

**Kesimpulan §3.1:** order-order itu **nyata** dan **pernah** melalui pembayaran + penyelesaian + pemotongan stok — yang menurut kode **mensyaratkan adanya `OrderItem`**. Item-item itulah yang kini hilang.

### 3.2 Marker forensik waktu (paling menentukan)
- `information_schema.TABLES`: **semua tabel dasar** (restaurant, order, orderitem, orderitemcostsnapshot, payment, customer, orderstatushistory, stockmovement, product, dll.) memiliki `CREATE_TIME` **2026-09-12 13:41 WIB** (06:41 UTC) — satu burst. Migrasi setelahnya membuat tabel pada waktunya masing-masing (branchproduct 16:09 WIB = 09:09 UTC; refunditem 17:43; addon/option 18:18; reservation 09-19; tablelayout 09-19; expense 10-09). **[Test]**
- `_prisma_migrations` **tetap** mencatat `0000_init_schema` (09-05) … `f5_order_item_cost_snapshot` (09-11) dengan `finished_at` lama — **tidak** di-rewrite pada 09-12. **[Test]**
- Baris historis lebih tua dari `CREATE_TIME`: auditlog 09-07…09-11, order 09-06…09-11, payment 09-06…. **[Test]**
- `@@system_time_zone = WIB`; `NOW()=2026-10-09 08:37 WIB` vs `UTC_TIMESTAMP()=01:37` → konversi tz terkonfirmasi (nilai `CREATE_TIME` adalah wall-clock WIB). **[Test]**

**Interpretasi:** `mysqldump` (DROP+CREATE+INSERT) yang diimpor akan **(a)** memberi `CREATE_TIME` seragam = waktu import, dan **(b)** menyalin baris `_prisma_migrations` **dengan timestamp aslinya**. Kedua ciri terpenuhi. Sebaliknya, `prisma migrate reset` akan **menulis ulang** semua `finished_at` ke waktu reset — **tidak** teramati. Karena itu: **restore/import dump logis** adalah penjelasan paling konsisten. **[Test → LIKELY]**

### 3.3 Keterbatasan forensik
- `log_bin = OFF`; `general_log = OFF`; `/var/log/mariadb/mariadb.log` **tidak dapat dibaca** (permission). **[Test]**
- Shell history (`~/.bash_history`, 190 baris) **tidak** memuat perintah `mysqldump`/`mysql`/`TRUNCATE`/`orderitem`. **[Test]**
- `~/backups/` hanya berisi dump proyek **lain** (`tinggalklik_*.sql`, 2026-09-16). **Tidak ada** dump `restaurant_app`. **[Test]**
- `SHOW DATABASES`: `restaurant_app`, `prisma_migrate_shadow_db`, + DB proyek lain — tidak ada `restaurant_app_backup`. **[Test]**

---

## 4. Analisis jalur: bisakah order/payment tersimpan tanpa item?

| Pertanyaan | Jawaban | Bukti |
|---|---|---|
| Bisa membuat order tanpa item dari aplikasi? | **Tidak** — header + item nested dalam 1 `order.create` bertransaksi | **[Source]** |
| Bisa membayar order tanpa item? | **Bisa** (payment hanya menunjuk order), tetapi order seperti itu hanya muncul jika item sudah hilang sebelum/atau tidak pernah ada | **[Source]** |
| Bisa menghapus OrderItem terpisah? | **Ya, hanya lewat SQL/test** — tak ada API/service produksi | **[Source]** |
| Bisa hilang lewat penghapusan parent? | Order → item **akan** cascade (order jadi hilang juga); tidak teramati | **[Source/Test]** |
| Product → item cascade? | **Tidak** (RESTRICT); produk dihapus akan tertolak bila item ada | **[Test]** |
| Ada transaksi parsial order tanpa item? | Tidak ditemukan di kode produksi | **[Source]** |

---

## 5. Kandidat penyebab (status)

| # | Kandidat | Status | Alasan berbasis bukti |
|---|---|---|---|
| **C1** | **Restore/import database** pada 2026-09-12 yang tidak menyertakan data `orderitem`/`orderitemcostsnapshot` | **LIKELY** | `CREATE_TIME` seragam 2026-09-12 untuk semua tabel dasar + `_prisma_migrations` mempertahankan timestamp lama + baris historis lebih tua dari tabel ⇒ restore dump; item/snapshot seragam absen |
| **C2** | **Penghapusan massal `orderitem` bertarget** (manual SQL `DELETE`/`TRUNCATE`, memicu cascade snapshot) | **POSSIBLE / NOT VERIFIED** | FK cascade mereproduksi keadaan persis; tetapi tanpa binlog/general log/shell history, tidak ada bukti eksekusi |
| **C3** | **Bug aplikasi** membuat order tanpa item | **RULED OUT** | Kedua jalur produksi selalu membuat item secara nested & atomik; hanya 2 `order.create` produksi; tidak ada jalur delete produksi |
| **C4** | **Cascade penghapusan parent** (order/product/restaurant) | **RULED OUT** | `order`, `product`, `customer`, `restaurant` masih ada; order punya history/payment/stok |
| **C5** | **Cleanup test/fixture/e2e** menghapus item dataset nyata | **RULED OUT** | Semua menargetkan tenant/order miliknya sendiri, atau menghapus `order`+`history` sekaligus (yang tetap ada di dataset ini) |
| **C6** | **Migration destruktif** | **RULED OUT** | Tidak ada `DROP/DELETE/TRUNCATE` pada order/orderitem di migrasi |
| **C7** | **Seed/fixture/import script membuat order headless** | **RULED OUT (seed)** / **NOT VERIFIED (import script)** | `seed.ts` tidak membuat order; tidak ada import script di repo; test reservasi membuat headless hanya untuk tenant ujinya |
| **C8** | **`prisma db push`/`migrate reset`** | **POSSIBLE / NOT VERIFIED** | `prisma_migrate_shadow_db` ada (indikasi `migrate dev`); migrasi di-edit pada `f835e13` memicu drift. Namun reset akan me-rewrite `_prisma_migrations` → tidak teramati; `db push` destruktif akan menghapus data order juga → tidak teramati |
| **C9** | **Order dibuat headless oleh tooling pihak ketiga** (bukan repo ini) | **NOT VERIFIED** | Tidak ada bukti |

---

## 6. Apakah akar masalah dapat ditentukan dari bukti saat ini?

**Sebagian — mekanisme dapat dipastikan, perintah persisnya tidak.**

- **Dapat dipastikan (CONFIRMED):**
  1. Order ber-revenue adalah order aplikasi nyata (orderNumber, customer, payment, `COMPLETED` history, `stockmovement`) yang **pernah memiliki item**.
  2. Baris `OrderItem` kini **hilang**; `OrderItemCostSnapshot` **kosong** (konsisten cascade `orderitem→snapshot`).
  3. **Aplikasi tidak dapat** membuat atau menghapus hanya `OrderItem`; tidak ada migration destruktif; tidak ada jejak di `AuditLog`.
  4. Terdapat **peristiwa rebuild/import database pada 2026-09-12 13:41 WIB** (semua tabel dasar `CREATE_TIME` seragam; `_prisma_migrations` lama dipertahankan).
- **Tidak dapat dipastikan (NOT VERIFIED):**
  5. Perintah/artefak restore spesifik dan mengapa sumber/import tidak memuat item (tidak ada dump `restaurant_app`, binlog OFF, general log OFF, error log tidak terbaca).
  6. Apakah item pernah ada **setelah** Sep-12 lalu dihapus (ada 2 order pasca-rebuild: Sep-20 **0 item**, Oct-06 **1 item**) — menunjukkan kehilangan item **tidak terbatas pada pra-Sep-12**, sehingga **tidak mengesampingkan** penghapusan bertarget pasca-restore (C2).

> Catatan: order **Sep-20** yang dibuat **setelah** rebuild juga headless, sedangkan order **Oct-06** memiliki item. Ini melemahkan hipotesis "restore tunggal pra-Sep-12" sebagai satu-satunya penjelasan, dan menaikkan bobot **C2 (penghapusan bertarget) / restore data-only yang lebih baru**. Keduanya tetap **[NOT VERIFIED]** tanpa log.

---

## 7. Dampak ke Revenue, COGS, Profitabilitas, P&L

| Area | Dampak | Status mitigasi |
|---|---|---|
| **Revenue** | Order tanpa item tetap dihitung revenue (header `grandTotal`): 16 order / Rp517.000; Net Sales Rp487.000. Revenue kanonik tidak diubah (benar untuk order yang memang terjadi) | Tidak diubah (sesuai D2) |
| **COGS** | Tidak dapat diverifikasi (0 item, 0 snapshot). Sebelum D1, ini tampil sebagai `cogs=0`/`COVERED` | **Sudah dimitigasi D1**: `NO_ITEMS`, `coverageComplete=false` |
| **Profitabilitas** | Gross Profit = null (tidak diketahui), bukan 100% margin | **Sudah dimitigasi D1** |
| **P&L** | Gross Profit & Net Profit = null; disclosure `revenueWithoutItems` = {16 order, Rp517.000} | **Sudah dimitigasi D1** |
| **Data historis** | Tidak ada COGS historis untuk periode terdampak; snapshot tidak dapat direkonstruksi (F.5 melarang backfill) | Tidak diperbaiki (di luar scope D2) |

**Risiko residual:** selama data item/snapshot tidak dipulihkan (dari sumber otoritatif), laporan historis akan menampilkan revenue tanpa COGS; D1 memastikan ini **dinyatakan tidak diketahui**, bukan dinolkan.

---

## 8. Rekomendasi perbaikan paling minimal (belum diimplementasikan)

1. **Jangan backfill snapshot / jangan membuat ulang item** (melanggar aturan F.5 dan berisiko memalsukan data). **[kebijakan]**
2. **Pertahankan guard & disclosure D1** (`NO_ITEMS`, `coverageComplete=false`, `revenueWithoutItems`) sebagai jaring pengaman permanen. **[sudah ada]**
3. **Tambahkan pemeriksaan integritas read-only** (admin/CI) yang mendeteksi "order ber-revenue tanpa item" dan "order COMPLETED tanpa snapshot" menggunakan agregat; ini mengubah insiden tak terlihat menjadi terlihat. Reuse query `revenueWithoutItems` D1. **[kode kecil, terpisah]**
4. **Disiplin backup/restore (ops, bukan kode):** sebelum restore, ambil backup; verifikasi jumlah baris `orderitem` dan `orderitemcostsnapshot` setelah restore; gunakan `mysqldump --single-transaction` + cek FK orphan. Simpan dump `restaurant_app` di lokasi terkelola. **[proses]**
5. **Aktifkan log forensik** (binlog/general log) di lingkungan dev bila investigasi data di masa depan diperlukan. **[ops, di luar scope]**
6. **Pisahkan data uji dari data riil**: jalankan harness/e2e hanya pada database/tenant bertag (`M*`/smoke). Praktik ini sudah diterapkan pada harness saat ini — pertahankan. **[proses]**
7. **Jika COGS historis harus dipulihkan**, itu adalah tugas terpisah dengan sumber otoritatif (dump/cetakan) dan persetujuan eksplisit — **bukan** bagian D2. **[NOT VERIFIED sumber]**

---

## 9. Test plan untuk perbaikan di masa depan (belum dijalankan)

1. **Integritas pasca-restore (script read-only):** bandingkan `COUNT(order)` vs `COUNT(DISTINCT orderId) FROM orderitem`; laporkan order ber-revenue tanpa item & order `COMPLETED` tanpa snapshot.
2. **Unit/disclosure:** order ber-revenue tanpa item ⇒ `revenueWithoutItems.orders > 0`; Profitabilitas/P&L ⇒ `grossProfit=null` (sudah dicakup D1).
3. **Fixture create-order:** buat order lewat `orderService` (dengan item) ⇒ pastikan item + (setelah COMPLETED) snapshot tercipta; simulasi headless hanya via SQL uji ⇒ disclosure memicu.
4. **Guard cleanup harness:** uji bahwa `cleanupPurchases`/harness hanya menyentuh tenant bertag (regresi isolasi).
5. **Restore drill:** pulihkan dump ke DB uji dan verifikasi jumlah baris per tabel (orderitem, orderitemcostsnapshot) sama dengan sumber.

**Catatan:** D2 tidak membuat/menjalankan test apa pun (audit-only).

---

## 10. Git status sebelum/sesudah & konfirmasi tidak ada perubahan

| Item | Sebelum audit D2 | Sesudah audit D2 |
|---|---|---|
| HEAD | `d7f29ac` | `d7f29ac` (**tidak berubah**) |
| Modified (tracked) | 29 | 29 (**tidak berubah**) |
| Staged | 0 | 0 |
| Untracked | 55 | **56** (+1 laporan ini; tidak ada file temp) |
| `prisma/` numstat | `78  0  prisma/schema.prisma` | `78  0  prisma/schema.prisma` (**tidak berubah**) |
| Source/schema/migration/config diubah | — | **tidak ada** |
| Tulis/ubah data DB (DML/DDL) | — | **tidak ada** (hanya SELECT/SHOW) |
| Seed/reset/backfill | — | **tidak ada** |
| Commit/push/deploy/VPS | — | **tidak ada** |
| File temp | — | **tidak ada** (semua query via `node -e` inline) |

Seluruh pekerjaan existing & uncommitted (termasuk hasil D1) dipertahankan utuh.

---

## 11. Kesimpulan

- **Bukan bug aplikasi.** Aplikasi selalu membuat order beserta item dalam satu transaksi, dan tidak punya jalur menghapus item saja.
- **Order riil pernah memiliki item** (payment + `COMPLETED` history + stok), lalu item-nya hilang, memicu cascade snapshot.
- **Bukti forensik menunjuk pada peristiwa restore/import database pada 2026-09-12** sebagai konteks hilangnya data — **LIKELY**, bukan CONFIRMED.
- **Penyebab persis (perintah/artefak) tidak dapat ditentukan** dari bukti saat ini (tanpa binlog, general log, error log, atau dump `restaurant_app`) — **NOT VERIFIED**.
- Dampak terhadap laporan **sudah dikelola** oleh perbaikan D1; rekomendasi D2 bersifat **proses/pemantauan**, bukan perubahan data.

**STOP** — audit selesai. Tidak ada coding/perbaikan data. Menunggu review.
