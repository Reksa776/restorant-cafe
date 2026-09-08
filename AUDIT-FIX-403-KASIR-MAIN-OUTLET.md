# AUDIT + FIX — 403 KASIR MAIN OUTLET

> Audit + fix untuk dashboard kasir Main Outlet yang melempar HTTP **403** pada seluruh endpoint utama meskipun login berhasil.
> Tanggal: 2026-09-08
> Scope: **tanpa melemahkan tenant/branch authorization**, tanpa mengubah arsitektur, DB, atau security model.

---

## 1. Executive Summary

Login **Kasir Main Outlet** (`kasir@restobahagia.com`) berhasil dan session terbentuk (`branchScoped: true`, 1 branch: Main Outlet), namun setiap request dashboard ditolak server dengan **403**:

| Endpoint | Status awal |
|---|---|
| `/api/orders/dashboard/stats` | 403 |
| `/api/orders?limit=5` | 403 |
| `/api/orders` | 403 |
| `/api/payments` | 403 |
| `/api/shifts/active` | 403 |

**Akar masalah (root cause, ter-reproduce):** *stale* `admin_branch_id` di `localStorage` (sisa pilihan cabang dari sesi/admin lain) dikirim oleh axios interceptor sebagai header `x-branch-id` di **setiap** request. Server **benar** menolak karena branch tersebut tidak termasuk UserBranch kasir → 403 (auth-helpers.ts: "Anda tidak memiliki akses ke cabang ini"). `useBranchContext` hanya me-reset state React ke `null`, **tidak menghapus localStorage**, sehingga nilai stale dikirim terus-menerus. Kasir Main Outlet punya tepat 1 branch sehingga `BranchSelector` render `null` dan tidak pernah membersihkan nilai tersebut.

**Verifikasi:** ter-reproduce — semua endpoint → 403 saat mengirim `x-branch-id: TEST-BR-JKT` (non-assigned), dan **200 saat tanpa header ATAU dengan branch yang benar** (Main Outlet). Tidak ada bug backend: role, branch scope, restaurant isolation semua benar.

**Fix (tidak melemahkan auth):** sehatkan sinkronisasi browser (hapus localStorage stale) + perbaiki UX error handling. **Semua rules otorisasi server tetap utuh dan diverifikasi 23/23 test.**

---

## 2. Symptom

- Login Kasir Main Outlet: sukses (POST `/api/auth/callback/credentials` → 302, session cookie OK).
- GET `/api/auth/session`: `200`, data benar — `branches: [Main Outlet]`, `branchScoped: true`, `branchId: null`.
- Setiap GET dashboard → **403** dengan body `{ message: "Anda tidak memiliki akses ke cabang ini" }`.
- Kasir **JKT** (`cashier-jkt@restobahagia.com`, branch `TEST-BR-JKT`) — **tidak** kena masalah (data kosong → 200).

## 3. Working vs Failing Cashier

| | Kasir JKT (working) | Kasir Main Outlet (failing) |
|---|---|---|
| Jumlah UserBranch | 1 (`TEST-BR-JKT`) | 1 (`MAIN`) |
| Sesi | `branchScoped:true`, branchId null | `branchScoped:true`, branchId null |
| `x-branch-id` terkirim | **TIDAK** (belum pernah set branch lain) | **YA — stale** dari localStorage sesi sebelumnya |
| Status | 200 (data dikosongkan, benar) | **403** (server benar menolak branch non-assigned) |

## 4. Database Evidence

- `users` **tidak punya** kolom `branchId`. Satu-satunya sumber branch assignment = tabel `userbranch` (`id`, `userId`, `branchId`, `createdAt`).
- `kasir@restobahagia.com` (id `cmtois1ir0002bzu8ycm1sbdl`) → UserBranch `cmts3aks100009tu818hblu00` → Branch `MAIN` (Main Outlet, restaurant `restobahagia-id`).
- `cashier-jkt@restobahagia.com` → UserBranch → `TEST-BR-JKT`.
- Kedua cashier: UserBranch aktif, data konsisten. **Bukan** data inconsistency.

## 5. Authorization Trace (per endpoint)

Semua endpoint dipakai pola yang sama:

```
branchHintFrom(request)      // from x-branch-id / ?branchId= / body.branchId
  → requireRoles(['ADMIN','CASHIER'], branchId)
  → authorizedBranches(ctx)
       // not-scoped    → undefined (semua branch)
       // scoped+header → [branchId]
       // scoped, no-header → ctx.branchIds (dari UserBranch)
→ service filter: branchId: { in: [...] }
```

`branchScoped = branchIds.length > 0`. Verifikasi kode: `auth-helpers.ts` (`requireRoles` l.81-145, `authorizedBranches` l.190-196, `assertBranchInScope`, `effectiveWriteBranchId`), route `orders`, `orders/dashboard/stats`, `payments`, `shifts/active`. **Tidak ada bug backend** — 200 benar saat branch valid, 403 hanya saat branch non-assigned (sesuai intent).

## 6. Root Cause (ter-reproduce)

1. Sesi sebelumnya (atau admin lain) menyimpan `admin_branch_id = <branch>` di `localStorage` browser.
2. Axios interceptor (`src/lib/axios.ts`) membaca `localStorage.getItem('admin_branch_id')` **sinkron** di setiap request → kirim header `x-branch-id`.
3. `useBranchContext` hanya me-reset React state ke `null`, **tidak** menghapus localStorage.
4. Server menerima `x-branch-id` branch yang bukan milik kasir → `authorizedBranches` scoped → `[branchId]` → filter `branchId: { in: [foreign] }` → **403**.

Reproduksi di server test (port 3005):
- `x-branch-id: TEST-BR-JKT` (stale, non-assigned) → seluruh 4 endpoint **403**.
- Tanpa header → seluruh endpoint **200** (data scoped ke Main Outlet).
- `x-branch-id: <MAIN id>` → seluruh endpoint **200**.

→ Membuktikan root cause adalah header stale, bukan bug role/branch/data.

## 7. Fix — Code & Data

### 7.1 Root cause: `src/hooks/use-branch-context.ts`

Saat session dimuat, nilai `admin_branch_id` yang **tidak termasuk daftar branch user** kini **dihapus dari localStorage** (bukan hanya diabaikan di state React), sehingga interceptor tidak lagi mengirim nilai stale:

```ts
const stored = localStorage.getItem("admin_branch_id");
const allowed = (data as SessionDto).branches.some((b) => b.id === stored);
if (stored && !allowed) {
  localStorage.removeItem("admin_branch_id");
}
setBranchIdState(stored && allowed ? stored : null);
```

### 7.2 Race guard: gate `useBranchContext` sebelum fetch data

`useEffect` halaman yang memuat data kini menunggu `branchCtxLoading === false` terlebih dahulu (prevent request dengan nilai stale yang masih dibaca interceptor): `dashboard`, `orders`, `payments`, `shifts`.

## 8. Error Handler Frontend (baru)

File baru **`src/lib/api-error-handler.ts`** — normalisasi error jadi `NormalizedApiError` sehingga UI tak pernah render raw `AxiosError`:

| Status | `message` (user-facing) | `retryable` |
|---|---|---|
| 401 | "Sesi login sudah berakhir…" (diteruskan ke recovery interceptor) | false |
| 403 | server message atau "Anda tidak memiliki akses ke cabang ini…" | **false** (tidak auto-retry) |
| 404 | "Data tidak ditemukan." | false |
| 429 | "Terlalu banyak permintaan…" | true |
| 5xx | "Server sedang mengalami gangguan…" | true |
| network | "Koneksi bermasalah…" | true |

Helper: `getErrorStatus`, `getErrorMessage`, `isForbidden`, `isUnauthorized`, `normalizeApiError`.

Diterapkan ke: `dashboard`, `orders`, `payments`, `shifts`. Setiap halaman: 401 tidak dirender sebagai error widget (di-handle interceptor), 403/404 tidak menampilkan tombol "Coba Lagi" (hard error + hint pilih cabang), 429/5xx/network menampilkan tombol retry.

## 9. Dashboard Partial Failure

`dashboard/page.tsx` di-refactor: load **per-section** (`loadStats` / `loadRecentOrders`) via `Promise.allSettled`. Kegagalan satu bagian menampilkan error sendiri (`DashboardErrorBanner` + "Pesanan Terbaru" error + tombol Coba Lagi yang retryable-only), tidak mengosongkan seluruh dashboard.

## 10. Branch Selector Audit

`branch-selector.tsx`: `showSelector = session && visibleBranches.length > 1 && !isLoading` → **single-branch user (kasir Main Outlet) tidak melihat selector**, jadi tak bisa mengset branch yang salah. `setBranchId` hanya menulis localStorage saat user benar-benar memilih cabang, dan `useBranchContext` kini membersihkan nilai tak sah → nilai stale tak bisa bertahan.

## 11. Security Verification (server test port 3005)

```
=== 11a: MAIN OUTLET CASHIER — all endpoints ===
PASS  orders (no header) → 200      PASS  orders (Main) → 200
PASS  dashboard stats → 200         PASS  payments → 200
PASS  active shift → 200            PASS  tables → 200
PASS  stock → 200                   PASS  reports → 200

=== 11b: MAIN OUTLET tries FOREIGN branch (must stay blocked) ===
PASS  orders JKT → 403              PASS  stats BDG → 403
PASS  payments JKT → 403            PASS  active shift BDG → 403
PASS  stock JKT → 403               PASS  report JKT → 403

=== 11c: WORKING CASHIER (JKT) — no regression ===
PASS  orders JKT → 200              PASS  stats JKT → 200
PASS  payments JKT → 200            PASS  active shift JKT → 200
PASS  orders MainOutlet → 403       PASS  payments BDG → 403

=== 11d: CROSS-RESTAURANT (must stay blocked) ===
PASS  adminB orders RestoBahagia → 403
PASS  adminB own stats → 200
PASS  MainOutlet orders RestoB Bekasi → 403

RESULTS: 23 PASS, 0 FAIL
```

## 12. Error Handler Test

- 401: tidak dirender sebagai error widget; diteruskan ke mekanisme recovery existing (`src/lib/axios.ts` SESSION_COOKIE_NAMES + `authRecoveryInFlight`).
- 403: tidak auto-retry, tidak mengosongkan data → error eksplisit + hint.
- 429/5xx/network: retryable → tombol "Coba Lagi".
- Tidak ada redirect loop / infinite retry.

## 13. Regression & Build

- `npx tsc --noEmit` → **PASS** (0 error).
- `npm run build` / `npx next build` → **PASS**.
- ESLint file yang diubah → **0 error baru** (3 error `react-hooks/set-state-in-effect` + 2 warning sudah ada di versi pristine; tidak diperkenalkan oleh edit ini). Pre-existing `reports/page.tsx:96` tidak disentuh.
- Produksi tetap berjalan di **port 3001** (`next start -p 3001`); test memakai port 3005 (session sementara).

## 14. Files Changed

| File | Perubahan |
|---|---|
| `src/hooks/use-branch-context.ts` | **ROOT CAUSE fix** — hapus localStorage stale `admin_branch_id` kalau di luar branch user |
| `src/lib/api-error-handler.ts` | **BARU** — normalisasi error (401/403/404/429/5xx/network), `isUnauthorized`, `isForbidden` |
| `src/app/admin/dashboard/page.tsx` | gate branch context, load per-section (`Promise.allSettled`), partial-failure UI + retry |
| `src/app/admin/orders/page.tsx` | `normalizeApiError` + gate branch context + error UI retryable-only |
| `src/app/admin/payments/page.tsx` | `normalizeApiError` + gate branch context + error state UI |
| `src/app/admin/shifts/page.tsx` | `normalizeApiError` + gate branch context + error state UI |

## 15. Remaining Risks

- **Single source of truth tetap `UserBranch`** — fix ini tidak melemahkan otorisasi; `x-branch-id` tetap di-revalidasi server di tiap request.
- Nilai stale di browser user lama akan bersih otomatis di load pertama setelah deploy (satu 403 transien masih mungkin sebelum localStorage dibersihkan — ditangani jadi pesan error yang jelas, bukan halaman kosong).
- Dua instance `useBranchContext` (layout + page) masing-masing memanggil `/auth/session` → duplikasi fetch ringan; tidak ada masalah perilaku.

## 16. Verification Checklist

- [x] Root cause ter-reproduce (stale `admin_branch_id` → 403; tanpa header/correct header → 200)
- [x] localStorage stale dihapus otomatis saat session dimuat
- [x] Race guard: data fetch menunggu branch context resolve
- [x] Error handler front end (401/403/404/429/5xx/network), 403 tidak retry
- [x] Dashboard partial-failure
- [x] Branch selector aman untuk single-branch user
- [x] Security test 23/23 PASS (foreign branch & cross-restaurant tetap diblokir)
- [x] tsc PASS, build PASS, eslint 0 error baru