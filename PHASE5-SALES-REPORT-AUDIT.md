# PHASE 5 — SALES REPORT / REKAPITULASI — AUDIT REPORT

> **Mode: AUDIT ONLY.** Tidak ada coding, tidak ada migration, tidak ada commit/push/deploy.
> Dokumen ini adalah **audit report** yang diminta sebelum implementasi (§21 langkah terakhir = STOP).
> Repo `/home/reksa/restorant-cafe`, HEAD `d7f29ac` (tidak berubah).
>
> **Headline finding:** **Sales Report sudah ada dan sudah lengkap** — engine
> `src/services/report/report.service.ts` + 9 halaman report + 9 endpoint (+ export) sudah
> mencakup **seluruh** target UI (§8): Sales Summary, Payment Breakdown, Order Type, Best
> Selling Products, Export CSV, dengan filter Hari Ini/Kemarin/Minggu Ini/Bulan Ini/Custom.
> **Jangan buat engine baru.** Gap utamanya **bukan** fitur yang hilang, melainkan
> **basis revenue Dashboard yang berbeda dari Report** — dan itu **dibuktikan dengan data** (§3).

---

## 1. Existing functionality

| Area | Status | Bukti |
| --- | --- | --- |
| Report engine | **ADA, lengkap** | `src/services/report/report.service.ts` (2451 baris): `getSalesReport`, `getProductReport`, `getPaymentReport`, `getShiftSalesReport`, `getPurchaseReport`, `getInventoryReport`, `getMultiOutletReport`, `getMenuEngineeringReport`, `getSalesOrdersForExport`, `computeRefundRevenue` |
| Sales report | **ADA** | `getSalesReport()` (L1011) → summary + payment breakdown + order type + best sellers + best categories + busiest hours + daily series + promo performance |
| Dashboard statistics | **ADA** | `getDashboardStats()` (`src/services/order/order.service.ts:1910`) + `/api/orders/dashboard/stats` |
| Dashboard analytics | **ADA (report-based)** | `src/components/admin/analytics/dashboard-analytics.tsx` memanggil `getSalesReport` (L170) — labelnya sudah menyatakan semantik PAID |
| UI report | **ADA (9 halaman)** | `/admin/reports` (Penjualan), `/reports/products`, `/reports/payments`, `/reports/purchases`, `/reports/inventory`, `/reports/shift-sales`, `/reports/multi-outlet`, `/admin/profitability`, `/admin/menu-engineering` |
| CSV export | **ADA (generik)** | `src/lib/csv.ts` (`buildCsv` + `csvCell`) dipakai **semua** export route; 9 endpoint `*/export` |
| Date filter utility | **ADA** | server: `resolveReportRange()`; client preset: `src/lib/report-periods.ts` (`presetToReportParams`) |
| Refund/cancel engine | **ADA** | `src/services/approval/approval.service.ts` (refund → Payment REFUNDED + reconciliation `Order.paymentStatus`) |

**Kesimpulan:** ini **bukan** greenfield. Semua yang diminta di PHASE 5 (summary, payment,
order type, best sellers, CSV, filter periode) **sudah terimplementasi server-side**.

---

## 2. Existing report engine

`export const reportService = new ReportService()` (`report.service.ts:2451`).

**Predikat inti** (single source of truth di dalam engine):

| Helper | Definisi | Dipakai untuk |
| --- | --- | --- |
| `reportScopeWhere` | `restaurantId` + `branchId ∈ branchFilters` + `status != CANCELLED` + filter `orderType`/`paymentMethod(paid)` | dasar semua |
| `reportBaseWhere` | `reportScopeWhere` + `createdAt ∈ [start,end]` | himpunan **aktivitas** |
| `reportActivityWhere` | `reportBaseWhere` + `paymentStatus = (filter.status ?? PAID)` | order count + bucket |
| **`revenueWhere`** | `reportBaseWhere` + **`OR[ paymentStatus=PAID, payments.some(status=REFUNDED) ]`** | **semua metrik revenue** |
| `revenueScopeWhere` | `revenueWhere` **tanpa** batas tanggal | atribusi refund lintas periode |

Implementasi agregasi: seluruhnya **di database** — `prisma.order.aggregate`, `orderItem.aggregate`,
`payment.groupBy`, `order.groupBy`, `orderItem.groupBy`, dan raw SQL `GROUP BY HOUR()/DATE_FORMAT()`;
`computeRefundRevenue` memakai satu raw SQL `UNION ALL`. **Tidak ada** pengambilan seluruh order ke
memori pada jalur report (kecuali export yang dibatasi `take: 5000`).

Komponen rekursif yang **memakai engine yang sama** (bukan engine kedua):
`profitability.service.ts`, `menu-engineering.service.ts`, `cashier-sales.service.ts` — semuanya
mengimpor/mengikuti predikat PAID yang sama.

---

## 3. Existing dashboard calculations — **TEMUAN UTAMA**

`getDashboardStats(restaurantId, branchFilters)` (`order.service.ts:1910–1993`) menghitung
**`todayRevenue` dengan basis BERBEDA**:

```ts
// Dashboard (order.service.ts) — BASIS COMPLETED, TANPA filter pembayaran
prisma.order.aggregate({
  where: { ...whereBase, status: "COMPLETED", createdAt: { gte: today } },
  _sum: { grandTotal: true },
})
```

```ts
// Report (report.service.ts) — BASIS PAID (authoritative)
where: { ...scope, createdAt: { gte: range.start, lte: range.end },
         OR: [ { paymentStatus: "PAID" }, { payments: { some: { status: "REFUNDED" } } } ] }
```

### Bukti kuantitatif (DB lokal, read-only)

| Definisi | Nilai | n order |
| --- | --- | --- |
| Dashboard `Σ grandTotal WHERE status=COMPLETED` (tanpa filter bayar) | **519.000** | 16 |
| Report `Σ grandTotal WHERE status!=CANCELLED AND paymentStatus=PAID` | **487.000** | 15 |
| **Selisih (dashboard overstate)** | **+32.000 (+6,6%)** | +1 |

Rekonsiliasi selisih:

| Kontribusi | Order | Nilai |
| --- | --- | --- |
| Dihitung dashboard, **tidak** dihitung report | COMPLETED+PENDING `ORD-20260907-ZVTQ75` | 55.000 |
| | COMPLETED+UNPAID `ORD-20260910-0F4JMX` | 30.000 |
| | COMPLETED+EXPIRED `ORD-20260910-49TXZJ` | 30.000 |
| Dihitung report, **tidak** dihitung dashboard | PAID+PROCESSING `ORD-20260907-QRZHXM` | 30.000 |
| | PAID+PROCESSING `ORD-20260911-02065X` | 53.000 |
| **Net** | 115.000 − 83.000 | **32.000** |

➡ **Dashboard melebih-satakan revenue** (menghitung COMPLETED yang belum/ gagal/tidak dibayar)
**dan** mengecilkan revenue (mengabaikan PAID yang belum COMPLETED).

### Masalah kedua: **dua angka revenue di satu layar**
Halaman `/admin/dashboard` menampilkan **keduanya**:
1. card **"Pendapatan Hari Ini"** ← `stats.todayRevenue` (**basis COMPLETED**, salah), dan
2. section **"Sales Overview"** (`DashboardAnalytics`) ← `getSalesReport` (**basis PAID**, benar).

Sehingga satu dashboard bisa menampilkan dua angka pendapatan dengan basis berbeda.

---

## 4. Revenue semantics — **SUMBER AUTHORITATIVE**

**KEPUTUSAN AUDIT: `PaymentStatus.PAID` (payment-based revenue recognition) adalah authoritative.**
Dashboard berbasis `OrderStatus.COMPLETED` adalah **outlier dan harus diselaraskan** (bukan sebaliknya).

Alasannya (bukan preferensi — berbasis semantik existing):

1. **`Order.status` adalah workflow fulfillment**, bukan status uang: `PENDING → CONFIRMED →
   PROCESSING → READY → COMPLETED`. Ia tidak menyatakan uang diterima. Data nyata membuktikan
   kedua sumbu independen: `COMPLETED+UNPAID` (30.000), `COMPLETED+PENDING` (55.000),
   `COMPLETED+EXPIRED` (30.000), dan `PAID+PROCESSING` (30.000, 53.000).
2. **Keputusan ini sudah terdokumentasi di codebase** (`AUDIT-F5-HISTORICAL-COGS-PROFITABILITY.md`):
   *"`COMPLETED` = pengakuan COGS; `PAID` = pengakuan revenue; `COMPLETED+UNPAID` punya COGS tanpa
   revenue."* Konsisten dengan `F8-FULL-REGRESSION.md` (*"unpaid completed order … not counted as
   revenue"*).
3. **Semua konsumer lain memakai PAID**: `report.service.ts`, `profitability`, `menu-engineering`,
   `cashier-sales`, `print bill` (menampilkan status pembayaran sebenarnya). Dashboard sendirian.
4. **Uang = `Payment`/`PaymentTransaction`.** `Order.paymentStatus` adalah proyeksi denormalisasi
   dari `Payment.status`, dan selalu direkonsiliasi server-side (refund penuh → `UNPAID`).

**Order status yang dianggap "sale": TIDAK ADA sebagai gate.** Gate-nya hanya `status != CANCELLED`
(membuang order batal), sedangkan pengakuan nilai dilakukan oleh pembayaran.

### 4.1 Perhitungan metrik — jawaban eksplisit (WAJIB JELASKAN)

Semua dihitung **server-side di database** dari nilai **tersimpan** (tidak pernah direkayasa dari client):

| Metrik | Rumus (existing engine) | Basis |
| --- | --- | --- |
| `totalSales` (= `grossRevenue`) | `Σ Order.grandTotal` atas revenue set | **GROSS** — sudah termasuk pajak & service charge, sudah dipotong diskon |
| `grossSales` | `Σ Order.subtotal` (= `Σ OrderItem.totalPrice`) | nilai barang **sebelum** diskon, belum termasuk pajak/SC |
| `totalDiscount` | `Σ Order.discount` (nilai tersimpan) | **TIDAK pernah** dihitung ulang dari `Promo.type`/`Promo.value` |
| `totalTax` | `Σ Order.tax` (nilai tersimpan) | label UI `Pajak`; dikecualikan dari `netSales` |
| `totalServiceCharge` | `Σ Order.serviceCharge` (nilai tersimpan) | dikecualikan dari `netSales` |
| `totalItemsSold` | `Σ OrderItem.quantity` (order di revenue set) | — |
| `averageOrderValue` | `totalSales / paidOrders` (0 bila `paidOrders = 0`) | per order **lunas** |
| **`netSales`** | `Σ (grandTotal − tax − serviceCharge)` − `Σ refundRevenue` | **NET**: product revenue, **mengecualikan pajak & service charge**, dikurangi refund (proporsional, capped, tak pernah negatif) |
| `totalRefund` (= `refundReversal`) | `Σ Refund.amount` ber-`status=APPROVED` di periode | atribusi **tanggal approval** |
| Revenue per produk | `Σ OrderItem.totalPrice` per `productId` | historis dari OrderItem, **bukan** `Product.price` |
| Diskon per produk | `OrderItem.totalPrice × Order.discount / Order.subtotal` (raw SQL, pro-rata) | karena diskon disimpan di level **Order**, bukan OrderItem |

**Apakah refund mengurangi revenue? → YA, tapi hanya pada `netSales`.**
`totalSales`/`grossRevenue` tetap **gross sebelum refund**; `totalRefund`/`refundReversal` melaporkan
pengurangnya, dan `netSales` adalah angka **setelah** refund. Refund penuh → `netSales ≈ 0` (tidak negatif).

**Gross atau net? → DUA-duanya dilaporkan, eksplisit.** "Total Penjualan" = `totalSales` (**gross collected**),
"Net Sales" = `netSales` (**net** berbasis product revenue). Dashboard card "Pendapatan Hari Ini" memakai
basis **gross** (`Σ grandTotal`) — hanya basis **himpunan**-nya yang salah (§3), bukan gross/net-nya.

---

## 5. Payment semantics

| Pertanyaan | Jawaban (existing engine) |
| --- | --- |
| Payment status dianggap paid | **`Payment.status = PAID`** (dan `Order.paymentStatus = PAID` sebagai proyeksi) |
| Cash | `Payment.method = KASIR` → bucket **cash**; audit uang diterima/kembalian di `PaymentTransaction.type='cashier_payment'` |
| QRIS | `Payment.method = QRIS` (`provider=ipaymu`) → bucket **qris** |
| VA / Gateway | bucket **va** bila `provider='ipaymu' && method=null` (dataset lokal: **tidak ada** baris VA; jalur kodenya ada) |
| Unpaid | `UNPAID`/`PENDING` → bucket **unpaid**; **tidak** masuk revenue; tetap dihitung di "Total Order" |
| Failed | `FAILED`/`EXPIRED` → bucket **failed** (digabung); **tidak** masuk revenue |
| Cancelled | `Payment.status=CANCELLED` → bucket **cancelled** |
| Refunded | `Payment.status=REFUNDED` → bucket **refunded** |
| Distribusi lokal | payment: PAID 16 (577.000) · UNPAID 11 (319.000) · PENDING 3 (115.000) · EXPIRED 4 (149.500) · REFUNDED 1 (30.000) · CANCELLED 11 (286.000). Metode: KASIR 28 · QRIS+ipaymu 18 |

**Tidak ada sumber dari client.** Semua bucket/agregasi dihitung server-side dari `Payment`.

---

## 6. Refund / cancel semantics

| Kasus | Perilaku existing | Dampak revenue |
| --- | --- | --- |
| **Full refund** (APPROVED, `netPaid ≈ 0`) | `Payment.status → REFUNDED` (histori dipertahankan, tidak dihapus) + `Order.paymentStatus → UNPAID` + `PaymentTransaction` `type='refund'`, `status='REFUNDED'`, `amount` **negatif** | Order **tetap** di revenue set via `OR payments.some(REFUNDED)` supaya revenue **dibalik**, bukan hilang → `netSales` mendekati 0 (tidak pernah negatif) |
| **Partial refund** | Pembayaran **tetap PAID**, order tetap PAID | `refundRevenue = refundedAmount × productRevenue / grandTotal` (capped) → mengurangi `netSales` secara proporsional |
| Atribusi periode refund | **Tanggal APPROVAL refund** (`approvedAt ∈ range`), order boleh dari periode lebih awal | Refund September atas order Agustus tampil di September; tidak double-count |
| `PENDING` refund | Belum APPROVED → tidak mengurangi revenue | hanya 1 row PENDING (30.000) di data lokal |
| **Cancelled order** | `status=CANCELLED` **dikeluarkan** dari activity & revenue | — |
| Alokasi product-level | `RefundItem` → pembalikan COGS historis (F.5) | tidak mengubah revenue, mengubah COGS |

### ⚠️ Edge case yang WAJIB diputuskan (jangan diubah diam-diam)

Terdapat **1 order `CANCELLED` + `paymentStatus=PAID` + `Payment.status=PAID` (QRIS, 90.000)**
(`ORD-20260908-HCOK1L`). Karena report memakai `status != CANCELLED`, **uang 90.000 yang sudah
tertagih tidak masuk revenue report**. Secara desain, order yang dibatalkan setelah dibayar
seharusnya melewati alur **refund** (yang menandai payment `REFUNDED`) — baris ini tampak
legacy/koreksi-manual. **Rekomendasi: pertahankan perilaku sekarang** (`status != CANCELLED`) dan
**dokumentasikan** sebagai keputusan; perubahan perilaku cancel-paid adalah keputusan bisnis, bukan
bagian dari "selaraskan dashboard".

---

## 7. Existing API

| Endpoint | Auth | Scoping |
| --- | --- | --- |
| `GET /api/reports/sales` | `requireRoles(["ADMIN","CASHIER"])` | `ctx.restaurantId` + `authorizedBranches(ctx)` / `branchId` tervalidasi |
| `GET /api/reports/sales/export` | **`requireAdmin`** | sama (ADMIN-only, server-enforced) |
| `GET /api/reports/products`, `/payments`, `/purchases`, `/inventory`, `/multi-outlet`, `/shift-sales`, `/profitability`, `/menu-engineering` (+ masing-masing `/export`) | report GET umumnya ADMIN+CASHIER; export/multi-outlet/profitability/menu-engineering ADMIN-only | sama |
| `GET /api/orders/dashboard/stats` | `requireRoles(["ADMIN","CASHIER"])` | `ctx.restaurantId` + `authorizedBranches(ctx)` |
| `GET /api/orders/dashboard` | (dashboard data lain) | — |

Semua route adalah **GET-only**, **tanpa mutasi**, dan memvalidasi filter lewat whitelist
(`REPORT_PERIODS`, `REPORT_ORDER_TYPES`, `REPORT_PAYMENT_METHODS`, `REPORT_PAYMENT_STATUSES`) —
nilai tak dikenal di-fallback/null, bukan diteruskan mentah.

---

## 8. Existing UI — pemetaan ke target UI

| Target | Status | Lokasi |
| --- | --- | --- |
| Admin nav: Dashboard, Orders, Menu, Customers, Payments, Reports, Marketing, Settings | **ADA** | `src/app/admin/layout.tsx` |
| Reports → **Sales Summary** | **ADA** | `/admin/reports` — 9 summary cards (§ di bawah) |
| Reports → **Payment Breakdown** | **ADA** | `/admin/reports` (section "Pembayaran") **dan** halaman khusus `/admin/reports/payments` |
| Reports → **Order Type** | **ADA** | `/admin/reports` (section "Tipe Order") |
| Reports → **Best Selling Products** | **ADA** | `/admin/reports` (section "Produk Terlaris") + `/admin/reports/products` |
| Reports → **Export CSV** | **ADA** | tombol export (ADMIN-only) di setiap halaman report |
| Sub-nav report | **ADA** | `src/components/admin/reports/report-nav.tsx` (Penjualan, Produk, Pembelian, Inventory, Per Shift, Pembayaran, Multi Outlet*, Profitabilitas*, Menu Engineering*) — *adminOnly |

**MINIMAL SUMMARY yang diminta — sudah semua ada** (`/admin/reports` `summaryCards`):
Total Penjualan (`totalSales`) · Total Order (`totalOrders` + `paidOrders lunas`) · Item Terjual
(`totalItemsSold`) · Rata-rata Order (`averageOrderValue`) · Total Diskon (`totalDiscount`) ·
Total Refund (`totalRefund`) · Total Pajak (`totalTax`) · Service Charge (`totalServiceCharge`) ·
**Net Sales** (`netSales`).

**Filter periode:** Hari Ini, Kemarin, Minggu Ini (ISO Senin), Bulan Ini, Custom — **ADA**
(server `resolveReportRange`). Plus tambahan client: 7 Hari, 30 Hari via `report-periods.ts`.

**Pembayaran:** Cash, QRIS, VA/Gateway, Unpaid, Failed+Expired, Refund, Cancelled — **ADA**.
**Order type:** DINE_IN / TAKEAWAY / DELIVERY — **ADA**.
**Produk:** Terlaris, Qty terjual, Revenue per produk — **ADA**; bonus yang sudah ada:
**kategori terlaris** (`bestCategories`) & **jam paling ramai** (`busiestHours`).

**UI states:** loading (`Loader2`), error (`AlertCircle` + "Coba Lagi"), empty ("Belum ada data
pada periode ini"), responsive grid — **ADA**.

---

## 9. Existing export

- **Util:** `src/lib/csv.ts` — `buildCsv(header, rows)` + `csvCell()`: RFC-4180 quoting, **UTF-8 BOM**
  (Excel), **CRLF**, dan **formula-injection guard** (`= + - @` pada text cell di-prefix `'`).
  ➡ **Reuse. Tidak perlu dependency baru.**
- **Sales export:** `GET /api/reports/sales/export` → `getSalesOrdersForExport()` (order-level,
  `createdAt` urut naik, `take: 5000`, menyertakan metode + `paidAt`) → `Content-Disposition: attachment`.
  **Tidak** menyertakan secret pembayaran (`providerRef`/`qrString`/`paymentUrl` tidak diselect).
- 8 export route lain (produk, pembayaran, pembelian, inventory, multi-outlet, shift, profitability,
  menu-engineering) memakai `buildCsv` yang sama.

---

## 10. Existing tenant scoping

- `restaurantId` **selalu** dari session: `requireRoles`/`requireAdmin` → `requireRestaurantContext(ctx)`
  (`src/lib/auth-helpers.ts`) yang membaca `User.restaurantId` dari DB (JWT), **bukan** dari query/body.
- Query param `branchId` hanya sebagai *filter*, tervalidasi; **bukan** identitas tenant.
- Tidak ada jalur yang menerima `restaurantId` dari client. Cross-tenant report **tidak mungkin**
  (semua agregasi ber-`where.restaurantId`).

## 11. Existing branch scoping

- `authorizedBranches(ctx)` → `branchId: { in: [...] }` untuk user ter-scope; `undefined` untuk
  all-branch admin (semua cabang).
- `branchId` eksplisit di query divalidasi oleh `requireRestaurantContext` (ditolak bila di luar
  assignment user) → menjadi satu-satunya scope baca.
- Header `x-branch-id` hanya **hint**, selalu direvalidasi.
- Raw SQL (`busiestHours`, `dailySeries`, `computeRefundRevenue`, `getProductReport`) memakai
  fragmen `AND branchId IN (Prisma.join([...]))` — **ter-scope**, tanpa double-count.
- UI: `ReportBranchFilter` + `useBranchContext()` → hanya cabang authorized yang bisa dipilih.

---

## 12. GAP

| # | Gap | Severity | Catatan |
| --- | --- | --- | --- |
| **G1** | **Dashboard `todayRevenue` memakai basis `COMPLETED` tanpa filter pembayaran** — berbeda dari report (authoritative PAID). Terukur overstate **+32.000 (+6,6%)** pada data lokal. | **HIGH** | Inti PHASE 5 |
| **G2** | **Dua angka revenue di satu dashboard** ("Pendapatan Hari Ini" COMPLETED-based vs "Sales Overview" PAID-based) | **HIGH** | Turunan G1; membingungkan & saling bertentangan |
| G3 | `.aggregate` dashboard memakai `createdAt >= today` tanpa batas atas (tidak masalah fungsional, tapi tidak simetris dengan engine) | LOW | Rapikan saat G1 diperbaiki (delegasi ke engine) |
| G4 | **`CANCELLED` + PAID (90.000)** dikeluarkan dari revenue | LOW (perlu keputusan) | §6; **jangan** ubah tanpa keputusan bisnis |
| G5 | Tidak ada index komposit `(restaurantId, createdAt)` | LOW (perf) | **Jangan** tambah tanpa pengukuran — index existing `restaurantId` & `createdAt` terpisah sudah ada |
| G6 | `OrderStatusHistory` **tidak** dipakai report sama sekali | — | Bukan gap: revenue berbasis Order/Payment; history = audit trail. Tidak perlu diubah |
| G7 | Fitur "kategori terlaris" & "jam ramai" | **TIDAK ADA gap** | Sudah tersedia (`bestCategories`, `busiestHours`) — jangan dipaksa bikin baru |

**Tidak ada gap** pada: target UI/nav, summary fields, payment breakdown, order type, best sellers,
CSV export, filter periode, tenant/branch scoping, atau agregasi server-side.

---

## 13. Files yang perlu diubah (rencana implementasi, belum dikerjakan)

| File | Perubahan |
| --- | --- |
| `src/services/order/order.service.ts` | `getDashboardStats().todayRevenue` → selaraskan ke basis revenue authoritative |
| `src/services/report/report.service.ts` | (opsional) ekspor helper predikat/`getSalesSummary` agar hanya ada **satu** definisi revenue |
| `src/app/admin/dashboard/page.tsx` | (opsional) penegasan label card revenue |
| `src/components/admin/analytics/dashboard-analytics.tsx` | **tidak berubah** (sudah PAID-based) |
| Report pages/services/export | **tidak berubah** (sudah sesuai target) |

**Tidak ada** file engine Order/Payment/Refund/Table/WhatsApp/Print Bill yang perlu diubah.

## 14. API impact

**Minimal.** Tidak ada endpoint baru; kontrak `GET /api/orders/dashboard/stats` **bentuknya sama**
(hanya **nilai** `todayRevenue` yang berubah basis). `GET /api/reports/sales` & `/export` **tidak berubah**.

## 15. Database impact

**NONE.** Murni perubahan agregasi/baca. Tidak ada DDL/DML, tidak ada backfill.

## 16. Migration required?

**TIDAK.** Semua field yang dibutuhkan sudah ada
(`Order.paymentStatus/status/grandTotal/subtotal/discount/tax/serviceCharge/createdAt`,
`Payment.status/method/provider/amount`, `PaymentTransaction.rawData`, `Refund.amount/status/approvedAt`,
`Product/Category`, `OrderItem.quantity/totalPrice`). **0 migration.**

## 17. Performance impact

- Semua agregasi tetap **di DB** (`aggregate` / `groupBy` / raw SQL `GROUP BY`); **tidak ada**
  `fetch all orders → reduce()` di browser, **tidak ada** perhitungan revenue di client.
- Index existing cukup: `Order(restaurantId)`, `(branchId)`, `(createdAt)`, `(status)`,
  `(paymentStatus)`, `(customerId)`; `Payment(restaurantId/branchId/orderId/status)`; `OrderItem(orderId, productId)`.
- Bila `todayRevenue` didelegasikan ke ringkasan engine → 1 `aggregate` + 1 raw SQL (refund), keduanya terindeks.
- Export dibatasai `take: 5000`; best sellers `take 10`; kategori `take 50` — semua berbatas.
- **Tidak menambah index** (belum ada bukti kebutuhan).

## 18. Security impact

- Tidak ada perubahan auth & tidak ada permission baru: report GET = **ADMIN+CASHIER**,
  export/multi-outlet/profitability/menu-engineering = **ADMIN-only** (existing, **dipertahankan**).
- `restaurantId` tetap dari session; cross-tenant tetap mustahil; `branchId` tetap tervalidasi
  (server) dan header tetap hanya hint.
- Perubahan nilai `todayRevenue` **tidak** membuka data baru (angka agregat, bukan detail).

## 19. UI impact

- Report UI: **tidak berubah** (sudah memenuhi target).
- Dashboard: hanya **angka** card "Pendapatan Hari Ini" berubah (menjadi konsisten dengan report);
  opsional penajaman label agar basisnya eksplisit. Tidak ada restrukturisasi layout.

## 20. Regression risk

| Area | Risiko |
| --- | --- |
| Report engine & export | **LOW** — idealnya tidak disentuh |
| Print Bill (PHASE 4, verified) | **NONE** — tidak ada file print yang disentuh |
| Order/Payment/Refund engine | **NONE** — hanya query agregasi dashboard |
| Reservation purchase flow | **NONE** |
| Dashboard angka berubah (koreksi ke bawah) | **Expected** — ini perbaikan, bukan regresi; perlu disebut di release note |

## 21. Implementation plan (untuk fase berikutnya — **BELUM dijalankan**)

1. **Tetapkan authoritative:** basis revenue = **PAID** (`status != CANCELLED AND (paymentStatus=PAID OR
   ada Payment REFUNDED)`), persis `revenueWhere` engine report. (§4)
2. **Selaraskan dashboard:** ubah `getDashboardStats.todayRevenue` agar memakai basis itu — idealnya
   **delegasi** ke satu helper/`getSalesReport`-summary supaya **hanya ada satu definisi revenue** di
   codebase (hindari definisi kedua). Pertahankan bentuk API.
3. **Label UI:** pertahankan card "Pendapatan Hari Ini" dengan basis baru (opsional: tambah keterangan
   "lunas"), agar konsisten dengan "Total Penjualan" di report.
4. **Jangan** ubah: report engine/UI/export, permission (ADMIN-only export), perilaku
   `status != CANCELLED`, edge `CANCELLED+PAID` (G4) tanpa keputusan bisnis.
5. **Verifikasi wajib:** `tsc --noEmit`, `npm run build`, `git diff --check`, plus **runtime
   perbandingan**: untuk periode yang sama, angka dashboard **harus sama** dengan
   `report.summary.totalSales`; uji lintas-tenant & branch-scope tetap **ditolak**; uji order
   COMPLETED+UNPAID / PAID+PROCESSING sebagai kasus pembeda.
6. **Tanpa** migration, tanpa dependency baru, tanpa endpoint baru, tanpa commit/push/deploy kecuali diminta.

---

## Bukti pendukung (ringkas)

```
Dashboard (COMPLETED, tanpa filter bayar): 519.000  n=16
Report    (!CANCELLED & PAID)            : 487.000  n=15
DELTA                                    : +32.000 (+6,6%)
dashboard-only : COMPLETED+PENDING 55.000 · COMPLETED+UNPAID 30.000 · COMPLETED+EXPIRED 30.000
report-only    : PAID+PROCESSING 30.000 · PAID+PROCESSING 53.000
refund         : APPROVED 1 (30.000) · PENDING 1 (30.000)
edge           : CANCELLED + paymentStatus=PAID + Payment PAID (QRIS 90.000)
```

> **STOP setelah audit report** — sesuai instruksi. Tidak ada coding, migration, commit, push,
> atau deploy yang dilakukan pada fase ini.
