# AUDIT + FIX — BRANCH SELECTION & STOCK SOLD OUT

> Audit dan perbaikan dua bug produksi pada alur customer:
> **(1)** pemilihan cabang tidak bisa diganti lagi setelah tersimpan, **(2)** produk dengan stock 0 (termasuk produk tanpa `BranchProduct` di cabang) masih bisa dibeli.
> Tanggal: 2026-09-09 · Verifikasi: `npx tsc --noEmit` + `npm run build` + test fungsional pada build produksi `next start` port 3001 (API level).
> Restaurant: `cmtois12y0000bzu8o894azsd` ("Restoran Bahagia") · Branch aktif: MAIN `cmts3aks100009tu818hblu00`, JKT `TEST-BR-JKT` (code `JKT`), BDG `TEST-BR-BDG` (code `BDG`).

---

## 1. Problem

### Bug 1 — Cabang tidak bisa diganti
- Semua route root (`/`) langsung `router.replace("/menu")` begitu ada `customer_branch_context` yang valid. Customer **tidak pernah bisa berpindah cabang**; tidak ada UI "Ganti Cabang".

### Bug 2 — Produk stock 0 masih bisa dibeli
- Produk yang **tidak punya `BranchProduct`** untuk sebuah cabang (mis. `Nasi Goreng` tidak ter-registrasi di JKT) muncul di menu dengan `stock: null` → UI menganggap bisa dibeli (`isSoldOut`: `stock != null && stock <= 0` = false).
- `order.service.ts` men-skip validasi stock untuk produk semacam itu (`if (stock === undefined) continue`). **Akibat: stok MASTER (mis. 100 di MAIN) bisa "dibeli" dari cabang yang tidak menyediakannya**, dan produk stock 0 yang TIDAK punya baris stock tidak tertolak server.

---

## 2. Root Cause

1. **`src/app/page.tsx`**: logika lama memang menangani `tableContext` dan validasi, tetapi ketika `customerBranch` valid SELALU memproses ke `/menu`. Tidak ada state/UI untuk mengganti cabang. Root fix: tampilkan halaman landing dengan aksi terpisah saat konteks cabang valid.
2. **Ambiguitas makna "tidak ada baris stock"**: kode lama memperlakukan `BranchProduct` yang tidak ada sebagai *legacy unmanaged → bisa dibeli*. Setelah migrasi `branchproduct.stock` (NOT NULL DEFAULT 0), makna yang benar di cabang adalah **tidak di-stock → stock 0 → SOLD OUT**. Tiga titik yang keliru memperlakukan `undefined` sebagai buyable:
   - `GET /api/public/menu` → `stock: bp?.stock ?? null`
   - `recommendation.service.ts` (pemetaan `loadProducts` + `getFallbackProducts`) → `stock: bp?.stock ?? null`
   - `order.service.ts` (validasi `createOrder` + `createCustomerOrder`) → `if (stock === undefined) continue`
3. **Tidak ada gate stock client** di cart/checkout — sebelum submit server, user tidak pernah diperingatkan item habis.

---

## 3. Files / Flow Terdampak

| File | Peran |
|---|---|
| `src/app/page.tsx` | Landing root — titik masuk pemilihan cabang |
| `src/app/(customer)/menu/page.tsx` | Tombol "Ganti Cabang" (non-`tableContext`) |
| `src/app/api/public/menu/route.ts` | Resolusi stock per cabang |
| `src/services/recommendation/recommendation.service.ts` | Resolusi stock di tier rekomendasi/bestseller |
| `src/services/order/order.service.ts` | Validasi stock server (admin `createOrder` + customer `createCustomerOrder`) |
| `src/app/(customer)/cart/page.tsx` | Warning/habis per item + cap quantity |
| `src/app/(customer)/checkout/page.tsx` | Stock gate client + warning inline |
| `src/hooks/use-branch-stock.ts` | Hook baru — lookup stock advisory per cabang |

---

## 4. Fix

### Bug 1 — Branch selection
- **`src/app/page.tsx`** menampilkan landing saat `customerBranch` valid (tanpa `tableContext`): nama cabang/`branchCode`, tombol **"Lanjut ke Menu"** (`/menu`) dan **"Ganti Cabang"** (clear `customer_branch_context` → `/pilih-cabang`). Alur lama dipertahankan: `tableContext` → `/menu` (prioritas QR); tanpa konteks → `/pilih-cabang`; konteks invalid → validate via `/public/branches` → clear → `/pilih-cabang`; error transient → retry (tidak menghapus cabang tersimpan).
- **`menu/page.tsx`**: badge "Ganti Cabang" di header hanya saat `customerBranch && !tableContext` → `clearCustomerBranch()` + `/pilih-cabang`. Dengan `tableContext` (QR) badge tidak ditampilkan (cabang meja di-pin oleh QR — tidak bisa diganti).

### Bug 2 — Stock SOLD OUT
**Aturan final:** `stock > 0` → bisa dibeli; `stock = 0` → SOLD OUT. Produk tanpa `BranchProduct` di cabang ter-resolusi ⇒ effective stock **0**. Tanpa konteks cabang ⇒ `stock = null` (legacy, tidak diubah).

- `menu/route.ts`: `bp?.stock ?? (branchId ? 0 : null)` + keterangan.
- `recommendation.service.ts`: `bp?.stock ?? (branchId ? 0 : null)` dan `bp?.stock ?? (opts?.branchId ? 0 : null)`; docstring `loadProducts` diselaraskan.
- `order.service.ts` (kritikal — **server adalah sumber kebenaran**): pada kedua alur order, `stock === undefined` (cabang ter-resolusi) diubah dari `continue` menjadi **`throw ValidationError("Produk <nama> sudah habis")`**. Alur tanpa cabang tetap tidak divalidasi stock (legacy). `COMPLETED`-decrement tidak disentuh.
- `use-branch-stock.ts` + cart + checkout: warning "Habis" / "Stok tidak mencukupi (tersisa N)", tombol `+` di-cap pada stock, submit checkout di-block jika ada item `stock<=0 || stock<quantity`. **Semua client-side bersifat advisory** — server tetap final.

Tidak ada perubahan schema, tidak ada migrasi baru, tidak ada perubahan payment, tidak ada reset/drop DB.

---

## 5. Security Validation

- **Branch code tidak dipercaya dari client**: menu 404 `NOT_FOUND` untuk kode tak dikenal; order 400 `Cabang yang dipilih tidak valid atau tidak aktif` — keduanya diverifikasi (lihat test).
- **Stock tidak bocor lintas cabang**: stock MAIN=100 tidak bisa memvalidasi pembelian di JKT (produk tanpa baris JKT → ditolak dengan `sudah habis`).
- **Enforcement server-side** (`order.service`) berlaku utuh untuk admin `createOrder` dan customer `createCustomerOrder`; client hook tidak pernah bisa "menambah stok" — hanya *warning*.
- Tidak ada perubahan auth, tidak ada endpoint baru, tidak ada kebocoran PII; semua dibuat dengan `restaurantId`/`branchId` ter-validasi server-side.
- Hook baru tidak membaca/merubah data pengguna; hanya memetakan id produk → stock dari `/public/menu`.

---

## 6. Test Matrix (PASS/FAIL)

Verifikasi fungsional dijalankan terhadap **build produksi** `next start -p 3001` (API level, server asli + DB MySQL), lalu data test dibersihkan dan server dihentikan.

### Branch Tests (6)

| # | Uji | Hasil | Bukti |
|---|---|---|---|
| B1 | Kode cabang valid ter-resolve (menu `branchCode=JKT`) | **PASS** | 200; Nasi Goreng muncul scope JKT (stock 0) |
| B2 | Kode cabang tidak dikenal di menu | **PASS** | 404 `Branch not found` (uji dengan id `TEST-BR-JKT` sebagai code) |
| B3 | Kode cabang tidak dikenal di order | **PASS** | 400 `Cabang yang dipilih tidak valid atau tidak aktif` |
| B4 | Isolasi stock per cabang | **PASS** | Nasi Goreng stock 100 di MAIN → 0/SOLD OUT di JKT |
| B5 | Alur legacy tanpa cabang tidak berubah | **PASS** | menu `stock:null`, order tanpa branch → 201 `ORD-…` |
| B6 | Order produk stock cukup di cabang ter-resolve | **PASS** | MAIN qty1 → 201 `ORD-20260909-WKK3Q8` |

### Stock Tests (8)

| # | Uji | Hasil | Response |
|---|---|---|---|
| S1 | Produk TANPA `BranchProduct` di cabang → SOLD OUT (bukan null/buyable) | **PASS** | menu JKT: Nasi Goreng `stock=0` (sebelumnya `null`) |
| S2 | Baris `BranchProduct` dengan stock 0 → SOLD OUT | **PASS** | menu JKT & MAIN: Es Teh `stock=0` |
| S3 | Baris dengan stock>0 tetap tampil stock asli | **PASS** | menu MAIN: Nasi Goreng `stock=100` |
| S4 | Tanpa cabang → `stock:null` (legacy, tidak diubah) | **PASS** | menu tanpa `branchCode` |
| S5 | Order produk tanpa baris stock di cabang → ditolak | **PASS** | 400 `Produk Nasi Goreng sudah habis` |
| S6 | Order baris stock 0 di cabang → ditolak | **PASS** | 400 `Produk Es Teh sudah habis` |
| S7 | Order qty > stock → ditolak | **PASS** | 400 `Stok Nasi Goreng tidak mencukupi (tersisa 100, diminta 200)` |
| S8 | Order stock cukup di cabang → diterima (`COMPLETED`-decrement tidak tersentuh) | **PASS** | 201; stock TIDAK berubah saat order dibuat |

### Layer rekomendasi/bestseller

| # | Uji | Hasil |
|---|---|---|
| R1 | Rekomendasi manual dengan `branchCode=JKT` → seluruh 8 produk `stock=0` | **PASS** |
| R2 | Rekomendasi tanpa cabang → seluruh 8 produk `stock=null` (legacy) | **PASS** |
| R3 | Bestseller (tidak ada riwayat penjualan PAID di seed) → list kosong, 200 | **PASS** (pre-existing behavior) |

**Catatan kejujuran:**
- Perbaikan **Bug 1** (halaman landing `/`, tombol "Lanjut ke Menu"/"Ganti Cabang", badge menu) bersifat UI — pada sesi ini **tidak ada browser headless/produksi** (pm2 kosong, port 3001 tidak berjalan di luar sesi uji). Bukti: `tsc` + `next build` PASS + review alur logika. Disarankan spot-check browser di produksi setelah deploy.
- Saat pengujian pertama, kode yang dikirim salah (`TEST-BR-JKT` dipakai sebagai `branchCode` padahal itu `branchId`; code sebenarnya `JKT`/`BDG`/`MAIN`) — justru menghasilkan bukti B2/B3 (server menolak kode tak dikenal dengan tegas).

---

## 7. Regression Check

- `npx tsc --noEmit` → **PASS** (0 error).
- `npm run build` → **PASS** (compiled, 0 error).
- Alur legacy (tanpa cabang): menu/best-seller/rekomendasi `stock:null`, order dapat dibuat → **PASS**.
- Alur QR `/t/{branchCode}/{tableNumber}` & `/t/{tableNumber}`: tidak disentuh (logika `tableContext`/`useBranch` utuh, `page.tsx` prioritas `tableContext` tetap).
- Payment (QRIS/KASIR) & `COMPLETED`-decrement: tidak diubah.
- Admin/kasir stock management: tidak diubah.
- **Cleanup data test:** 4 order (`ORD-20260909-ZDOX5L`, `-XKBXAT`, `-WKK3Q8`, `-GQDGTS`) + 4 customer dihapus; nilai stock DB tidak diutak-atik; server `next start` pada 3001 dihentikan; tidak ada file harness baru di repo.

---

## 8. Remaining Risks

| Risiko | Catatan |
|---|---|
| Bug 1 hanya terverifikasi build/code-review | UI landing `/` + "Ganti Cabang" perlu spot-check browser di produksi (deploy dulu). |
| Cabang JKT & BDG saat ini tidak punya produk ber-stock > 0 | `BranchProduct` JKT & BDG hanya Es Teh & Es Jeruk (stock 0) → **seluruh menu SOLD OUT di kedua cabang** sampai staf mengisi stock. Ini konsekuensi dari aturan final (bukan bug), namun **harus dikomunikasikan ke pemilik** agar kasir mengisi stock per cabang. |
| `use-branch-stock` menambah 1 request `/public/menu` per halaman (cart/checkout) | Ringan; jika gagal, client skip check dan server tetap otoritatif. |
| Tier rekomendasi manual dapat menampilkan kartu stock 0 | UI tetap menampilkan kartu dengan state "Habis" (data `stock` ikut); order ditolak server — aman, hanya kosmetik. |
| `createOrder` admin kini juga menolak produk tanpa baris stock di cabang | Perilaku baru yang benar; pastikan kasir mengisi stock sebelum menyajikan produk di cabang. |

---

## Verdict: 🟢 PASS (tsc, build, 6/6 branch API, 8/8 stock API) — Bug 1 UI menunggu spot-check browser di produksi.