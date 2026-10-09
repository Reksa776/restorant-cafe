# ACCOUNTING — PHASE C: CONFORMANCE PATCH — REPORT

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) ✅ tidak berubah sebelum/sesudah
**Mode:** Patch konformansi minimal — **hanya 2 file** yang disetujui. Tanpa perubahan schema/migration/DB/data historis/engine.
**Tanggal:** 2026-10-09
**Referensi:** `ACCOUNTING-PHASE-C-FINAL-REVIEW.md` (§10.1–10.2, temuan F1/F2/F3).

---

## 1. Scope — file yang diubah (TEPAT 2)

| # | File | Perubahan | Hash sebelum → sesudah |
|---|---|---|---|
| 1 | `src/app/api/admin/accounting/cashbook/export/route.ts` | Tambah kolom CSV **"Basis Tanggal"** (header + nilai per baris via helper `dateBasis`). | `624ec0e5…bebe` → `19cade79…51b9` |
| 2 | `src/app/admin/accounting/cashbook/page.tsx` | Tambah 2 butir peringatan: makna `(fallback)` = `createdAt`; transaksi legacy `branchId=null` tidak tampil untuk admin ter-scope cabang. | `b9cc7853…6691` → `1d4e8c72…6cf9` |

**Tidak diubah:** `prisma/schema.prisma`, migration, DB, data historis; engine Payment/Refund/Expense/CashierShift/Sales; `cashbook.service.ts`, `cashbook.types.ts`, `src/services/cashbook.service.ts`, kedua UI/service lain, `layout.tsx`.

---

## 2. Audit working tree (sebelum patch)

| Item | Nilai |
|---|---|
| HEAD | `d7f29ac` |
| Modified (tracked) | 23 |
| Untracked | 47 |
| Staged | 0 |
| `prisma/` numstat | `78  0  prisma/schema.prisma` |
| Concurrent `next build` | 0 |
| Harness temp | none |
| Kedua file target | **untracked** (file PHASE C baru) → tidak ada versi ter-commit untuk dibandingkan; baseline memakai sha256 |

`find . -type f -newermt '-40 minutes'` (excl. `node_modules/.git/.next`) setelah patch → **hanya 3 file**: 2 file target + `ACCOUNTING-PHASE-C-FINAL-REVIEW.md` (laporan langkah sebelumnya, bukan bagian patch ini). Membuktikan patch menyentuh **hanya** 2 file yang disetujui.

---

## 3. Diff ringkas (added lines)

### 3.1 `src/app/api/admin/accounting/cashbook/export/route.ts`

```diff
+    // "Basis Tanggal" records the ACTUAL source of each row's date so a CSV
+    // consumer can tell a verified date from a createdAt fallback:
+    //   PAYMENT → paidAt · REFUND → approvedAt · EXPENSE → spentAt
+    //   any source whose own date is null → createdAt (fallback, unverified)
+    const dateBasis = (e: (typeof items)[number]) =>
+      e.dateFallback
+        ? "createdAt (fallback)"
+        : e.source === "REFUND"
+          ? "approvedAt"
+          : e.source === "EXPENSE"
+            ? "spentAt"
+            : "paidAt";
+
     const header = [
       "Tanggal",
+      "Basis Tanggal",
       "Sumber",
        …
     ];

     const rows = items.map((e) => [
       e.date.slice(0, 10),
+      dateBasis(e),
       e.source,
        …
     ]);
```

- Kolom baru disisipkan **tepat setelah "Tanggal"** (pasangan logis).
- **Tidak ada** perubahan pada: blok filter/scope (`requireAdmin`/`assertBranchInScope`/`authorizedBranches`), pemanggilan `exportCashbook`, urutan baris, jumlah baris, nominal, maupun header `X-Cashbook-Truncated`.

### 3.2 `src/app/admin/accounting/cashbook/page.tsx`

```diff
       <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
         <p>• Kas berbeda dari omzet/revenue.</p>
         <p>• Saldo awal tidak tersedia; saldo absolut tidak ditampilkan.</p>
         <p>• Settlement QRIS belum terverifikasi.</p>
         <p>• Transaksi tanpa shift tidak dapat diatribusikan ke laci kasir.</p>
+        <p>
+          • Tanggal bertanda (fallback) memakai waktu pembuatan (createdAt),
+          bukan waktu penerimaan uang yang terverifikasi.
+        </p>
+        <p>
+          • Transaksi legacy tanpa cabang (branchId kosong) tidak ditampilkan
+          bagi admin yang dibatasi ke cabang tertentu.
+        </p>
       </div>
```

Hanya penambahan teks; tidak ada perubahan logika/state/fetch.

### 3.3 Catatan interpretasi "Basis Tanggal"

Instruksi: `"paidAt"` bila `dateFallback=false`, `"createdAt (fallback)"` bila `true`, **sambil** menegaskan *"nilai harus mengikuti sumber tanggal aktual"*. Kedua klausa itu bertabrakan untuk Refund/Expense (tanggal aktualnya `approvedAt`/`spentAt`, bukan `paidAt`). Sesuai prinsip **"sumber tanggal aktual"**, mapping yang diterapkan:

| Sumber | `dateFallback=false` | `dateFallback=true` |
|---|---|---|
| PAYMENT | `paidAt` | `createdAt (fallback)` |
| REFUND | `approvedAt` | `createdAt (fallback)` |
| EXPENSE | `spentAt` | (tidak pernah — fallback hanya Payment/Refund) |

Jika Anda memang menginginkan **literal dua nilai** (`paidAt` untuk semua non-fallback), itu perubahan 1 baris — beri tahu saja.

---

## 4. Hasil verifikasi (exit status aktual)

### 4.1 Harness `_accCpatch.ts` (read-only; dijalankan lalu **dihapus**)
Mem-parse **sumber route asli** untuk menghitung kolom, mengekstrak & mengeksekusi **fungsi `dateBasis` asli**, dan membandingkan export vs list pada service nyata.

```
BASIS_COUNTS={"paidAt":17}
HEADER_COLS=14 ROW_COLS=14
PASS  header vs row column count equal  [header=14 row=14]
PASS  header contains 'Basis Tanggal'
PASS  dateBasis payment real  [got='paidAt' expected='paidAt']
PASS  dateBasis payment fallback  [got='createdAt (fallback)' expected='createdAt (fallback)']
PASS  dateBasis refund real  [got='approvedAt' expected='approvedAt']
PASS  dateBasis refund fallback  [got='createdAt (fallback)' expected='createdAt (fallback)']
PASS  dateBasis expense  [got='spentAt' expected='spentAt']
PASS  export count == list total (same filter)  [export=17 listTotal=17]
PASS  export ids == list page ids (scope/filter)
PASS  page explains (fallback)=createdAt
PASS  page explains branchId null legacy
TOTAL=11 PASS=11 FAIL=0
HARNESS_EXIT=0
```

- **Keselarasan kolom:** header = **14** kolom, tiap baris = **14** kolom (sebelumnya 13/13; bertambah 1).
- **Filter/scope list dipertahankan:** dengan filter identik (`dateFrom=2026-01-01&dateTo=2026-12-31&type=IN`), `exportCashbook` mengembalikan **jumlah baris == `list.total`** (17) dan **himpunan id identik** — patch tidak mengubah scope/filter/data.
- Data nyata: `BASIS_COUNTS={"paidAt":17}` (tidak ada fallback/refund/expense pada filter itu → kolom baru = `paidAt` untuk semua baris sekarang).

### 4.2 Static & build

| Perintah | Exit status |
|---|---|
| `npx tsc --noEmit` | **0** |
| `npm run build` (tanpa build lain berjalan) | **0** |
| `git diff --check` | **0** |
| `ps aux \| grep "[n]ext build"` sebelum build | 0 (tidak ada build lain) |

Build sukses; ketiga artefak cashbook terkompilasi:
`.next/server/app/api/admin/accounting/cashbook/route.js`, `.../cashbook/export/route.js`, `.next/server/app/admin/accounting/cashbook/page.js`.

---

## 5. Regression risk

| Area | Risiko | Catatan |
|---|---|---|
| Angka/summary | **Nol** | Service tidak disentuh (hash tetap); tidak ada perubahan nominal/rumus. |
| Tenant/branch isolation | **Nol** | Blok auth/scope tidak disentuh; diverifikasi export==list id. |
| Jumlah/urutan baris | **Nol** | Tidak ada perubahan `orderBy`/filter/limit. |
| Konsumen CSV | **Rendah (teoretis)** | Kolom baru disisipkan di **posisi ke-2**, sehingga indeks kolom lama bergeser +1. Tidak ditemukan importer CSV di repo; satu-satunya efek praktis bagi skrip luar adalah penyesuaian indeks. |
| UI | **Nol** | Hanya teks peringatan tambahan. |

---

## 6. Status integritas Git (sesudah patch)

| Item | Sebelum | Sesudah |
|---|---|---|
| HEAD | `d7f29ac` | `d7f29ac` (tidak berubah) |
| Modified (tracked) | 23 | 23 |
| Untracked | 47 | 47 (tidak ada file baru dari patch) |
| Staged | 0 | 0 |
| `prisma/` numstat | 78/0 | 78/0 (tidak berubah) |
| Deleted | 0 | 0 |

Tidak ada `git reset`/`clean`/`checkout`/`stash`; tidak ada file existing dihapus; seluruh pekerjaan existing & uncommitted utuh. Harness temp dihapus (`_acc*.ts`/`_p9b*.ts` → none).

**File yang berubah karena patch ini = TEPAT 2** (dibuktikan `find -newermt`).

---

## 7. Konfirmasi

- **Tidak ada** commit, push, deploy, atau perubahan VPS.
- **Tidak ada** perubahan Prisma schema / migration / database / data historis.
- **Tidak ada** perubahan engine Payment/Refund/Expense/CashierShift/Sales.
- Perubahan terbatas pada 2 file yang disetujui.
- Tidak menjalankan dua build bersamaan.

**STOP** — menunggu persetujuan. Tidak memulai PHASE D.
