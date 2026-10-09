# ACCOUNTING INTEGRITY MONITORING — PATCH REPORT (F1/F2/F3/F4)

**Repo:** `/home/reksa/restorant-cafe` — **Status:** SELESAI (menunggu review)
**Scope:** patch minimal F1/F2/F3/F4 dari `ACCOUNTING-INTEGRITY-MONITORING-VERIFICATION-REPORT.md` saja. Tidak memperluas scope; tidak memperbaiki temuan lain (F5/F6/F7 tetap apa adanya).
**Batasan dipatuhi:** tanpa schema/migration/DDL/DML; tanpa menyentuh OrderItem/snapshot historis; tanpa mengubah revenue/payment/refund/COGS/P&L/predikat revenue kanonik; tanpa scheduler/cron/alerting/UI/export; tanpa commit/push/deploy/VPS; tidak memulai Phase E.

---

## 1. File yang Berubah

| File | Perubahan |
|---|---|
| `src/services/accounting/integrity.types.ts` | +`codeDeployUnproven` pada `IntegrityCutoffEvidence`; +`IntegrityViolationScope`; `IntegrityViolation` +field `scope`; `ReconciliationCheck` +`branchReconciled`, +`tenantReconciled`, +`scopeNote` |
| `src/services/accounting/integrity.rules.ts` | +`VIOLATION_SCOPE`/`violationScope`, +`partitionViolations`, +`deriveReconciliation`, +`selectSampleOrderIds`, +`buildCutoffEvidence` (semua murni, tanpa DB) |
| `src/services/accounting/integrity.service.ts` | C3 dirombak: invariant dipisah branch-scoped vs tenant-wide; filter branch diterapkan pada invariant yang punya relasi Order; sample mengikuti scope; tautologi `statusTotal === snapshots` dihapus; `snapBranchSql` dihapus; cutoff memakai `buildCutoffEvidence` |
| `src/services/accounting/integrity.unit.test.ts` | +7 test regresi F1–F4 (total 21) |

Tidak ada file baru untuk source. Tidak ada perubahan pada `integrity` route (kontrak route tak berubah). **Tidak ada** perubahan schema/migration/data.

---

## 2. Keputusan Branch-vs-Tenant Scope (F1/F3)

Setiap invariant C3 kini punya `scope` eksplisit dan dikelompokkan sesuai kemampuan atribusi branch:

| Invariant | Scope | Alasan / query |
|---|---|---|
| `SNAPSHOT_ORDER_MISMATCH` | **BRANCH_SCOPED** | Punya relasi Order andal. `JOIN order o ON o.id = s.orderId` + `o.restaurantId = ? ${orderBranchSql}` + `oi.orderId <> s.orderId` |
| `SNAPSHOT_TENANT_MISMATCH` | **BRANCH_SCOPED** | Diubah agar memakai **scope Order yang sama dengan counts**: `o.restaurantId = ? ${orderBranchSql} AND o.restaurantId <> s.restaurantId` |
| `SNAPSHOTS_EXCEED_ORDER_ITEMS` | **BRANCH_SCOPED** | Turunan dari `counts` yang sudah branch-scoped |
| `ORPHAN_SNAPSHOT_ITEM` | **TENANT_WIDE** | Item hilang → tidak ada relasi Order andal; tetap `s.restaurantId = ?` |
| `SNAPSHOT_ORDER_MISSING` | **TENANT_WIDE** | Order hilang → tidak bisa diatribusikan ke cabang; `s.restaurantId = ?` |
| `DUPLICATE_SNAPSHOT_PER_ITEM` | **TENANT_WIDE** | Sesuai keputusan reviewer: tidak menebak cabang; `s.restaurantId = ?` |

**Prinsip yang dijaga:**
- **Tidak ada pelanggaran nyata yang disembunyikan.** Invariant TENANT_WIDE tetap dihitung dan dilaporkan meski filter branch aktif — hanya **tidak** digabung diam-diam ke verdikt branch-scoped.
- `reconciled` = `branchReconciled && tenantReconciled` (lihat §3), dengan `scopeNote` yang menjelaskan pemisahan ini di dalam respons.
- `branchId = NULL`: saat filter branch aktif, baris dengan `Order.branchId` NULL dikecualikan (konsisten dengan kontrak existing `branchId IN (...)`), dan **hanya** terlihat pada scope tenant-wide. Didokumentasikan di `scopeNote`.
- `snapBranchSql` **dihapus** (tidak pernah dipakai).

**Sample scope:** `sampleOrderIds` hanya memuat order dari scope yang dinyatakan. Sample branch-scoped selalu diambil (dengan `orderBranchSql`), dan sample tenant-wide **hanya** diambil bila **tidak** ada filter branch. Setiap sample wajib `o.restaurantId = ?` sehingga ID order tenant lain tidak pernah bocor. Konsekuensi: saat filter branch aktif, sample tenant-wide tidak disertakan (count tetap dilaporkan) — dinyatakan di `scopeNote`.

---

## 3. Tautologi `reconciled` (F4)

- Dihapus: `statusTotal === snapshots` (tidak pernah menjadi cross-check independen karena keduanya berasal dari himpunan snapshot yang sama).
- Diganti verdikt yang benar-benar berbasis invariant:
  - `branchReconciled = Σ(BRANCH_SCOPED) === 0`
  - `tenantReconciled = Σ(TENANT_WIDE) === 0`
  - `reconciled = branchReconciled && tenantReconciled`
- Tidak ada penambahan count equality yang keliru antara Order/OrderItem/snapshot.

---

## 4. Kontrak Cutoff (F2)

- **Cutoff tidak diubah** (tetap migration apply time `20260911143644_f5_order_item_cost_snapshot`).
- Tidak ada grace period / timestamp deploy yang dikarang.
- `IntegrityCutoffEvidence` kini menyatakan eksplisit: `codeDeployUnproven: true` (selalu), + `resolved`, `appliedAt`, `migration`.
- Dokumentasi: completion pasca-cutoff diklasifikasikan berdasarkan bukti **migration**, dan **masih berisiko false positive pada jendela deploy** karena waktu deploy kode tidak terbukti.
- **Severity/klasifikasi tidak diturunkan** (tetap `anomaly → CRITICAL`) menunggu keputusan reviewer.

---

## 5. Hasil Tes Aktual

| Tes | Perintah | Hasil |
|---|---|---|
| Unit integritas (termasuk 7 regresi baru) | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | **21 pass / 21** |
| Unit + regresi relevan | `... integrity.unit.test.ts src/services/profitability/coverage.unit.test.ts` | **36 pass / 36** |
| Typecheck | `npx tsc --noEmit` | **exit 0** |
| Build | `npm run build` | **exit 0** |
| Format diff | `git diff --check` | **exit 0** |
| Read-only | grep write-statement pada service | **NONE** |

**Regresi yang divalidasi (D):**
1. Branch A **tidak** menerima sample ID Branch B (unit: `selectSampleOrderIds` dengan `branchFilterActive=true`).
2. Pelanggaran branch-scoped vs tenant-wide dibedakan (unit: `violationScope` + `partitionViolations`).
3. `reconciled` **false** bila ada violation di scope mana pun (unit: `deriveReconciliation`, 4 kombinasi).
4. Cutoff evidence menyatakan deploy belum terbukti (unit: `buildCutoffEvidence`, resolved & unresolved).
5. Batas sebelum / sama dengan / sesudah cutoff tetap benar (unit: `classifyCompletionBucket` + test batas eksplisit).

**Verifikasi integrasi (read-only, DB nyata):**

| Aspek | Hasil |
|---|---|
| `cutoff` | `{ migration, appliedAt: "2026-09-11T16:06:57.831Z", resolved: true, codeDeployUnproven: true }` |
| Kunci C3 | `code,status,reconciled,branchReconciled,tenantReconciled,counts,snapshotByStatus,violations,sampleOrderIds,scopeNote` |
| Violations | terlabel `scope` — 2 `BRANCH_SCOPED`, 3 `TENANT_WIDE` |
| Tenant-wide | counts `35/1/0`, `reconciled:true` |
| Filter branch (Main Outlet) | `scope.branchIds:[main]`, counts `orders:22`, C1 `5` (vs 35/16 tenant-wide) → filter benar-benar diterapkan |
| Tenant B | (dari verifikasi sebelumnya) semua 0 — tanpa kebocoran |

---

## 6. Risiko / Regression

| Risiko | Status |
|---|---|
| Menyembunyikan pelanggaran nyata | **Tidak** — tenant-wide tetap dihitung & dilaporkan; hanya dipisah, bukan difilter hilang |
| `reconciled` overclaim | **Tidak** — `reconciled` mencakup kedua scope (konservatif); `branchReconciled` disediakan untuk verdikt branch |
| Kebocoran order ID antar-cabang | **Diperbaiki** — sample mengikuti scope; tenant-wide sample hanya tanpa filter branch |
| Kebocoran order ID antar-tenant | **Dicegah** — setiap sample wajib `o.restaurantId = ?` |
| Perubahan semantik `SNAPSHOT_TENANT_MISMATCH` | Disengaja: kini memakai scope Order yang sama dengan counts (sesuai instruksi reviewer); arah mismatch yang tak dapat dikaitkan ke order tenant ini tidak lagi dihitung di scope branch-scoped |
| Performa | Tidak berubah signifikan: masih agregat server-side + sample `LIMIT`; satu query sample tambahan hanya saat ada violation dan tanpa filter branch |
| Perubahan API (breaking) | `violations[].scope`, `branchReconciled`, `tenantReconciled`, `scopeNote`, `codeDeployUnproven` ditambahkan — aditif; konsumen lama (jika ada) tetap membaca `counts`/`reconciled`/`sampleOrderIds` |
| Auth/sesi palsu | Tidak dibuat; jalur authenticated HTTP tetap **belum diuji** (limitation) |

---

## 7. Git Status Sebelum/Sesudah & Konfirmasi

**Sebelum patch:** `HEAD=d7f29ac`, modified tracked `29`, staged `0`, untracked `59`, `prisma/` numstat `78 0`.

**Sesudah patch:** `HEAD=d7f29ac`, modified tracked `29` (tidak berubah), staged `0`, untracked `59` → **+1 laporan ini = 60**. `prisma/` numstat tetap `78 0` (tidak ada perubahan schema/migration).

**Konfirmasi kepatuhan:**
- ✅ Hanya 4 file source/test yang diubah + 1 laporan baru; tidak ada file tracked diubah/dihapus.
- ✅ Tidak ada perubahan schema/migration/DB; tidak ada DML/DDL/seed/reset/backfill.
- ✅ Tidak menyentuh OrderItem/snapshot historis, revenue, payment, refund, COGS, P&L, atau predikat revenue.
- ✅ Tanpa scheduler/cron/alerting/UI/export.
- ✅ Tidak commit/push/deploy/VPS; tidak memulai Phase E.
- ✅ Temp file verifikasi dihapus; port bebas; build artifact gitignored.

**STATUS: PATCH SELESAI — STOP untuk review. Tidak commit/push/deploy.**
