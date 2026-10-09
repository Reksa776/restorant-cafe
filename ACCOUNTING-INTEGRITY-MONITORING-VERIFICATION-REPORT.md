# ACCOUNTING INTEGRITY MONITORING — VERIFICATION REPORT (AUDIT-ONLY)

**Repo:** `/home/reksa/restorant-cafe` — **Status:** VERIFIKASI SELESAI (menunggu keputusan review)
**Metode:** audit-only, read-only. **Tidak ada source code diubah.** Tidak ada DML/DDL/seed/migration/reset/backfill; tidak menyentuh OrderItem/snapshot historis; tidak mengubah revenue/payment/COGS/P&L/schema; tidak commit/push/deploy/VPS; tidak memulai Phase E. Build/test yang sudah lulus tidak diulang (tidak ada perubahan source).

**File diaudit:** `src/services/accounting/integrity.rules.ts`, `integrity.service.ts`, `integrity.types.ts`, `src/app/api/admin/accounting/integrity/route.ts`, `integrity.unit.test.ts`; migration `20260911143644_f5_order_item_cost_snapshot`; `order.service.ts` (blok COMPLETED).

---

## 1. Audit Cutoff & Timezone (C2)

### 1.1 Bukti cutoff

| Bukti | Nilai | Sumber |
|---|---|---|
| Migration pembuat tabel snapshot | `20260911143644_f5_order_item_cost_snapshot` | `prisma/migrations/` (artefak repo) |
| Migration terpasang (`finished_at`) | `2026-09-11T16:06:57.831Z` (= 23:06:57 WIB) | `_prisma_migrations` (read-only) |
| Migration `started_at` | `2026-09-11T16:06:57.572Z` | `_prisma_migrations` |
| Commit kode F.5 (`4b5895c`) | `2026-09-11 16:31:58 +0700` (= 09:31:58Z) | `git log` |
| Dokumentasi | "Diterapkan via `prisma migrate deploy` … `prisma generate` selesai" — 11 September 2026 | `AUDIT-F5-HISTORICAL-COGS-PROFITABILITY.md` §5 |

### 1.2 Timezone & presisi kolom (tidak mencampur UTC/lokal)

| Kolom | Tipe | Presisi |
|---|---|---|
| `_prisma_migrations.finished_at` | `datetime(3)` | 3 |
| `_prisma_migrations.started_at` | `datetime(3)` | 3 |
| `orderstatushistory.createdAt` | `datetime(3)` | 3 |
| `orderitemcostsnapshot.completedAt` / `createdAt` | `datetime(3)` | 3 |

**Bukti binding parameter Date (read-only, konstanta):** session `time_zone = SYSTEM`, `system_time_zone = WIB (+07)`. Namun perbandingan Prisma tetap UTC:

```
CAST('2026-09-11 16:06:57.831' AS DATETIME(3)) <  <cutoff Date>  => 0
CAST('2026-09-11 16:06:57.831' AS DATETIME(3)) >= <cutoff Date>  => 1
CAST('2026-09-11 16:06:57.830' AS DATETIME(3)) <  <cutoff Date>  => 1
CAST('2026-09-11 16:06:57.832' AS DATETIME(3)) >= <cutoff Date>  => 1
```

**Round-trip cutoff:** `_prisma_migrations.finished_at = <cutoff Date>` ⇒ `1` (cocok persis, termasuk milidetik).

**Kesimpulan §1.2:** `orderstatushistory.createdAt` (ditulis Prisma = UTC) dibandingkan dengan cutoff yang dibaca Prisma dari `_prisma_migrations` (UTC) melalui parameter `Date` — **tidak ada pencampuran UTC/lokal**; presisi identik `datetime(3)` sehingga tidak ada pembulatan pada batas milidetik. Ini konsisten dengan uji semantik batas SQL yang sudah dijalankan (tepat = cutoff ⇒ anomaly).

### 1.3 Analisis risiko jendela deploy (order COMPLETED setelah migration terpasang, sebelum kode snapshot aktif)

Garis waktu nyata (read-only):

| Waktu (WIB) | Peristiwa |
|---|---|
| 11 Sep 16:31 | commit kode F.5 (`4b5895c`) |
| 11 Sep **23:06:57** | migration F.5 **terpasang** (tabel snapshot dibuat) |
| 11 Sep 23:14:15 | **order `cmtwbpgzy…` COMPLETED** (≈ +7,3 menit setelah cutoff) |
| 11 Sep 23:17:47 | **order `cmtx5so65…` COMPLETED** (≈ +10,8 menit setelah cutoff) |
| 12 Sep 13:41 | rebuild/import DB (temuan D2) |

Ada **aktivitas completion nyata 7–11 menit setelah cutoff**. Kondisi "COMPLETED tanpa snapshot" pada jendela ini bisa berasal dari:
1. bug integritas sebenarnya (kode snapshot aktif, snapshot tidak ditulis), **atau**
2. **deploy lag** (tabel sudah ada, tetapi proses aplikasi versi F.5 belum berjalan/restart) — jalur lama tidak menulis snapshot.

**Apakah kondisi tersebut benar-benar dapat diklasifikasikan CRITICAL berdasarkan bukti yang tersedia?**
**Tidak secara terbukti.** Yang dapat dibuktikan hanyalah **waktu migration terpasang** (tabel ada). **Tidak ada** bukti terpercaya kapan kode F.5 mulai berjalan (tidak ada timestamp deploy/restart; log aplikasi tidak diakses). `finished_at` migration ≠ waktu deploy kode. Karena itu, untuk order yang selesai **di dalam jendela tak-terbukti** pasca-cutoff, `anomaly → CRITICAL` bertumpu pada **asumsi** bahwa kode snapshot sudah aktif — asumsi yang didukung konteks (migrasi dijalankan pada sesi yang sama, kode sudah di-commit sebelumnya) tetapi **tidak terbukti**.

Catatan: kode lama + tabel belum ada **tidak** menghasilkan order COMPLETED tanpa snapshot (pemanggilan snapshot akan gagal → transaksi rollback), sehingga sumber risiko tunggal adalah **kode lama + tabel sudah ada**.

**Rekomendasi paling aman (TIDAK diimplementasikan — butuh keputusan reviewer):**
- **Jangan ubah cutoff** (sudah benar & terbukti). Jangan mengarang grace period.
- **Opsi A (minimal, disarankan):** dokumentasikan asumsi ini secara eksplisit di kontrak/komentar dan `IntegrityCutoffEvidence` (mis. tambah `assumption`/`codeDeployUnproven`), tetap CRITICAL — konservatif untuk deteksi dini, dengan catatan jendela.
- **Opsi B:** jika bukti deploy tersedia di masa depan (mis. timestamp startup aplikasi, atau `MIN(orderitemcostsnapshot.createdAt)` sebagai "engine live since" ketika ada snapshot), pakai **penanda terbukti** itu sebagai cutoff efektif (`MAX(migration.finished_at, engineLiveSince)`); pada dataset ini 0 snapshot ⇒ penanda tidak tersedia.
- **Opsi C (butuh persetujuan eksplisit):** turunkan bucket pasca-cutoff menjadi **WARN** sampai bukti deploy ada. Ini menurunkan sensitivitas deteksi, jadi **tidak** direkomendasikan tanpa keputusan reviewer.

---

## 2. Audit C3 — Evaluasi Keenam Invariant

| # | Kode | Kondisi DB yang memicu | Query mendeteksi? | False positive mungkin? | FK/UNIQUE membuat mustahil? | Scope branch konsisten? |
|---|---|---|---|---|---|---|
| 1 | `ORPHAN_SNAPSHOT_ITEM` | snapshot dengan `orderItemId` tanpa baris `orderitem` | **Ya** (`s LEFT JOIN orderitem oi ... WHERE oi.id IS NULL`) | Tidak (query tepat) | **Mustahil** selama FK `orderitemcostsnapshot.orderItemId → orderitem(id)` (ON DELETE CASCADE) aktif | **Tidak** — hanya `s.restaurantId`, tanpa filter branch (tidak ada order untuk join) |
| 2 | `SNAPSHOT_ORDER_MISSING` | snapshot dengan `orderId` tanpa baris `order` | **Ya** (`s LEFT JOIN order o ... WHERE o.id IS NULL`) | Tidak | **Mustahil** selama FK ke `order` aktif; **mungkin** jika impor/restore dengan `foreign_key_checks=0` | **Tidak** — hanya `s.restaurantId` |
| 3 | `SNAPSHOT_ORDER_MISMATCH` | `snapshot.orderId <> orderitem.orderId` untuk item yang sama | **Ya** (`JOIN orderitem oi ... oi.orderId <> s.orderId`) | Tidak (writer selalu set keduanya dari order yang sama) | **Mungkin** (tidak ada constraint yang mengikat kedua kolom) | **Tidak** — hanya `s.restaurantId` (punya `order`/item tersedia untuk join branch, tapi tidak dipakai) |
| 4 | `SNAPSHOT_TENANT_MISMATCH` | `order.restaurantId <> snapshot.restaurantId` | **Ya** (`JOIN order o ... o.restaurantId <> s.restaurantId`) | Tidak | **Mungkin** — `snapshot.restaurantId` tidak diikat FK ke tenant order | **Tidak** — hanya `s.restaurantId` |
| 5 | `DUPLICATE_SNAPSHOT_PER_ITEM` | >1 snapshot untuk `orderItemId` sama | **Ya** (`GROUP BY s.orderItemId HAVING COUNT(*)>1`) | Tidak | **Mustahil** selama `@@unique([orderItemId])` aktif | **Tidak** — hanya `s.restaurantId` |
| 6 | `SNAPSHOTS_EXCEED_ORDER_ITEMS` | `snapshots > orderItems` (turunan, bukan query sendiri) | **Ya** (`max(0, snapshots − orderItems)`) | Bisa **double-report** bersama #3 (mismatch dapat menggeser kedua hitungan) | **Mustahil** selama FK item aktif (tiap snapshot butuh item) | **Ya** — keduanya memakai `orderBranchSql` (konsisten dengan counts) |

**Catatan penting:** #1, #2, #5, #6 **tidak mungkin terjadi** selama constraint FK/unique ditegakkan; keberadaannya bernilai *defense-in-depth* (relevan karena D2 menemukan rebuild/import — jika impor dijalankan dengan `foreign_key_checks=0`, kondisi ini bisa muncul). Satu-satunya invariant yang **realistis** terealisasi pada skema saat ini adalah **#4 `SNAPSHOT_TENANT_MISMATCH`** (dan kemungkinan #3).

**Semua invariant didefinisikan dengan benar** dan tidak menyamakan `COUNT(order) = COUNT(orderitem) = COUNT(snapshot)`.

---

## 3. Audit Tenant / Branch Scope & API

| Aspek | Temuan |
|---|---|
| `restaurantId` hanya dari session | **OK** — route memakai `ctx.restaurantId`; skema query tidak menerima `restaurantId` |
| Validasi parameter sebelum query | **OK** — `IntegrityQuerySchema.safeParse` di awal `getIntegrityReport`, sebelum `Promise.all` |
| C1 tenant predicate | **OK** — `revenueScopeWhere(restaurantId, branchFilters)` (predikat kanonik) |
| C2 tenant predicate | **OK** — `o.restaurantId = ?` + `JOIN order` (orderitem di-scope lewat order) |
| C3 counts/status tenant predicate | **OK** — `o.restaurantId = ?` |
| C3 violations/samples tenant predicate | **OK secara tenant** — `s.restaurantId = ?` di setiap subquery |
| `orderitem` selalu lewat JOIN Order | **OK untuk C2** (satu-satunya tempat orderitem dihitung); C3 tidak menghitung orderitem per-baris |
| Filter branch diterapkan konsisten? | **TIDAK** — counts/status pakai `orderBranchSql` (`o.branchId IN`), sedangkan **violations & sample hanya `s.restaurantId`** (tenant-wide). `snapBranchSql` dideklarasikan (L306) tetapi **tidak pernah dipakai** |
| `sampleOrderIds` bocorkan tenant lain? | C1/C2: **tidak** (tenant+branch). C3: **tidak antar-tenant**, tetapi **dapat memuat order ID dari cabang lain dalam tenant yang sama** saat filter branch aktif (kebocoran **branch-scope**, bukan tenant) |
| Jalur authenticated HTTP | **BELUM diuji** (tidak ada sesi). Tidak membuat sesi palsu / mengubah auth. Dicatat sebagai limitation |

**Konsistensi `reconciled`:** `reconciled = (violationTotal === 0) && (statusTotal === snapshots)`. Klausa kedua bersifat **tautologis** (keduanya bersumber dari himpunan snapshot yang sama) sehingga tidak menambah jaminan. Namun `violationTotal === 0` memang berarti seluruh invariant yang didefinisikan lolos — *dengan catatan* basis scope-nya **tenant-wide**, bukan branch, saat filter branch dipakai.

---

## 4. Temuan, False Positive/Negative, Severity

| ID | Temuan | Bukti | Dampak | False +/- | Severity |
|---|---|---|---|---|---|
| **F1** | Filter branch tidak diterapkan pada C3 `violations` & `sampleOrderIds` (`snapBranchSql` dideklarasikan tapi tak dipakai) | `integrity.service.ts` L306 (deklarasi saja); counts/status pakai `orderBranchSql`, violations hanya `s.restaurantId` | Admin branch-scoped: `reconciled` dapat **CRITICAL karena pelanggaran di cabang lain**; `sampleOrderIds` dapat memuat **order ID dari cabang lain** (dalam tenant sama) | **False positive** (branch scope) + **kebocoran branch-scope** (bukan tenant) | **Medium** |
| **F2** | C2 `anomaly → CRITICAL` untuk completion di jendela tak-terbukti pasca-cutoff | Migration 23:06:57 WIB; completions nyata 23:14:15 & 23:17:47 WIB; waktu deploy kode tidak terbukti | False positive bila completion dalam jendela deploy-lag | **False positive** (latent, hanya jendela) | **Medium** |
| **F3** | `snapBranchSql` unused (dead code) | L306, hanya 1 kemunculan | Indikasi cacat F1; kebersihan kode | — | **Low** |
| **F4** | `reconciled` memuat klausa tautologis `statusTotal === snapshots` | Keduanya dari join/scope yang sama | Menyesatkan; seolah ada cross-check tambahan | — | **Low** |
| **F5** | 4 dari 6 invariant mustahil selama FK/unique aktif | §2 tabel kolom FK | Hanya berarti jika constraint di-drop / impor FK-off; nilai defense-in-depth | — | **Info** |
| **F6** | `orderitem` orphan (tanpa order) tidak dapat dideteksi (tidak bisa tenant-scope) | Tidak ada query; orderitem tanpa restaurantId | Gap cakupan; orphan item global tak terlihat oleh tenant mana pun | **False negative** (gap, terdokumentasi) | **Low/Info** |
| **F7** | `SNAPSHOTS_EXCEED_ORDER_ITEMS` dapat double-report dengan `SNAPSHOT_ORDER_MISMATCH` | Keduanya dapat terpicu oleh mismatch | `violationTotal` menghitung dua kali (bukan bug fatal) | — | **Info** |

**Tidak ada temuan** untuk: pencampuran timezone (terbukti benar), predikat tenant (semua query punya), `restaurantId` dari session, validasi sebelum query, dan C1/C2 sample scoping.

---

## 5. Hasil Pemeriksaan Aktual & Limitation

| Pemeriksaan | Hasil |
|---|---|
| Tipe kolom (5 kolom) | semuanya `datetime(3)` |
| Binding parameter Date vs literal UTC | `equal_lt=0, equal_ge=1, minus1_lt=1, plus1_ge=1` → **UTC konsisten** |
| Round-trip cutoff (`finished_at = cutoff`) | `1` (persis) |
| Rentang completion | 2026-09-07T07:39:29Z … 2026-09-11T16:17:47Z (16 baris) |
| Completion di sekitar cutoff | 1 legacy (02:13:56Z) + 2 anomaly (16:14:15Z, 16:17:47Z) |
| Branch tenant A | 2 cabang (Main Outlet 22 order, Perum Cirebon 12 order) + 1 order `branchId` NULL |
| Snapshot branchId NULL | 0 (tidak ada snapshot sama sekali) |
| `snapBranchSql` terpakai? | **Tidak** (hanya deklarasi di L306) |
| Tenant A (live) | C1 `16 / Rp517.000` CRITICAL; C2 `0`; C3 `reconciled: true`, counts `35/1/0` |
| Tenant B (live) | semua `0` → tanpa kebocoran tenant |
| `sampleLimit=999` | `ValidationError` sebelum query |

**Limitation:**
- **Jalur authenticated HTTP (ADMIN & branch-scoped) belum diuji** end-to-end; guard memakai `requireAdmin` existing (kontrol tanpa sesi = 401, sudah diverifikasi sebelumnya). Tidak membuat sesi palsu.
- **Waktu deploy kode F.5 tidak terbukti** → klasifikasi CRITICAL untuk jendela pasca-cutoff bertumpu pada asumsi (F2).
- C2 anomali tidak dapat diuji pada data nyata (0 order COMPLETED ber-item); diverifikasi via unit test + semantik SQL read-only.
- F1 (branch) tidak dapat ditunjukkan dengan data nyata karena tidak ada violation; disimpulkan dari SQL & keberadaan variabel tak terpakai.

---

## 6. Patch Minimal yang Direkomendasikan (TIDAK diimplementasikan)

> Dilarang memperbaiki pada tahap ini. Berikut usulan agar reviewer dapat memutuskan.

**F1/F3 — samakan scope branch pada C3.** Terapkan filter branch berbasis order pada subquery yang memilikinya, dan hapus `snapBranchSql`:

```ts
// pada SNAPSHOT_ORDER_MISMATCH dan SNAPSHOT_TENANT_MISMATCH:
Prisma.sql`... JOIN \`order\` o ON o.id = s.orderId
            WHERE s.restaurantId = ${restaurantId} ${orderBranchSql} AND ...`
// SNAPSHOT_ORDER_MISSING: tidak punya order → tetap tenant-wide; jika
// branchFilters diset, dokumentasikan/keluarkan dari reconciled branch.
// ORPHAN_SNAPSHOT_ITEM / DUPLICATE_SNAPSHOT_PER_ITEM: tidak punya konteks
// order → tetap tenant-wide; jelaskan di kontrak.
```
Lalu `sampleOrderIds` mengikuti scope yang sama.

**F2 — jangan ubah cutoff.** Tambahkan penanda ketidakpastian pada `IntegrityCutoffEvidence` (mis. `codeDeployUnproven: true`) atau, bila tersedia bukti, `engineLiveSince = MIN(orderitemcostsnapshot.createdAt)` dan pakai `MAX(migration.finished_at, engineLiveSince)`.

**F4 —** ganti `statusTotal === snapshots` dengan cross-check bermakna atau hapus.

---

## 7. Git Status Sebelum/Sesudah & Konfirmasi

**Sebelum:** `HEAD=d7f29ac`, modified tracked `29`, staged `0`, untracked `58`.

**Sesudah:** `HEAD=d7f29ac`, modified tracked `29` (tidak berubah), staged `0`, untracked `58` → **+1 laporan ini = 59** (hanya file laporan baru). `prisma/` numstat tetap `78 0`.

**Konfirmasi kepatuhan:**
- ✅ Tidak ada source code diubah (audit-only).
- ✅ Tidak ada DML/DDL/seed/migration/reset/backfill; tidak menyentuh OrderItem/snapshot.
- ✅ Tidak mengubah revenue/payment/COGS/P&L/schema/migration.
- ✅ Tidak commit/push/deploy/VPS; tidak memulai Phase E.
- ✅ Temp file audit dihapus; tidak ada proses server tertinggal.

**STATUS: VERIFIKASI SELESAI — STOP untuk review. Tidak ada bug yang diperbaiki; patch direkomendasikan menunggu persetujuan.**
