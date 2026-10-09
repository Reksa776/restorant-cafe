# PHASE 4 — PRINT BILL — FINAL REPORT

> **Headline finding (PHASE 4A):** a **complete Print Bill feature already exists** and is
> **already wired** into Order Detail (3 hosts). It was **not rebuilt** — the existing
> receipt component was **reused and minimally upgraded** (2 presentation rows), then
> verified **at real browser runtime** (headless Chrome + Chrome print pipeline → PDF),
> which the earlier PHASE 1.5 validation could only do by static code trace.
>
> **Deliverable:** `PHASE4-PRINT-BILL-FINAL-REPORT.md` (this file).
> **No commit / push / deploy.** HEAD remains `d7f29ac`.

---

## 1. Environment & method

| Item | Value |
| --- | --- |
| Repo | `/home/reksa/restorant-cafe` |
| HEAD | `d7f29ac fix wa reservation` (unchanged — no commit in this phase) |
| Node | v24.21.0 |
| Next.js | 16.3.3 · build: `npm run build` → **exit 0** |
| Server | `npx next start -p 3000` (production build). **Port 3000** used because `.env` sets `AUTH_URL=http://localhost:3000` — NextAuth cookie/callback must stay on the same origin. |
| DB | local MySQL `127.0.0.1:3306` / `restaurant_app` (source of truth) |
| Browser | `/usr/bin/google-chrome` (headless) via `puppeteer-core` 25.10.0 |
| Print rendering | Chrome real print pipeline: `Emulation.setEmulatedMedia(print)` + CDP `Page.printToPDF` → `pdfinfo` / `pdftotext` |
| Tenant A | `cmtois12y0000bzu8o894azsd` "Restoran Bahagia" — `siteName` **Caffe Baraja**, logo **ada**, address + phone ada; cabang **MAIN** (`cmts9dbpe…`) & **PERUM-1** (`cmts9ma1g…`) |
| Tenant B (cross-tenant) | `cmu1hoe9y0000vyivpiqa0m79` |
| Staff uji | `admin@restobahagia.com` (ADMIN, tanpa pembatasan cabang) · `kasir@restobahagia.com` (CASHIER, **hanya MAIN**) |

**Tidak disentuh:** production, VPS, container Docker (`restaurant-mariadb`/`-phpmyadmin`/`-redis`, 3307/8080/6379), Redis, iPaymu, WhatsApp engine, Order/Payment/Reservation engine, Cashier, Table engine. Tidak ada migration, tidak ada perubahan konfigurasi permanen.

---

## 2. AUDIT FINDINGS (PHASE 4A)

### 2.1 Existing Print/Receipt functionality

**Sudah ada, lengkap, dan sudah ter-commit** (`f230f9f`, `438cc1f`). Ini **satu-satunya**
receipt/print engine di repo — grep `receipt|invoice|thermal|window.print|@media print`
tidak menemukan engine kedua. **Tidak ada duplicate engine** dan tidak dibuat yang baru.

| Piece | Detail |
| --- | --- |
| Component | `src/components/admin/orders/print-bill-dialog.tsx` → `PrintBillDialog` → `FullBill` ("Print All") + `ProductTicket` ("Print Per Product") |
| Render model | Pure client-side React; `window.print()`; body bill di-`createPortal` ke `<div id="print-root">` di `document.body` |
| Print CSS | `src/app/globals.css` `@media print`: `body > *:not(#print-root){display:none!important}` + `#print-root{display:block!important}` |
| Paper | `paperWidthClass()`: A4 `w-full sm:max-w-[190mm]` · Thermal80 `w-[72mm]` · Thermal58 `w-[52mm]` (default state = **A4**) |
| Data source | Payload `Order` admin yang sudah dimuat (tenant-scoped). Komponen **tidak** mengimpor service/fetch (`window.print()` + `createPortal` saja) |
| Payment source | `Payment.transactions[]`, termasuk `type:"cashier_payment"` + `status:"PAID"` → `rawData.amountReceived` / `rawData.changeAmount` |

### 2.2 Existing Order Detail functionality (target flow sudah terpasang)

| Host | File | Status |
| --- | --- | --- |
| **Order Detail (route)** | `src/app/admin/orders/[orderNumber]/page.tsx` (`<PrintBillDialog>` + tombol **"Print Bill"**) | sudah ada, ter-wire |
| **Orders list → detail sheet** | `src/components/admin/orders/order-detail.tsx` (tombol **"Print Bill"** di `SheetHeader`) | sudah ada, ter-wire |
| **Cashier sales history** | `src/app/admin/cashier/sales/page.tsx` (tombol **"Cetak Bill"**) | sudah ada, ter-wire |

Berarti target flow **Orders → pilih Order → Order Detail → Print Bill** memang sudah
tersedia; PHASE 4 tidak menambah tombol baru (tidak ada duplikasi), hanya
meng-upgrade isi bill.

### 2.3 Existing Payment data (mana yang authoritative)

| Data | Authoritative source | Dipakai bill |
| --- | --- | --- |
| Status bayar yang ditampilkan | **`Order.paymentStatus`** (server) | ✅ `PAYMENT_STATUS_LABEL` |
| Metode bayar | **`Payment.method`** dari payment terbaru | ✅ KASIR → "Kasir", QRIS → "QRIS" |
| Waktu bayar | `Payment.paidAt` | ✅ baris "Dibayar" |
| Kedaluwarsa intent belum lunas | `Payment.expiresAt` | ✅ baris "Berlaku s/d" |
| Provider | `Payment.provider` (`ipaymu`/`cashier`) | hanya untuk fallback label, **bukan** status |
| Audit kas | `PaymentTransaction` `type="cashier_payment"` `status="PAID"` → `rawData.{amountDue,amountReceived,changeAmount,processedBy,processedAt,shiftId}` | ✅ Uang Diterima / Kembalian |

**Tidak ada status yang dikarang di sisi print.** Bill membaca nilai yang sudah tersimpan
(`order.paymentStatus` / `payment.status`) — print tidak pernah menghitung/mengubah status.

### 2.4 Existing restaurant branding data

`Restaurant.name`, `Restaurant.address`, `Restaurant.phone`, `RestaurantSettings.siteName`,
`RestaurantSettings.logoUrl` — semuanya **sudah** diselect oleh `getOrder()` /
`getOrderByNumberScoped()` (`src/services/order/order.service.ts:1413,1471`). Bill memakai
`siteName ?? name` untuk judul dan menampilkan logo bila ada. `Branch.name` juga tersedia
dan ditampilkan sebagai baris "Cabang".

### 2.5 Existing customer / order item data

`customer: true` (nama, phone) · `items[].product.name`, `quantity`, `unitPrice`,
`totalPrice`, `notes`, `customizations` (JSON snapshot: `selections[]`, `addons[]`, `notes`).
Bill mem-parse JSON yang sama dengan Order Detail — **tidak ada** logika parsing baru.

### 2.6 Existing cash received / change data → **A/B = SUDAH TERSEDIA**

Uang diterima & kembalian **sudah dipersist**, bukan di `Payment` langsung melainkan di
`PaymentTransaction.rawData` (row `provider:"cashier"`, `type:"cashier_payment"`,
`status:"PAID"`), ditulis server-side oleh `paymentService.markCashierPaymentPaid`
(`src/services/payment/payment.service.ts:584–822`). Jadi jawaban audit: **B — bisa
diturunkan dari existing Payment/PaymentTransaction (dan memang sudah tersimpan).**
**Tidak ada data yang difabrikasi.**

### 2.7 Existing QRIS status data

`Order.paymentStatus` + `Payment.status`/`method`/`paidAt`/`expiresAt`. QRIS PAID →
"Lunas" + metode QRIS + baris "Dibayar"; QRIS PENDING → "Menunggu Pembayaran" + QRIS +
"Berlaku s/d". Tidak ada status buatan. **Secret QRIS tidak pernah dicetak**
(`providerRef` / `qrString` / `qrImage` / `paymentUrl` / `rawData` tidak direferensikan
oleh render path — diverifikasi runtime: `providerRef` fixture tidak muncul di PDF).

### 2.8 GAP (yang ditemukan audit)

| # | Gap | Dampak | Tindakan |
| --- | --- | --- | --- |
| G1 | **Phone customer tidak dicetak** (spesifikasi: "phone jika tersedia") — `Customer.phone` sudah ada di payload tapi tidak dirender | sedang | **DIPERBAIKI** (§3) |
| G2 | **Unit price hanya dicetak bila berbeda dari `totalPrice/qty`** → untuk qty > 1 harga satuan tidak tampil (spesifikasi: "unit price") | sedang | **DIPERBAIKI** (§3) |
| G3 | Label pajak hardcoded `"Pajak (10%)"` padahal nilainya `order.tax` | rendah | **TIDAK diubah** — didokumentasikan (§11). Tidak ada `taxRate` di `RestaurantSettings`; app memang memakai tarif tetap. |
| G4 | Tanpa `@page { size: … }` untuk thermal | rendah | **TIDAK diubah** — operator memilih ukuran kertas di dialog print browser (§10) |
| G5 | Header bill memakai alamat/telepon **restaurant**, bukan `Branch.address/phone` | rendah | **TIDAK diubah** (di luar permintaan; bukan regresi) |

### 2.9 Files yang perlu diubah

Hanya **satu**: `src/components/admin/orders/print-bill-dialog.tsx`
(+ import `@/lib/phone` yang sudah ada). **Tidak ada** file order/payment/cashier/QRIS/WhatsApp/table yang disentuh.

### 2.10–2.15 Dampak

| Aspek | Hasil |
| --- | --- |
| **API impact** | **NONE.** Tidak ada endpoint baru. Reuse `GET /api/orders/[id]` dan `GET /api/orders/by-number/[orderNumber]` (keduanya `requireRoles(["ADMIN","CASHIER"])` + `authorizedBranches(ctx)`, GET-only, tanpa mutasi). |
| **Database impact** | **NONE.** Tidak ada baris/tabel/kolom berubah. Snapshot sebelum/sesudah print **identik** (§9). |
| **Migration** | **TIDAK DIPERLUKAN.** Semua field yang dibutuhkan sudah ada (`Order.promoCode`, `Order.customer.phone`, `PaymentTransaction.rawData`). Tidak ada DDL dijalankan. |
| **Security impact** | Memperkuat: tidak ada data baru yang bocor ke print (secret QRIS tetap tidak tampil); tenant + branch scoping existing dipertahankan (diverifikasi runtime, §9). |
| **UI impact** | Screen UI tidak berubah selain isi bill: +1 baris "No. HP" dan baris "@ harga" pada line multi-unit. Print CSS tidak diubah. |
| **Regression risk** | **LOW** — perubahan presentational, di dalam komponen print-only, 1 file, tanpa perubahan engine/logic. |
| **Implementation plan** | Reuse komponen existing → tambah baris phone customer → tampilkan unit price untuk qty > 1 → verifikasi runtime A4/thermal + read-only. |

---

## 3. Implementasi (minimal)

Diff penuh (1 file, `+18 −2`):

```diff
--- a/src/components/admin/orders/print-bill-dialog.tsx
+++ b/src/components/admin/orders/print-bill-dialog.tsx
@@ -5,6 +5,7 @@ import { createPortal } from "react-dom";
 import { Dialog, DialogContent } from "@/components/ui/dialog";
 import { Button } from "@/components/ui/button";
+import { formatPhoneDisplay } from "@/lib/phone";
 import type { Order } from "@/services/order.service";
@@ -366,6 +367,16 @@ function FullBill({
           <span className="text-gray-500">Customer</span>
           <span>{order.customer?.name || "Guest"}</span>
         </div>
+        {/* Customer phone — only when the order actually carries one ... */}
+        {order.customer?.phone && (
+          <div className="flex justify-between gap-2">
+            <span className="text-gray-500">No. HP</span>
+            <span>{formatPhoneDisplay(order.customer.phone)}</span>
+          </div>
+        )}
         {/* Branch ... */}
@@ -427,8 +438,13 @@ function FullBill({
-              {Number(item.unitPrice) !==
-                Number(item.totalPrice) / Math.max(item.quantity, 1) && (
+              {/* Unit price: shown for any multi-unit line (quantity ≠ 1) and
+                  for single-unit lines whose line total differs ... */}
+              {(item.quantity > 1 ||
+                Number(item.unitPrice) !==
+                  Number(item.totalPrice) / Math.max(item.quantity, 1)) && (
                 <p className="pl-3 text-[11px] text-gray-500">
                   @ {rupiah(item.unitPrice)}
                 </p>
```

Catatan desain: label baris phone memakai **"No. HP"**, bukan "Telp" — "Telp:" sudah
dipakai header untuk telepon restoran; memakai "Telp" dua kali menghasilkan bill ambigu
(temuan ini muncul saat verifikasi runtime pertama, lalu diperbaiki).

**Tidak ada** perubahan pada Order engine, Payment engine, QRIS/iPaymu, Cashier, WhatsApp,
Table/Reservation engine, atau reservation purchase flow.

---

## 4. Print format

- Browser print (`window.print()`) → **sudah cukup**; **tidak ada** server-side printer system, **tidak ada** dependency hardware printer, **tidak ada** library PDF.
- Portal `#print-root` + `@media print` global ⇒ saat mencetak **hanya bill** yang ter-render (diverifikasi: saat print-media, `document.body` hanya menyisakan `print-root`).
- Satu komponen melayani **A4 + Thermal 80mm + Thermal 58mm** (selector di toolbar, `print:hidden`).
- Screen UI tidak rusak: toolbar/hint `print:hidden`, copy print `hidden` di screen.

---

## 5. Tests dijalankan

| # | Perintah | Hasil |
| --- | --- | --- |
| 1 | `npx tsc --noEmit` | **exit 0** — dijalankan ulang pada **revisi final** (setelah edit terakhir `Telp` → `No. HP`) untuk memastikan hasil lama tidak menutupi perubahan terakhir |
| 2 | `npm run build` | **exit 0** (build produksi sukses, dijalankan setelah edit terakhir) |
| 3 | `git diff --check` | **exit 0** |
| 4 | Runtime browser (2 harness) | **77 PASS / 0 FAIL** + **9 PASS / 0 FAIL** = **86 PASS, 0 FAIL** |

**Targeted automated tests: NOT RUN — tidak ada di repo.** Repo ini tidak punya test runner
(tidak ada `vitest`/`jest`/RTL, `package.json` tanpa script `test`; file `*.test.ts` adalah
skrip plain-`tsx`). Tidak ada satu pun test yang menyentuh print bill atau read-path
order/payment admin. Menambahkan runner + jsdom/RTL hanya untuk 1 baris presentasi
melanggar aturan "minimal change" / "jangan buat test infrastructure baru", jadi **tidak
dilakukan** dan **tidak diklaim PASS**. Sebagai gantinya, kontrak bill diuji secara
**nyata di browser** (§6) — harness-nya bersifat sementara dan sudah dihapus.

---

## 6. Browser verification (REAL runtime — bukan static trace)

Metode: login NextAuth via form (kredensial asli), buka `/admin/orders/[orderNumber]`,
klik tombol **Print Bill**, baca teks bill dari copy print (`#print-root`), ukur layout pada
print-media, dan generate PDF lewat pipeline print Chrome.

### 6.1 Fixture uji (dibuat lokal, **sudah dibersihkan** — §8)

| Fixture | Order | Kasus |
| --- | --- | --- |
| F1 | `ORD-P4TEST-DINEIN` | **DINE_IN** + meja Table 05 + customer (nama+phone) + variant (Sayap, Cabe Ijo +Rp2.000) + addon (Extra Keju) + qty 2 + unit price + diskon + promo HEMAT10 + tax + service charge + **UNPAID** |
| F2 | `ORD-P4TEST-CASH` | **TAKEAWAY** + **KASIR PAID** (diterima Rp25.000, kembali Rp2.000) |
| F3 | `ORD-P4TEST-QRISPAID` | **DELIVERY** + **QRIS PAID** (paidAt) |
| F4 | `ORD-P4TEST-QRISPEND` | **DINE_IN** + **QRIS PENDING** (expiresAt) + **customer name null** (Guest, tanpa phone) |
| F5 | `ORD-P4TEST-OTHER` | order **tenant B** (cross-tenant) |

### 6.2 Hasil (77 checks, 0 FAIL)

| Area | Hasil |
| --- | --- |
| Login ADMIN (form nyata) | **PASS** → `/admin/dashboard` |
| Tombol **Print Bill** di Order Detail | **PASS** |
| Restaurant: siteName branding, address, phone | **PASS** |
| Order: nomor, tanggal, waktu, tipe | **PASS** |
| DINE_IN → nomor meja (`Table 05 (5)`) | **PASS** |
| TAKEAWAY / DELIVERY → tanpa baris meja | **PASS** |
| Customer name; **phone baru** (`+62 813-7777-0001`) | **PASS** |
| Customer name null → `Guest`, **tanpa** baris No. HP | **PASS** |
| Item: nama, qty, **unit price (`@ Rp30.000`) baru**, subtotal | **PASS** |
| Variant/option + price adjustment; addon; catatan item | **PASS** |
| Subtotal, diskon (`-Rp6.000`), promo (`HEMAT10`), pajak, service charge, grand total (`Rp62.400`) | **PASS** |
| UNPAID → "Belum Bayar", **tanpa** Uang Diterima | **PASS** |
| CASH → "Lunas" + metode "Kasir" + **Uang Diterima Rp25.000** + **Kembalian Rp2.000** | **PASS** |
| QRIS PAID → "Lunas" + "QRIS" + baris "Dibayar" | **PASS** |
| QRIS PENDING → "Menunggu Pembayaran" + "QRIS" + "Berlaku s/d" | **PASS** |
| Secret QRIS (`providerRef`) tidak pernah dicetak | **PASS** |
| Print All: saat print-media **hanya `#print-root`** yang visible | **PASS** |
| A4: lebar bill 718px (=190mm), **tanpa overflow** horizontal (scroll=718 = client=718) | **PASS** |
| Thermal 80mm: lebar terukur **272.13px = 72mm** | **PASS** |
| Thermal 58mm: lebar terukur **196.53px = 52mm** | **PASS** |
| Print Per Product: qty 2 → **2 ticket**, tiap ticket `Qty: 1`, tanpa total & tanpa payment | **PASS** |
| Host **Orders list → detail sheet** ikut menampilkan Print Bill + isi bill | **PASS** |
| **Cross-tenant** (sesi tenant A → order tenant B): API **HTTP 404**, UI "Pesanan tidak ditemukan", **tanpa** tombol Print Bill | **PASS** |

### 6.3 PDF (pipeline print Chrome nyata, diperiksa `pdfinfo` + `pdftotext`)

| Output | Geometri | Isi |
| --- | --- | --- |
| `f1-a4.pdf` | **595.92 × 841.92 pts (A4)**, 1 halaman | berisi Caffe Baraja + `ORD-P4TEST-DINEIN` + Ayam Geprek + `Rp62.400` + `+62 813-7777-0001`; **tanpa** chrome admin (🍽️/#order) & **tanpa** secret QRIS |
| `f1-thermal80.pdf` | **204.96 × 792 pts (= 72.3mm)**, 1 halaman | berisi bill (5 string kunci terkonfirmasi), tanpa chrome admin |
| `f1-thermal58.pdf` | **165.12 × 792 pts (= 58.3mm)**, 1 halaman | berisi bill, tanpa chrome admin |
| `f1-perproduct.pdf` | A4, **2 halaman** (= 1 per unit) | ticket produk, **tanpa** "Subtotal" & **tanpa** chrome admin |

> Catatan metodologi: pada percobaan pertama, PDF justru memuat **seluruh halaman admin**.
> Penyebabnya **bug harness**: `emulateMediaType("screen")` yang masih aktif ikut meng-override
> `Page.printToPDF`. Diperbaiki dengan `emulateMediaType("print")` sebelum setiap PDF; angka
> di atas berasal dari run setelah perbaikan. Temuan ini penting agar klaim "sudah dicek PDF"
> tidak menyesatkan.

### 6.4 Role & branch scope (9 checks, 0 FAIL, harness terpisah)

| Check | Hasil |
| --- | --- |
| Login **CASHIER** (`kasir@restobahagia.com`) | **PASS** |
| CASHIER melihat Print Bill pada order **cabang-nya (MAIN)** + isi bill benar | **PASS** |
| CASHIER **ditolak** order cabang lain (PERUM-1) — API **404**, UI not-found, tanpa tombol Print Bill | **PASS** |
| CASHIER **ditolak** order tenant lain — API **404** | **PASS** |
| Kontrol: **ADMIN** (tanpa batas cabang) **bisa** membuka order PERUM-1 yang sama | **PASS** |

---

## 7. Bukti READ-ONLY

Snapshot DB diambil **sebelum** seluruh aksi print/browser, lalu dibandingkan **sesudah**
(perbandingan JSON penuh atas order, payment, paymentTransaction, table, dan total).

```
READONLY_OK: snapshot identical (orders/payments/txns/tables/totals)
```

| Entity | Sebelum | Sesudah |
| --- | --- | --- |
| Order status / paymentStatus / amount | — | **tidak berubah** |
| Payment status / method / paidAt | — | **tidak berubah** |
| PaymentTransaction (rows, type, status, amount) | — | **tidak berubah** |
| `Table.status` (Table 05 & 06) | `AVAILABLE` | `AVAILABLE` (tetap) |
| Tidak ada Payment baru | 49 (fixture) | **49** |
| Tidak ada Order baru | 40 (fixture) | **40** |

Print tidak memanggil webhook/provider dan tidak membuat audit mutation (render path hanya
`window.print()` — tidak ada fetch/axios di `print-bill-dialog.tsx`).

---

## 8. Cleanup & integritas

```
CLEAN: orders=5 (ORD-P4TEST-CASH, -DINEIN, -OTHER, -QRISPAID, -QRISPEND) customers=3
COUNTS: {"orders":35,"orderItems":1,"payments":46,"paymentTxns":29,"customers":35,"orderStatusHistory":108}
leftover test orders: 0 | leftover test customers: 0
tables: [{"number":5,"status":"AVAILABLE"},{"number":6,"status":"AVAILABLE"}]
```

Baseline **persis** kembali: orders 35→35, orderItems 1→1, payments 46→46, paymentTxns 29→29,
customers 35→35, orderStatusHistory 108→108. Semua script & artefak sementara dihapus,
server dimatikan (port 3000 free), Docker tidak disentuh.

```
== git status --short ==
 M src/components/admin/orders/print-bill-dialog.tsx     ← satu-satunya perubahan source
?? AUDIT-PRINT-BILL.md                          (pra-existing, PHASE 1)
?? PHASE1.5-PRINT-BILL-VALIDATION.md            (pra-existing, PHASE 1.5)
?? PHASE2-RESERVATION-PURCHASE-FINAL-REPORT.md  (pra-existing, PHASE 2)
?? PHASE3-RESERVATION-RUNTIME-VERIFICATION.md   (pra-existing, PHASE 3)
?? PHASE4-PRINT-BILL-FINAL-REPORT.md            (dokumen ini)

== git diff --stat ==  1 file changed, 18 insertions(+), 2 deletions(-)
== git diff --check == exit 0
== git diff --cached --name-only == (kosong — tidak ada yang di-stage)
== HEAD == d7f29ac (tidak ada commit baru)
```

---

## 9. Limitations (jujur — termasuk yang NOT RUN)

1. **Automated tests: NOT RUN** — repo tanpa test runner & tanpa test untuk print flow (§5). Tidak diklaim PASS.
2. **Physical printer: NOT RUN** — tidak ada printer fisik/thermal. Yang diverifikasi adalah **layout & PDF** dari pipeline print Chrome (ukuran halaman diukur), bukan keluaran kertas nyata.
3. **Host "Cashier sales history" (`/admin/cashier/sales` → "Cetak Bill"): NOT RUN di browser.** Yang diverifikasi runtime adalah host Order Detail (route) dan Orders list (sheet). Komponen yang dipakai sama (`PrintBillDialog`, prop `order`) sehingga risiko rendah — tetapi tetap **tidak diklaim PASS**.
4. **Multi-item per-product tickets: NOT RUN** — Print Per Product diverifikasi untuk 1 order dengan 1 item qty 2 (→ 2 ticket, 2 halaman). Order dengan banyak item belum diuji.
5. **`@page { size }` thermal tidak diset** — operator memilih ukuran kertas di dialog print browser. Thermal diverifikasi dengan meng-emulasi lebar kertas (72mm/58mm), bukan auto-size.
6. **Product & customer name tidak di-snapshot** — bill membaca nilai live; rename produk/customer langsung terlihat pada reprint.
7. **Label pajak hardcoded `"Pajak (10%)"`** — nilainya `order.tax` (server). Tidak ada `taxRate` di settings.
8. **Header memakai alamat/telepon restaurant**, bukan `Branch.address/phone`.
9. **Nama produk sangat panjang tanpa spasi** berpotensi overflow (span tanpa `min-w-0`/`break-words`) — tidak direproduksi.
10. **Observation (code trace, TIDAK diverifikasi runtime):** `PrintBillDialog` merender portal `#print-root` selama `order` tersedia, **juga saat dialog tertutup**. Karena `@media print` global menyembunyikan semua body child kecuali `#print-root`, `Ctrl+P` pada halaman Order Detail **akan mencetak bill** (bukan halaman admin). Tidak mengganggu target flow (tombol Print Bill), dilaporkan sebagai catatan LOW agar tidak mengejutkan. Berstatus **static observation**, bukan hasil runtime.
11. **QRIS live** (scan + webhook iPaymu) **tidak diuji** — di luar scope print; status dibaca dari DB fixture.

---

## 10. Regression risk

| Area | Risiko |
| --- | --- |
| Reservation purchase flow (PHASE 2/3) | **NONE** — tidak ada file reservation yang disentuh |
| Order engine / Payment engine / QRIS / iPaymu / Cashier / WhatsApp / Table | **NONE** — tidak ada file engine yang disentuh |
| Print A4/thermal existing | **LOW** — CSS print tidak diubah; hanya 2 baris konten baru di `FullBill` |
| Screen UI | **NONE** — perubahan hanya di dalam bill (dialog print) |
| Tenant/branch security | **NONE (diperkuat/dipertahankan)** — tidak ada perubahan route/auth; diverifikasi runtime 404 |

---

## 11. Final result

| Kriteria permintaan | Status |
| --- | --- |
| Audit sebelum coding (24 area + 16 output) | **DONE** (§2) |
| Jangan duplicate receipt engine | **DONE** — engine existing di-reuse |
| Target flow Orders → Order Detail → Print Bill | **DONE** — sudah ada & terverifikasi runtime |
| Bill content (restaurant/logo/address, order/date/time/type, meja, customer+phone, item/variant/addon/qty/unit price/subtotal, subtotal/diskon/tax/service charge/grand total, payment status+method, cash diterima/kembalian, QRIS PAID/PENDING) | **DONE** — semua tampil; 2 gap ditutup |
| Payment authoritative, bukan dari client | **DONE** — `Order.paymentStatus` + `Payment.*` + `PaymentTransaction` |
| Print READ-ONLY (tanpa ubah/membuat Order/Payment/PaymentTransaction, tanpa webhook/provider) | **DONE** — snapshot identik (§7) |
| Browser print + A4 + thermal 58/80 via CSS | **DONE** — PDF A4 (595.92×841.92 pts), 72.3mm, 58.3mm |
| Tenant scoped + cross-tenant ditolak | **DONE** — 404 (API + UI), ADMIN/KASIR, branch scope |
| `tsc --noEmit` / `npm run build` / `git diff --check` | **PASS** (exit 0 semua) |
| Migration hanya bila mandatory | **TIDAK DIPERLUKAN** — 0 DDL, 0 perubahan DB |
| Jangan commit/push/deploy | **DIPATUHI** — HEAD tetap `d7f29ac` |
| Report `PHASE4-PRINT-BILL-FINAL-REPORT.md` | **DONE** |

**Hasil: 86/86 runtime checks PASS, 0 FAIL · 1 file source berubah (+18/−2) · 0 migration ·
0 perubahan DB (baseline dipulihkan persis) · tidak ada commit/push/deploy.**

Item yang **tidak** dapat diverifikasi ditulis eksplisit sebagai **NOT RUN** di §9 dan
**tidak** diubah menjadi PASS.

> **STOP setelah report** — sesuai instruksi.
