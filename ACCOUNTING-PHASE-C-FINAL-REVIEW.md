# ACCOUNTING — PHASE C: CASHBOOK READ-MODEL — FINAL REVIEW (PRA-PHASE D)

**Repository:** `/home/reksa/restorant-cafe`
**Branch:** `main` — **HEAD:** `d7f29acecd0432c13a3d0d731f0869e72b9a1aef` (`d7f29ac`) ✅ tidak berubah sebelum/sesudah review
**Mode:** **READ-ONLY REVIEW**. Tanpa coding, tanpa migration/schema, tanpa commit/push/deploy, tanpa perubahan VPS, tanpa perubahan data historis.
**Tanggal:** 2026-10-09
**Referensi dibaca:** `ACCOUNTING-PHASE-C-AUDIT.md`, `ACCOUNTING-PHASE-C-IMPLEMENTATION-REPORT.md`, `src/services/accounting/cashbook.service.ts`, `src/services/accounting/cashbook.types.ts`, `src/services/cashbook.service.ts`, `src/app/api/admin/accounting/cashbook/route.ts`, `src/app/api/admin/accounting/cashbook/export/route.ts`, `src/app/admin/accounting/cashbook/page.tsx`, `src/lib/auth-helpers.ts`, `src/lib/csv.ts`, `src/app/admin/layout.tsx`.

> **Legend bukti:**
> **[Source]** = diperiksa langsung pada kode/schema.
> **[Test]** = runtime **read-only** (SELECT saja) via probe `_accCreview.ts` yang dijalankan lalu **dihapus**; tidak ada INSERT/UPDATE/DELETE.
> **[Belum diverifikasi]** = tidak dapat dipastikan dari lingkungan saat ini (butuh sesi NextAuth).

---

## 0. Ringkasan verdict

| Poin yang diminta | Verdict |
|---|---|
| 1. Refund `paymentId=null` / split tender → bucket unknown bila metode tak terbukti | **LULUS** untuk `paymentId=null`; **LATEN** untuk split tender (vocab bucket benar, tanpa data) |
| 2. `paidAt=null` fallback `createdAt` ditandai jelas & tidak diklaim akurat | **SEBAGIAN** — UI menandai `(fallback)`, tetapi **CSV tidak menandai sama sekali** & tidak ada penjelasan di UI |
| 3. Perlakuan data `branchId=null` dijelaskan agar transaksi tidak hilang tanpa keterangan | **SEBAGIAN** — perilaku benar (tidak bocor antar-tenant), tetapi **tidak dijelaskan** di UI |
| 4. Konsistensi `totalIn/totalOut/netMovement/attributableCash/nonCash` & tidak menyamakan mutasi dengan saldo fisik | **LULUS** — 13/13 identitas konsisten **[Test]** |
| 5. Kedua API ADMIN-only, tenant-scoped, branch-scoped, tanpa data sensitif | **LULUS** (branch-scoped untuk user ter-scope); non-admin runtime **[Belum diverifikasi]** |
| 6. Tidak mengubah Payment/Refund/Expense/CashierShift/Sales Report/data historis | **LULUS** |
| 7. Tanpa migration/commit/push/deploy/VPS | **LULUS** |

**Kesimpulan:** **tidak ditemukan bug material** pada read-model numerik. Yang ditemukan hanya **1 defect tingkat rendah (latent)** pada CSV (penanda `dateFallback` tidak diekspor) + **2 gap penjelasan/konformansi** (branchId null, makna fallback) + **2 keterbatasan data/model yang laten**. Tidak ada perubahan yang memblokir PHASE D. Rekomendasi penutupan ada di §9.

---

## 1. Baseline & integritas (sebelum ⇄ sesudah review)

| Item | Nilai |
|---|---|
| HEAD | `d7f29ac` (tidak berubah) |
| Modified (tracked) | 23 |
| Untracked | 46 |
| Deleted | 0 |
| Staged | 0 |
| `prisma/` numstat | `78  0  prisma/schema.prisma` (tidak berubah) |
| Harness temp | `_accCreview.ts` dibuat → dijalankan → **dihapus** (`ls _acc*.ts _p9b*.ts` → none) |
| Concurrent build | 0 (`ps aux \| grep "[n]ext build"`) |

Semua operasi review = SELECT; tidak ada tulis DB, tidak ada `prisma migrate`/`db push`/seed/reset.

---

## 2. Poin 1 — Refund `paymentId=null` / split tender → unknown/unverified

**Verdict:** Benar secara kode untuk `paymentId = null`; split tender **laten** (tidak ada data).

**Bukti [Source]:**
- `cashbook.service.ts:339` — `const method = r.payment?.method ?? null;` → refund tanpa parent payment (`paymentId` null **atau** relasi yatim) menghasilkan `method = null`.
- `cashbook.service.ts:471` — `else outflow.refundUnknown += e.amount;` → metode yang tidak dapat dibuktikan (null / selain `KASIR`/`QRIS`) masuk bucket **`refundUnknown`**, bukan `refundKasir`/`refundQris`.
- UI: `page.tsx:434` — `Refund (instrumen tidak pasti)` hanya muncul bila `refundUnknown > 0`.
- Label aman: `label(null)` → `"Tidak diketahui"` (bukan menampilkan null sebagai metode pasti).

**Bukti [Test] (snapshot restaurant A):**
- 2 refund: 1 **APPROVED** (parent method `KASIR`, amt 30000, `approvedAt` set, `shiftId` NULL) + 1 PENDING (dikecualikan).
- `REFUND_UNKNOWN_BUCKET=0`; `refundKasir=30000`. → Jalur `refundUnknown` **belum terpicu data nyata** (latent, bukan gagal).

**Split tender (keterbatasan model):**
- `SPLIT_TENDER_ORDERS=0` pada snapshot → tidak ada dampak saat ini.
- `Refund` hanya menyimpan **satu** `paymentId`. Jika refund pada order **split tender** (KASIR+QRIS) menunjuk payment KASIR tetapi `refund.amount > parentPayment.amount`, maka **seluruh** refund dihitung sebagai `refundKasir` (kas fisik) — bagian yang sebenarnya berasal dari porsi QRIS ikut diklaim sebagai kas keluar. Saat ini tidak terjadi (0 split tender), tetapi ini **titik bukti metode yang bisa salah**.

**Catatan minor semantik:** `settlementVerified: method !== "QRIS"` (`cashbook.service.ts:278/365/430`) mengembalikan **`true`** untuk metode `null`/unknown — yaitu mengklaim settlement "terverifikasi" untuk instrumen yang justru tidak diketahui. Ini berlawanan arah dengan prinsip konservatif poin 1. **Dampak nol saat ini** karena flag `settlementVerified` **tidak dikonsumsi di mana pun** (grep: hanya didefinisikan + di-assign; UI hanya memakai `dateFallback`), dan ringkasan sudah benar memakai `refundUnknown`. Dicatat sebagai inkonsistensi laten, bukan bug aktif.

**Klasifikasi:** keterbatasan data/model (laten) + inkonsistensi semantik laten. **Bukan bug material.**

---

## 3. Poin 2 — `paidAt=null` fallback `createdAt`

**Verdict:** **SEBAGIAN** — UI menandai, **CSV tidak menandai**.

**Bukti [Source]:**
- Filter tanggal memakai `OR` fallback eksplisit: bila `paidAt` null, bucketing memakai `createdAt` (`cashbook.service.ts` loader Payment, blok `OR`).
- `cashbook.service.ts:251` — `const fallback = !p.paidAt;` → `:262` `dateFallback: fallback`.
- UI menampilkan penanda: `page.tsx:529` — `{e.dateFallback && <span className="ml-1 text-amber-600">(fallback)</span>}`.
- **CSV TIDAK menandai**: `export/route.ts:50–66` — header hanya `["Tanggal","Sumber","Tipe","Metode","Status","Kode Cabang","Cabang","No. Order","Shift","Atribusi Shift","Kategori","Nominal","Arah (+/-)"]`; kolom tanggal = `e.date.slice(0, 10)`. **Tidak ada kolom `dateFallback`/basis tanggal.** Konsumen CSV tidak dapat membedakan tanggal fallback (`createdAt`) dari `paidAt` yang akurat.

**Bukti [Test]:** `COLLECTED_NULL_PAIDAT=0` → jalur fallback **belum terpicu data nyata**; `ENTITY_WITH_DATE_FALLBACK=0`.

**Dua celah konformansi terhadap permintaan:**
1. **CSV** tidak menandai fallback sama sekali — inilah **satu-satunya defect nyata** yang ditemukan (severity rendah, latent).
2. Blok peringatan UI (`page.tsx:245–248`) menjelaskan Kas≠omzet, saldo awal, QRIS, tanpa shift — **tidak** menjelaskan bahwa `(fallback)` berarti tanggal memakai `createdAt` dan **bukan** waktu penerimaan uang yang akurat.

**Klasifikasi:** defect nyata tingkat rendah (traceability CSV) + gap penjelasan UI. **Tidak material** (0 baris saat ini), tetapi menyimpang dari acceptance "harus ditandai jelas".

---

## 4. Poin 3 — Perlakuan data `branchId=null`

**Verdict:** **SEBAGIAN** — perilaku aman & benar, tetapi **tidak dijelaskan**.

**Bukti [Source]:**
- `cashbook.service.ts:80–93` (`branchPredicate`):
  - `:92` `if (branchFilters?.length) return { branchId: { in: branchFilters } };` → admin **branch-scoped** hanya melihat baris dengan `branchId ∈ assigned`; baris `branchId=null` **dikecualikan diam-diam**.
  - `:93` fallback `return {};` → admin non-scoped (tanpa assignment) melihat **semua** baris termasuk `branchId=null` (Cabang tampil "—", `page.tsx:519+`).
- `Expense.branchId` **wajib (NOT NULL)** per schema → expense tidak pernah null-branch; hanya `Payment`/`Refund` yang nullable.

**Bukti [Test]:** `NULL_BRANCH: collectedPayment=0 approvedRefund=0` → tidak ada baris null-branch saat ini; transaksi tidak hilang sekarang.

**Gap:** karena baris `branchId=null` (data legacy) bisa ada di masa depan, admin branch-scoped dapat melihat total lebih kecil tanpa keterangan apa pun (dua admin bisa berbeda angka untuk filter yang tampak sama). Peringatan UI **tidak** menyebut perlakuan ini — padahal permintaan poin 3 secara eksplisit meminta hal itu dijelaskan. Ini **gap dokumentasi/UX**, bukan kebocoran isolasi (tidak ada akses lintas-cabang/tenant).

**Klasifikasi:** gap penjelasan (bukan bug numerik). **Tidak material.**

---

## 5. Poin 4 — Konsistensi ringkasan & tidak menyamakan mutasi dengan saldo fisik

**Verdict:** **LULUS** — 13/13 identitas konsisten **[Test]**.

Ringkasan aktual (`getCashbook(A, {}, undefined)`) + hasil rekonsiliasi terhadap SELECT mentah:

```
totalIn=607000  totalOut=30000  netMovement=577000
inflow={kasir:465000, qris:142000, other:0, total:607000}
attributableCash={in:465000, out:30000, net:435000}
nonCash={in:142000, out:0, net:142000}
outflow={refundKasir:30000, refundQris:0, refundUnknown:0, expense*:0, total:30000}
unattributedShift={count:7, inAmount:178000, outAmount:30000}
collectedOnCancelledOrders={count:1, amount:90000}
openingBalance=null  qrisSettlementVerified=false
```

| Uji identitas | Hasil |
|---|---|
| `totalIn == Σ Payment collected` (mentah) | **PASS** (607000) |
| `totalOut == Σ Refund APPROVED + Σ Expense` | **PASS** (30000) |
| `netMovement == totalIn − totalOut` | **PASS** |
| `inflow.total == totalIn` | **PASS** |
| `inflow.kasir + qris + other == totalIn` | **PASS** (465000+142000+0) |
| `attributableCash.in + nonCash.in == totalIn` | **PASS** (465000+142000) |
| `attributableCash.out + nonCash.out == totalOut` | **PASS** (30000+0) |
| Σ semua bucket `outflow` (kecuali `total`) `== totalOut` | **PASS** |
| `attributableCash.net + nonCash.net == netMovement` | **PASS** (435000+142000) |
| `attributableCash.net == in − out`, `nonCash.net == in − out` | **PASS** |
| `openingBalance == null`, `qrisSettlementVerified == false` | **PASS** |

**Tidak menyamakan mutasi dengan saldo fisik:** `openingBalance: null`, tidak ada running balance, kartu "Net Movement (periode)" ber-hint **"Bukan saldo absolut"** (`page.tsx:204`), peringatan **"Saldo awal tidak tersedia; saldo absolut tidak ditampilkan"** (`page.tsx:246`), dan kas fisik dipisah eksplisit menjadi `attributableCash`. ✅

**Catatan minor (kosmetik, bukan bug):**
- Kartu "Total Kas Masuk" (`page.tsx:189`) ber-hint `"KASIR + QRIS"` (`:192`) — **tidak menyebut** `inflow.other` (payment metode null/other). Saat ini `other=0`, jadi tidak menyesatkan sekarang, tapi hint-nya tidak lengkap.
- Nama kartu "Kas Masuk" menyertakan QRIS/other (non-kas). Ini tidak melanggar karena angka "kas" yang benar (`attributableCash`) ditampilkan terpisah dan ada peringatan; hanya penamaan yang agak longgar.
- `unattributedShift` (baris `!shiftAttributed`) juga mencakup **Expense** (selalu `shiftAttributed=false`, `:425/481`) padahal UI menyembunyikan tanda "!" untuk expense. Snapshot expense=0 → tidak berdampak; bila expense terisi, indikator "Tanpa shift" akan tercampur. Semantik, bukan ketidakkonsistenan total.

**Klasifikasi:** tidak ada bug.

---

## 6. Poin 5 — ADMIN-only, tenant-scoped, branch-scoped, tanpa data sensitif

**Verdict:** **LULUS** (dengan 1 catatan perilaku *pre-existing*, bukan PHASE C).

**Bukti [Source]:**
- **ADMIN-only:** kedua route memanggil `requireAdmin(branchHintFrom(request))` — `route.ts:33`, `export/route.ts:27`. `requireAdmin` = `requireRoles(["ADMIN"])` → non-admin 403. UI juga menolak render untuk non-admin (`page.tsx` guard `isAdmin`).
- **Tenant:** hanya `ctx.restaurantId` (dari sesi via `requireRestaurantContext`) — tidak ada `restaurantId` dari query/body di kedua route.
- **Branch:** `branchId` eksplisit divalidasi `assertBranchInScope(ctx, …)` (`route.ts:41`, `export/route.ts:35`); scope diteruskan sebagai `authorizedBranches(ctx)` (`route.ts:52`, `export/route.ts:42`) dan diberlakukan di `branchPredicate` (`cashbook.service.ts:80`). Branch-scoped user tak pernah bisa melebar (untuk `authorizedBranches`, scoped tanpa header → daftar assignment, bukan "semua").
- **Tanpa data sensitif:** `select` loader tidak pernah mengambil `Payment.rawData`, `provider`, `providerRef`, atau payload gateway; CSV hanya kolom ringkasan. **[Test]** T9b di report implementasi: tidak ada `rawData`/`qrString`/`providerRef`.
- **Read-only:** tidak ada `create/update/delete/upsert/executeRaw` di `cashbook.service.ts` (grep `src/services/accounting` → hanya `expense.service.ts`). Tidak ada AuditLog karena tidak ada mutasi.

**Catatan (PRE-EXISTING, bukan PHASE C):** untuk admin **non-scoped** (0 assignment `UserBranch`), `authorizedBranches(ctx)` mengembalikan `undefined`, sehingga `x-branch-id` **diabaikan** dan pemilihan cabang di `ReportBranchFilter` menjadi **no-op** (tetap semua cabang). Ini **identik** dengan PHASE B `expenses` dan semua halaman report (`reports/payments`, `reports/sales`) — perilaku proyek, **bukan regresi PHASE C** dan **bukan kebocoran** (non-scoped memang boleh melihat semua cabang). Dianjurkan diputuskan terpisah, lintas modul.

**[Belum diverifikasi]:** uji runtime non-admin (butuh sesi NextAuth) — hanya terbukti **[Source]**.

---

## 7. Poin 6 — Tidak mengubah engine & data historis

**Verdict:** **LULUS.**

- `cashbook.service.ts` murni SELECT (tidak ada mutasi) — semua sumber dibaca apa adanya.
- `git diff` untuk `payment.service.ts`, `approval/approval.service.ts`, `report/report.service.ts`, `cashier-sales/cashier-sales.service.ts`, `order/order.service.ts` **tidak memuat** perubahan terkait cashbook (`grep -i cashbook` → none). **[Source]**
- Satu-satunya file **tracked** yang diubah PHASE C = `src/app/admin/layout.tsx`: +import `BookOpen` dan +2 baris nav (`Pengeluaran` PHASE B, `Buku Kas` PHASE C) di grup Finance. Diff bersih, tanpa perubahan lain. **[Source]**
- Kanonik Sales Report tetap 517000/30000/487000 (T11 report implementasi) — tidak disentuh.
- Tidak ada perubahan data historis.

---

## 8. Poin 7 — Tanpa migration/commit/push/deploy/VPS

**Verdict:** **LULUS.**

- HEAD tetap `d7f29ac`; 23 M / 46 ?? / 0 staged; `prisma/` numstat tetap `78/0` (dari PHASE B, tidak tersentuh).
- Tidak ada `prisma migrate`/`db push`/seed/reset; tidak ada commit/push/deploy; tidak ada perubahan VPS.
- Harness `_accCreview.ts` dihapus; tidak ada `_acc*.ts`/`_p9b*.ts` tertinggal.

---

## 9. Bug nyata vs keterbatasan data

| # | Temuan | Kategori | Materialitas | Bukti |
|---|---|---|---|---|
| F1 | CSV tidak menandai `dateFallback` (poin 2) | **Defect nyata (rendah, latent)** | Tidak material (0 baris) | `export/route.ts:50–66` |
| F2 | UI tidak menjelaskan makna `(fallback)`/createdAt (poin 2) | Gap konformansi/UX | Tidak material | `page.tsx:245–248, 529` |
| F3 | Perlakuan `branchId=null` tidak dijelaskan (poin 3) | Gap konformansi/UX | Tidak material (0 baris) | `cashbook.service.ts:92–93` |
| F4 | Refund split tender bisa salah bucket jika `amount > parent payment` (poin 1) | Keterbatasan model (latent) | Tidak material (0 split tender) | `cashbook.service.ts:339` |
| F5 | `settlementVerified=true` untuk metode null/unknown (poin 1) | Inkonsistensi semantik laten, **tidak dikonsumsi** | Tidak material | `cashbook.service.ts:365` |
| F6 | `unattributedShift` mencakup Expense (poin 4) | Semantik, bukan total | Tidak material (expense=0) | `cashbook.service.ts:425,481` |
| F7 | Hint kartu "KASIR + QRIS" melewatkan `other` | Kosmetik | Tidak material | `page.tsx:192` |
| F8 | Pemilihan cabang no-op untuk admin non-scoped | **Pre-existing lintas modul** (bukan PHASE C) | Perlu keputusan terpisah | `auth-helpers.ts` `authorizedBranches` |

Tidak ada temuan yang mengubah angka ringkasan, kebocoran tenant/branch, atau pelanggaran engine. **Tidak ada bug material.**

---

## 10. Perubahan minimal yang direkomendasikan (opsional, non-blocking)

Jika ingin menutup gap konformansi tanpa menyentuh logika numerik/engine:

1. **CSV `dateFallback` (F1)** — tambah 1 kolom di `export/route.ts` (mis. `"Basis Tanggal"` = `"paidAt"` | `"createdAt (fallback)"`), atau sufiks pada kolom Tanggal. Risiko sangat rendah (header + data sejajar), tanpa perubahan summary.
2. **Baris peringatan UI (F2/F3)** — tambah 2 kalimat di blok `page.tsx:245–248`: (a) "Tanggal bertanda (fallback) memakai waktu pembuatan, bukan waktu penerimaan uang"; (b) "Transaksi legacy tanpa cabang tidak ditampilkan untuk admin ter-scope cabang."
3. **Opsional indikator (F3)** — tambah `branchUnassigned {count}` di summary + tampilkan bila > 0. Butuh penyesuaian tipe di service + client wrapper.
4. **F4/F5/F6/F7** — cukup didokumentasikan sebagai keterbatasan (tidak perlu patch sekarang).
5. **F8** — tangani terpisah lintas modul (PHASE B + report), jangan di dalam PHASE C.

Semua di atas **tidak menyentuh** Payment/Refund/Expense/CashierShift/Sales Report/prisma.

---

## 11. Risiko regression & tes yang diperlukan

**Risiko regression:** **sangat rendah.** Read-model tidak mengubah skema, engine, atau data. Bila patch opsional §10 dikerjakan:
- F1 (tambah kolom CSV): risiko konsumen CSV berasumsi jumlah kolom tetap — perlu cek skrip impor pihak ketiga (tidak ada di repo).
- F2/F3 (teks/indikator): nol risiko fungsional.

**Tes yang diperlukan (bila patch dikerjakan):**
1. **CSV == list** (jumlah baris & scope) setelah penambahan kolom; verifikasi header baru + baris terisi benar. **[Test]**
2. **`dateFallback`** ter-set pada baris yang `paidAt`/`approvedAt` null (uji dengan data uji, lalu hapus — bukan data produksi), dan CSV menandainya. **[Test]**
3. **Konsistensi identitas** ulang (§5, 13/13) tetap PASS.
4. **Kanonik** `getSalesReport`/`computeRefundRevenue` tetap 517000/30000/487000. **[Test]**
5. **Static** `npx tsc --noEmit`, `npm run build`, `git diff --check` exit 0. **[Test]**
6. **Isolasi tenant/branch:** foreign tenant → 0 baris; branch-scoped → hanya cabangnya. **[Test]**
7. **Non-admin 403** runtime (butuh sesi). **[Belum diverifikasi]**

---

## 12. Rekomendasi penutupan

- **Logika read-model PHASE C (angka, dedup, bucket, isolasi) TIDAK memiliki bug material** dan seluruh identitas ringkasan konsisten (13/13) → **layak ditutup tanpa mengubah logika**.
- Terdapat **1 defect nyata tingkat rendah (F1: penanda fallback di CSV)** plus **2 gap penjelasan (F2/F3)** terhadap permintaan eksplisit poin 2 & 3. Karena hal ini menyimpang dari acceptance "ditandai jelas/dijelaskan", rekomendasi: **tutup logika PHASE C apa adanya; jadikan patch teks/CSV minimal (§10.1–10.2) sebagai item kecil terpisah** — pilihan A: kerjakan sekarang sebagai patch 2 file non-numerik; pilihan B: catat sebagai backlog PHASE D. **Tidak ada temuan yang menghalangi dimulainya PHASE D.**
- F4/F5/F6/F7 dicatat sebagai keterbatasan; F8 sebagai isu lintas modul.

**Keputusan akhir diserahkan ke Anda** (tutup tanpa perubahan vs patch konformansi minimal). **STOP** — tidak memulai PHASE D tanpa persetujuan.

---

## 13. Konfirmasi

- **Tanpa commit, push, deploy, atau perubahan VPS.** HEAD `d7f29ac` tidak berubah.
- **Tanpa migration / perubahan `prisma/schema.prisma` / seed / reset.** `prisma/` tetap 78/0.
- **Tanpa perubahan data historis** (semua review = SELECT).
- **Tanpa perubahan engine** Payment/Refund/Expense/CashierShift/Sales/Profitability/cashier ledger.
- Harness temp dibuat & dihapus; tidak ada build bersamaan.

**STOP** — menunggu persetujuan; tidak mulai PHASE D.
