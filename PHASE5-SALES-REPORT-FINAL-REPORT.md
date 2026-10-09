# PHASE 5B — SALES REPORT / REVENUE SEMANTICS FIX — FINAL REPORT

> Scope: **hanya gap yang sudah disetujui** dari `PHASE5-SALES-REPORT-AUDIT.md` (G1/G2 — basis revenue
> Dashboard). Tidak ada audit ulang, tidak ada report engine baru, tidak ada migration, tidak ada
> endpoint baru, tidak ada perubahan permission/tenant/branch scoping.
> Repo `/home/reksa/restorant-cafe` · HEAD `d7f29ac` (**tanpa commit/push/deploy**).

---

## 1. Root cause

`orderService.getDashboardStats().todayRevenue` menghitung pendapatan dengan **status fulfillment**,
tanpa memandang pembayaran:

```ts
// SEBELUM (order.service.ts)
prisma.order.aggregate({
  where: { restaurantId, status: "COMPLETED", createdAt: { gte: today } },
  _sum: { grandTotal: true },
})
```

Engine report (authoritative) memakai **payment-based revenue recognition**:

```ts
// report.service.ts — revenueWhere()
{ ...scope(restaurantId, branch, status != CANCELLED, filter orderType/paymentMethod),
  createdAt: { gte: start, lte: end },
  OR: [ { paymentStatus: "PAID" }, { payments: { some: { status: "REFUNDED" } } } ] }
```

Akibatnya Dashboard dan Report memakai himpunan order yang **berbeda**: `COMPLETED` bukanlah pengakuan
revenue (`COMPLETED+UNPAID/PENDING/EXPIRED` ikut terhitung), sementara `PAID` yang belum `COMPLETED`
justru **tidak** terhitung. Audit 5A mengukur dampaknya pada DB lokal: Dashboard **Rp519.000** vs Report
**Rp487.000** → **+Rp32.000 (+6,6%)** overstate, dan halaman `/admin/dashboard` menampilkan **dua angka
revenue** dengan basis berbeda (card "Pendapatan Hari Ini" vs section "Sales Overview").

---

## 2. Existing revenue semantics (authoritative — tidak diubah)

`PaymentStatus.PAID` = pengakuan revenue; `Order.status` hanya fulfillment/workflow.

| Kasus | Perilaku | Masuk revenue? |
| --- | --- | --- |
| `status != CANCELLED` | gate aktivitas | — |
| `paymentStatus = PAID` | uang diterima | **YA** |
| collected-then-refunded (`Payment.status = REFUNDED`, order bisa `UNPAID`) | tetap di revenue set agar revenue **dibalik**, bukan hilang | **YA** |
| `COMPLETED` + `UNPAID` / `PENDING` / `EXPIRED` | belum ada uang | **TIDAK** |
| `PAID` + `PROCESSING` / `READY` (belum COMPLETED) | uang sudah diterima | **YA** |
| `CANCELLED` + `PAID` | existing behavior: `status != CANCELLED` → dikeluarkan | **TIDAK** (tidak diubah) |
| `FAILED` / `EXPIRED` | gagal | **TIDAK** (bucket "failed") |

**Tidak ada predicate revenue kedua yang dibuat.** Predicate existing (`revenueWhere`) kini di-`export`
dan **dipakai bersama** oleh report dan dashboard.

---

## 3. Files changed

| File | Perubahan | Baris |
| --- | --- | --- |
| `src/services/report/report.service.ts` | `function revenueWhere` → **`export function revenueWhere`** + komentar (menegaskan ia predicate tunggal). **Tidak ada perubahan logika.** | +8 / −1 |
| `src/services/order/order.service.ts` | `getDashboardStats`: import `resolveReportRange` + `revenueWhere`; `todayRevenue` memakai predicate & range resolver report | +21 / −4 |

Verifikasi diff `report.service.ts` — **hanya** baris export yang berubah:

```
-function revenueWhere(
+export function revenueWhere(
```

Tidak ada file lain yang disentuh. `src/components/admin/orders/print-bill-dialog.tsx` tetap seperti
PHASE 4 (tidak ada perubahan 5B).

---

## 4. Implementation

```ts
// order.service.ts
import { resolveReportRange, revenueWhere } from "@/services/report/report.service";

async getDashboardStats(restaurantId: string, branchFilters?: string[] | null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // PHASE 5B — revenue basis: reuse the report engine's authoritative predicate
  // and its range resolver so dashboard.todayRevenue === report.totalSales.
  const revenueRange = resolveReportRange("today");
  ...
  prisma.order.aggregate({
    where: revenueWhere(restaurantId, revenueRange, branchFilters),
    _sum: { grandTotal: true },
  }),
```

Kenapa ini menghilangkan duplikasi **dan** menjamin kesetaraan:
- `resolveReportRange("today")` → **resolver yang sama** dengan `getSalesReport(period="today")`
  (`{ start: 00:00 hari ini, end: now }`).
- `revenueWhere(restaurantId, range, branchFilters)` → **predicate yang sama**, termasuk aturan
  collected-then-refunded.
- Titik batas (`latest`/`now`) identik per request, dan kedua endpoint dipanggil dalam periode yang
  sama → nilainya harus sama.

Implementasi lama (`orderWhere({ status: "COMPLETED", createdAt: { gte: today } })`) dihapus dari jalur
revenue. `todayOrders` & card lain tetap memakai `orderWhere` seperti sebelumnya.

---

## 5. API impact

**Tidak ada perubahan kontrak.** `GET /api/orders/dashboard/stats` tetap mengembalikan
`{ success, message, data }` dengan **8 key yang sama** — diverifikasi runtime:
`completedOrders, paidOrders, pendingOrders, pendingPayments, processingOrders, readyOrders, todayOrders, todayRevenue`.
Yang berubah **hanya nilai `todayRevenue`** (basisnya). `GET /api/reports/sales` & `/export` tidak berubah.

## 6. Database impact

**NONE.** Murni perubahan agregasi baca → tidak ada DDL/DML/seed dari implementasi.
Bukti: snapshot DB **identik** sebelum vs sesudah seluruh pemanggilan API (§10.5), dan baseline
dipulihkan persis setelah fixture sementara dibersihkan (§10.6).

## 7. Migration

**TIDAK ADA.** Tidak ada migration, tidak ada perubahan `prisma/schema.prisma`, tidak ada index baru.

## 8. Security

- `restaurantId` tetap dari **authenticated server context** (`requireRoles` → `requireRestaurantContext`); tidak ada `restaurantId` dari client.
- `branchFilters` = `authorizedBranches(ctx)` tetap dipakai apa adanya; header `x-branch-id` tetap hint.
- **Tidak ada perubahan permission**: report GET tetap ADMIN+CASHIER, export/multi-outlet/profitability/menu-engineering tetap ADMIN-only; akses CASHIER **tidak** diperlebar.
- Diverifikasi runtime: ADMIN melihat semua cabang (115.000), CASHIER hanya cabang authorized (74.000), order tenant B (999.000) **tidak** muncul.

## 9. Performance

- Agregasi tetap **di database** (`prisma.order.aggregate`), terindeks (`restaurantId`, `branchId`, `createdAt`, `paymentStatus`).
- **Tidak ada** fetch order ke browser / perhitungan revenue di client; **tidak ada N+1**; **tidak ada index baru** (tanpa bukti kebutuhan).
- Perubahan biaya: predicate baru menambahkan klausa `OR ... EXISTS(payment)` pada **satu** agregasi
  dashboard (sebelumnya memakai `status + createdAt`). Beban tetap konstanta per request; `resolveReportRange`
  adalah fungsi murni tanpa I/O.

## 10. Runtime verification

Lingkungan: build produksi (`npm run build` → exit 0), server `npx next start -p 3000`
(sesuai `AUTH_URL=http://localhost:3000`), MySQL lokal, headless Chrome, login NextAuth asli.

**Fixture sementara (dibuat lalu dibersihkan, item 16):** 9 order ber-`createdAt = hari ini` untuk
membedakan setiap kasus, plus 2 customer & 8 payment. Ekspektasi dihitung independen dari DB.

| Fixture | status | paymentStatus | Nilai | Revenue? |
| --- | --- | --- | --- | --- |
| A1 | COMPLETED | UNPAID | 11.000 | TIDAK |
| A2 | COMPLETED | PENDING | 12.000 | TIDAK |
| A3 | COMPLETED | EXPIRED | 13.000 | TIDAK |
| A4 | PROCESSING | PAID | 21.000 | **YA** |
| A5 | COMPLETED | PAID | 22.000 | **YA** |
| A6 | CANCELLED | PAID | 90.001 | TIDAK (existing behavior) |
| A7 | PROCESSING | UNPAID + Payment REFUNDED | 31.000 | **YA** (reversal set) |
| A8 | COMPLETED | PAID (cabang PERUM-1) | 41.000 | **YA** (hanya scope PERUM-1) |
| B1 | COMPLETED | PAID (**tenant B**) | 999.000 | TIDAK untuk tenant A |

### 10.1 Hasil: **37 PASS / 0 FAIL**

### 10.2 Test pembeda (item 9)
| Kasus | Ekspektasi | Hasil |
| --- | --- | --- |
| COMPLETED + UNPAID / PENDING / EXPIRED | tidak dihitung | **PASS** (nilai ≠ 151.000) |
| PAID + PROCESSING (A4) | dihitung | **PASS** |
| COMPLETED + PAID (A5) | dihitung | **PASS** |
| REFUNDED/collected (A7) | mengikuti `revenueWhere` → dihitung | **PASS** |
| CANCELLED + PAID (A6, 90.001) | tidak dihitung | **PASS** (nilai ≠ 205.001) |
| Predicate lama (COMPLETED tanpa filter bayar) | **99.000** (dihitung ulang dari DB) | **PASS** (nilai ≠ 99.000) |

### 10.3 Bukti kesetaraan (item 6–8)
| Scope | `dashboard.todayRevenue` | `report.summary.totalSales` | Sama? |
| --- | --- | --- | --- |
| **ADMIN — semua cabang** | **115.000** | **115.000** | ✅ |
| **CASHIER — MAIN saja** | **74.000** | **74.000** | ✅ |

(115.000 = A4 21.000 + A5 22.000 + A7 31.000 + A8 41.000)

### 10.4 Field dashboard lain TIDAK berubah
7 field sisanya dibandingkan terhadap hitungan **independen dari DB**: ADMIN
(`todayOrders 8, pendingOrders 7, processingOrders 6, readyOrders 1, completedOrders 21, pendingPayments 15, paidOrders 20`)
dan CASHIER MAIN-only (`7, 7, 5, 0, 9, 15, 8`) → **semua cocok** (14 check PASS). Hanya `todayRevenue`
yang berubah.

### 10.5 Read-only (item 15)
Snapshot DB penuh sebelum vs sesudah seluruh pemanggilan API: **`READONLY_OK: snapshot identical`**
— orders, payments, paymentTransactions, refunds, customers, orderStatusHistory, **auditLogs**,
promos, reservations semuanya tidak berubah. Membaca dashboard/report **tidak menulis apa pun**.

### 10.6 Baseline dipulihkan
Setelah cleanup: **`READONLY_OK[S0]: snapshot identical`** — `orders 35 · orderItems 1 · payments 46 ·
paymentTxns 29 · customers 35 · refunds 2 · refundItems 0 · orderStatusHistory 108 · auditLogs 44 ·
promos 2 · reservations 1`; `ORD-P5TEST-* = 0`, customer uji = 0.

### 10.7 UI (interface yang dipakai user)
Card **"Pendapatan Hari Ini"** tetap ada di `/admin/dashboard` dan nilainya **sama dengan API**
(`Rp0` saat revenue hari ini 0 setelah cleanup) → binding UI↔API terverifikasi di browser nyata.

---

## 11. Dashboard vs report comparison

| Periode/Scope | Dashboard | Report | Catatan |
| --- | --- | --- | --- |
| Audit 5A (data historis semua waktu) | 519.000 | 487.000 | **selisih +32.000** — sebelum perbaikan |
| 5B fixture, today, ADMIN (semua cabang) | **115.000** | **115.000** | **sama** |
| 5B fixture, today, CASHIER (MAIN) | **74.000** | **74.000** | **sama** |
| 5B, today, setelah cleanup | 0 | 0 | sama |

Catatan penting: pada fixture 5B, angka baru **115.000** bisa **lebih tinggi** dari predicate lama
(**99.000**) karena A4 (`PAID+PROCESSING` 21.000) dan A7 (refunded-collected 31.000) kini **masuk**,
sementara A1–A3 (36.000) **keluar**. Ini menegaskan perbaikannya adalah **koreksi semantik**, bukan
sekadar pengurangan/penambahan tetap.

## 12. Tenant / branch verification

| Check | Hasil |
| --- | --- |
| Tenant A tidak melihat revenue tenant B (B1 = 999.000) | **PASS** — nilai ≠ 1.114.000, dan total = 115.000 |
| CASHIER (MAIN) tidak melihat revenue PERUM-1 (A8 = 41.000) | **PASS** — 74.000 (bukan 115.000) |
| CASHIER `todayOrders`/`completedOrders` ter-scope cabang | **PASS** — 7 / 9 vs ADMIN 8 / 21 |
| ADMIN (tanpa batas cabang) melihat semua cabang | **PASS** — 115.000 |
| `restaurantId` tidak pernah dari client | code path tidak berubah (session-only) |

## 13. Regression verification

| Item | Cara verifikasi | Hasil |
| --- | --- | --- |
| `npx tsc --noEmit` | perintah | **exit 0** |
| `npm run build` | perintah | **exit 0** |
| `git diff --check` | perintah | **exit 0** |
| Report `/admin/reports` tidak berubah | `report.service.ts` diff **hanya** `export` + komentar (tanpa perubahan logika); runtime `totalSales 115.000`, `totalOrders 7`, `paidOrders 4` sesuai ekspektasi | **PASS** |
| **Print Bill PHASE 4** tidak berubah | tidak ada file print yang disentuh; smoke browser: tombol Print Bill ada + bill render memuat nomor order + "Lunas" | **PASS** |
| **Reservation PHASE 2/3** tidak berubah | tidak ada file reservation yang disentuh; `GET /reservasi` → HTTP 200 | **PASS** |
| Order/Payment/Refund/Promo/WhatsApp engine | tidak ada file yang disentuh (diff = 2 file service) | **PASS** |
| DB schema/migration | tidak ada perubahan `prisma/` | **PASS** |
| Baseline DB | snapshot identik (35/1/46/29/35/2) | **PASS** |

## 14. Limitations / NOT RUN

1. **Nilai predicate lama (99.000) adalah REKONSTRUKSI**, dihitung ulang langsung dari DB — bukan hasil
   menjalankan kode versi lama (kode lama sudah tidak ada). Angka ini dilabeli sebagai rekomputasi.
2. **Edge `CANCELLED + PAID` (ORD-20260908-HCOK1L, Rp90.000) TIDAK diubah** — sesuai perintah, tetap
   mengikuti `status != CANCELLED`. Keputusan bisnis untuk kasus ini **belum diambil** (dicatat di audit 5A §6/§12 G4).
3. **Temuan di luar scope, TIDAK diperbaiki** (tidak termasuk gap yang disetujui): field `completedOrders`
   adalah hitungan **sepanjang waktu** (`status=COMPLETED`, tanpa batas tanggal) padahal label UI-nya
   **"Selesai Hari Ini"**; `pendingOrders`/`processingOrders`/`readyOrders` juga tanpa batas tanggal.
   Terlihat di runtime: card "Selesai Hari Ini" menampilkan **16** (semua COMPLETED historis). Ini
   **pre-existing**, tidak berubah oleh 5B, dan sengaja **tidak** disentuh.
4. **Tidak ada test unit/otomatis** untuk revenue semantics (repo tanpa test runner) — verifikasi
   dilakukan lewat runtime API + browser nyata.
5. **Tidak ada pengukuran beban produksi** — dataset lokal kecil (35 order); tidak ada benchmark
   performa maupun bukti kebutuhan index baru.
6. **Periode selain "today" tidak diuji untuk dashboard** — dashboard hanya punya konsep "hari ini"
   (sesuai kontrak API existing), jadi kesetaraan diuji pada periode `today` (persis target permintaan).
7. Validasi UI dilakukan pada nilai 0 (setelah cleanup), bukan pada 115.000 — angka non-nol
   diverifikasi di level API (dan binding memakai field yang sama, code trace).

## 15. Final result

| Kriteria permintaan | Status |
| --- | --- |
| Implement hanya gap yang disetujui (G1/G2) | **DONE** |
| Reuse predicate `revenueWhere` existing; hindari predicate kedua | **DONE** (di-export & dipakai bersama) |
| `dashboard.todayRevenue === report.summary.totalSales` (periode today, scope sama) | **DONE** — 115.000 = 115.000 (ADMIN), 74.000 = 74.000 (CASHIER) |
| Semantics report tidak diubah | **DONE** — diff hanya `export` |
| Edge `CANCELLED + PAID` tetap existing behavior | **DONE** — tidak dihitung |
| API contract `GET /api/orders/dashboard/stats` sama | **DONE** — 8 key identik, hanya nilai |
| Security: `restaurantId` dari session, `authorizedBranches`, CASHIER tidak diperlebar | **DONE** |
| Database NONE / tanpa migration / tanpa index | **DONE** — 0 DDL/DML |
| Performa: agregasi DB, tanpa N+1, tanpa fetch ke client | **DONE** |
| tsc / build / git diff --check | **PASS** (exit 0) |
| Runtime test, login ADMIN + CASHIER, bandingkan dua endpoint | **PASS** — 37/37 |
| Test pembeda 6 kasus + tenant isolation + branch scope | **PASS** |
| Snapshot DB sebelum/sesudah (read-only) | **PASS** — identik |
| Regression: report/print bill/reservation | **PASS** |
| Fixture sementara + cleanup (baseline persis) | **PASS** |
| Tanpa commit / push / deploy | **DIPATUHI** — HEAD tetap `d7f29ac` |

**Hasil: implementasi minimal 2 file (1 di antaranya hanya `export`), 37/37 runtime check PASS,
0 FAIL, 0 migration, 0 perubahan DB, tanpa commit/push/deploy.**

> **STOP** setelah report ini — sesuai instruksi.
