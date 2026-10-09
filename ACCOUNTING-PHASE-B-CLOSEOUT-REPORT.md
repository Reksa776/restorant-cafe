# ACCOUNTING — PHASE B: CLOSE-OUT & INTEGRITY RECONCILIATION

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) ✅ sesuai expected, tidak berubah selama audit
**Mode:** AUDIT/close-out only. Tidak implementasi fitur baru, tidak mulai PHASE C, tanpa commit/push/deploy, **tanpa perubahan database** (hanya SELECT read-only), tanpa `git reset`/`git clean`/`checkout`/`stash`.
**Tanggal:** 2026-10-09
**Referensi dibaca:** `ACCOUNTING-PHASE-A-AUDIT.md`, `ACCOUNTING-PHASE-B-IMPLEMENTATION-REPORT.md`, `PHASE9B-FINAL-INTEGRITY-AUDIT.md`, `PHASE9B-FINAL-VERIFICATION.md`.

> **Legend bukti:** **[Langsung]** = diperiksa langsung pada source/DB/git saat close-out ini. **[Test PHASE B]** = hasil uji runtime yang dijalankan pada PHASE B (dilaporkan di laporan lain, **tidak** diulang di sini karena close-out bersifat read-only). **[Source]** = ditinjau dari kode (bukan runtime). **[Belum diverifikasi]** = tidak dapat dipastikan pada close-out ini.

---

## 1. Git baseline dan integritas working tree **[Langsung]**

| Item | Nilai |
|---|---|
| `git rev-parse HEAD` | `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) — cocok expected |
| Branch | `main` |
| Modified (tracked) | **23** |
| Untracked | **42** (32 laporan `.md` + 10 entri non-`.md`) |
| Deleted | **0** |
| Staged | **0** (`git diff --cached` kosong) |
| `git diff --check` | bersih (exit 0) |
| Total tracked diff | 23 files changed, **2107 insertions(+), 155 deletions(-)** |
| Temp harness | tidak ada (`ls _acc*.ts _p9b*.ts` → none) |

**23 file tracked modified:** `prisma/schema.prisma`, `src/app/admin/{audit-logs,layout,reports,shifts,dashboard,cashier/sales}…`, `src/services/{report,report.service,order/order,payment/payment,customer/customer,customer.service,approval/approval,cashier-sales/cashier-sales,audit/audit.service,audit/audit.types,audit.service}.ts`, dsb. (Daftar lengkap identik dengan snapshot `PHASE9B-FINAL-VERIFICATION.md` §2.)

**10 entri untracked non-`.md`:**
```
prisma/migrations/20261009_add_expense_management/   ← PHASE B (baru)
src/app/admin/accounting/                             ← PHASE B (baru)
src/app/api/admin/accounting/                         ← PHASE B (baru)
src/services/accounting/                              ← PHASE B (baru)
src/services/expense.service.ts                       ← PHASE B (baru)
src/app/admin/audit-logs/layout.tsx                   ← PHASE 9B
src/app/admin/reports/customers/                      ← PHASE 9B
src/app/admin/reports/reservations/                   ← PHASE 9B
src/app/api/reports/customers/                        ← PHASE 9B
src/app/api/reports/reservations/                     ← PHASE 9B
```

**Kesimpulan integritas:** seluruh pekerjaan uncommitted PHASE 4–9B **tetap utuh** (tidak ada yang hilang/tertimpa), tidak ada file dihapus, tidak ada staging. Satu-satunya penambahan sejak baseline PHASE 9B adalah artefak **PHASE B** yang memang disengaja (lihat §2).

---

## 2. Rekonsiliasi baseline PHASE 9B vs PHASE B **[Langsung]**

| Baseline | Modified | Untracked | `prisma/` change | Migration baru |
|---|---|---|---|---|
| `PHASE9B-FINAL-INTEGRITY-AUDIT.md` (≈10:14) | 21 | 33 | **0 baris** | tidak ada (terakhir `20260920_add_floor_layout`) |
| `PHASE9B-FINAL-VERIFICATION.md` (≈11:00) | 23 | 42 | +78 baris (schema) | `20261009_add_expense_management` |
| **Close-out ini** | **23** | **42** | **+78/-0** | **ada & applied** |

**Delta PHASE 9B → close-out = tepat himpunan additive PHASE B:**
- `prisma/schema.prisma` — **+78 / −0** (enum `ExpenseMethod` + model `ExpenseCategory` + `Expense` + relasi `User.expensesCreated`, `Restaurant.expenses`/`expenseCategories`, `Branch.expenses`).
- `src/app/admin/layout.tsx` — **+2 / −0** (1 komentar + 1 entri sidebar "Pengeluaran").
- Untracked: `prisma/migrations/20261009_add_expense_management/`, `src/app/admin/accounting/`, `src/app/api/admin/accounting/`, `src/services/accounting/`, `src/services/expense.service.ts`.
- Laporan: `ACCOUNTING-PHASE-A-AUDIT.md`, `ACCOUNTING-PHASE-B-IMPLEMENTATION-REPORT.md` (+ laporan close-out ini).

**Interpretasi `PHASE9B-FINAL-VERIFICATION.md` §6 (status "FAIL"):** status FAIL tersebut adalah **kegagalan kondisi baseline PHASE 9B** ("no Prisma schema or migration changes exist"), **bukan** cacat finansial/kode. Penyebabnya teridentifikasi sebagai pekerjaan **PHASE B** yang berjalan di repo yang sama. Close-out ini mengonfirmasi: perubahan schema/migrasi itu **bukan** regresi PHASE 9B, melainkan **migrasi additive PHASE B** yang sahih (§3). Tidak ada temuan F1–F8 PHASE 9B yang berubah status: **F1, F2, F3, F4, F5 = FIXED; F7 = RESOLVED; F6, F8 = OUTSTANDING (by-design)** — tidak ada dari perubahan PHASE B yang menyentuh jalur report/revenue PHASE 9B.

**Catatan jumlah untracked:** baseline audit PHASE 9B mencatat 33; sekarang 42. Selisih +9 = 2 laporan akuntansi + 5 direktori/file sumber PHASE B + `PHASE9B-FINAL-VERIFICATION.md` + `PHASE9B-POST-F4-SEMANTIC-REVIEW.md` (dua laporan yang menyusul setelah baseline 10:14). Tidak ada entri PHASE 4–9B yang hilang.

---

## 3. Hasil review schema / migration **[Langsung]**

### Schema — aditif murni
- `git diff --numstat -- prisma/schema.prisma` → **78 insertions, 0 deletions**. Tidak ada model/field/relasi lama yang dihapus atau diubah.
- Sisipan hanya: 3 baris relasi baru pada `User`/`Restaurant`/`Branch`, dan blok model baru di akhir file.

### Migration — aditif murni
- `prisma/migrations/20261009_add_expense_management/migration.sql`:
  - `CREATE TABLE expensecategory` + `CREATE TABLE expense` (hanya tabel baru).
  - Index: `expensecategory_restaurantId_name_key` (unique per-tenant), `expensecategory_restaurantId_idx`, `expensecategory_restaurantId_isActive_idx`, `expense_restaurantId_spentAt_idx`, `expense_restaurantId_branchId_spentAt_idx`, `expense_restaurantId_categoryId_spentAt_idx`.
  - 5 FK via `ALTER TABLE ... ADD CONSTRAINT`: `expensecategory.restaurantId→restaurant` (CASCADE), `expense.restaurantId→restaurant` (CASCADE), `expense.branchId→branch` (RESTRICT), `expense.categoryId→expensecategory` (RESTRICT), `expense.createdByUserId→user` (RESTRICT).
- **Tidak ada** `DROP`/`RENAME`/`ALTER COLUMN`/`TRUNCATE` terhadap tabel/kolom lama. Tidak ada migrasi lain yang diubah; `migration_lock.toml` tidak berubah. Tidak ada file **tracked** di `prisma/migrations/` yang termodifikasi (migrasi baru bersifat untracked).

### Status migration (read-only)
- `npx prisma migrate status` → **"22 migrations found"**, **"Database schema is up to date!"**. Artinya `20261009_add_expense_management` tercatat **applied** pada DB lokal. Perintah hanya baca metadata `_prisma_migrations`; **tidak** ada `migrate dev`/`deploy`/`db push`/seed/reset yang dijalankan pada close-out ini.

### Batasan
- `prisma migrate dev` (shadow DB) **tetap gagal** memutar ulang migration lama pra-existing `20260908030144_add_branch_multi_cabang` (error `1146`: tabel `promo` belum ada di shadow DB). Ini masalah replay shadow DB **pra-existing**, bukan akibat PHASE B, dan tidak memengaruhi real DB. **[Langsung, tercatat di `ACCOUNTING-PHASE-B-IMPLEMENTATION-REPORT.md`]**

---

## 4. Hasil security review (source) **[Source]**, dengan penanda runtime

| Kontrol | Temuan | Bukti |
|---|---|---|
| `requireAdmin()` pada semua endpoint | **OK** — 7 handler di 5 route memanggil `requireAdmin` | `grep` `requireAdmin` → expenses/route (2), expenses/[id] (3), expenses/export (1), expense-categories (2), expense-categories/[id] (1) |
| Non-admin ditolak | **OK [Source]**, **runtime BELUM DIVERIFIKASI** | `requireAdmin` → `requireRoles(["ADMIN"])`; tidak ada jalur tanpa guard. Uji runtime butuh sesi NextAuth → tidak dijalankan. |
| `restaurantId` hanya dari session | **OK** — seluruh 11 referensi `restaurantId` di route berasal dari `ctx.restaurantId` | `grep` `restaurantId` di `src/app/api/admin/accounting/` |
| Actor hanya dari session | **OK** — `ctx.userId` dipakai untuk `createdByUserId` & audit | route POST/PATCH/DELETE & service |
| Branch auth read/create/update/delete | **OK** — `branchHintFrom`+`assertBranchInScope` (create/export) dan `authorizedBranches` (list/detail/update/delete) | `grep` helper di route + `branchPredicate()` di service |
| Kategori lintas-tenant ditolak | **OK** — `assertCategoryInTenant` mencocokkan `categoryId` dengan `restaurantId` | `expense.service.ts:154–166`, dipakai create (381) & update |
| Amount positif & finite | **OK** — `.finite()`, `.positive()`, `.max(9_999_999_999.99)`, lalu `round2` + cek `> 0` di service | `expense.types.ts:84–86,99–101`; `expense.service.ts:383,466` |
| CSV tenant/branch scoped | **OK** — export memakai `authorizedBranches` + `branchPredicate` yang sama dengan list | `expenses/export/route.ts:38–47`; `exportExpenses` → `buildExpenseWhere` |
| Mutasi tercatat AuditLog tanpa secret | **OK** — 5 action (`EXPENSE_CREATED/UPDATED/DELETED`, `EXPENSE_CATEGORY_CREATED/UPDATED`); details hanya id/nama/nominal/tanggal/metode/branch | `grep action:`; tidak ada `password`/`secret`/`token`/`whatsappId` di kode (hanya komentar) |
| Purchase tidak dihitung sebagai Expense | **OK** — tidak ada rujukan `purchase` di kode expense (hanya komentar) | `grep purchase` → hanya komentar |
| Expense CRUD tidak mengubah Sales/Refund/COGS/ledger kasir | **OK** — tidak ada import `orderService`/`paymentService`/`reportService`/`refund`/`cashierShift`/`OrderItemCostSnapshot`/`shift.service` | `grep` → **NONE** |

**Catatan desain (bukan temuan):** POST create memakai `requireAdmin()` + `effectiveWriteBranchId(ctx)` mengikuti pola route `purchases`; branch eksplisit dari body divalidasi `assertBranchInScope` dan Zod men-*strip* key tak dikenal, sehingga `restaurantId`/actor kiriman klien diabaikan.

---

## 5. Hasil tes runtime yang benar-benar dijalankan **[Langsung]**

Close-out ini **read-only** terhadap DB (SELECT saja; tanpa INSERT/UPDATE/DELETE). Uji yang dijalankan:

**Probe read-only `_accCloseout.ts`** (SELECT murni + pemanggilan service baca; file dihapus setelah dipakai):

```
COUNTS:    {"orders":35,"payments":46,"refunds":2,"purchases":5,"expenses":0,"categories":0,"audit":44}
CANONICAL: {"totalSales":517000,"totalRefund":30000,"netSales":487000}
EXPENSE_LIST_TOTAL: 0  SUMMARY_TOTAL: 0  CATEGORIES: 0
READONLY_RESULT: PASS                         (exit 0)
```

Menegaskan: (a) tabel `expense`/`expensecategory` ada dan **kosong**, (b) angka kanonik Sales/Refund **tidak berubah** (517000/30000/487000), (c) service `listExpenses`/`listExpenseCategories` memuat & men-scope dengan benar, (d) baseline DB PHASE 9B tetap utuh.

**Uji write-based (create/update/delete, isolasi tenant/branch, validasi, audit) — TIDAK diulang pada close-out** dan **tidak diklaim** sebagai hasil close-out. Uji tersebut dijalankan pada PHASE B (23/23 PASS, tercatat di `ACCOUNTING-PHASE-B-IMPLEMENTATION-REPORT.md` §6) dan ditandai **[Test PHASE B]**. Alasan tidak diulang: instruksi close-out melarang perubahan database, sedangkan uji tersebut membuat baris sementara.

---

## 6. Hasil TypeScript / build / diff-check **[Langsung]**

| Perintah | Exit | Catatan |
|---|---|---|
| `npx tsc --noEmit` | **0** | 0 error TypeScript pada tree saat ini. |
| `git diff --check` | **0** | Bersih — tanpa whitespace error/conflict marker; `git diff --cached --stat` kosong (0 staged). |
| `npm run build` | **0** | Sukses; **tidak ada build lain yang berjalan** saat dijalankan (lock `.next/lock` tidak dihapus, tidak ada proses dimatikan). 6 rute accounting terkompilasi (`/api/admin/accounting/expenses`, `.../[id]`, `.../export`, `/api/admin/accounting/expense-categories`, `.../[id]`, `/admin/accounting/expenses`). |

Tidak ada kode yang diubah untuk membuat tes lolos; tidak ada suppression/pelemahan assertion.

---

## 7. Database yang diperiksa dan batasan verifikasi

- **Database diperiksa:** `restaurant_app` @ `localhost:3306` (datasource dari `prisma/schema.prisma`; **nilai secret `.env` tidak ditampilkan**). Status: schema **up to date** (22 migrations).
- **Snapshot read-only:** `orders 35, payments 46, refunds 2, purchases 5, expenses 0, categories 0, audit 44`; kanonik `517000 / 30000 / 487000`. **Sama dengan baseline PHASE B/9B** → tidak ada residu uji.
- **Batasan verifikasi (BELUM DIVERIFIKASI pada close-out ini):**
  1. **Penolakan non-admin (runtime)** — butuh request context sesi NextAuth; hanya terbukti **[Source]**.
  2. **Uji write-based CRUD/isolation/amount/audit** — tidak diulang (read-only); status **[Test PHASE B]**.
  3. **Isolasi expense lintas-restaurant penuh** — restoran B (`cmu1hoe9y…`) **tidak punya branch**, sehingga tidak ada expense B untuk diuji; isolasi tenant tetap terbukti via kategori lintas-tenant + branch scope pada PHASE B.
  4. **UI interaktif (browser)** — tidak dijalankan; halaman lolos typecheck & build.
  5. **`prisma migrate dev`/shadow DB** — replay migration lama gagal (pra-existing).

---

## 8. Risiko yang masih terbuka

1. **Hard delete expense** tanpa void/reversal akuntansi (hanya snapshot `EXPENSE_DELETED` di AuditLog). Risiko jejak immutable bila kelak dibutuhkan. **[Langsung]**
2. **F6 PHASE 9B (tanpa `noShowAt`)** dan **F8 (tanpa FK `orderId`)** — keterbatasan desain by-design, belum berubah oleh PHASE B. **[Langsung]**
3. **Shadow-DB replay gagal** untuk migration lama → `prisma migrate dev` tidak dapat membuat migration baru via diff normal. Perlu perbaikan terpisah agar alur migrasi tim lancar. **[Langsung]**
4. **Reconciliation bergantung pada narasi two-phase:** perubahan schema/migrasi PHASE B sengaja berada di working tree yang sama; tanpa commit/branch terpisah, `PHASE9B-FINAL-INTEGRITY-AUDIT.md` (baseline PHASE 9B) tetap **tidak lagi berlaku** untuk tree saat ini. Perlu baseline baru bila akan dilakukan verifikasi rilis. **[Langsung]**
5. **Ketergantungan `x-branch-id` vs body branch** pada create: UI mengirim `branchId` eksplisit; klien non-UI tanpa body branch akan mendapat 403 "Pilih cabang terlebih dahulu" (perilaku sesuai desain, bukan bug). **[Source]**

---

## 9. Verdict

# **VERDICT: PASS WITH LIMITATIONS**

**PASS** karena: HEAD tetap `d7f29ac`; working tree utuh (0 deleted, 0 staged); PHASE B **aditif murni** (schema +78/-0; migration hanya `CREATE TABLE`+index+FK); migration **applied** & DB **up to date**; `tsc`/`build`/`diff --check` semuanya **exit 0**; security controls terpasang dan konsisten dengan pola existing; probe read-only PASS dengan angka kanonik tidak berubah; tidak ada residu uji di DB.

**Limitasi** karena item yang **tidak dapat dijalankan sebagai runtime pada close-out read-only**: penolakan non-admin (butuh sesi), uji write-based (dilarang mengubah DB pada close-out → dirujuk sebagai [Test PHASE B]), isolasi expense lintas-restaurant (restoran B tanpa branch), dan UI interaktif — serta risiko terbuka §8.

**Tidak ada kegagalan (FAIL) yang ditemukan** pada close-out ini. Status "FAIL" pada `PHASE9B-FINAL-VERIFICATION.md` §6 telah **direkonsiliasi**: itu kondisi-baseline PHASE 9B, bukan cacat PHASE B.

---

## 10. Pernyataan eksplisit integritas close-out

- **Tidak ada source code yang diubah** selama close-out ini. Satu-satunya berkas yang ditulis adalah **laporan ini** (`ACCOUNTING-PHASE-B-CLOSEOUT-REPORT.md`).
- **Tidak ada data yang diubah.** Tidak ada INSERT/UPDATE/DELETE; tidak ada seed/reset; tidak ada `migrate dev`/`deploy`/`db push`. Hanya perintah **read-only** (`git rev-parse/status/diff`, `prisma migrate status`, dan probe SELECT) serta `tsc`/`build` (artefak hanya di `.next/` yang git-ignored).
- **Tidak ada migration yang diubah/ditambah/dihapus.** Migration `20261009_add_expense_management` dan `prisma/schema.prisma` dibiarkan persis seperti kondisi awal close-out.
- **Tidak ada commit/push/deploy/perubahan VPS.** HEAD tetap `d7f29ac`; staging tetap kosong. Tidak ada `git reset`/`git clean`/`checkout`/`stash`.
- **Tidak ada laporan lama yang dihapus/ditimpa.** Laporan baru dibuat sebagai file terpisah.
- Probe sementara dihapus (`ls _acc*.ts` → none); tidak ada build lain yang dihentikan dan lock tidak dihapus.

**STOP** — menunggu persetujuan. Tidak implementasi PHASE C, tidak commit/push/deploy, tidak ada perubahan database.
