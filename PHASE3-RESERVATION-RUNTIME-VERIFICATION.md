# PHASE 3 — RUNTIME VERIFICATION
## Reservation + Pembelian + Payment (satu flow)

> Mode: **VERIFICATION ONLY**. Tidak ada source code yang diubah. Tidak ada migration/commit/push/deploy.
> Repo: `/home/reksa/restorant-cafe` · HEAD **`d7f29ac fix wa reservation`**
> Driver: **headless Chrome** (`/usr/bin/google-chrome` via `puppeteer-core`) + HTTP API + Prisma, terhadap **DB lokal**.

---

## 1. Environment

| Item | Nilai |
| --- | --- |
| Repo | `/home/reksa/restorant-cafe` |
| HEAD | `d7f29ac fix wa reservation` |
| Node | v24.21.0 |
| Next.js | 16.3.3 (`npx next start`) |
| Port | **3113** (port aman; 3000 tidak dipakai app lain) |
| DB | MySQL lokal `127.0.0.1:3306` / `restaurant_app` (source of truth) |
| Browser | `/usr/bin/google-chrome` (headless) via `puppeteer-core` |
| Tenant uji | `cmtois12y...` "Restoran Bahagia" — cabang **MAIN** (`cmts9dbpe...`) |
| Data terpakai | produk in-stock: **Ayam Geprek** (2 required option group); 5 produk lain `stock=0` |

**Tidak disentuh:** production, VPS, Docker database (3307), container `restaurant-app`/`restaurant-worker`, Redis (6379), port 8080. Tidak ada konfigurasi permanen yang diubah.

> Catatan: seluruh test memakai **DB lokal**. Docker (8080/3307/6379) terdeteksi berjalan tetapi **tidak diakses**.

---

## 2. Runtime setup

- Build produksi dijalankan (`npm run build`) lalu server dinyalakan di **port 3113** (`npx next start -p 3113`), health-check `GET /reservasi → 200`.
- Wizard di-drive end-to-end di headless Chrome (branch → date → party → time → table → purchase → guest → review → submit).
- Endpoint server diuji lewat `fetch` ke `http://localhost:3113`.
- Integritas DB diverifikasi via Prisma; data test dibersihkan di akhir.
- Beberapa percobaan awal gagal karena **kesalahan harness** (bukan bug aplikasi): harness click memakai selector yang salah, lalu menemukan bahwa step date/slot/table **auto-advance**, dan bahwa placeholder input (`Cari produk`, `Nama Anda`) tidak ada di `innerText`. Harness diperbaiki; temuan aplikasi tidak dipengaruhi.

---

## 3. Reservation wizard verification

Semua step berjalan di `http://localhost:3113/reservasi` dan **URL tetap** di `/reservasi` dari awal sampai sukses.

| Step | Hasil | Bukti |
| --- | --- | --- |
| STEP 1 — Branch: tampil & bisa dipilih | **PASS** | kartu "Main Outlet · MAIN" & "Perum Cirebon · PERUM-1" tampil; klik Main Outlet → step date |
| STEP 2 — Date: tanggal bisa dipilih | **PASS** | `input[type=date]` (min=hari ini, max=+60 hari); memilih tanggal **auto-advance** |
| STEP 3 — Party: party size bisa dipilih | **PASS** | step "Berapa orang yang makan?" tampil; kontrol +/- & input number |
| STEP 4 — Time: slot tersedia tampil | **PASS** | slot jam tampil; dipilih **10:00**; memilih slot auto-advance |
| STEP 5 — Table: floor/table tampil | **PASS** | toggle "Denah"/"Daftar Meja"; daftar 10 meja MAIN ("Meja N … Tersedia") |
| STEP 5 — table RESERVED tidak bisa dipilih | **PASS (data)** | tidak ada meja RESERVED pada slot uji (semua "dapat dipilih"); logika non-selectable (`aria-disabled`) ada di source dan diuji unit test, **tidak ditemui kasus RESERVED live di slot ini** |
| STEP 5 — table AVAILABLE bisa dipilih | **PASS** | Meja 2 diklik → auto-advance ke purchase |
| STEP 6 — PEMBELIAN tampil DI DALAM wizard | **PASS** | judul "Pembelian untuk Reservasi" tampil; picker di `/reservasi` |

---

## 4. Product picker verification

| Case | Hasil | Bukti |
| --- | --- | --- |
| Tidak redirect ke /menu | **PASS** | URL tetap `/reservasi`; `purchase.urlHasMenu=false` |
| Product list tampil | **PASS** | 6 produk: Ayam Geprek, Es Jeruk, Es Teh, Kentang Goreng, Mie Ayam, Nasi Goreng |
| Search bekerja | **PASS** | query "Ayam" → 6 produk menyusut jadi 3 (Ayam Geprek, Mie Ayam, Nasi Goreng) |
| Kategori bekerja | **PASS** | tombol "Semua"/"Makanan" ada; "Makanan" → Ayam Geprek, Mie Ayam, Nasi Goreng (Minuman/Snack hilang) |
| Produk aktif tampil | **PASS** | hanya produk `isActive` yang tampil (2 produk nonaktif tidak muncul) |
| Produk sold out tidak bisa dibeli | **PASS** | "Stok habis" tampil; 6 tombol Tambah, **5 disabled** (hanya Ayam Geprek aktif) |
| Quantity + / - bekerja | **PASS** | qty 1 → klik "+" → 2; total Rp30.000 → **Rp60.000** |
| Variant/option bekerja | **PASS** | modal Ayam Geprek; 2 required group dipilih (Sayap, Cabe Ijo); tombol "Tambah · Rp30.000" |
| Addon bekerja | **NOT RUN** | **tidak ada addon aktif** pada katalog tenant uji (semua produk `addons=0`); tidak dibuat fixture addon |
| Subtotal berubah | **PASS** | "Total Pembelian" Rp30.000 → Rp60.000 setelah qty+ |
| Total pembelian berubah | **PASS** | sama (DINE-IN tanpa tax/service) |

Minimal 1 produk, qty ≥ 1 terpenuhi (Ayam Geprek ×2).

---

## 5. Follow-up phone verification

| Case | Hasil | Bukti |
| --- | --- | --- |
| Input `"No. WhatsApp untuk Follow-up *"` ada | **PASS** | `guest.followUpLabelPresent=true` |
| Helper text | **PASS** | `guest.helperPresent=true` — "Nomor aktif yang dapat dihubungi untuk follow-up reservasi pada hari-H..." |
| Field wajib | **PASS** | tombol Lanjut `disabled` bila nama/nomor invalid (validasi `normalizePhone`) |
| Nomor bisa diedit | **PASS** | input `type=tel` terisi `081377770001` |
| Jika login, boleh ter-prefill | **NOT RUN** | sesi customer login tidak dipakai pada run ini (prefill terverifikasi lewat unit test, bukan runtime) |
| Nomor dipakai untuk follow-up reservation | **PASS** | success screen menampilkan **WhatsApp +62 813-7777-0001** |
| Tidak membuat field/database baru | **PASS** | DB verification: `Reservation.guestPhone` terisi; **tidak ada** kolom baru |
| Server menyimpan normalized (`normalizePhone`) | **PASS** | input `081377770002` → tersimpan `6281377770002`; `081377770001` → `6281377770001` |

---

## 6. Review verification

Step Review menampilkan seluruh blok (case-insensitive; heading ber-CSS `uppercase`):

| Blok | Hasil |
| --- | --- |
| RESERVATION (Cabang, Tanggal, Jam, Jumlah Orang, Meja) | **PASS** |
| CUSTOMER/FOLLOW-UP (Nama, No. WhatsApp, Catatan) | **PASS** |
| PEMBELIAN (Nama produk, variant, qty, harga, subtotal, total) | **PASS** (Ayam Geprek, Sayap/Cabe Ijo, ×2, Rp30.000 × 2 = Rp60.000) |
| PAYMENT (metode QRIS / KASIR) | **PASS** (tombol "QRIS (bayar sekarang)" & "Bayar di Kasir") |
| Tidak ada "Pesan Menu Dulu"/"Pembelian Diperlukan"/"Verifikasi Pembelian"/"Purchase requirement terpenuhi" | **PASS** (`review.forbiddenStrings=[]`) |

Catatan: pada step Review status yang ditulis adalah "belum dibayar — pembayaran diselesaikan setelah reservasi dibuat" (sesuai engine). Grand Total dihitung server-side.

---

## 7. KASIR verification

| Case | Hasil | Bukti |
| --- | --- | --- |
| Reservation + Order dibuat | **PASS** | runtime API: `R-9LH67LPF` → order `ORD-20261008-IZ4P4L` (201) |
| Order status sesuai flow | **PASS** | `status=PENDING` |
| Order paymentStatus = UNPAID | **PASS** | `paymentStatus=UNPAID` |
| Payment method = KASIR | **PASS** | `payments[0].method="KASIR"` |
| Payment status = UNPAID | **PASS** | `payments[0].status="UNPAID"`, amount 30000 |
| Tidak menandai PAID otomatis | **PASS** | `paymentStatus` tetap UNPAID |
| UI: tombol "Lihat Pesanan & Bayar di Kasir" | **PASS** | success screen browser |

---

## 8. QRIS verification

| Case | Hasil | Bukti |
| --- | --- | --- |
| Reservation + Order dibuat | **PASS** | runtime API: `R-LYPXC1RJ` → order `ORD-20261008-RWERYE` (201) |
| Order paymentStatus (existing engine) | **PASS** | `paymentStatus=UNPAID`; **tidak ada** Payment intent dibuat saat submit (QRIS intent di halaman bayar) |
| Order.paymentMethod | **PASS** | `null` (intent belum dibuat) — konsisten engine |
| Halaman payment `/reservasi/[code]/payment` tampil | **PASS** | HTTP **200** |
| Tidak menganggap PAID hanya dari QRIS intent | **PASS** | tidak ada status PAID dipalsukan |

**NOT RUN:** menyelesaikan pembayaran QRIS (scan + webhook iPaymu live). Tidak ada webhook dikirim ke production; status PAID hanya boleh lewat engine existing dan **tidak diuji live** pada fase ini.

---

## 9. Database verification

Diuji untuk `R-9LH67LPF` (KASIR), `R-LYPXC1RJ` (QRIS), `R-PZ6BNS6K` (duplikat-1), `R-U96DACS9` (spoof). Semua **PASS**.

| Entitas | Hasil | Bukti (contoh) |
| --- | --- | --- |
| Reservation.orderId terisi | **PASS** | `R-9LH67LPF → orderId=cmuyz3z96002a6iivuxl1hha3` |
| Reservation.guestPhone terisi + normalized | **PASS** | `6281377770002` |
| Reservation.restaurantId/branchId benar | **PASS** | `rest = cmtois12y...`, `branch = cmts9dbpe... (MAIN)` |
| Order.restaurantId/branchId benar | **PASS** | sama dengan reservasi |
| Order.customerId benar | **PASS** | customer terbuat, `phone=6281377770002` |
| Order.status / paymentStatus | **PASS** | PENDING / UNPAID |
| Order.grandTotal server-side | **PASS** | `30000` (dari harga DB, bukan input klien) |
| OrderItem.productId/quantity/price | **PASS** | `productId=cmtois1jp...`, `qty=1`, `unitPrice=30000` |
| OrderItem.customizations tersimpan | **PASS** | `hasCustomizations=true` |
| Payment.orderId/method/status | **PASS** | KASIR: `orderId` cocok, `method=KASIR`, `status=UNPAID` |

Semua baris tenant-scoped (`restaurantId` konsisten). `Reservation → Order → OrderItem → Payment` terhubung melalui scalar `orderId` (tanpa relasi Prisma).

---

## 10. Tenant isolation

| Case | Hasil | Bukti |
| --- | --- | --- |
| Produk dari restaurant lain tidak bisa dipakai | **PASS** | `400 "Produk tidak ditemukan atau tidak tersedia"` |
| Branch dari restaurant lain tidak bisa dipakai | **PASS** | `404 "Cabang tidak ditemukan"` |
| Customer/tenant control | **PASS** | tenant B berhasil memesan produknya sendiri (`R-3ZDSL5DK`, grandTotal 5000) |
| Reservation→Order→Item→Payment tenant-scoped | **PASS** | semua `restaurantId` konsisten |
| client tidak bisa menentukan restaurantId sendiri | **PASS** | spoof `restaurantId` tenant B diabaikan; order tersimpan di tenant A |
| client tidak bisa menentukan customerId sendiri | **PASS** | `customerId` di-resolve server-side dari nomor/ sesi (tidak dari body) |

Fixture tenant B (restaurant/branch/product/category/table) dibuat sementara lalu **dihapus**.

---

## 11. Server-side price validation

| Case | Hasil | Bukti |
| --- | --- | --- |
| client tidak bisa menentukan harga sendiri | **PASS** | body `items[].price/unitPrice/totalPrice=1` diabaikan → `unitPrice=30000` |
| client tidak bisa menentukan discount sendiri | **PASS** | `discount=999999` diabaikan → `0` |
| client tidak bisa menentukan tax/service/grand total | **PASS** | `tax=5`, `serviceCharge=5`, `grandTotal=1` → `0/0/30000` |
| payment status tidak bisa dipalsukan | **PASS** | body `paymentStatus="PAID"` → order tetap `UNPAID` |
| restaurantId tidak bisa dipalsukan | **PASS** | order di tenant A meski body menunjuk tenant B |

Semua nilai dihitung ulang oleh engine order existing dari database.

---

## 12. No redirect verification

| Case | Hasil | Bukti |
| --- | --- | --- |
| URL tetap di reservation flow | **PASS** | setiap step: URL `http://localhost:3113/reservasi` |
| Tidak redirect ke /menu | **PASS** | `purchase.urlHasMenu=false`, `success.urlHasMenu=false` |
| Tidak redirect ke /cart | **PASS** | tidak ada navigasi ke `/cart` |
| Tidak redirect ke /checkout | **PASS** | tidak ada navigasi ke `/checkout` |
| Pembelian selesai dari reservation wizard | **PASS** | produk dipilih & submit dari `/reservasi` |

Catatan: halaman sukses menyediakan link "Kembali ke Menu" dan header nav ke `/menu` — ini link navigasi biasa, **bukan** prasyarat pembelian dan tidak dipakai oleh flow.

---

## 13. Duplicate submit verification

| Case | Hasil | Bukti |
| --- | --- | --- |
| Submit kedua ditolak conflict | **PASS** | submit-1 `201`, submit-2 `409` (`"Meja yang dipilih sudah tidak tersedia."` — TABLE_NOT_AVAILABLE, gate availability sebelum duplikasi) |
| Tidak muncul Order A + Order B | **PASS** | `Order count` untuk nomor itu = **1** |
| Tidak ada orphan Order/Payment | **PASS** | hanya satu reservation/order/payment dibuat |

Diuji juga pada percobaan browser sebelumnya: submit dengan nomor+tanggal+slot yang sama ditolak (tidak membuat reservasi/order kedua).

---

## 14. Cleanup verification

| Case | Hasil | Bukti |
| --- | --- | --- |
| Reservation/order/item/payment test dihapus | **PASS** | 4 reservasi API + 1 tenant B dihapus |
| Customer test dihapus | **PASS** | `deletedCustomers` 4 (+1 sebelumnya) |
| PaymentTransaction test dihapus | **PASS** | tidak ada transaksi yatim |
| Tenant fixture sementara dihapus | **PASS** | "deleted temp tenant QAP3… B", termasuk category |
| Data existing tidak dihapus | **PASS** | reservasi non-test (1) tetap ada |
| Jumlah kembali seperti semula | **PASS** | **sebelum test vs sesudah cleanup**: reservations `1 → 1`, orders `35 → 35`, payments `46 → 46`, customers `35 → 35` |

Baseline diambil setelah membersihkan run harian pertama; angka akhir **sama persis** dengan baseline.

---

## 15. Source integrity

| Case | Hasil | Bukti |
| --- | --- | --- |
| Tidak ada source code berubah | **PASS** | `git status --short` tidak menampilkan file tracked yang berubah; `git diff --stat` kosong |
| `git diff --check` | **PASS** | exit `0` |
| Tidak commit / push / deploy | **PASS** | tidak dijalankan |
| Temp script dihapus | **PASS** | `_phase3_tmp_*.ts` dihapus |
| Server dimatikan | **PASS** | tidak ada listener di 3113 |

`git status --short` (akhir):
```
?? AUDIT-PRINT-BILL.md
?? PHASE1.5-PRINT-BILL-VALIDATION.md
?? PHASE2-RESERVATION-PURCHASE-FINAL-REPORT.md
?? PHASE3-RESERVATION-RUNTIME-VERIFICATION.md   (file laporan ini)
```

---

## 16. Known limitations

1. **Addon — NOT RUN.** Tidak ada addon aktif pada katalog tenant uji; tidak dibuat fixture addon (menghindari mengubah data katalog). Addon terverifikasi lewat unit test, bukan runtime.
2. **Table RESERVED — tidak ditemui kasus live.** Pada slot uji semua meja "dapat dipilih"; jalur non-selectable terverifikasi lewat source + unit test, bukan runtime RESERVED nyata.
3. **Logged-in prefill — NOT RUN.** Tidak memakai sesi customer login; prefill diuji statis/unit test.
4. **QRIS end-to-end — NOT RUN.** Halaman payment `200`, tetapi scan QR + webhook iPaymu live tidak dijalankan (dilarang mengirim webhook/ke production).
5. **E2E `/menu` checkout & Cashier existing — NOT RUN** pada fase ini (di luar flow reservasi).
6. Duplicate submit kedua tertahan oleh **gate availability** (bukan semantik duplikasi reservasi) karena reservasi pertama sudah memblokir meja/slot yang sama — tetap menghasilkan **409** dan **tanpa order kedua**.
7. Verifikasi UI difokuskan pada jalur **KASIR** di browser; jalur **QRIS** diverifikasi di level API + halaman.

---

## 17. Final result

**Seluruh case yang dijalankan: PASS. Tidak ada FAIL.** Beberapa case dinyatakan **NOT RUN** (addon, table RESERVED live, logged-in prefill, QRIS webhook live, E2E /menu & cashier) — tidak diklaim PASS.

Ringkasan:
- Wizard reservasi berjalan end-to-end di `/reservasi` **tanpa redirect** ke `/menu`/`/cart`/`/checkout`.
- Product picker (list, search, kategori, sold-out, qty, variant/option) berfungsi; subtotal/total berubah.
- Follow-up phone tersimpan di `Reservation.guestPhone` (normalized), tanpa field baru.
- Review menampilkan RESERVATION/FOLLOW-UP/PEMBELIAN/PAYMENT tanpa teks gate historis.
- Submit membuat **Reservation + Order + OrderItem (+ Payment KASIR)** dengan `Reservation.orderId` terisi; QRIS membuat order UNPAID tanpa payment dini.
- `Table.status` **tidak** menjadi OCCUPIED karena booking.
- Duplicate submit → 409, tepat satu order, tanpa orphan.
- Tenant isolation & server-side price validation lulus; spoof harga/diskon/status/tenant diabaikan.
- Cleanup mengembalikan jumlah data persis ke baseline.
- Tidak ada source code yang berubah; tidak ada commit/push/deploy.
