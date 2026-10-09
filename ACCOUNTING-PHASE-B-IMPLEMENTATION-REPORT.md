# ACCOUNTING — PHASE B: EXPENSE MANAGEMENT — IMPLEMENTATION REPORT

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`) ✅ sesuai expected, tidak berubah
**Mode:** IMPLEMENT PHASE B (expense management only). Tidak commit/push/deploy, tidak mengubah VPS, tidak seed/reset database.
**Tanggal:** 2026-10-09
**Referensi:** `ACCOUNTING-PHASE-A-AUDIT.md` (P1 = Expense Management).

> **Legend bukti:** **[Source]** = terbukti dari source code/schema. **[Test]** = terbukti dari uji runtime lokal (harness sementara, read/write hanya pada tabel expense baru, lalu dibersihkan). **[Belum diverifikasi]** = tidak dapat dipastikan dengan lingkungan saat ini.

---

## 1. Fitur yang diimplementasikan

Expense Management untuk mencatat **pengeluaran operasional (non-COGS)**:

1. **CRUD pengeluaran** — create, list (dengan pagination), detail, update, delete (hard delete + snapshot AuditLog).
2. **Kategori pengeluaran** restaurant-scoped — list, create, rename, aktif/nonaktif (soft-disable, **tidak** di-hard-delete).
3. **Filter** — rentang tanggal (`spentAt`), kategori, metode pembayaran, branch (via `authorizedBranches` + header `x-branch-id`).
4. **Ringkasan** — total pengeluaran + jumlah transaksi sesuai filter, ditambah breakdown per kategori (server-side `groupBy`).
5. **CSV export** — mengikuti filter & scope yang sama dengan halaman (cap 5000 baris terbaru).
6. **Validasi server-side** — nominal > 0 & finite, kategori milik tenant & aktif, branch milik tenant & dalam scope, tanggal `YYYY-MM-DD` valid.
7. **Audit trail** — `EXPENSE_CREATED`, `EXPENSE_UPDATED`, `EXPENSE_DELETED`, `EXPENSE_CATEGORY_CREATED`, `EXPENSE_CATEGORY_UPDATED`.
8. **UI** — halaman admin lengkap (daftar, filter, total, dialog tambah/edit, kelola kategori, konfirmasi hapus, loading/empty/error state) + entri sidebar "Pengeluaran" di grup **Finance**.

**Non-goals (ditegaskan):** Cashbook, P&L/net profit, Chart of Accounts, Journal/GL/Balance Sheet, AP/AR, rekonsiliasi QRIS/bank, approval workflow, recurring expense — **tidak** diimplementasikan (sesuai scope PHASE B). **Purchase tidak pernah otomatis dicatat sebagai Expense** (lihat §7).

---

## 2. File yang ditambah / diubah

### Baru (9 file)
| File | Keterangan |
|---|---|
| `prisma/migrations/20261009_add_expense_management/migration.sql` | Migration additive (2 tabel + index + FK). |
| `src/services/accounting/expense.types.ts` | Schema validasi Zod v4 (list/create/update expense + kategori). |
| `src/services/accounting/expense.service.ts` | Server service: CRUD, scope, summary, export, audit. |
| `src/services/expense.service.ts` | Client wrapper (axios) untuk bundle browser. |
| `src/app/api/admin/accounting/expenses/route.ts` | GET list + POST create. |
| `src/app/api/admin/accounting/expenses/[id]/route.ts` | GET / PATCH / DELETE. |
| `src/app/api/admin/accounting/expenses/export/route.ts` | CSV export. |
| `src/app/api/admin/accounting/expense-categories/route.ts` | GET list + POST create kategori. |
| `src/app/api/admin/accounting/expense-categories/[id]/route.ts` | PATCH kategori (rename/toggle). |
| `src/app/admin/accounting/expenses/page.tsx` | Halaman UI Expense Management. |

### Diubah (2 file tracked)
| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | + enum `ExpenseMethod`, model `ExpenseCategory`, `Expense`; + relasi `Expense[]`/`ExpenseCategory[]` pada `Restaurant`, `Branch`, `User`. Tidak ada kolom/tabel existing yang diubah/dihapus. |
| `src/app/admin/layout.tsx` | + 1 entri sidebar: `{ name: "Pengeluaran", href: "/admin/accounting/expenses", icon: Wallet, roles: ["ADMIN"] }` di grup **Finance**. |

**Tidak disentuh:** Order, OrderItem, Payment, PaymentTransaction, Refund, CashierShift, ShiftOverride, Purchase, Supplier, revenue engine (`revenueWhere`/`computeRefundRevenue`), Sales/Customer/Reservation report, Profitabilitas, shift ledger, PHASE 4–9B.

---

## 3. Schema dan migration impact

### Model baru **[Source]**
- **`ExpenseCategory`** — `id`, `restaurantId`, `name`, `isActive`, `createdAt`, `updatedAt`.
  - `@@unique([restaurantId, name])` → nama unik **per tenant**; kategori tidak bisa dipakai lintas tenant.
  - `@@index([restaurantId])`, `@@index([restaurantId, isActive])`.
  - `@@map("expensecategory")`.
- **`Expense`** — `id`, `restaurantId`, `branchId` (**wajib**), `categoryId`, `amount Decimal(12,2)`, `spentAt`, `method ExpenseMethod` (default `CASH`), `note`, `createdByUserId`, `createdAt`, `updatedAt`.
  - `@@index([restaurantId, spentAt])`, `@@index([restaurantId, branchId, spentAt])`, `@@index([restaurantId, categoryId, spentAt])`.
  - `@@map("expense")`.
- **enum `ExpenseMethod`** — `CASH | TRANSFER | QRIS | CARD | OTHER`.

### Migration
- **File:** `prisma/migrations/20261009_add_expense_management/migration.sql`.
- **Sifat:** **additive murni** — hanya `CREATE TABLE` + index + `ALTER TABLE ... ADD CONSTRAINT` (FK). Tidak ada `DROP`/`RENAME`/`ALTER COLUMN` pada tabel existing.
- **Dampak data historis:** **nol** — tabel lama tidak disentuh; baris historis tidak dibaca/diubah/dihapus.
- **FK:** `expensecategory.restaurantId → restaurant` (CASCADE); `expense.restaurantId → restaurant` (CASCADE); `expense.branchId → branch` (RESTRICT); `expense.categoryId → expensecategory` (RESTRICT); `expense.createdByUserId → user` (RESTRICT).
- **Penerapan lokal:** `npx prisma migrate deploy` → **berhasil**, `prisma migrate status` → "Database schema is up to date!" (22 migrations). **[Test]**
- **Catatan proses:** `prisma migrate dev --create-only` **gagal** karena shadow database tidak dapat memutar ulang migration lama `20260908030144_add_branch_multi_cabang` (error 1146: tabel `promo` belum ada **di shadow DB** — masalah pra-existing pada replay migrasi, **bukan** akibat perubahan PHASE B). Karena itu migration SQL ditulis tangan agar identik dengan konvensi Prisma (naming index/FK, `DATETIME(3)`, `ENUM`, `DECIMAL(12,2)`), lalu diterapkan dengan `migrate deploy`. **Real DB tidak terpengaruh** oleh kegagalan shadow DB tersebut.

---

## 4. API / UI impact

### API (semua `requireAdmin` — ADMIN only) **[Source]**
| Endpoint | Method | Fungsi |
|---|---|---|
| `/api/admin/accounting/expenses` | GET | List + summary (pagination, filter tanggal/kategori/metode/branch/search). |
| `/api/admin/accounting/expenses` | POST | Create expense. |
| `/api/admin/accounting/expenses/[id]` | GET/PATCH/DELETE | Detail / update / hard delete (+audit snapshot). |
| `/api/admin/accounting/expenses/export` | GET | CSV (filter & scope sama dengan list, cap 5000). |
| `/api/admin/accounting/expense-categories` | GET/POST | List / create kategori. |
| `/api/admin/accounting/expense-categories/[id]` | PATCH | Rename / aktif-nonaktif. |

Respons memakai envelope existing (`successResponse`/`createdResponse`/`errorResponse`); error `AppError` dipetakan ke kode existing (`VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409).

### UI
- Halaman baru: `/admin/accounting/expenses` (`src/app/admin/accounting/expenses/page.tsx`), ADMIN-only, mengikuti pola halaman existing (client component, gated `useBranchContext().isLoading`, `toast`/`normalizeApiError`, komponen `Card/Table/Dialog/Select/Badge`).
- Navigasi: 1 entri di grup **Finance** sidebar. Tidak merombak sidebar, tidak mengubah halaman report/cashier/purchase/profitability.
- CSV diunduh via `fetch` dengan header `x-branch-id` dari branch context (pola sama dengan halaman report purchases).

---

## 5. Security, tenant/branch isolation, risiko regresi

- **Auth:** setiap endpoint memakai `requireAdmin(...)` (`src/lib/auth-helpers.ts`). Non-admin → 403. UI juga menyembunyikan menu/halaman untuk non-admin (`roles: ["ADMIN"]` + guard di halaman). **[Source]**
- **Tenant:** `restaurantId` **selalu** dari sesi (`ctx.restaurantId`) — tidak pernah dari body/query. Payload Zod object men-*strip* key tak dikenal, sehingga `restaurantId`/`createdByUserId` yang dikirim klien diabaikan. **[Source]**
- **Branch:** branch tulis di-resolve server-side via `effectiveWriteBranchId(ctx)` + divalidasi `assertBranchInScope`; read/update/delete difilter `branchId: { in: branchFilters }` (`authorizedBranches`). Branch-scoped admin tidak bisa membaca/menulis branch lain. **[Source][Test]**
- **Kategori lintas tenant:** `assertCategoryInTenant` mencocokkan `categoryId` dengan `restaurantId`; kategori tenant lain ditolak `VALIDATION_ERROR`. **[Test]**
- **Audit:** semua mutasi menulis AuditLog tanpa secret/kredensial (hanya id, nama, nominal, tanggal, metode, branch). **[Test]**
- **Non-destruktif purchase:** service Expense tidak menyentuh tabel `purchase` — tidak ada auto-expense dari pembelian. **[Test]**
- **Risiko regresi:** rendah — tidak ada engine kanonik yang diubah. Uji regresi: `tsc` → 0, `build` → 0, `git diff --check` → clean, angka kanonik tidak berubah (§7).

---

## 6. Hasil test aktual

### Static checks **[Test]**
| Perintah | Exit | Hasil |
|---|---|---|
| `npx tsc --noEmit` | **0** | Tidak ada error TypeScript. |
| `npm run build` | **0** | Build produksi sukses (rute `/api/admin/accounting/*` terkompilasi). |
| `git diff --check` | **0** | Clean (tidak ada whitespace error). |

### Uji runtime service (harness sementara `_accBverify.ts`, 23 assert) **[Test]**
Baseline DB sebelum: `{orders:35, payments:46, refunds:2, purchases:5, expenses:0, categories:0, audit:44}`.

| # | Skenario | Hasil |
|---|---|---|
| T1a | Create kategori restaurant-scoped | PASS |
| T1b | Create expense mengembalikan view kanonik (amount/branch/methodLabel) | PASS |
| T2a | List + summary menemukan & menjumlahkan expense | PASS |
| T2b | Filter tanggal mengecualikan expense di luar rentang | PASS |
| T8a | Create expense **tidak** membuat baris `purchase` | PASS |
| T7 | Audit `EXPENSE_CREATED` tertulis | PASS |
| T5a/b/c | Nominal `0` / negatif / NaN ditolak `VALIDATION_ERROR` | PASS ×3 |
| T6 | `categoryId` restoran lain ditolak `VALIDATION_ERROR` | PASS |
| T3a | Daftar kategori restoran A tidak memuat kategori restoran B | PASS |
| T4a | Filter branch menyembunyikan expense branch lain | PASS |
| T4b | Filter branch tetap menampilkan expense branch sendiri | PASS |
| T4c | Read expense branch lain dengan scope → `NOT_FOUND` | PASS |
| T4d | CSV export mengikuti scope branch yang sama | PASS |
| T9a | Update mengubah amount/method/note | PASS |
| T9b/c | Delete menghapus; read setelahnya → `NOT_FOUND` | PASS |
| T9d | Delete menulis snapshot audit `EXPENSE_DELETED` | PASS |
| T10 | Rename kategori & list restaurant-scoped | PASS |
| T11 | Count order/payment/refund/purchase **tidak berubah** | PASS |
| T12 | Count expense/kategori/audit kembali ke baseline | PASS |

**Total 23/23 PASS.** Setelah harness: `{orders:35, payments:46, refunds:2, purchases:5, expenses:0, categories:0, audit:44}` — **persis baseline**.

### Uji angka finance kanonik **[Test]**
`_accBsales.ts` memanggil `reportService.getSalesReport(A, "custom", "2000-01-01", today, ...)` **sebelum, saat, dan sesudah** operasi Expense CRUD:

```
BEFORE/DURING/AFTER: totalSales=517000, totalRefund=30000, grossRevenue=517000,
                     refundReversal=30000, netSales=487000
RESULT stable=true netSales=487000 canonicalBaseline=true   (exit 0)
```

Angka kanonik **identik** dan sesuai baseline PHASE 9B (product 517000, refund 30000, net 487000).

### Belum dapat diuji **[Belum diverifikasi]**
- **`requireAdmin` untuk non-admin (acceptance #3)** — memerlukan request context sesi NextAuth; tidak dapat dijalankan di harness script. Dibuktikan **[Source]** (setiap route memanggil `requireAdmin`, mengikuti pola route purchases/suppliers).
- **Isolasi expense lintas-restaurant penuh (T3b–d)** — restoran B (`cmu1hoe9y…`) **tidak memiliki branch**, sehingga tidak bisa dibuat expense B untuk diuji. Isolasi tenant tetap dibuktikan lewat T6 (kategori lintas tenant ditolak) + T3a (list kategori terpisah) + T4 (branch scope).
- **Uji UI interaktif (klik/rendering)** — tidak dijalankan di browser; halaman lolos typecheck & build.

---

## 7. Verifikasi angka finance tidak berubah

- **Sales/Revenue kanonik:** `totalSales=517000`, `totalRefund=30000`, `netSales=487000` — stabil sebelum/saat/sesudah Expense CRUD **[Test]**.
- **Profitabilitas:** tidak disentuh (tidak ada perubahan pada `profitability.service.ts` / `OrderItemCostSnapshot`); Expense tidak masuk perhitungan COGS/gross profit. **[Source]**
- **Purchase:** `create` expense tidak menambah baris purchase; pembelian tetap aset/inventory → COGS saat terjual. Tidak ada double counting. **[Test]**
- **Order/Payment/Refund/Shift:** jumlah baris tidak berubah; tidak ada engine yang diubah. **[Test]**

---

## 8. Status Git dan daftar perubahan lokal

- **HEAD:** `d7f29ac` — **tidak berubah** (tanpa commit/push).
- **Staged:** 0 file.
- **`git diff --check`:** clean.
- **Perubahan lokal:** 23 modified (21 pra-existing PHASE 4–9B + **`prisma/schema.prisma`** + **`src/app/admin/layout.tsx`**) dan 41 untracked (36 pra-existing + 5 entri baru: folder migration `20261009_add_expense_management/`, `src/app/admin/accounting/`, `src/app/api/admin/accounting/`, `src/services/accounting/`, `src/services/expense.service.ts`).
- **Harness sementara:** semua dihapus (`_accBverify.ts`, `_accBtenants.ts`, `_accBsales.ts`, `_accBcount.ts` → `ls _acc*.ts` = none).
- **Perubahan PHASE 4–9B:** tetap utuh, tidak ada yang dihapus/ditimpa.

---

## 9. Risiko dan keterbatasan

1. **Hard delete expense** — dibiarkan sebagai hard delete karena ini catatan operasional (bukan jurnal terposting), namun **selalu** disertai snapshot lengkap di AuditLog (`EXPENSE_DELETED`). Tidak ada void/reversal bergaya akuntansi; jika kebijakan bisnis menuntut jejak immutable, ini perlu fase lanjutan. **[Source]**
2. **Branch wajib** — expense harus terikat satu branch (mirip `Purchase`). Pembuatan oleh admin non-scoped tanpa branch aktif akan ditolak "Pilih cabang terlebih dahulu". **[Test]**
3. **Batas export 5000 baris** — sama dengan pola export report existing. **[Source]**
4. **Kategori soft-disable** — kategori dengan expense tidak bisa di-hard-delete (FK RESTRICT); UI hanya mengaktifkan/menonaktifkan. Kategori nonaktif tetap tampil pada expense lama (badge "nonaktif"). **[Source]**
5. **Shadow DB replay gagal** untuk migration lama (pra-existing) — tidak memengaruhi real DB; dicatat agar tidak mengejutkan pada `migrate dev` berikutnya. **Rekomendasi:** perbaiki urutan/ketergantungan migration lama sebelum mengandalkan `migrate dev`/shadow DB. **[Belum diverifikasi]** apakah ini praktik yang diinginkan tim.
6. **Belum ada integrasi Cashbook/P&L** — Expense belum direkap ke arus kas atau laba rugi (memang di luar scope PHASE B).

---

## 10. Rekomendasi tahap selanjutnya

- **PHASE C — Cashbook:** rekap kas masuk (Payment PAID) + kas keluar (Refund APPROVED + Expense berbayar) + cash movement manual; read-model, bukan engine baru. Reuse `Payment`/`Refund`/`CashierShift`/`Expense`.
- **PHASE D — P&L sederhana:** `Omzet → Net Sales → COGS → Gross Profit → Operating Expense (per kategori) → Net Profit`, menumpang Profitabilitas + Expense. Beri label eksplisit "Net Sales ≠ Profit".
- **Belum disarankan:** COA/Journal/GL/Balance Sheet (double-entry) dan AR/AP hingga ada keputusan bisnis.
- **Perbaikan teknis opsional:** perbaiki replay shadow DB (migration lama) agar `prisma migrate dev` kembali berfungsi; pertimbangkan kebijakan void/reversal expense bila audit immutable diperlukan.

---

## Ringkasan

PHASE B **Expense Management** selesai: 2 tabel additive + service/API/UI/nav, tenant & branch-scoped, ADMIN-only, tercatat AuditLog, nominal/kategori/branch tervalidasi server-side, CSV mengikuti scope, dan **angka finance kanonik tidak berubah**. Static checks (`tsc`, `build`, `git diff --check`) **exit 0**; uji runtime **23/23 PASS**; baseline DB dipulihkan persis; tidak ada commit/push/deploy.

**STOP — menunggu persetujuan sebelum PHASE C.**
