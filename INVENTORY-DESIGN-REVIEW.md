# Design Review: Make Product Inventory Optional

**Date:** 2026-10-13  
**Scope:** Product Inventory optionality without breaking Order/Accounting  
**Status:** READ-ONLY ANALYSIS - NO CODE CHANGES

---

## 1. JAWABAN KEPERTANYAKAN

### 1. Apakah sudah ada setting inventory tracking?

**Tidak ada setting eksplisit untuk inventory tracking.** Namun ada kemungkinan bypass melalui:

| Level | Existing Setting | Effect |
|-------|------------------|--------|
| **BranchProduct** | `stock: Int @default(0)` | Stok di-level cabang-produk |
| **Order** | `branchId: String?` | Order tanpa branchId → lewati stock check |
| **BranchProduct** | `isAvailable: Boolean @default(true)` | Bisa dimatikan untuk produk tidak tersedia |

**Tidak ada:** `requiresStock`, `skipStockCheck`, atau setting serupa.

### 2. Kontrol stok mana yang paling tepat?

**Rekomendasi: Restaurant-level setting** berdasarkan arsitektur existing:

- Semua setting penting restaurant ada di `RestaurantSettings` (branding, notifikasi)
- `branchId` pada Order sudah ada untuk isolation
- `BranchProduct.stock` sudah ada untuk control per cabang

### 3. Default untuk restoran baru?

**Default HARUS "stock check enabled"** untuk backward compatibility:
- Restaurant existing sudah mengandalkan stock check
- Restoran baru dapat meng-offload lewat UI admin

### 4. Menjaga perilaku existing tidak berubah?

- Setting bersifat **opt-in** (`allowStockBypass: Boolean @default(false)`)
- Semua logic stock tetap berjalan kecuali setting aktif
- Zero impact pada restoran yang tidak mengganti default

### 5. Lewati semua stock check bila inventory tidak aktif?

**YA, dengan perubahan MINIMAL:**

Di `order.service.ts:1761`, ubah dari:
```typescript
if (order.status !== "COMPLETED" && input.status === "COMPLETED" && order.branchId) {
```

Menjadi:
```typescript
if (order.status !== "COMPLETED" && input.status === "COMPLETED" && order.branchId && !settings.skipStockCheck) {
```

### 6. Jaga validasi stok bila inventory aktif?

Tidak perlu ubah - logic sudah ada di `applyStockMovement()` di stock.service.ts

### 7. Produk tanpa BranchProduct?

**MASALAH:** `applyStockMovement()` auto-create BranchProduct dengan stock=0

**Solusi:** Jika `skipStockCheck = true`, jangan panggil `applyStockMovement()`

### 8. Apakah butuh migration?

**YA, jika menambah kolom baru di RestaurantSettings.**

Alternatif: **TIDAK butuh migration** jika gunakan cara kerja existing:
- Order tanpa `branchId` → lewati stock check (sudah ada!)
- Hanya butuh UI untuk memberi tahu admin

### 9. Verifikasi ConflictError impact?

**File:** `src/services/order/order.service.ts:1661-1825`

**Transaction boundary:**
```typescript
const updatedOrder = await prisma.$transaction(
  async (tx) => {
    // ... update order status ...
    // ... stock deduction with CONFLICT ERROR ...
  },
  { isolationLevel: Prisma.TransactionIsolateLevel.ReadCommitted }
);
```

**ConflictError tidak membatalkan COMPLETED** karena:
- Dilempar di dalam transaction
- Transaction rollback otomatis
- Namun: orderStatus sudah diupdate di baris 1663 sebelum stock check

**INFO KRITISAL:** Status update dan stock check dalam SATU transaction. Jika stock gagal, status juga rollback. Ini benar-benar membatalkan COMPLETED.

### 10. Dampak terhadap Accounting?

| Komponen | Dampak |
|----------|--------|
| Cost Snapshot | Tidak berpengaruh (best-effort setelah commit) |
| Integrity M2 | Tidak berpengaruh (monitor exists snapshot) |
| P&L | Tidak berpengaruh (gunakan snapshot, bukan stock) |
| Reporting | Tidak berpengaruh (gunakan revenue predicate) |

---

## 2. OPSI REUSE EXISTING CONFIGURATION

### Ide: Pakai `branchId = null` sebagai penanda stock bypass

**Mechanism:**
1. Customer order tanpa table → `branchId` null
2. Stock check otomatis lewat (lihat `order.service.ts:1761-1764`)

**Files affected:**
- `src/services/order/order.service.ts` ( sudah ada, tidak perlu ubah)
- UI checkout untuk memberi tahu `branchId` opsional

**Database impact:** **TIDAK ADA** - tidak butuh migration

**Default behavior:** Stock check ON (branchId required untuk stock deduction)

**Backward compatibility:** 100% - tidak ada perubahan

**Tenant/branch isolation:** Tidak applicable - tidak ada perubahan

**Regression tests:** Cukup verifikasi that orders without branchId skip stock

**Rollback strategy:** Tidak ada - tidak ada perubahan code

**KEKURANGAN:**
- Tidak flexible untuk admin yang ingin disable stock tapi tetap pakai branch
- Customer order tanpa branchId tidak bisa tracking stok sama sekali

---

## 3. OPSI SETTING INVENTORY RINTANG RESTORAN

### Ide: Tambah `restaurantSettings.allowStockBypass`

**Database schema change:**
```prisma
// Di RestaurantSettings model
skipStockCheck Boolean @default(false)
```

**Files affected:**
- `prisma/schema.prisma` (tambah kolom)
- `src/services/order/order.service.ts:1761` (cek setting)
- UI Admin: `src/app/admin/settings/page.tsx` (opsional)

**Database impact:** **YA** - butuh migration `add_column`

**Default behavior:** Stock check ON (`skipStockCheck: false`)

**Backward compatibility:** 100% - restaurant existing tetap false

**Tenant/branch isolation:** Setting level restaurant, apply ke semua branch

**Regression tests:**
- Test: restoran dengan skipStockCheck=true → order COMPLETE tanpa stock check
- Test: restoran dengan skipStockCheck=false → order COMPLETE dengan stock check
- Test: order tanpa branchId → lewati stock check (existing behavior)

**Rollback strategy:** Hapus kolom + ubah kembali logic

---

## 4. OPSI SETTING INVENTORY TINGKAT PRODUK

### Ide: Tambah `product.requiresStock: Boolean` atau gunakan recipe

**Database schema change:**
```prisma
// Di Product model
requiresStock Boolean @default(true)  // atau
hasStockControl Boolean @default(true)
```

**Alternatif existing:**
- `recipe` null = NO_RECIPE → snapshot status
- Tidak ada field untuk "this product doesn't use inventory"

**Files affected:**
- `prisma/schema.prisma` (tambah kolom)
- `src/services/order/order.service.ts` (cek product.requiresStock)
- UI Admin product page

**Database impact:** **YA** - butuh migration

**Default behavior:** Semua produk butuh stok (`requiresStock: true`)

**Backward compatibility:** 100% - semua produk existing tetap check

**Tenant/branch isolation:** Setting level produk, bisa berbeda per produk

**Regression tests:**
- Test: produk tanpa stok → order COMPLETE tanpa stock check
- Test: produk dengan stok → order COMPLETE dengan stock check
- Test: campuran → hanya produk dengan stok yang dicek

**Rollback strategy:** Hapus kolom + ubah kembali logic

---

## 5. PERBANDINGAN OPSI

| Kriteria | Opsi 1: Reuse branchId | Opsi 2: RestaurantSetting | Opsi 3: ProductLevel |
|----------|----------------------|---------------------------|---------------------|
| **Migration** | TIDAK perlu | YA (add column) | YA (add column) |
| **Regression risk** | MINIMAL (existing) | RENDAH | RENDAH |
| **Flexibility** | RENDAH | SEDANG | TINGGI |
| **Complexity** | MINIMAL | SEDANG | SEDANG |
| **Admin UX** | Otomatis | Perlu UI setting | Perlu UI per produk |
| **Use case: Cafe bekas** | ✅ | ✅ | ✅ |
| **Use case: Multi-produk campur** | ❌ | ❌ | ✅ |
| **Use case: Semua produk tidak pakai stock** | ❌ | ✅ | ❌ (harus setiap produk) |

---

## 6. REKOMENDASI AKHIR

**Pilihan: Opsi 2 - Restaurant-level setting `skipStockCheck`**

**Justifikasi:**
1. **Backward compatibility 100%** - semua restaurant existing tetap stock check
2. **Migration tetap diperlukan** untuk menambah kolom `skipStockCheck`
3. **Least complexity** untuk restaurant yang tidak pakai inventory sama sekali
4. **Mudah dikelola** - satu setting per restaurant
5. **Tidak mengubah Order/Payment lifecycle** - hanya menyalakan/mematikan stock check

**Implementation Plan:**

### Phase 1: Database Schema (Migration Required)
```prisma
// prisma/schema.prisma - RestaurantSettings model
model RestaurantSettings {
  // ... existing fields ...
  skipStockCheck Boolean @default(false)
}
```

Migration file: `prisma/migrations/YYYYMMDD_add_skip_stock_check/migration.sql`

### Phase 2: Service Logic
**File:** `src/services/order/order.service.ts:1761-1809`

Tambah auto-load settings:
```typescript
// Di dalam updateOrderStatus atau sebelum call
const settings = await prisma.restaurantSettings.findUnique({
  where: { restaurantId }
});
```

Ubah kondisi:
```typescript
if (
  order.status !== "COMPLETED" &&
  input.status === "COMPLETED" &&
  order.branchId &&
  !settings?.skipStockCheck  // <-- TAMBAH KONDISI INI
) {
  // existing stock deduction logic
}
```

### Phase 3: API & Admin UI
**File opsional:** `src/app/api/admin/settings/route.ts`
- Endpoint untuk update `skipStockCheck`

**File opsional:** `src/app/admin/settings/page.tsx`
- Toggle "Skip Product Stock Check"

---

## 7. ALTERNATIVE DENGAN TANPA MIGRATION

**Gunakan cara kerja existing tanpa perubahan:**

1. **Tanpa branchId** = otomatis skip stock (sudah ada)
2. **Tidak pakai stock sama sekali** → tidak beri branchId pada order
3. **Manual entry** → order tanpa branchId, catat manual di expense

**Catatan:** Ini cara yang sudah ada - tidak perlu perubahan. Tapi kurang user-friendly karena harus memilih "Takeaway" atau tidak pilih meja.

---

## 8. VERIFICATION CHECKLIST

Setelah implementasi, verifikasi:

- [ ] Restoran baru (tanpa settings) → stock check aktif
- [ ] Restoran dengan `skipStockCheck=true` → order COMPLETE tanpa stock error
- [ ] Restoran dengan `skipStockCheck=false` → stock check normal
- [ ] Order tanpa branchId → selalu lewati stock check
- [ ] Product dengan BranchProduct stock=0 → masih ConflictError (kecuali skipStockCheck)
- [ ] COGS snapshot tetap ditulis (best-effort)
- [ ] Cashbook tidak terpengaruh
- [ ] Revenue reporting tidak berubah

---

## 9. CONCLUSION

**Rekomendasi:** Implementasikan Opsi 2 dengan `skipStockCheck: Boolean @default(false)` di RestaurantSettings.

**Alasan utama:**
- Menggunakan arsitektur existing (RestaurantSettings)
- Backward compatible 100%
- Migration terkelola (hanya column baru)
- Reusable untuk kebutuhan inventory lain (misal: ingredient stock control di masa depan)
- Simplest UI/admin experience

**Yang TIDAK berubah:**
- Cashbook (read-only)
- Revenue calculation (payment-based)
- Cost snapshot (best-effort, setelah commit)
- Accounting M2 integrity (monitor)
- Payment flow (PAID terminal)
- Refund workflow

---

**END OF DESIGN REVIEW**