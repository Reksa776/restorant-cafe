# ACCOUNTING INTEGRITY MONITORING — AUDIT

**Scope:** Apakah sistem dapat mendeteksi (1) order ber-revenue **tanpa OrderItem**, (2) order **COMPLETED tanpa OrderItemCostSnapshot**, (3) **ketidaksesuaian jumlah** Order/OrderItem/snapshot, dan apakah pemeriksaan bisa **efisien & tenant-scoped**, serta apakah **query/helper existing dapat digunakan kembali**.

**Aturan yang dipatuhi:** audit & rekomendasi saja — **tidak ada** perubahan source/schema/migration/config, **tidak ada** DML/DDL/seed/reset/backfill, **tidak ada** penghapusan/recreate OrderItem historis, **tidak ada** commit/push/deploy/akses production. Seluruh pemeriksaan bersifat read-only (`SELECT`/`grep`/`git`). Tidak memulai Phase E.

**Referensi yang dibaca:** `ACCOUNTING-PHASE-D1-COGS-INTEGRITY-AUDIT.md`, `ACCOUNTING-PHASE-D1-IMPLEMENTATION-REPORT.md`, `ACCOUNTING-PHASE-D2-MISSING-ORDERITEM-AUDIT.md`.

---

## 1. Existing Functionality

Sistem **sudah** memiliki deteksi sebagian, tetapi **bukan** sebagai fitur monitoring tersendiri — deteksi melekat sebagai *side effect* laporan periodik.

| # | Kebutuhan deteksi | Sudah ada? | Di mana | Bentuk |
|---|---|---|---|---|
| 1 | Order ber-revenue tanpa OrderItem | **Sebagian** | `src/services/profitability/profitability.service.ts` L~349 & L~639 | Agregat `revenueWithoutItems = { orders, headerValue }` di `summary` (Prisma `order.aggregate({ where: {...soldWhere, items: { none: {} }}, _count, _sum.grandTotal })`) |
| 2 | Order COMPLETED tanpa snapshot | **Sebagian** | `profitability.service.ts` L~287 (`coverageRow`) | Bucket agregat `legacyOrderItems = SUM(o.status='COMPLETED' AND s.id IS NULL)`; ditampilkan sebagai peringatan "legacy/COGS tidak tersedia" |
| 3 | Ketidaksesuaian jumlah Order / OrderItem / snapshot | **Tidak** | — | Tidak ada agregat reconciliation |
| — | Konsumen hilir | Ya | `src/services/accounting/pnl.service.ts` L168–169 (`disclosure.revenueWithoutItems`), `grossProfit/netProfit = null` saat `coverageComplete=false`; Menu Engineering (`isCoverageComplete`/`isItemSetCoverageComplete`) | Disclosure/guard |
| — | Tampilan UI | Ya | `src/app/admin/profitability/page.tsx` L150/L316–318/L352; `src/app/admin/accounting/pnl/page.tsx` L359–361/L375–376; `src/app/admin/menu-engineering/page.tsx` L176/L357 | Disclosure di halaman laporan |
| — | Ekspor | Ya (tidak langsung) | `src/app/api/admin/accounting/pnl/export/route.ts` L109–110 | Kolom disclosure di CSV P&L |

**Kesimpulan §1:** deteksi #1 dan #2 **ada** tetapi (a) terikat periode (`soldWhere.createdAt` di dalam range), (b) hanya angka agregat **tanpa daftar order ID**, (c) bukan endpoint/monitor tersendiri, (d) #2 tidak memisahkan "legacy yang wajar" dari "anomali", dan (e) #3 **sama sekali belum ada**.

---

## 2. Gap Monitoring

| Gap | Deskripsi | Dampak |
|---|---|---|
| **G1 — Tidak ada endpoint/page monitor** | Tidak ada route `/api/admin/accounting/integrity` (atau sejenis); tidak ada halaman `admin/.../integrity`. Deteksi hanya muncul bila admin membuka Profitabilitas/P&L dengan periode yang tepat. | Insiden tidak terlihat secara proaktif. |
| **G2 — Terikat periode** | `soldWhere` membatasi `createdAt` ke `range`. Anomali order di luar periode terpilih **tak terdeteksi**. | Order headless lama (mis. Sep-20 pada D2) tak muncul saat melihat periode lain. |
| **G3 — Tanpa daftar/severity/#1** | `revenueWithoutItems` hanya `{ orders, headerValue }` — tanpa order ID, tanpa per-branch, tanpa level keparahan. | Tidak actionable untuk ditindaklanjuti. |
| **G4 — Legacy vs anomali (#2)** | `legacyOrderItems` mencampur order COMPLETED pra-F.5 (memang tanpa snapshot, wajar) dengan anomali sungguhan. Hanya bucket terpisah di dalam coverage; tak ada cutoff/tanggal untuk membedakan. | Risiko false alarm atau false negative. |
| **G5 — Tanpa rekonsiliasi jumlah (#3)** | Tidak ada pembanding `COUNT(order)` vs `COUNT(orderitem)` vs `COUNT(orderitemcostsnapshot)` (total & per status). | Ketidaksesuaian jumlah tak terukur. |
| **G6 — Tanpa penjadwalan/alerting** | `package.json` hanya punya worker WhatsApp (`worker:dev`); tidak ada cron/scheduler/queue/health check untuk integritas. Tidak ada `AuditLog` dari pemeriksaan. | Tidak ada deteksi berkala; temuan tidak terekam. |
| **G7 — Tanpa UI/ekspor integritas** | Tidak ada halaman/CSV khusus integritas. | Sulit dioperasikan tim finance. |
| **G8 — Tanpa cek konsistensi FK/kaskade** | Tidak ada pemeriksaan snapshot tanpa item (secara FK tak mungkin), item tanpa order, order orphan, dsb. | Celah integritas lain tak terjaga. |

---

## 3. Query/Helper yang Bisa Digunakan Kembali

**A. Predikat revenue (WAJIB reuse — jangan duplikasi):**
- `src/services/report/report.service.ts`: `resolveReportRange()` (L68), `revenueWhere()` (L199, *THE single revenue predicate*), `revenueScopeWhere()` (L220, tanpa batas tanggal), `reportBaseWhere()`.
- Di Profitabilitas: `soldScopeWhere` (revenue set tanpa tanggal) dan `soldWhere` (= +`createdAt`). Monitor sebaiknya reuse **bentuk** `soldScopeWhere` + `range` opsional.

**B. Agregat deteksi #1 (sudah persis):**
```ts
prisma.order.aggregate({
  where: { ...revenueScopeWhere(...), items: { none: {} } }, // + opsional branch/orderType/paymentMethod
  _count: { _all: true },
  _sum: { grandTotal: true },
})
```

**C. SQL coverage deteksi #2 (sudah ada, `coverageRow` di `profitability.service.ts` L~270–305):**
```sql
SUM(CASE WHEN o.`status` = 'COMPLETED' AND s.`id` IS NULL THEN 1 ELSE 0 END) AS legacyOrderItems
-- FROM orderitem oi JOIN order o LEFT JOIN orderitemcostsnapshot s ON s.orderItemId = oi.id
```
Pola yang sama dapat diperluas menjadi daftar order ID + jumlah item.

**D. Aturan coverage murni (tanpa DB) — reusable 100%:**
- `src/services/profitability/coverage.ts`: `deriveCogsState()`, `isCoverageComplete()`, `isItemSetCoverageComplete()` — sudah dipakai Profitabilitas + Menu Engineering, sudah diuji (`coverage.unit.test.ts`).

**E. Scoping & auth (reuse):**
- `src/lib/auth-helpers.ts`: `requireAdmin`, `branchHintFrom`, `authorizedBranches`, `assertBranchInScope`.
- `src/lib/api-response.ts`: `successResponse`, `errorResponse`.

**F. Pola route admin (reuse):**
- `src/app/api/admin/accounting/pnl/route.ts` & `src/app/api/admin/audit-logs/route.ts` — `requireAdmin(branchHintFrom(request))`, `assertBranchInScope`, Zod-validasi, `AppError` handling.

**Referensi indeks (deteksi bisa memakai index):**
- `order`: `@@index([restaurantId])`, `[branchId]`, `[status]`, `[paymentStatus]`, `[createdAt]`.
- `orderitem`: `@@index([orderId])`, `[productId]`.
- `orderitemcostsnapshot`: `orderItemId @unique`, `@@index([orderId])`, `[completedAt]`, `[status]`, FK `restaurantId`.

`orderitem` **tidak** punya kolom `restaurantId` → scoping tenant **harus** lewat JOIN ke `order`; sedangkan `orderitemcostsnapshot` punya `restaurantId` langsung.

---

## 4. Rekomendasi Implementasi Minimal

**Prinsip:** read-only, ADMIN-only, tanpa schema/migration, reuse helper existing, jangan mengubah query laporan.

**Bentuk minimal yang disarankan:**
1. **Service baru** `src/services/accounting/integrity.service.ts` (+ `integrity.types.ts`) dengan 3 pemeriksaan, tiap pemeriksaan mengembalikan `{ status: "OK" | "WARN" | "CRITICAL", count, sampleIds[], detail }`:
   - **C1 — revenue orders tanpa item:** reuse agregat §3.B. Default **all-time** (atau `?period` opsional) supaya anomali di luar periode tetap terlihat.
   - **C2 — COMPLETED tanpa snapshot:** reuse SQL §3.C. **Penting:** jangan alarm `CRITICAL` untuk order pra-F.5; sediakan opsional `since` (cutoff) atau tandai bucket "expected legacy" vs "unexpected" agar tidak false alarm (lihat §8).
   - **C3 — rekonsiliasi jumlah:** `COUNT(order)` pada revenue set, `COUNT(orderitem)` (JOIN order), `COUNT(orderitemcostsnapshot)` total & per `status` (`SNAPSHOTTED`/`LEGACY`/lain), plus invarian: jumlah snapshot ≤ jumlah item; 0 order orphan yang masih ber-revenue. Kembalikan `reconciled: boolean` + selisih.
2. **Route baru** `src/app/api/admin/accounting/integrity/route.ts` (`GET`), mengikuti pola §3.F: `restaurantId` dari sesi, branch via `authorizedBranches` + `assertBranchInScope`, parameternya Zod-validasi. Reuse `successResponse`/`errorResponse`.
3. **(Opsional) UI minimal:** halaman `src/app/admin/accounting/integrity/page.tsx` + 1 entri nav di grup **Finance** (`src/app/admin/layout.tsx`, ikon mis. `ShieldAlert`, `roles:["ADMIN"]`) mengikuti pola Phase B/C/D. Cukup tabel 3 baris (check, status, count, sample).
4. **(Opsional) Ekspor CSV** memakai helper `src/lib/csv.ts`.
5. **(Opsional) Rekam temuan** sebagai `AuditLog` (action baru, tanpa migration — cek enum/action existing) bila ingin jejak operasional.
6. **Penjadwalan: TIDAK disarankan pada langkah minimal** (tidak ada infrastruktur cron/queue; menambahkannya = scope besar). Mulai dari on-demand admin endpoint; jadwalkan di fase terpisah bila diperlukan.

**Eksplisit BUKAN rekomendasi:** backfill/recreate OrderItem historis, mengubah `deriveCogsState`, atau menyatukan query ke dalam laporan periodik (cukup *reuse*).

---

## 5. Dampak Performa dan Keamanan Tenant

**Performansi:**
- Deteksi C1/C2/C3 memakai **agregat** (`COUNT`/`SUM`) dengan join ke index (`orderitem.orderId`, `orderitemcostsnapshot.orderItemId UNIQUE`/`orderId`, `order.restaurantId`/`createdAt`). Tidak ada pemindaian per-baris di JS.
- Agregat **all-time** bersifat O(jumlah baris) lewat index/covering — dapat diterima untuk **on-demand ADMIN**, tetapi pada volume besar sebaiknya:
  - sediakan default window (mis. 90 hari) atau flag `allTime=true` eksplisit;
  - batasi `sampleIds` dengan `LIMIT` (bukan mengembalikan seluruh daftar);
  - (opsional) cache hasil beberapa menit.
- Rekomendasi: satu `Promise.all` untuk 3 pemeriksaan; hindari query per-branch N+1 (gunakan `GROUP BY branchId` bila per-branch diminta).

**Keamanan tenant:**
- `restaurantId` **selalu** dari sesi (`requireAdmin`), **tidak pernah** dari query string (mengikuti `pnl/route.ts`).
- Branch: `authorizedBranches(ctx)` selalu diterapkan; `branchId` eksplisit divalidasi `assertBranchInScope`.
- Scoping snapshot langsung (`restaurantId` di tabel); scoping orderitem **wajib** JOIN `order` (tidak punya `restaurantId`).
- **ADMIN-only** (mengekspos nilai/COGS). Read-only, tanpa PII (order number/ID saja).
- Risiko utama: lupa menerapkan branch filter pada sql `$queryRaw` → selalu join predicate tenant pada setiap raw query.

---

## 6. File yang Mungkin Perlu Diubah

**Baru:**
- `src/services/accounting/integrity.service.ts`
- `src/services/accounting/integrity.types.ts`
- `src/app/api/admin/accounting/integrity/route.ts`
- (opsional) `src/app/admin/accounting/integrity/page.tsx`
- (opsional) `src/app/api/admin/accounting/integrity/export/route.ts`
- (opsional) test: `src/services/accounting/integrity.unit.test.ts` + integration read-only

**Diedit (minimal, opsional):**
- `src/app/admin/layout.tsx` — 1 entri nav di grup Finance (jika UI ditambahkan).

**Reuse tanpa perubahan:** `src/services/profitability/coverage.ts`, `src/services/report/report.service.ts` (`resolveReportRange`/`revenueWhere`), `src/lib/auth-helpers.ts`, `src/lib/api-response.ts`, `src/lib/csv.ts`.

**Tidak diubah:** `prisma/schema.prisma`, `prisma/migrations/*`, query `profitability.service.ts`/`pnl.service.ts` (hanya dibaca/di-reuse).

---

## 7. Test Plan

**Unit (tanpa DB):**
- Klasifikasi status integritas (`OK/WARN/CRITICAL`) dari angka agregat — murni, deterministik.
- Kasus batas: 0 order, 0 item, snapshot 0 tetapi item > 0, snapshot > item (harus tak mungkin), all-complete.

**Integration (read-only terhadap DB saat ini):**
- **C1** cocok dengan baseline D1/D2: `revenueWithoutItems = { orders: 16, headerValue: 517000 }` (all-time) — paritas dengan `summary.revenueWithoutItems` Profitabilitas all-time.
- **C2** mengembalikan jumlah `legacyOrderItems` yang konsisten dengan coverage Profitabilitas pada window yang sama.
- **C3** `COUNT(order)`/`COUNT(orderitem)`/`COUNT(orderitemcostsnapshot)` konsisten; `reconciled` benar/salah sesuai data.
- **Isolasi tenant/branch:** memanggil sebagai tenant/branch lain ⇒ hitungan 0 untuk data tenant pertama (regresi kebocoran scope).
- **Kondisi bersih:** pada tenant tanpa anomali ⇒ semua `OK`.

**Perf smoke:** ukur waktu 3 pemeriksaan pada volume seed; pastikan memakai index (`EXPLAIN` opsional).

**Regresi:**
- Angka Profitabilitas/P&L **tidak berubah** (monitor read-only, tidak menyentuh query laporan).
- Tidak ada `INSERT/UPDATE/DELETE/DDL` yang dijalankan (verifikasi via log/permission atau inspeksi).

---

## 8. Risiko / Regression

| Risiko | Penjelasan | Mitigasi |
|---|---|---|
| **R1 — Duplikasi predikat revenue** | Jika monitor menulis ulang logika "revenue set", angka bisa menyimpang dari laporan. | **Wajib** reuse `revenueWhere`/`revenueScopeWhere` (report.service) atau bentuk `soldScopeWhere`; jangan reimplementasi. |
| **R2 — False alarm legacy (#2)** | Order COMPLETED pra-F.5 memang tanpa snapshot (wajar). | Beri cutoff/bucket "expected legacy"; jangan `CRITICAL` hanya karena legacy; dokumentasikan baseline. |
| **R3 — Performa all-time** | Agregat besar pada tabel tumbuh. | Default window / `LIMIT` sample / cache / indeks existing. |
| **R4 — Kebocoran tenant** | Raw SQL tanpa predicate tenant/branch. | Selalu apply `restaurantId` dari sesi + `authorizedBranches`; JOIN `order` untuk `orderitem`. |
| **R5 — Mutasi tak sengaja** | Menambah perbaikan otomatis/backfill. | Monitor **read-only**; perbaikan data = keputusan terpisah (dilarang di sini). |
| **R6 — Rasa aman palsu** | Monitor hijau dianggap data pasti utuh. | Dokumentasikan batas: hanya 3 invarian; bukan jaminan provenance. |
| **R7 — Scope creep** | Menambah scheduler/alerting besar. | Tunda penjadwalan ke fase terpisah. |
| **R8 — Konflik dengan pekerjaan uncommitted** | Mengedit file yang sedang dimodifikasi. | Cek `git status` sebelum implementasi; sentuh sesedikit mungkin (idealnya file baru saja). |

---

## 9. Git Status Sebelum/Sesudah & Konfirmasi

**Sebelum penulisan laporan ini:**
```
HEAD=d7f29ac
modified tracked = 29, staged = 0, untracked = 56
git diff --numstat -- prisma/  →  78  0  prisma/schema.prisma   (hanya whitespace/format, UNCHANGED oleh audit ini)
```

**Sesudah penulisan laporan ini:** hanya bertambah **satu file baru** `ACCOUNTING-INTEGRITY-MONITORING-AUDIT.md` (untracked 56 → 57). Tidak ada file lain dibuat/diubah/dihapus.

**Konfirmasi kepatuhan:**
- ✅ Tidak ada perubahan **source** (tidak ada `.ts`/`.tsx` disentuh).
- ✅ Tidak ada perubahan **schema/migration/config** (`prisma/` numstat tetap `78 0`).
- ✅ Tidak ada perubahan **data**: seluruh perintah hanya `SELECT`/`SHOW`/`grep`/`git log`/`git diff`/`git status`.
- ✅ Tidak menjalankan `INSERT`/`UPDATE`/`DELETE`/DDL/seed/reset/backfill.
- ✅ Tidak menghapus/membuat ulang OrderItem historis.
- ✅ Tidak commit/push/deploy, tidak mengakses VPS/production.
- ✅ Tidak memulai Phase E.

---

## Ringkasan Jawaban atas 5 Pertanyaan

1. **Order ber-revenue tanpa OrderItem:** **Dapat dideteksi sebagian** — agregat `revenueWithoutItems` sudah ada (Profitabilitas/P&L), tetapi terikat periode & tanpa daftar order ID.
2. **Order COMPLETED tanpa OrderItemCostSnapshot:** **Dapat dideteksi sebagian** — bucket `legacyOrderItems`; tetapi tercampur legacy wajar vs anomali.
3. **Ketidaksesuaian jumlah Order/OrderItem/snapshot:** **Belum dapat dideteksi** — tidak ada agregat rekonsiliasi.
4. **Efisien & tenant-scoped:** **Bisa efisien** (agregat + index; join `order` untuk tenant). Perlu default window/`LIMIT` untuk all-time pada volume besar.
5. **Query/helper reusable:** **Ya** — `coverage.ts` (murni), `revenueWhere`/`revenueScopeWhere`/`resolveReportRange` (report.service), pola agregat `revenueWithoutItems` & SQL `coverageRow`, `auth-helpers`, `api-response`.

**Rekomendasi:** monitor read-only ADMIN-only (`integrity.service.ts` + endpoint), reuse helper existing, tanpa schema/migration, mulai on-demand (penjadwalan fase terpisah).

**STATUS: SELESAI — AUDIT/RECOMMENDATION ONLY. STOP & tunggu review. Tidak ada implementasi dijalankan.**
