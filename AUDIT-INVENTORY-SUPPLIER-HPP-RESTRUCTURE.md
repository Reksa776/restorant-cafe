# AUDIT — Restrukturisasi Inventory + Supplier + HPP

Status: **READ-ONLY AUDIT**. Tidak ada kode, migrasi, `db push`, atau perubahan database.
Tujuan: memisahkan **BAHAN BAKU** dan **STOK PRODUK**, menjadikan **Supplier hanya untuk bahan baku**, dan menyediakan **HPP 2 mode** (otomatis dari resep + manual) tanpa engine duplikat.

Target workflow:
`SUPPLIER → PEMBELIAN BAHAN BAKU → STOK BAHAN BAKU → RESEP/KOMPOSISI → HPP OTOMATIS`
dan alternatif `PRODUK → HPP MANUAL`, lalu `PRODUK → STOK PRODUK → ORDER → COGS → PROFITABILITY`.

---

## 1. EXISTING FUNCTIONALITY

### A. Bahan Baku — **SUDAH ADA (lengkap, Fase F.1 + F.2)**

| Kebutuhan | Status | Lokasi |
|---|---|---|
| Master `Ingredient` | ✅ Ada | `prisma/schema.prisma` → `model Ingredient` (`restaurantId`, `name` unik per tenant, `baseUnit` enum `PCS/GRAM/KG/ML/LITER`, `isActive`) |
| Service CRUD | ✅ Ada | `src/services/ingredient/ingredient.service.ts` |
| Stock per cabang | ✅ Ada | `model BranchIngredient` (`@@unique([branchId, ingredientId])`, `stock Decimal(18,3)`) |
| `averageCost` / WAC | ✅ Ada | `BranchIngredient.averageCost Decimal(12,2)?` |
| `lastPurchaseCost` | ✅ Ada | `BranchIngredient.lastPurchaseCost Decimal(12,2)?` |
| Stock movement ledger | ✅ Ada | `model IngredientStockMovement` (append-only, `balanceAfter`) |
| Adjustment | ✅ Ada | `adjustIngredientStock()` di `src/services/ingredient/ingredient-stock.service.ts` (target → delta, `IN`/`OUT` + `refType = STOCK_ADJUSTMENT`) |
| API | ✅ Ada | `GET/POST /api/admin/ingredients`, `GET/PUT /api/admin/ingredients/[id]`, `GET /api/admin/ingredients/stock`, `GET(movements)`, `PUT /api/admin/ingredients/stock/[ingredientId]` |
| UI | ✅ Ada | `/admin/ingredients` (master), `/admin/stock` tab **"Bahan Baku"** (stok + adjust) |

Atomic write path: `applyIngredientStockMovement()` — lock `branchingredient` `FOR UPDATE`, hitung `balanceAfter` di `Prisma.Decimal`, tolak saldo negatif, tulis saldo + ledger dalam satu transaksi.

### B. Supplier — **SUDAH ADA (relasi hanya ke Purchase)**

`model Supplier`: relasi **hanya** `restaurant` + `purchases: Purchase[]`.
**Tidak ada** relasi langsung ke `Product`, `BranchProduct`, atau `Ingredient`.

- Service: `src/services/supplier/supplier.service.ts` (tenant-scoped, soft-disable `isActive`, unique `(restaurantId, name)`).
- API: `GET/POST /api/admin/suppliers`, `GET/PATCH /api/admin/suppliers/[id]` (POST/PATCH = ADMIN only).
- UI: `/admin/purchasing/suppliers`.

Relasi Supplier ke produk saat ini bersifat **tidak langsung**: `Supplier → Purchase → PurchaseItem → Product`. Inilah satu-satunya jalur "supplier memasok produk" dan inilah yang perlu dihentikan.

### C. Purchasing — **SUDAH BISA produk, bahan baku, atau keduanya**

- `model PurchaseItem` → `Product` (legacy, qty integer PCS) — **jalur produk**.
- `model PurchaseIngredient` → `Ingredient` (qty `Decimal(18,3)` + `unit`) — **jalur bahan baku**.
- `createPurchase()` menerima `items[]` (produk) **dan/atau** `purchaseIngredients[]` (bahan baku); total server-derived.
- `receivePurchase()` (DRAFT → RECEIVED, idempotent):
  - Produk → `applyStockMovement()` (stok produk `BranchProduct.stock` bertambah, ledger `StockMovement`).
  - Bahan baku → `applyIngredientStockMovement()` + **hitung WAC** `(oldStock·oldWAC + receivedQty·unitCost) / newStock` lalu update `averageCost` & `lastPurchaseCost`.
- API: `GET/POST /api/admin/purchases`, `GET/PATCH /api/admin/purchases/[id]`, `POST .../[id]/receive`, `POST .../[id]/cancel`.
- UI: `/admin/purchasing/purchases`, `/admin/purchasing/purchases/new`, `/admin/purchasing/purchases/[id]`.

**Target `Supplier → Bahan Baku` secara teknis SUDAH DIDUKUNG** oleh `PurchaseIngredient` + logika WAC di `receivePurchase`. Yang belum: UI masih menampilkan jalur produk sebagai default, dan tidak ada aturan yang melarang pemilihan produk.

### D. Stok Produk vs Stok Bahan Baku — **SUDAH terpisah di DB & service**

| | Stok Bahan Baku | Stok Produk/Menu |
|---|---|---|
| Tabel saldo | `BranchIngredient.stock Decimal(18,3)` | `BranchProduct.stock Int` |
| Ledger | `IngredientStockMovement` | `StockMovement` |
| Engine | `applyIngredientStockMovement()` | `applyStockMovement()` |
| API | `/api/admin/ingredients/stock` | `/api/admin/branches/[id]/products` (GET list, PUT set stock), `/api/admin/stock-movements` |
| UI | `/admin/stock` tab "Bahan Baku" | `/admin/stock` tab "Produk" |

Order selesai (`READY → COMPLETED`) memakai `applyStockMovement()` OUT untuk **stok produk** (`src/services/order/order.service.ts`). `BranchProduct.stock` juga bisa naik dari `receivePurchase` jalur `PurchaseItem`.

> **Penting:** Penjualan **tidak** mengurangi stok bahan baku. Tidak ada konsumsi BOM otomatis (recipe → ingredient OUT) saat order selesai. Snapshot COGS F.5 hanya *menghitung nilai*, bukan memotong stok.

### E. HPP Otomatis (MODE 1) — **SUDAH ADA (Fase F.4)**

Formula yang sudah jalan persis seperti yang diminta:
```
HPP = Σ (RecipeItem.quantity × BranchIngredient.averageCost)
```
- Service: `src/services/costing/costing.service.ts` (READ-ONLY, live WAC, semua arithmetic `Prisma.Decimal`).
- Resep/BOM: `model Recipe` + `model RecipeItem`; service `src/services/recipe/recipe.service.ts`; UI tab **"Komposisi"** di dialog produk `/admin/menu`; API `GET/PUT/DELETE /api/admin/menu/products/[productId]/recipe`.
- API costing: `GET /api/admin/costing/products`, `GET /api/admin/costing/products/[productId]` (**ADMIN only**, butuh `branchId`).
- UI: `/admin/costing` (+ dialog What-If Simulation).

### F. HPP per Cabang — **SUDAH aman, tidak bocor**

- `Recipe` bersifat **restaurant-level** (satu resep per produk), **bukan** per cabang.
- Pembeda antar-cabang adalah **WAC** (`BranchIngredient` per `branchId`) dan `BranchProduct.priceOverride`.
- Costing selalu meminta `branchId`, diverifikasi `assertBranchInScope()` → cabang di luar wewenang = 403.
- HPP/COGS tidak pernah di-`select` di API publik/customer; endpoint costing = ADMIN only.

### G. COGS / Historical HPP — **SUDAH ADA (Fase F.5)**

Alur: `HPP → OrderItem → OrderItemCostSnapshot → COGS → Profitability`.
- Snapshot dibuat **sekali** saat transisi ter-guard `READY → COMPLETED`, di transaksi yang sama (`createOrderItemCostSnapshots()` di `src/services/costing/historical-snapshot.ts`).
- Tabel `OrderItemCostSnapshot` (`orderItemId` unik, `hppUnit`, `hppTotal`, `status`: `SNAPSHOTTED / NO_RECIPE / MISSING_WAC / INACTIVE_INGREDIENT / NO_BRANCH / LEGACY`).
- `ProfitabilityService` **hanya membaca snapshot**. Perubahan WAC/resep setelahnya **tidak** mengubah COGS historis. ✅ sesuai kebutuhan.

### H. Admin Navigation — **sudah ada group yang mendekati target**

`src/app/admin/layout.tsx` (single source of truth sidebar):

```
Operasional  : Orders, Kitchen, Tables, Customers, Shifts
Menu         : Menu, Costing
Inventory    : Stok, Bahan Baku, Stock Movement, Pembelian, Supplier
Finance      : Payments, Riwayat Penjualan
Reports      : Laporan Penjualan, Best Selling, Pembelian, Inventory,
               Pembayaran, Per Shift, Multi Outlet, Profitabilitas, Menu Engineering
Marketing    : Promosi
Outlet       : Cabang
Settings     : Website Branding, Users, WhatsApp
```

---

## 2. GAP

| # | GAP | Dampak |
|---|---|---|
| G1 | **HPP MANUAL tidak ada sama sekali.** Tidak ada field/kolom di `Product`, `BranchProduct`, atau model lain untuk menyimpan HPP manual / mode costing. | MODE 2 (HPP manual tanpa resep) belum bisa. Perlu migration (lihat §11). |
| G2 | **Purchasing masih mengizinkan beli Produk.** `PurchaseItem` + `createPurchase(items)` + `receivePurchase` jalur produk masih aktif; UI `purchases/new` default menampilkan baris produk. | Melanggar aturan "Supplier tidak boleh supplier produk". |
| G3 | **Tidak ada aturan "Supplier hanya untuk bahan baku".** Supplier bebas dipakai di purchase berisi produk. | Perlu penegakan di service + UI (bukan skema baru). |
| G4 | **Belum ada relasi preferensi Supplier ↔ Ingredient.** Saat ini supplier↔bahan baku hanya via `Purchase → PurchaseIngredient`. | Opsional: bila ingin "supplier default per bahan baku", perlu model baru (mis. `SupplierIngredient`). |
| G5 | **Tidak ada konversi satuan.** `RecipeItem.unit` dan `PurchaseIngredient.unit` **wajib sama** dengan `Ingredient.baseUnit` (hard rule). | Contoh "Ayam 100 gram" hanya valid bila `baseUnit = GRAM`. Bila stok dalam KG, tak bisa resep 100 gram. |
| G6 | **Penjualan tidak memotong stok bahan baku.** Tidak ada konsumsi BOM saat order selesai. | Stok bahan baku hanya berubah dari pembelian + adjustment manual. |
| G7 | **Navigasi belum memisahkan "Stok Bahan Baku" & "Stok Produk".** Keduanya tab dalam satu halaman `/admin/stock`; label menu "Stok" ambigu. | Perlu relabel/penataan menu (tanpa route baru). |
| G8 | **"Kategori" tidak punya route sendiri.** Kategori adalah tab/dialog di `/admin/menu`. | Target menu `Menu → Produk, Kategori, Costing` perlu tab awal via query param atau tab yang sudah ada. |
| G9 | **Recipe tidak per cabang.** Hanya WAC yang berbeda antar cabang. | Bila nanti butuh resep berbeda antar cabang, perlu struktur baru. (Belum diminta.) |

---

## 3. DUPLICATE RISK

**Jangan membuat ulang** engine berikut — semuanya sudah ada dan terpakai:

- Supplier engine → `src/services/supplier/supplier.service.ts`
- Purchasing engine → `src/services/purchase/purchase.service.ts`
- Ingredient engine → `src/services/ingredient/ingredient.service.ts` + `ingredient-stock.service.ts`
- Stock produk engine → `src/services/stock/stock.service.ts`
- Recipe engine → `src/services/recipe/recipe.service.ts`
- HPP engine → `src/services/costing/costing.service.ts`
- COGS engine → `src/services/costing/historical-snapshot.ts` + `src/services/profitability/profitability.service.ts`

**Catatan penting:** dua "lapisan" file service **bukan duplikat**:
- `src/services/<domain>.service.ts` (root) = **wrapper axios client-side** (browser).
- `src/services/<domain>/<domain>.service.ts` = **implementasi server**.
Jangan gabung/hapus salah satunya.

---

## 4. CURRENT DATABASE (model & relasi)

**Bahan baku:** `Ingredient` (restaurant) ─┬─ `BranchIngredient` (branch, stock, averageCost, lastPurchaseCost)
├─ `IngredientStockMovement` (ledger)
├─ `PurchaseIngredient` (→ Purchase)
└─ `RecipeItem` (→ Recipe)

**Produk/stok produk:** `Product` ─┬─ `BranchProduct` (branch, stock, priceOverride)
├─ `StockMovement` (ledger)
├─ `PurchaseItem` (→ Purchase) ← **jalur legacy yang perlu dihentikan**
└─ `Recipe` (1:1) ─ `RecipeItem`

**Supplier:** `Supplier` (restaurant) ─ `Purchase` (branch, supplier) ─┬─ `PurchaseItem` → Product
└─ `PurchaseIngredient` → Ingredient

**HPP/COGS:** `Order` ─ `OrderItem` ─ `OrderItemCostSnapshot` (unik per order item) → dibaca `Profitability`.

**Enum:** `IngredientUnit` (`PCS/GRAM/KG/ML/LITER`), `StockMovementType` (`IN/OUT/ADJUSTMENT`), `PurchaseStatus` (`DRAFT/RECEIVED/CANCELLED`), `OrderItemCostStatus`.

**Belum ada:** field/model HPP manual & mode costing.

---

## 5. CURRENT API (endpoint existing)

| Domain | Endpoint | Guard |
|---|---|---|
| Ingredient | `/api/admin/ingredients`, `/api/admin/ingredients/[id]` | GET ADMIN+CASHIER / write ADMIN |
| Ingredient stock | `/api/admin/ingredients/stock`, `/api/admin/ingredients/stock/[ingredientId]` | ADMIN+CASHIER read / ADJUSTMENT ADMIN |
| Supplier | `/api/admin/suppliers`, `/api/admin/suppliers/[id]` | GET ADMIN+CASHIER / write ADMIN |
| Purchase | `/api/admin/purchases`, `/[id]`, `/[id]/receive`, `/[id]/cancel` | GET ADMIN+CASHIER / create+receive+cancel ADMIN |
| Recipe | `/api/admin/menu/products/[productId]/recipe` | GET ADMIN+CASHIER / write ADMIN |
| Costing | `/api/admin/costing/products`, `/[productId]` | **ADMIN only** |
| Stok produk | `/api/admin/branches/[id]/products`, `/[productId]` | ADMIN+CASHIER (write sesuai role) |
| Stock movement | `/api/admin/stock-movements` | ADMIN+CASHIER |
| Reports | `/api/admin/reports/*` (termasuk `inventory`, `purchases`) | ADMIN (+sebagian CASHIER) |

---

## 6. CURRENT UI

| Route | Fungsi |
|---|---|
| `/admin/stock` | **Stok** — tab **Produk** (BranchProduct) + tab **Bahan Baku** (BranchIngredient, adjust) |
| `/admin/ingredients` | Master **Bahan Baku** (CRUD) |
| `/admin/inventory` | **Stock Movement** (ledger produk: IN/OUT/ADJUSTMENT) |
| `/admin/purchasing/purchases` | Daftar **Pembelian** |
| `/admin/purchasing/purchases/new` | Buat pembelian (baris **Produk** default + opsi **Bahan Baku**) |
| `/admin/purchasing/purchases/[id]` | Detail + receive/cancel |
| `/admin/purchasing/suppliers` | Master **Supplier** |
| `/admin/menu` | Produk + Kategori + tab **Komposisi** (resep) |
| `/admin/costing` | **HPP** live per cabang + What-If Simulation |
| `/admin/profitability` | COGS & profitabilitas (snapshot) |
| `/admin/reports/inventory` | Laporan inventory (ledger **produk**) |

---

## 7. HPP FLOW EXISTING (DB → UI)

1. `Supplier` + `Purchase` (`DRAFT`) → `PurchaseIngredient`.
2. `receive` → `applyIngredientStockMovement` (stok bahan baku naik) + update **WAC** `BranchIngredient.averageCost`.
3. `Recipe` + `RecipeItem` (komposisi per produk) diisi admin via tab Komposisi.
4. `costingService` menghitung **HPP live** = `Σ(RecipeItem.quantity × BranchIngredient.averageCost)` untuk `branchId` terpilih → `/admin/costing`.
5. Saat order `READY → COMPLETED`, `createOrderItemCostSnapshots()` membekukan `hppUnit`/`hppTotal` ke `OrderItemCostSnapshot`.
6. `ProfitabilityService` membaca snapshot → `COGS` → `/admin/profitability`.

Status biaya: `COMPLETE` / `INCOMPLETE` (ada bahan tanpa WAC) di costing; `SNAPSHOTTED` / `NO_RECIPE` / `MISSING_WAC` / `INACTIVE_INGREDIENT` / `NO_BRANCH` di snapshot. Bahan tanpa WAC **tidak pernah** dianggap 0.

---

## 8. STOCK FLOW

### Stok Bahan Baku
`Purchase.RECEIVED` → `applyIngredientStockMovement(IN)` → `BranchIngredient.stock` ↑ + `IngredientStockMovement`
`adjustIngredientStock` → `IN`/`OUT` + `refType=STOCK_ADJUSTMENT`
(Naik dari pembelian & adjustment; **tidak** turun dari penjualan — lihat G6)

### Stok Produk
`Purchase.RECEIVED` jalur `PurchaseItem` → `applyStockMovement(IN)` → `BranchProduct.stock` ↑ + `StockMovement`
`updateBranchProduct` (admin, alasan wajib) → `applyStockMovement(ADJUSTMENT)`
`Order READY → COMPLETED` → `applyStockMovement(OUT, -qty)` per produk (idempotent, tolak saldo negatif) + `StockMovement` OUT

Kedua ledger **terpisah** dan tidak pernah saling menulis.

---

## 9. SUPPLIER FLOW (existing vs target)

**Existing:** `Supplier → Purchase → PurchaseItem(Product)` **dan** `Purchase → PurchaseIngredient(Ingredient)`.
**Target:** `Supplier → Purchase → PurchaseIngredient(Ingredient) → BranchIngredient.stock + WAC` saja.

Kesimpulan: arsitektur existing **sudah cukup**. Yang dibutuhkan bukan skema baru, melainkan (a) berhenti memakai `PurchaseItem` untuk pembelian baru, dan (b) validasi agar purchase berisi bahan baku saja.

---

## 10. RECOMMENDED ARCHITECTURE

```
Supplier ─┐
          ├─ Purchase (branch) ─ PurchaseIngredient ─ Ingredient
          │                         │
          │                         └─ receive → BranchIngredient.stock + averageCost (WAC)
          │
          └─ (PurchaseItem/Product = LEGACY, read-only, tidak dipakai untuk pembelian baru)

Ingredient ─ RecipeItem ─ Recipe ─ Product
                                   │
                    ┌──────────────┴──────────────┐
             MODE AUTO (HPP = Σ qty×WAC)     MODE MANUAL (HPP input admin)
                    └──────────────┬──────────────┘
                                   ▼
                         Product ─ BranchProduct.stock (Stok Produk)
                                   ▼
                          OrderItem ─ OrderItemCostSnapshot (frozen) ─ COGS ─ Profitability
```

Prinsip: satu engine per domain. Mode HPP dipilih per produk; mode auto membaca costing existing, mode manual membaca nilai tersimpan. Snapshot historis tetap beku.

---

## 11. DATABASE IMPACT (dijelaskan, **TIDAK dijalankan**)

### Untuk pemisahan Supplier/Bahan Baku (G2, G3, G4)
- **Wajib migration? Tidak.** Bisa selesai dengan:
  - Menegakkan di service: `createPurchase`/`updateDraftPurchase` menolak `items[]` produk (atau abaikan), hanya `purchaseIngredients[]`.
  - `receivePurchase` berhenti memakai jalur `applyStockMovement` untuk pembelian baru.
  - `PurchaseItem` dibiarkan sebagai data historis (jangan hapus data).
- Opsional (bila ingin supplier default per bahan baku): tabel baru `SupplierIngredient` (`supplierId`, `ingredientId`, `@@unique`, `isPreferred`) — **bukan** mengubah `Supplier`.

### Untuk HPP MANUAL (G1) — butuh migration
Belum ada tempat menyimpan HPP manual / mode. Field yang **diperlukan** (pilih satu opsi):

**Opsi A — level restaurant & per-produk**
- Enum baru `CostingMode { AUTO, MANUAL }`
- `Product.costingMode CostingMode @default(AUTO)`
- `Product.manualHpp Decimal(12,2)?` (nullable; hanya dibaca saat MANUAL)

**Opsi B — HPP manual per cabang (bila HPP manual boleh beda antar cabang)**
- Enum `CostingMode { AUTO, MANUAL }`
- `Product.costingMode CostingMode @default(AUTO)`
- `BranchProduct.manualHpp Decimal(12,2)?`

Rekomendasi: **Opsi B** bila HPP per cabang harus independen (konsisten dengan permintaan "HPP per cabang"); **Opsi A** bila HPP manual seragam se-restaurant.

Tidak perlu mengubah `OrderItemCostSnapshot`, `BranchIngredient`, `OrderItem`, atau `Recipe` apa pun. Migration **belum dijalankan** dan menunggu persetujuan.

---

## 12. API IMPACT

**Dipakai ulang (tanpa endpoint baru):**
- Supplier: `/api/admin/suppliers*`
- Purchasing: `/api/admin/purchases*` (receive/cancel)
- Bahan baku: `/api/admin/ingredients*` + `/api/admin/ingredients/stock*`
- Resep: `/api/admin/menu/products/[productId]/recipe`
- HPP: `/api/admin/costing/products*`
- Stok produk: `/api/admin/branches/[id]/products*` + `/api/admin/stock-movements`
- Laporan: `/api/admin/reports/inventory`, `/purchases`

**Perlu penyesuaian (bukan endpoint baru):**
- `POST/PATCH /api/admin/purchases` → tolak `items[]` produk, wajib `purchaseIngredients[]`.
- `GET /api/admin/costing/products*` → kembahkan `costingMode` + sumber HPP (auto/manual) saat MODE 2 dipilih.
- (Bila MODE 2) endpoint baru untuk set HPP manual bisa menumpang `PATCH /api/admin/menu/products/[id]` yang sudah ada, atau endpoint costing mode.

---

## 13. UI IMPACT

| Page | Perubahan |
|---|---|
| `/admin/purchasing/purchases/new` | Jadikan **Bahan Baku** sebagai baris utama; hapus/disable baris Produk; label tegas "Pembelian Bahan Baku". |
| `/admin/stock` | Pisahkan jelas **Stok Produk** vs **Stok Bahan Baku** (pertahankan tab atau deep-link `?tab=`). Relabel heading. |
| `/admin/costing` | Tambah pemilih mode HPP **( ) Otomatis dari Bahan Baku ( ) Manual** + input nominal saat Manual; tampilkan sumber HPP. |
| `/admin/menu` | Indikator mode HPP pada dialog produk; tab Komposisi hanya relevan untuk mode Auto. |
| `layout.tsx` (nav) | Tata ulang: `Inventory → Bahan Baku, Stok Bahan Baku, Stok Produk, Stock Movement, Pembelian, Supplier`; `Menu → Produk, Kategori, Costing/HPP`; `Reports → Profitability` (sudah ada). Gunakan route existing. |

Tidak ada route baru yang wajib; "Kategori" & "Profitability" sudah ada sebagai tab/route existing.

---

## 14. SECURITY

- **restaurantId scoped:** semua service & API memakai `ctx.restaurantId`; query `findFirst({ where: { id, restaurantId } })`. Supplier unique `(restaurantId, name)` per tenant.
- **branchId scoped:** `authorizedBranches(ctx)` + `assertBranchInScope(ctx, branchId)`; `x-branch-id` hanya hint, divalidasi terhadap `UserBranch`. Costing mewajibkan `branchId` terverifikasi.
- **ADMIN authorization:** create/receive/cancel purchase, CRUD supplier/ingredient/resep, adjustment stok, dan **seluruh costing** = ADMIN. Kasir read-only (403 terverifikasi di F8).
- **Supplier isolation:** tidak ada relasi langsung supplier↔produk; purchase divalidasi milik tenant yang sama.
- **Ingredient isolation:** `saveRecipe` & purchase memvalidasi seluruh `ingredientId` milik `restaurantId`; cross-restaurant ditolak.
- **Stock isolation:** ledger & saldo di-scope `restaurantId` + `branchId`; movement wrapper `FOR UPDATE` mencegah balapan & saldo negatif.
- **HPP tidak bocor ke customer/public:** endpoint costing = ADMIN; `averageCost`/`lastPurchaseCost`/resep tidak pernah di-`select` di API publik/customer. Pertahankan ini saat menambah MODE 2.

---

## 15. REGRESSION RISK

| Area | Risiko | Catatan |
|---|---|---|
| Order | **Rendah** | Jangan ubah `order.service.updateOrderStatus` (snapshot F.5 + stok OUT). Bila ingin konsumsi bahan baku saat jual (G6), itu perubahan terpisah & berisiko tinggi. |
| Payment / Cashier / QRIS | **Nihil** bila tidak menyentuh `payment.service`, shift, dan kasir. |
| Product / Branch | **Rendah** | Perubahan hanya menambah mode costing & pembelian bahan baku. |
| Inventory (produk) | **Sedang** | Menghentikan `PurchaseItem` mengubah perilaku `receivePurchase` untuk produk; pastikan data lama tetap terbaca. |
| Recipe | **Rendah** | Engine resep tidak berubah; hanya mode manual melewati resep. |
| Costing / HPP | **Sedang** | `menu-engineering.service.ts` dan `simulation.service.ts` **mengimpor `costingService`** → perubahan bentuk DTO berdampak ke keduanya. Jaga kompatibilitas DTO. |
| COGS / Profitability | **Tinggi bila salah** | `OrderItemCostSnapshot` harus tetap beku & tidak ditulis ulang. MODE 2 hanya boleh memengaruhi snapshot **baru**, tidak pernah mengubah baris lama. |
| What-If Simulation (F7) | **Sedang** | Read-only & bergantung costing; verifikasi ulang setelah perubahan mode. |

Bukti regresi terakhir ada di `F8-FULL-REGRESSION.md` (F.1–F.5 lulus). Jalankan ulang model regresi yang sama setelah implementasi.

---

## IMPLEMENTATION PLAN (menunggu approval — belum ada kode)

**Fase 0 — Approval audit ini.**

**Fase 1 — Supplier hanya bahan baku (tanpa migration)**
1. `purchase.service.ts`: tolak `items[]` produk pada create/update; wajib minimal satu `purchaseIngredients`.
2. `receivePurchase`: hentikan jalur `applyStockMovement` untuk pembelian baru.
3. UI `purchases/new`: hanya baris bahan baku; relabel "Pembelian Bahan Baku".
4. Verifikasi: purchase produk → 400; purchase bahan baku → stok + WAC benar; data lama tetap tampil.

**Fase 2 — Pisahkan navigasi & jelasnya stok (tanpa migration)**
5. `layout.tsx`: `Inventory → Bahan Baku, Stok Bahan Baku, Stok Produk, Stock Movement, Pembelian, Supplier`; `Menu → Produk, Kategori, Costing/HPP`.
6. `/admin/stock`: pisahkan/relabel tab; dukung deep-link tab.

**Fase 3 — HPP 2 mode (butuh migration, approval terpisah)**
7. Migration: enum `CostingMode` + `Product.costingMode` + (Opsi B) `BranchProduct.manualHpp`.
8. `costing.service.ts`: bila MANUAL & ada nilai → pakai `manualHpp`; else AUTO.
9. `historical-snapshot.ts`: MODE 2 memakai nilai manual untuk snapshot **baru**; baris lama tidak diubah.
10. UI `/admin/costing` & `/admin/menu`: pemilih mode + input manual.
11. Verifikasi: costing mode auto/manual, snapshot baru, profitabilitas, simulation, menu engineering.

**Fase 4 — Regresi penuh (F8-style): Order, Payment, Cashier, QRIS, Product, Branch, Inventory, Recipe, Costing, COGS, Profitability.**

> Aturan yang dipegang: tanpa engine duplikat, tanpa hapus data, tanpa `db push`, tanpa migration sebelum approval, tanpa perubahan payment/order/QRIS/customer.

---

## KEPUTUSAN YANG DIBUTUHKAN DARI OWNER

1. **HPP manual:** level **restaurant** (Opsi A) atau **per cabang** (Opsi B)?
2. **`PurchaseItem` legacy:** dipertahankan read-only, atau nanti ditandai deprecated?
3. **Supplier↔Bahan Baku:** cukup via Purchase (existing), atau perlu daftar supplier default per bahan baku?
4. **Konversi satuan (G5) & konsumsi BOM saat jual (G6):** termasuk scope, atau fase lanjutan?
