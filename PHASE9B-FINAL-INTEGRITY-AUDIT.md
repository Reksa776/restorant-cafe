# PHASE 9B — FINAL INTEGRITY AUDIT

**Repository:** `/home/reksa/restorant-cafe`
**HEAD (tidak berubah):** `d7f29ac` (`d7f29acecd0432c13a3d0d731f0869e72b9a1aef`)
**Jenis:** AUDIT ONLY — read-only; tanpa perubahan source/schema/migration/seed/data; tanpa commit/push/deploy/VPS.
**Tanggal:** 2026-10-09

> **Catatan integritas bukti:** setiap temuan ditandai sumbernya — **[Langsung]** = diperiksa langsung pada code/DB saat audit ini; **[Laporan]** = bukti dari laporan terdahulu (tidak diulang penuh); **[Belum diverifikasi]** = tidak dapat dipastikan dengan data saat ini.

---

## 0. Inventaris laporan

| Laporan diminta | Status |
|---|---|
| `PHASE9B-CUSTOMER-RESERVATION-REPORT-AUDIT.md` | **TIDAK DITEMUKAN (nama berbeda).** File aktual: `PHASE9-CUSTOMER-RESERVATION-REPORT-AUDIT.md` (tanpa “B”). Dicatat, bukan diganti dengan asumsi. |
| `PHASE9B-CUSTOMER-RESERVATION-REPORT-IMPLEMENTATION.md` | PRESENT (641 baris) |
| `PHASE9B-POST-AUDIT.md` | PRESENT (387) |
| `PHASE9B-F2-FIX-REPORT.md` | PRESENT (186) |
| `PHASE9B-F3-FIX-REPORT.md` | PRESENT (147) |
| `PHASE9B-F4-REVENUE-CONSOLIDATION-REPORT.md` | PRESENT (153) |
| `PHASE9B-F5-CUSTOMER-REVENUE-ALIGNMENT-REPORT.md` | PRESENT (141) |
| `PHASE9B-F6-SCOPE-AUDIT.md` | PRESENT (150) |
| `PHASE9B-F7-SCOPE-AUDIT.md` | PRESENT (153) |
| `PHASE9B-F7-UI-LABEL-REPORT.md` | PRESENT (99) |
| `PHASE9B-F8-SCOPE-AUDIT.md` | PRESENT (174) |
| `F1-CUSTOMER-CREDENTIAL-SECURITY-FIX.md` | PRESENT (284) |

Referensi tambahan yang ada di repo: `PHASE9B-F2-F8-AUDIT.md`, `PHASE9B-F3-SCOPE-AUDIT.md`,
`PHASE9B-POST-F4-SEMANTIC-REVIEW.md`.

---

## 1. Status F1–F8 terhadap acceptance criteria

| ID | Acceptance criteria (dari audit asli) | Status | Bukti |
|---|---|---|---|
| **F1** | Customer credential (password hash / whatsappId) tidak boleh keluar dari endpoint customer/order/payment | **FIXED** | **[Langsung]** `CUSTOMER_PUBLIC_SELECT` = `{id,name,phone,email,isActive,createdAt,updatedAt}` (customer.service.ts:14); order.service 8 + payment.service 2 lokasi `customer: { select: { id, name, phone } }`; grep `password: true|whatsappId: true` di `report/`+`customer/` → **none**; runtime: customer report/list/detail rows **tanpa** `password`/`whatsappId`. |
| **F2** | Export reservasi sepadan dengan report: order-branch filter + refund `approvedAt` + product `createdAt` + shared-`orderId` sekali | **FIXED** | **[Langsung]** export: `aliasBranchSql("o", branchFilters)` (3448/3458), `approvedRefundsSql(restaurantId, range)` (3453), bound `o.createdAt` in-range, `revenueAttributed` (3500–3506). **[Langsung]** runtime: report net == CSV sum pada [MAIN]/[PERUM-1]/no-filter. |
| **F3** | Untuk caller branch-scoped, identity list customer harus milik branch (period-created boleh bila punya order di branch) | **FIXED** | **[Langsung]** `activityOrNew` branch-scoped (2735+); **[Laporan]** runtime [MAIN] 35→20, [PERUM-1] 35→12 (F3-FIX-REPORT). |
| **F4** | Hilangkan duplikasi predikat/math kanonik; satu sumber; tanpa perubahan perilaku | **FIXED** | **[Langsung]** helper tunggal: `paidRevenueSql` (532), `revenueSetSql` (545), `productRevenueSql` (551), `refundRevenueSql` (560), `approvedRefundsSql` (578), `aliasBranchSql` (596); **[Langsung]** equality kanonik tetap 517000/30000/487000 (kedua engine). |
| **F5** | Refund half `computeCustomerRevenue` memakai predikat revenue-set kanonik | **FIXED** | **[Langsung]** refund half memakai `revenueSetSql("o")` (komentar F5 di 430); **[Langsung]** canonical net/refund tetap 487000/30000. |
| **F6** | Tidak ada `noShowAt`/history → funnel no-show hanya snapshot status | **OUTSTANDING (by-design)** | **[Langsung]** `Reservation` tanpa `noShowAt` (schema 686 + `information_schema`); funnel `SUM(r.status='NO_SHOW')` (3140/3169/2870); **[Laporan]** audit F6 → tidak diubah. |
| **F7** | Revenue reservasi memakai basis kanonik (bukan business date); UI harus menyatakan basisnya | **RESOLVED (Opsi C)** | **[Langsung]** label UI ada di `reservations/page.tsx:296` dengan teks persis; basis kanonik tetap (computeRefundRevenue `range.start/end`). |
| **F8** | Isolasi lintas-tenant `orderId` bersifat app-layer; tanpa FK | **OUTSTANDING (by-design)** | **[Langsung]** `orderId String?` tanpa relation/index; guards `restaurantId` ada; DB: linked 0, cross-tenant 0, cross-branch 0, orphan 0; tanpa index `orderId`. |

Ringkas: **F1, F2, F3, F4, F5 = FIXED; F7 = RESOLVED (label); F6 & F8 = OUTSTANDING (keterbatasan desain yang disengaja, bukan bug finansial).**

---

## 2. Konsistensi revenue/refund di semua report & CSV

- **[Langsung]** `computeRefundRevenue` == `computeCustomerRevenue` (all-time): product **517000**, refund **30000**, net **487000**; per-branch product MAIN 150000 + PERUM-1 367000 = 517000.
- **[Langsung]** Reservation report vs CSV: `Σ CSV.revenue == summary.reservationNetRevenue` untuk `[MAIN]`, `[PERUM-1]`, dan no-filter (saat ini 0 karena 0 reservasi ter-link).
- **[Langsung]** Predikat kanonik tunggal (F4) dipakai oleh `computeRefundRevenue`, `computeCustomerRevenue`, activity `CASE`, funnel `paid`, dan export → tidak ada salinan yang bisa drift.
- **[Belum diverifikasi]** Kesetaraan lintas-periode/cross-refund pada data nyata (dataset 0 order ter-link reservasi) → kasus multi-periode hanya terbukti lewat fixture/in-memory di laporan F2/F4/F5.

---

## 3. Tenant & branch isolation (API, service, export)

- **[Langsung]** 4 route report (`customers`, `customers/export`, `reservations`, `reservations/export`) memakai `requireAdmin` + `branchHintFrom`/`authorizedBranches` + `restaurantId` dari sesi (25 referensi guard).
- **[Langsung]** Tenant: `getReservationReport("NOPE", …)` → `totalReservations 0`; `getReservationsForExport("NOPE", …)` → **0 baris**. Service kanonik & customer semuanya `restaurantId`-scoped (F4 memusatkan predikat).
- **[Langsung]** Branch: order/refund memakai `branchId IN branchFilters`; reservation base memakai `branchId`; F2 menambahkan branch pada order lookup export. Customer report identity list branch-scoped (F3).
- **[Belum diverifikasi]** Kasus lintas-tenant/lintas-branch nyata: 0 reservasi ter-link dan 0 order lintas-branch → **NOT REPRODUCED**, hanya terbukti struktural + tenant `NOPE` runtime.

---

## 4. Perlindungan data sensitif customer

- **[Langsung]** `CUSTOMER_PUBLIC_SELECT` allow-list; order/payment (F1) `{id,name,phone}` ×10; tidak ada `password: true`/`whatsappId: true` di `report/`+`customer/`.
- **[Langsung]** Runtime: customer report rows (19 field), customer list `items` (10 field, n=5), customer detail (8 field) — **tidak ada** `password`/`whatsappId`.
- **[Langsung]** Customer CSV export: header tidak memuat password/whatsappId (route komentar + kolom name/phone/email).

---

## 5. Kesesuaian UI dengan API dan aturan tanggal

- **[Langsung]** Tipe `ReservationReport`/`CustomerReport` (`src/services/report.service.ts`) konsisten dengan payload service; UI mengonsumsi `summary`, `funnel`, `byStatus/byBranch/bySource/byDate`, `paymentStatus`.
- **[Langsung]** Label F7 ada (page line 296) menjelaskan basis tanggal revenue (order + refund approval), sejalan dengan komentar service (line 3034–3036).
- **[Langsung]** UI date scope: `reservationDate` (business date) untuk daftar/periode; revenue memakai basis kanonik — perbedaannya sudah dijelaskan di UI.
- **[Laporan]** F7-UI-LABEL-REPORT mencatat verifikasi `tsc`/`diff --check` bersih.

---

## 6. Potensi regresi / konflik antar-perubahan

- **Tidak ditemukan konflik.** F2 dan F4 saling memperkuat jalur export; F5 menyempitkan refund half customer (dokumentasi eksplisit, guarded oleh equality kanonik); F3 hanya mengubah identity list customer; F7 hanya teks UI.
- **Risiko residual (by-design, bukan regresi):** F6 (tanpa `noShowAt`) dan F8 (tanpa FK) tetap terbuka; keduanya tidak memengaruhi angka finansial saat ini.
- **[Langsung]** Equality kanonik tetap terjaga setelah semua fase → tidak ada regresi angka.

---

## 7. Git & integritas uncommitted work

- **[Langsung]** HEAD = `d7f29ac` (tidak berubah). Tidak ada staging (`git diff --cached` kosong).
- **[Langsung]** Working tree: **21 file tracked modified**, **33 path untracked** (termasuk 28 laporan `.md` + 5 direktori source PHASE 9B: `audit-logs/layout.tsx`, `reports/customers/`, `reports/reservations/`, `api/reports/customers/`, `api/reports/reservations/`).
- **[Langsung]** Schema/migration: `git diff -- prisma/` = **0 baris**; migrasi terakhir `20260920_add_floor_layout` (tidak ada migrasi baru).
- **[Langsung]** Tidak ada `git reset`/`git clean`/commit/push/deploy. Read-only probe dihapus (`ls _p9b*.ts` → none).
- **[Langsung]** Order historis `ORD-20260908-HCOK1L` tidak disentuh (tetap CANCELLED/PAID).

---

## 8. Daftar pemeriksaan: berhasil / gagal / belum

| Pemeriksaan | Hasil |
|---|---|
| Inventaris 12 laporan | **Sebagian** — 11 PRESENT; 1 nama berbeda (dicatat) |
| Revenue/refund canonical equality (kedua engine) | **BERHASIL** (517000/30000/487000) |
| Reservation report ↔ CSV consistency | **BERHASIL** (0-linked; konsisten) |
| Tenant isolation runtime (`NOPE`) | **BERHASIL** (0) |
| Sensitive-field absence (report/list/detail) | **BERHASIL** |
| F1 fix sites (order/payment) | **BERHASIL** (10 lokasi) |
| F3/F5/F7 anchor presence | **BERHASIL** |
| Schema/migration/Git integrity | **BERHASIL** |
| `npx tsc --noEmit` / `npm run build` | **TIDAK DILAKUKAN** pada audit ini (tidak ada perubahan code; sesuai instruksi). Bukti build/typecheck ada di laporan fase masing-masing. |
| Live cross-tenant / cross-branch / cross-period | **BELUM DIVERIFIKASI** (0 data) → NOT REPRODUCED |

Tidak ada pemeriksaan yang **GAGAL**.

---

## 9. Verdict keseluruhan & rekomendasi

**Verdict: WARN** (bukan BLOCKER).

- Semua temuan fungsional/keamanan yang dapat ditindak (**F1, F2, F3, F4, F5**) sudah **FIXED** dan terverifikasi; **F7** tertutup via label UI.
- **F6** dan **F8** adalah **keterbatasan desain yang sengaja** dan tetap **OUTSTANDING**; keduanya tidak berdampak pada angka finansial atau kebocoran lintas-tenant pada data saat ini. Karena masih terbuka (walau by-design), status keseluruhan = WARN, bukan PASS penuh.

**Rekomendasi langkah selanjutnya (menunggu persetujuan; tidak dikerjakan saat audit):**
1. **F6:** dokumentasi in-product (hint bahwa “Tidak Hadir” adalah snapshot status); hanya jika analitik time-ordered diminta, tambah additive `noShowAt DateTime?` di fase terpisah.
2. **F8:** pertahankan predikat; opsional additive `@@index([orderId])` **hanya jika** join terukur lambat, atau validasi runtime pada jalur tulis reservasi→order; FK nyata tidak direkomendasikan.
3. **Verifikasi data nyata:** dengan fixture terisolasi (di fase terpisah), uji lintas-periode / lintas-branch / lintas-tenant untuk menutup item “BELUM DIVERIFIKASI”.
4. **Sebelum commit:** jalankan `npx tsc --noEmit` + `npm run build` sekali lagi di HEAD saat ini (dilaporkan bersih pada tiap fase, tetapi audit ini tidak menjalankannya karena tidak ada perubahan code).

---

## 10. Integrity statement (audit ini)

- **Perubahan:** tidak ada. Tidak ada source/schema/migration/seed/data yang diubah/dihapus; tanpa `git reset`/`git clean`.
- **Migration/DB:** tanpa migrasi baru; tanpa reset; tanpa perubahan data historis; `git diff -- prisma/` = 0.
- **HEAD Git:** `d7f29ac` (tidak berubah); tanpa commit/push/deploy/VPS.
- **Uncommitted work:** F1, PHASE 9B, F2, F3, F4, F5, F7 tetap utuh (21 modified + 33 untracked, tanpa staging).
- Probe read-only dihapus; tidak ada build/typecheck dijalankan (tidak relevan tanpa perubahan code).

**STOP.** Menunggu persetujuan sebelum tindak lanjut coding.
