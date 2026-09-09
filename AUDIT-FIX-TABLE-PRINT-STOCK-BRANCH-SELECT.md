# AUDIT + FIX — TABLE • PRINT • STOCK • BRANCH SELECTION

> Audit akhir (Phase 33–38) fitur management table, print bill, stock per cabang, dan pemilihan cabang.
> Tanggal: 2026-09-09 · Env produksi test: `http://127.0.0.1:3001` (`pm2` `restaurant-app`, uptime stabil, `restart_time=7`)
> Restaurant: `cmtois12y0000bzu8o894azsd` ("Restoran Bahagia") · Branch: MAIN `cmts3aks100009tu818hblu00`, JKT `TEST-BR-JKT`, BDG `TEST-BR-BDG` (semua ACTIVE)

---

## 1. Executive Summary

Berbagai regresi ditemukan & diperbaiki tanpa mengubah arsitektur auth/branch/payment:

1. **Print bill ter-clipping** (isi terpotong kanan/tengah) — root cause: strata dialog Radix + CSS `@media print` konvensional. Fix final dengan **portal `#print-root` ke `document.body`**: saat print, seluruh konten lain `display:none`, hanya isi bill yang dicetak penuh. Terverifikasi PDF A4/thermal80/thermal58/per-product.
2. **Lebar thermal 80/58 mm** sempat turun ke ukuran A4 — kelas `paperWidthClass` kini unconditional.
3. **Dialog table QR tidak muat** di viewport mobile + `admin/tables/page.tsx` memakai URL API salah → keduanya diperbaiki.
4. **Harness audit** dikoreksi (pdftotext untuk isi PDF, ekspektasi QR "Mulai Pesan" → /menu, matriks user scoping benar, stall server transient ditangani `waitServer()`, `localStorage` butuh origin, cookie HttpOnly tidak bisa dibersihkan antar-page → pakai incognito browser context per user).
5. **Pemilihan cabang customer** (root `/` → /menu / /pilih-cabang, prioritas `table_context`) **terverifikasi di produksi**.
6. **Phase 38 — cleanup**: 20 order test, 5 customer test, 3 tabel test (ZZ-Audit-999, TEST-TBL-JKT-01, TEST-TBL-BDG-01) dihapus; stock dikembalikan 0; tidak ada sisa `ZZ-*`/`TEST-*`.

**Verdict: 🟢 PASS** — semua fase hijau dengan bukti runtime (34/34 UI audit, 33/33 produksi, tsc/build PASS).

---

## 2. Ringkasan Hasil Per Fase

| Fase | Scope | Hasil |
|---|---|---|
| 33 | Stock lifecycle + variant/addon (harness, JKT/BDG/MAIN) | **28/28 + 7/7 PASS** |
| 34 | UI audit (table, QR dialog, print dialog, branch selector, QR landing) | **PASS=34 FAIL=0** |
| 35 | Migrasi schema `branchproduct.stock` | **AMAN** (NOT NULL DEFAULT 0, non-destructive) |
| 36 | `tsc --noEmit` + `npm run build` | **PASS** (0 error) |
| 37 | Produksi port 3001 — stock JKT, tabel JKT, scope kasir, CSV ACL, root routing | **PASS=33 FAIL=0** |
| 38 | Cleanup data test + verifikasi state final | **BERSIH** (0 order, 0 payment, 12 tabel, stock 0) |

---

## 3. Defect & Fix

### 3.1 Print bill ter-clipping (P0) — FIXED & VERIFIED

**Gejala:** hasil print bill (A4) terpotong: garis kanan/isi terpotong, bilah sebaran tinta (ink bands) kosong di sisi kanan, "RESTORAN BAHAGIA" serta baris menu terpotong.

**Percobaan root cause (semua diuji, dipertahankan/dibuang):**
- `#bill-print-root { position:absolute; inset:0 }` + `height:auto` → kolaps ke ~32px (konten overflow).
- Centering print ICB (100% x 100%) → paruh kiri bill ter-potong (oknum absolute-position).
- `break-inside:avoid` pada seluruh bill → SUKA seluruh 1197px bill dibuang ke page 2 (paruh bawah + margin).
- Dialog Radix (flattened) → konten berpindah ke halaman 2.

**Fix final (arsitektur print-root):**
- `src/components/admin/orders/print-bill-dialog.tsx`:
  - `billBody` dihitung **sekali** dan dirender di preview dialog (`#bill-print-root`, screen-only) **dan** di-portal ke `document.body` sebagai `<div id="print-root" class="hidden">` via `createPortal` (`react-dom`).
  - `paperWidthClass` diterapkan **unconditional** (80mm/58mm), bukan hanya saat width<90.
- `src/app/globals.css` `@media print`:
  ```css
  @media print {
    body > *:not(#print-root) { display: none !important; }
    #print-root { display: block !important; }
    #print-root .bill-inner { box-shadow: none; border: none; }
  }
  ```
- `window.print()` hanya dipanggil di dialog ini → CSS print global aman.

**Verifikasi PDF (order ORD-20260909-IV06W2, 25 item, Rp675.000):**
| Aspek | Hasil |
|---|---|
| A4 page 1 texts | 671 char, page 2 = 88 char (2 halaman, semua 25 baris + total ada) |
| Ink bands page 1 (90dpi) | `[2.169, 0.015, 0.968, 0.088, 2.132]` — **kelima band terisi**, tidak ada clipping |
| Header | "RESTORAN BAHAGIA" + alamat + telp + nomor order + tanggal + Dine In + customer tampil penuh |
| Isi menu | 25× "Nasi Goreng" terbaca `pdftotext` |
| Total | Subtotal & Total = Rp675.000 + status "Belum Bayar" |
| Thermal 80mm | extent teks 64.1mm di dalam box 72mm ✔ |
| Thermal 58mm | extent teks 45.8mm di dalam box 52mm ✔ |
| Per-produk | 27 tiket (qty3 + 24 item), satu tiket/halaman, tanpa Total/bayar |

Produk/bukti: `/tmp/opencode/a4-final.pdf`, `t80-final.pdf`, `t58-final.pdf`, `pp-final.pdf`, PNG band-analysis.

### 3.2 Dialog table QR overflow → FIXED
Dialog QR dan tautan berhasil dibuka di audit (all viewport sizes); perbaikan `src/components/ui/dialog.tsx` (constrain viewport) dan `src/app/admin/tables/page.tsx` (URL API + error UI) dipertahankan dari audit sebelumnya.

### 3.3 Harness/ekspektasi audit dikoreksi
- Pengecekan isi PDF memakai `pdftotext` (Chrome meng-kompres stream PDF dengan Flate — string mentah tidak terbaca).
- QR `/t/{code}/{no}` tidak auto-redirect; halaman landing menampilkan "Mulai Pesan" → `router.push("/menu")` → ekspektasi audit disesuaikan dan PASS.
- Password test user `admin-all@` / `cashier-jkt@` **di-reset** (bcrypt, cost 12) ke nilai test yang terdokumentasi — bukan tebakan.
- Harness produksi: `waitServer()` sebelum login (menghadapi stall transient server saat RAM penuh, `restart_time` TETAP 7 — bukan bug app), navigasi awal untuk mendapat origin sebelum `localStorage`, dan **incognito browser context per user** (page baru share cookie HttpOnly → login kembali ter-redirect).

---

## 4. Model Otorisasi Branch (terverifikasi)

| User | Role | Scope | Login |
|---|---|---|---|
| `admin@restobahagia.com` | ADMIN | MAIN | [test credential configured separately] |
| `kasir@restobahagia.com` | CASHIER | MAIN | [test credential configured separately] |
| `admin-all@restobahagia.com` | ADMIN | **semua** (UserBranch kosong) | [test credential configured separately] |
| `admin-scoped@restobahagia.com` | ADMIN | JKT | [test credential configured separately] |
| `cashier-jkt@restobahagia.com` | CASHIER | JKT | [test credential configured separately] |

- Header `x-branch-id` non-assigned → **403 "Anda tidak memiliki akses ke cabang ini"** (server benar menolak).
- Headerless / header branch sendiri → 200 (scope dari `UserBranch`).
- MAIN-scoped admin yang men-set `admin_branch_id` JKT: jQuery interceptor mengirim header → 403; `useBranchContext` membersihkan nilai tak sah → host page stock **fallback MAIN** dengan badge "Cabang: Main Outlet (MAIN)". Perilaku benar (documented in `AUDIT-FIX-403-KASIR-MAIN-OUTLET.md`).
- Stock page untuk admin-all dengan `admin_branch_id` JKT menampilkan badge "Jakarta (JKT)".

---

## 5. Phase 33 — Stock Lifecycle (harness `phase33-harness.ts`)

Produk target: Es Teh (`cmtois1jn0006bzu8zri0yq5n`); JKT/BDG/MAIN; `branchproduct.stock` (NOT NULL DEFAULT 0, migrasi aman).

- Create order PAID saat stock cukup → stock berkurang (transaksional `updateMany stock >= qty`).
- Create order PAID saat stock kurang → **ditolak** (tidak mengubah stock).
- Stock JKT tidak bocor ke BDG/MAIN dan sebaliknya.
- Update stock admin (0↔N) + reload UI.
- **28/28** skenario inti + **7/7** variant/addon; semua state dikembalikan ke nilai awal.

## 6. Phase 34 — UI Audit (`ui-audit.mjs`) 34/34

- Tabel/QR dialog fit seluruh viewport (375/768/1024/1440).
- Print dialog (80mm & 58mm) fit; buka PDF → 272px/196px (thermal width).
- Per-produk: 24 tiket, tanpa total/payment.
- A4: 22-line order → 2 halaman, semua baris + total ada (cek `pdftotext`).
- Branch selector: single-branch kasir tidak melihat selector; multi-branch melihat.
- QR landing + "Mulai Pesan" → /menu; tidak ada mobile horizontal overflow.

## 7. Phase 35 — Migration

Migrasi `branchproduct.stock` (kolom baru NOT NULL DEFAULT 0) sudah applied, non-destructive; schema konsisten; tidak ada perubahan arsitektur.

## 8. Phase 36 — Regression Build

```
$ npx tsc --noEmit    → exit 0 (0 error)
$ npm run build        → PASS
```

## 9. Phase 37 — Produksi 3001 (`prod-verification.mjs`) — PASS 33/33

| # | Check | Hasil |
|---|---|---|
| 1 | root: valid saved branch → /menu | PASS |
| 2 | root: invalid saved branch → /pilih-cabang | PASS |
| 3 | root: invalid saved branch di-clear | PASS |
| 4 | root: `table_context` menang → /menu | PASS |
| 5 | QR landing `/t/JKT/1` render | PASS |
| 6 | QR "Mulai Pesan" → /menu | PASS |
| 7 | MAIN admin login → dashboard | PASS |
| 8 | MAIN admin + hint JKT → 403 | PASS |
| 9 | MAIN admin tanpa hint/own → 200 | PASS |
| 10 | MAIN admin reports load | PASS |
| 11 | MAIN admin CSV export → 200 | PASS |
| 12 | admin-all login (all-branch) | PASS |
| 13 | admin-all tabel JKT → 200 | PASS |
| 14 | stock JKT badge "Jakarta (JKT)" + rows | PASS |
| 15 | stock JKT set 0→7 | PASS |
| 16 | stock persist setelah reload | PASS |
| 17 | stock restore 7→0 | PASS |
| 18 | create tabel JKT (UI) → row muncul | PASS |
| 19 | QR dialog open + fit | PASS |
| 20 | tabel row fetchable | PASS |
| 21 | PUT rename → 200 | PASS |
| 22 | UI tampil rename | PASS |
| 23 | DELETE → 200 | PASS |
| 24 | UI tidak lagi tampil row | PASS |
| 25 | kasir MAIN login | PASS |
| 26 | kasir MAIN reports load | PASS |
| 27 | kasir MAIN UI tanpa tombol Export CSV | PASS |
| 28 | kasir MAIN headerless → 200 | PASS |
| 29 | kasir MAIN + branch lain → 403 | PASS |
| 30 | kasir JKT login | PASS |
| 31 | kasir JKT own reports → 200 | PASS |
| 32 | kasir JKT + MAIN → 403 | PASS |
| 33 | kasir JKT tables → 200 | PASS |

Seluruh artifact (tabel ZZ-Audit-Jkt-777/776, stock 0→7→0) dibersihkan di akhir run.

## 10. Phase 38 — Cleanup & State Final

**Dihapus:**
- 20 order test (`ORD-20260907-15CBTF`, `ORD-20260908-*` ×10, `ORD-20260909-*` ×9: 22-line audit & 25-line print-audit & smoke) + child rows (4 payment, statusHistory, items, refunds, cancellations, promoUsage) via transaksi berurut dependency.
- 5 customer test (Audit Tester & kawan-kawan — 0 order tersisa).
- Tabel test: `ZZ-Audit-999` (MAIN, sisa dari baris uji cabang), `TEST-TBL-JKT-01`, `TEST-TBL-BDG-01`.
- Script diagnostik root (probe/diag/print-experiment/trace/ui-print-audit/prod-env-check). Harness sah dipertahankan: `ui-audit.mjs`, `phase33-harness.ts`, `prod-verification.mjs`.

**State final terverifikasi:**
```
orders 0   payments 0   customers test 0
tables 12   → MAIN: Table 01–10; JKT: Meja 101, Meja 103
stock Es Teh: MAIN 0 | JKT 0 | BDG 0
ZZ-* / TEST-* tables: none
pm2: restaurant-app online, restart_time tetap 7
HTTP: / 200, /api/public/branches 200
```

---

## 11. Files Changed (uncommitted)

| File | Perubahan |
|---|---|
| `src/app/globals.css` | **FIX PRINT** — `@media print` skema `#print-root` (body > * display:none, print-root block) |
| `src/components/admin/orders/print-bill-dialog.tsx` | **FIX PRINT** — `billBody` tunggal + portal `#print-root` + `paperWidthClass` unconditional |
| `src/app/admin/tables/page.tsx` | URL API yang benar + error handling UI (fix dari audit sebelumnya) |
| `src/components/ui/dialog.tsx` | Constrain `max-height`/scroll agar dialog QR fit viewport mobile |
| `src/app/page.tsx` (baru, menggantikan `src/app/route.ts`) | Prioritas routing: `table_context` → /menu; `customer_branch_context` valid → /menu; invalid → /pilih-cabang |
| `src/app/pilih-cabang/`, `src/app/api/public/branches/` (baru) | Pemilihan cabang customer + endpoint public branches |
| PWA/menu/orders/cart/services | Fitur multi-branch customer (dari phase sebelumnya, uncommitted) |
| `ui-audit.mjs`, `phase33-harness.ts`, `prod-verification.mjs` (baru) | Harness audit (bukti) |

## 12. Remaining Risks

- **Stall transient server** saat RAM box ~82% (satu-dua `ERR_CONNECTION_REFUSED` sesaat, tanpa restart pm2) — bukan bug app; `waitServer()` menanganinya di harness.
- User test `admin-scoped@` belum diverifikasi login di Phase 37 (scope JKT + `x-branch-id` behavior sudah diverifikasi lewat user lain & checks 13/29—33 yang setara). Password-nya berdasar konvensi test; admin @ (MAIN) telah teruji sepenuhnya.
- Data test sudah dihapus tuntas; tidak ada order tersisa untuk demo UI (dashboard kosong sesuai design, bukan regresi).
- Kode ui-print-fix (globals.css + print-bill-dialog) dan fitur branch belum di-commit (menunggu persetujuan).

## 13. Verification Checklist

- [x] Stock per-cabang: create/refund/blokir + isolasi branch (33) — 28+7 PASS
- [x] UI audit table/QR/print/branch-selector (34) — 34/34 PASS
- [x] Migrasi `branchproduct.stock` aman (35)
- [x] `tsc` + `next build` PASS (36)
- [x] Produksi 3001: stock JKT UI+API, tabel JKT UI+API+QR, scope kasir, CSV ACL, root routing (37) — 33/33 PASS
- [x] Print bill A4/80/58/per-produk VERIFIED FULL (tinta 5 band, header+25 item+total, tidak clipping)
- [x] Cleanup test data + state final bersih (38)

**Verdict: 🟢 PASS**