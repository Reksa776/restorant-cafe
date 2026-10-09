# PHASE 9B-F8 — SCOPE CONFIRMATION & AUDIT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (tidak berubah):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Jenis:** AUDIT ONLY — tanpa perubahan source/schema/migration/seed/data; tanpa commit/push/deploy; tanpa akses VPS/production.
**Tanggal:** 2026-10-09
**Sumber:** `PHASE9B-F2-F8-AUDIT.md` (definisi F8), `PHASE9B-F2-FIX-REPORT.md`, `PHASE9B-F4-REVENUE-CONSOLIDATION-REPORT.md`,
`PHASE9B-F5-CUSTOMER-REVENUE-ALIGNMENT-REPORT.md`, `PHASE9B-F3-FIX-REPORT.md`, `PHASE9B-F6-SCOPE-AUDIT.md`,
`PHASE9B-F7-SCOPE-AUDIT.md`, `PHASE9B-F7-UI-LABEL-REPORT.md`, serta code/schema saat ini.

---

## 1. Original finding dan acceptance criteria (verbatim scope)

Dari `PHASE9B-F2-F8-AUDIT.md` §F8:

- **Judul:** Cross-tenant `orderId` protection is structural, not constraint-enforced.
- **Severity:** INFO (structurally safe; no DB-level guarantee).
- **Status (audit):** CONFIRMED secara struktural; NOT REPRODUCED saat runtime.
- **Root cause:** `Reservation.orderId` adalah **scalar nullable tanpa Prisma relation / FK** ke `Order`. Tidak ada
  apa pun di level database yang mencegah satu baris reservasi menyimpan `orderId` milik tenant lain; keamanan
  sepenuhnya bergantung pada predikat aplikasi.
- **Exact file / query (audit):**
  - `prisma/schema.prisma` → `model Reservation`: `orderId String?` tanpa `@relation`, tanpa FK, tanpa index.
  - Guard: `computeRefundRevenue` (`o.restaurantId`), `getReservationReport` order payment groupBy
    (`where: { id: { in: orderIds }, restaurantId }`), `getReservationsForExport` order lookup
    (`where: { id: { in: orderIds }, restaurantId }`), `getCustomerReport` reservation-order lookup (`restaurantId`).
- **Evidence (audit):** `reservations with orderId != null = 0`; `cross-tenant orderId = 0`; `cross-branch = 0`.
- **Impact aktual:** Tidak ada pada data saat ini. Risiko residual adalah bug integritas data di masa depan
  (write yang salah menetapkan `orderId` lintas tenant) yang hanya tertangkap oleh predikat query, bukan oleh DB.
- **Rekomendasi minimal (verbatim):** “Keep the existing predicates (they are correct). Optional hardening, if
  desired, is a policy/schema decision: add `@@index([orderId])` for the join (C14 — only if measured necessary)
  and/or a runtime invariant test. A real FK would require a relation on `Order` (intentionally untouched) —
  not recommended in this phase.”
- **Tenant:** app-layer only; no DB FK. **Branch:** report benar mengecualikan order lintas-branch. **Migration:**
  None (optional additive index only). **Regression risk:** LOW.

**Acceptance criteria (sesuai framing audit):** pertahankan predikat aplikasi (sudah benar); hardening tambahan
(`@@index([orderId])` dan/atau runtime invariant test) bersifat **opsional/kebijakan** dan **hanya jika diukur
perlu**; **FK nyata tidak direkomendasikan** pada fase ini.

---

## 2. Bukti kondisi implementasi terkini

**Schema — `prisma/schema.prisma` → `model Reservation` (line 661):**
- `orderId String?` (line 686) — **plain scalar**, tanpa `@relation`, tanpa FK, tanpa `@@index([orderId])`.
- Komentar desain (line 653–655) secara eksplisit menyatakan intent: *“orderId is a PLAIN SCALAR (no Prisma
  relation) on purpose: converting a reservation into an order at check-in must not add a field, back-relation
  or migration to the existing Order model.”* (line 650–657) — dan *“No relations are declared here so R1 stays
  purely additive.”*

**Read-only DB evidence (audit ini; script `SELECT`-only, dihapus):**
- Reservasi total = **1**, linked (`orderId IS NOT NULL`) = **0**.
- Linked dengan order **cross-tenant** = **0**; **cross-branch** = **0**; **orphan** (order tidak ada) = **0**.
- Index pada tabel `reservation`: `PRIMARY(id)`, `customerId`, `guestPhone`, `(restaurantId,branchId,reservationDate,status)`,
  `(restaurantId,code)`, `(tableId,reservationDate,status)` → **tidak ada index `orderId`** (konsisten dengan audit).

**Guard aplikasi saat ini (tetap ada / diperkuat):** `src/services/report/report.service.ts`
- `getReservationReport` mengumpulkan `orderId` dari `prisma.reservation.findMany({ where: { ...baseWhere, orderId: { not: null } } })`
  (line 3067; `baseWhere` = `restaurantId` + branch + `reservationDate`).
- Order payment groupBy: `where: { id: { in: orderIds }, restaurantId }` (line 3185).
- `getReservationsForExport` order lookup: `where: { id: { in: orderIds }, restaurantId, ...branchId }` (line ~3414) — F2 menambah branch.
- `computeRefundRevenue`/`computeCustomerRevenue`: predikat `o.restaurantId = …` dan refund `r.restaurantId = …`
  (dipusatkan oleh F4 dalam shared fragment `approvedRefundsSql`/order WHERE).
- `getCustomerReport` reservation-order lookup: `where: { restaurantId, customerId: {...}, orderId: { not: null }, …branchWhere }` (line ~2887).

---

## 3. File / function / API / UI terdampak

- **Schema:** `prisma/schema.prisma` → `model Reservation` (orderId scalar; tanpa relation/FK/index) — titik F8.
- **Service:** `src/services/report/report.service.ts` → `computeRefundRevenue`, `computeCustomerRevenue`,
  `getReservationReport`, `getReservationsForExport`, `getCustomerReport` (semua memakai `restaurantId`/`orderId`
  guard).
- **API:** `GET /api/reports/reservations`, `GET /api/reports/reservations/export`, `GET /api/reports/customers`
  (semua `requireAdmin` + `restaurantId` sesi + branch scope).
- **UI:** `src/app/admin/reports/reservations/page.tsx` (revenue reservasi), `.../customers/page.tsx`
  (reservasi per customer) — konsumen angka yang bergantung pada `orderId` linked.
- **Aturan relevan:** tenant = `restaurantId` (app-layer saja, tanpa DB FK); branch = `Reservation.branchId` dan
  filter `o.branchId`/`r.branchId`; date = `reservationDate` (scope) + `Order.createdAt`/`Refund.approvedAt`
  (atribusi revenue, F7); finance = order revenue/refund memakai basis kanonik, `orderId` hanya penghubung.

---

## 4. Status F8 beserta alasan

**Status: OUTSTANDING** (keterbatasan struktural by-design; harden opsional belum diterapkan).

- **Bukan FIXED:** masih tidak ada `@relation`/FK, tidak ada constraint DB, dan tidak ada `@@index([orderId])`.
  Komentar schema justru menegaskan scalar sengaja dipertahankan.
- **Bukan PARTIALLY FIXED terhadap inti F8:** F2–F7 tidak menambah constraint DB. Namun **F2 dan F4 memperkuat
  pertahanan app-layer** (lihat §5) — jadi sebagian *mitigasi* bertambah, tetapi *gap struktural* tetap.
- **Bukan OBSOLETE:** tidak ada fase yang menambahkan relation/FK/index untuk `orderId`, dan risiko residual
  (data-integrity lintas-tenant di masa depan) tetap ada.
- **Bug nyata vs desain yang disengaja:** **bukan bug**. Ini keterbatasan desain yang **sengaja** (schema comment
  line 653–655); predikat aplikasi sudah benar dan tidak ada pelanggaran pada data saat ini (0 cross-tenant,
  0 cross-branch, 0 orphan).

---

## 5. Dampak dan keterkaitan F2–F7

- **F2** (reservation CSV scope) — menambah `branchId` pada order lookup export → mempersempit paparan lintas-branch
  di jalur export (sejalan dengan guard tenant/branch).
- **F4** (konsolidasi SQL kanonik) — memusatkan predikat `restaurantId`/`branchId` dalam shared fragment
  (`approvedRefundsSql`, `revenueSetSql`, `aliasBranchSql`), sehingga guard tenant tidak lagi tersebar/rawan drift.
- **F3** (identity list customer) — menambah `orders.some(branchWhere)`; tidak menyentuh `Reservation.orderId`.
- **F5** (refund half `computeCustomerRevenue`) — predikat refund; tidak menyentuh relasi `orderId`.
- **F6** (no-show timestamp) — tidak relevan.
- **F7** (basis tanggal revenue + label UI) — inbound ke `orderId` yang sama, tetapi tidak mengubah constraint.

**Kesimpulan keterkaitan:** F2 dan F4 **memperkuat pertahanan defense-in-depth** pada guard app-layer, tetapi
**tidak menghapus** gap struktural F8. F3/F5/F6/F7 orthogonal.

---

## 6. Minimal implementation plan (jika diperlukan)

Tidak ada perubahan yang direkomendasikan sekarang. Jika hardening diinginkan:

- **Opsi A (paling minimal, opsional):** tambahkan **additive** `@@index([orderId])` pada `Reservation`
  **hanya jika** join reservation-linked revenue terukur lambat (saat ini `IN (orderIds)` adalah lookup PK kecil;
  belum diperlukan). Ini perubahan schema+migration → butuh fase terpisah.
- **Opsi B (opsional, defense-in-depth, tanpa schema):** tambahkan validasi runtime/invariant pada jalur tulis
  reservasi→order (pastikan `order.restaurantId` dan idealnya `branchId` sama dengan reservasi) sebelum
  menetapkan `orderId`. Ini perubahan code pada service reservasi → di luar scope audit.
- **Opsi C (tidak direkomendasikan):** FK/relation nyata ke `Order`. Akan menambah field/back-relation/migration
  pada model `Order` yang **sengaja tidak disentuh** (schema comment) — bertentangan dengan desain aditif R1.

---

## 7. Risiko tenant, branch, date, finance, regression

- **Tenant:** isolasi saat ini **app-layer saja** (tanpa DB FK). Predikat `restaurantId` ada di semua query
  terkait dan kini terpusat (F4). Risiko residual: write yang salah lintas-tenant hanya tertangkap di query,
  bukan DB. Tidak ada pelanggaran pada data saat ini.
- **Branch:** laporan mengeksklusi order lintas-branch (via `branchFilters`); F2 memperluas konsistensi ini ke
  export. `Reservation.branchId` non-null; `Order.branchId` nullable sehingga guard memakai
  `o.branchId IS NULL OR <> rv.branchId` sebagai risiko.
- **Date:** `Reservation.reservationDate` (scope) vs `Order.createdAt`/`Refund.approvedAt` (atribusi revenue, F7);
  F8 tidak mengubah apa pun di sini.
- **Finance:** `orderId` hanya penghubung ke basis revenue kanonik; tidak ada perubahan formula/rounding; angka
  tidak berubah.
- **Regression:** **LOW**. Tidak ada perubahan code pada fase ini; Opsi A bersifat aditif (LOW), Opsi B adalah
  validasi tambahan (LOW–MEDIUM bila menyentuh jalur tulis).

---

## 8. Verdict: PASS / WARN / BLOCKER

| Item | Verdict | Alasan |
|---|---|---|
| Status F8 | **WARN** (OUTSTANDING, by-design) | Gap struktural (tanpa FK/constraint/index) tetap ada; desain disengaja; 0 pelanggaran pada data saat ini; isolasi tenant murni app-layer. |
| Keterkaitan F2–F7 | **PASS (tidak menghapus F8)** | F2 & F4 memperkuat guard app-layer (branch + centralized tenant predicate), tetapi tidak menambah constraint DB; F3/F5/F6/F7 orthogonal. |
| Tenant/branch/date/finance safety | **PASS (app-layer)** | Predikat `restaurantId`/branch benar dan terpusat; tidak ada kebocoran lintas-tenant pada data saat ini; tanpa FK, jadi jaminan bersifat aplikasi. |

**Kesimpulan:** Tidak ada **BLOCKER**. F8 tetap **OUTSTANDING** sebagai keterbatasan struktural yang **sengaja**
(app-layer isolation; by-design). Langkah paling minimal & aman = **tidak ada perubahan** (predikat sudah benar);
hardening opsional (`@@index([orderId])` atau validasi runtime) hanya bila diukur/perlu dan harus melalui fase
terpisah.

---

## 9. Integrity statement

- **Perubahan yang dilakukan:** tidak ada. Tidak ada file `src/`, `prisma/`, migration, seed, atau data yang
  diubah/dihapus/dibersihkan. Tidak ada `git reset`/`git clean`/destructive command.
- **Status migration/database:** tidak ada migration baru; tidak ada reset database; tidak ada data historis
  yang disentuh. `git diff -- prisma/` = **kosong**.
- **HEAD Git:** `d7f29ac` (tidak berubah). Tanpa commit/push/deploy/VPS.
- **Uncommitted work:** F1, PHASE 9B, F2, F3, F4, F5, F7 (audit + label UI) tetap utuh dan tidak ditimpa.
- Pemeriksaan hanya read-only (`SELECT`); script sementara dihapus (`ls _p9b*.ts` → none). Tidak menjalankan
  build/typecheck karena tidak ada perubahan code.
