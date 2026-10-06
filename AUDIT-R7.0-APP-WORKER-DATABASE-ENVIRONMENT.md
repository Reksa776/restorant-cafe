# AUDIT R7.0 — APP ↔ WORKER DATABASE ENVIRONMENT (G1)

> Mode: **AUDIT ONLY (read-only)**. Tidak ada kode/config/DB yang diubah. Tidak ada full test/build.
> Tanggal: 2026-10-06 · Repo audit: `/home/reksa/restorant-cafe` @ `e756804`

## TEMUAN TERPENTING (koreksi atas asumsi audit sebelumnya)

1. **Container yang berjalan BUKAN dari repo ini.** Compose project = `restorant-cafe2`,
   config file = `/home/reksa/restorant-cafe2/docker-compose.yml`, working dir = `/home/reksa/restorant-cafe2`.
   Direktori itu adalah **clone terpisah dari repo yang sama** (`git@github.com:Reksa776/restorant-cafe.git`)
   tetapi berada di commit **lama `afaea19`**, sedangkan repo yang kita kembangkan ada di `e756804`.
2. **`DATABASE_URL` app dan worker SUDAH SAMA** — keduanya membaca `env_file: .env.docker`:
   `DATABASE_URL=mysql://restaurant:***@mariadb:3306/restaurant_app`.
   Jadi masalahnya **bukan** "app ≠ worker", melainkan **URL bersama itu menunjuk ke DB yang salah (basi)**.
3. `docker-compose.yml` **di repo yang diaudit TIDAK dipakai** (service `mysql` + `nginx`; stack itu tidak jalan).

---

## 1. CURRENT APP DB

| Proses | DATABASE_URL | Catatan |
| --- | --- | --- |
| Host dev / `npm run dev` / tests (`/home/reksa/restorant-cafe/.env`) | `mysql://root:***@localhost:3306/restaurant_app` | **native MariaDB 11.8.8** di host (bukan container), listen `0.0.0.0:3306` |
| Container `restaurant-app` (port 3001) | `mysql://restaurant:***@mariadb:3306/restaurant_app` (via `/home/reksa/restorant-cafe2/.env.docker`) | DB container |

## 2. CURRENT WORKER DB

| Proses | DATABASE_URL |
| --- | --- |
| Container `restaurant-worker` | `mysql://restaurant:***@mariadb:3306/restaurant_app` (**sama** dengan app container, dari `.env.docker` yang sama) |

⇒ **App container dan worker container sudah menunjuk DB yang identik** (`mariadb:3306`). Yang salah adalah DB itu sendiri.

## 3. SOURCE-OF-TRUTH DB

**HOST native MariaDB `localhost:3306/restaurant_app`.** Bukti pencocokan:

| Kriteria | HOST DB (`localhost:3306`) | DOCKER DB (`mariadb:3306`, host 3307) |
| --- | --- | --- |
| `_prisma_migrations` | **27 baris**; semua migrasi repo ter-`finished` | **TABEL TIDAK ADA** |
| `prisma migrate status` | **"Database schema is up to date!"** (exit 0) | tidak bisa (belum pernah dimigrasi) |
| Tabel `reservation` | **ADA** (+ `20260915_add_reservation`, `20260920_add_floor_layout`) | **TIDAK ADA** |
| Restaurants | **2** (termasuk `cmtois12y0000bzu8o894azsd` "Restoran Bahagia") | 1 (lama, `cmu1f14te…`) |
| Orders / Customers | **34 / 34** | 0 / 0 |
| Branches / Users | 2 / 4 | 2 / 3 |
| Tables / Products | 11 / 8 | 10 / 6 |
| WhatsAppSession | 1 baris | 0 |
| Sumber schema | **migration** (terkini) | `db push`/seed (tanpa baseline migration) |

DB host berisi **seluruh data development terkini** (Restoran Bahagia, cabang MAIN/PERUM-1, user admin/kasir,
34 order, dsb.) dan schema paling baru. Docker DB hanya berisi **data seed/demo lama**.

## 4. APAKAH DOCKER DB DISPOSABLE?

**Secara data: ya (praktis disposable).** Isinya hanya seed: 1 restoran lama, 2 cabang, 3 user, 6 produk,
10 meja, **0 order, 0 customer, 0 whatsappsession, 0 whatsappmessage**, tanpa tabel `reservation`.

**Namun sesuai aturan SAFETY: DB ini TIDAK akan direset/drop/dihapus.** Volume `restorant-cafe2_mariadb_data`
dibiarkan utuh (tidak ada `down -v`, tidak ada `DROP`/`migrate reset`). Pendekatan yang direkomendasikan
bahkan **tidak menyentuh DB docker sama sekali**.

## 5. SCHEMA/MIGRATION STATUS

- **HOST DB:** 21 migrasi repo semuanya ada & `finished`; `migrate status` = up to date. Terdapat 5 baris
  `finished_at IS NULL` yang **semuanya sudah `rolled_back_at`** (artefak percobaan gagal yang kemudian
  berhasil diterapkan ulang: `0_baseline`, `20260910_add_product_recommendations`, `20260911_add_ingredient_f1` ×3).
  Karena `rolled_back_at` terisi, Prisma menganggapnya *resolved* → **tidak ada blocker, tidak perlu migrasi apa pun**.
- **DOCKER DB:** **tidak punya `_prisma_migrations`** sedangkan tabel-tabelnya sudah ada (hasil `db push`).
  Menjalankan `prisma migrate deploy` di sini akan bentrok (`table already exists` / P3005 baseline) —
  bukan target yang aman tanpa baseline. (Tidak dilakukan.)

## 6. RISIKO DATA

| Opsi | Risiko data |
| --- | --- |
| **A. Worker lokal pakai DB host (rekomendasi)** | **Nol tulis DB.** Hanya `docker stop restaurant-worker` + menjalankan proses worker dari repo ini. |
| **B. Repoint container ke DB host** | **Nol tulis data** (hanya 1 user grant baru di host, aditif). Volume docker utuh. |
| **C. Pakai DB docker sebagai target** | Butuh baseline migrasi/reset → **DILARANG** oleh safety; data dev host jadi tidak terpakai. |
| Risiko residual opsi A/B | Dua worker/dua app berbagi Redis yang sama → **jangan** menjalankan worker docker dan worker lokal bersamaan (double-consume). App container lama (3001) sebaiknya juga dihentikan karena DB-nya berbeda. |

## 7. SOLUSI YANG DIREKOMENDASIKAN

**Rekomendasi utama — Opsi A: satukan pada HOST DB (source of truth) untuk local development.**

1. Hentikan worker lama (kode lama `afaea19` + DB basi): `docker stop restaurant-worker`.
2. Jalankan worker dari **repo ini** memakai `.env` repo (`localhost:3306` + Redis `localhost:6379`):
   `cd /home/reksa/restorant-cafe && npm run worker:dev`.
   → APP (dev) & WORKER memakai **DATABASE_URL yang sama** (`localhost:3306/restaurant_app`), schema sama,
   `restaurantId` reservasi ketemu, **tidak lagi `Restaurant not found`**.
   Bonus: worker menjalankan **kode terkini**, bukan kode `afaea19`.
3. (Disarankan) `docker stop restaurant-app` juga, agar app lama (3001, DB basi) tidak meng-enqueue job
   dengan `restaurantId` yang tidak ada di DB host → mencegah `Restaurant not found` jenis baru.

Keunggulan: **tanpa edit config, tanpa perubahan DB, tanpa risiko data**, dan langsung memenuhi target R7.0.
Tambahan: worker menjalankan **kode + Prisma Client terkini**, sedangkan Opsi B menjalankan kode lama
`afaea19` (Prisma Client lama) terhadap schema baru → risiko drift (lihat ADDENDUM §2).

**Alternatif — Opsi B (bila container wajib tetap jalan):** arahkan container ke DB host.
Docker → host terbukti bisa: gateway bridge `172.18.0.1:3306` **OPEN** dari dalam container
(`host.docker.internal` belum ada di container → perlu `extra_hosts` bila ingin memakai nama itu).
Perlu 1 user MariaDB scoped untuk subnet container (host DB hanya punya `root@localhost` + `reksa@%`).

## 8. EXACT FILES/CONFIG YANG PERLU DIUBAH

**Opsi A (rekomendasi): TIDAK ADA file yang diubah.** Hanya tindakan runtime (stop container + jalankan worker lokal).

**Opsi B:**
| File | Perubahan |
| --- | --- |
| `/home/reksa/restorant-cafe2/.env.docker` | `DATABASE_URL=mysql://restaurant:<pw>@172.18.0.1:3306/restaurant_app` (atau `host.docker.internal` + `extra_hosts`) |
| `/home/reksa/restorant-cafe2/docker-compose.yml` | (khusus `host.docker.internal`) tambah `extra_hosts: ["host.docker.internal:host-gateway"]` pada service `app` & `worker` |
| Host DB (user grant, aditif) | `CREATE USER 'restaurant'@'172.18.%'` + `GRANT ALL ON restaurant_app.*` |

Tidak ada perubahan pada: schema/migration, `src/**`, payment, reservation logic, QR, WhatsApp session/Baileys, queue.

## 9. EXACT COMMANDS (baru dijalankan SETELAH persetujuan)

**Opsi A (rekomendasi):**
```bash
docker stop restaurant-worker            # hentikan worker lama (kode afaea19 + DB basi)
docker stop restaurant-app               # opsional tapi disarankan (app lama 3001)
cd /home/reksa/restorant-cafe
npm run worker:dev                       # worker kode terkini → DB host + Redis 6379
```
Verifikasi (read-only):
```bash
# buat/trigger 1 reservasi dari dev app, lalu cek log worker:
#   HARUS TIDAK muncul lagi: "Restaurant <id> not found"
#   (boleh muncul "WhatsApp not connected ..." → itu G2, DI LUAR scope R7.0)
```

**Opsi B (alternatif):**
```bash
mariadb -uroot -p*** -e "CREATE USER IF NOT EXISTS 'restaurant'@'172.18.%' IDENTIFIED BY '<pw>';
  GRANT ALL PRIVILEGES ON restaurant_app.* TO 'restaurant'@'172.18.%'; FLUSH PRIVILEGES;"
# edit /home/reksa/restorant-cafe2/.env.docker  → DATABASE_URL=mysql://restaurant:<pw>@172.18.0.1:3306/restaurant_app
cd /home/reksa/restorant-cafe2
docker compose up -d --no-deps --force-recreate app worker    # TANPA -v, volume tidak disentuh
```

## 10. CARA ROLLBACK

| Opsi | Rollback |
| --- | --- |
| A | `docker start restaurant-worker` (+ `docker start restaurant-app`) dan hentikan worker lokal. Tidak ada state DB yang berubah. |
| B | Kembalikan baris `DATABASE_URL` di `.env.docker` ke `mysql://restaurant:***@mariadb:3306/restaurant_app`, lalu `docker compose up -d --no-deps --force-recreate app worker`. Opsional: `DROP USER 'restaurant'@'172.18.%'` (hanya user yang kita buat). **Tidak ada** perubahan volume/data. |

---

## LAMPIRAN — bukti perintah audit (semua read-only)

```
docker inspect restaurant-app|worker|mariadb|redis
  → project=restorant-cafe2 · config_files=/home/reksa/restorant-cafe2/docker-compose.yml
  → app:3001 · mariadb:3307→3306 · redis:6379 · worker (no ports)
git -C /home/reksa/restorant-cafe2 log --oneline -3      → afaea19 (kode lama)
git -C /home/reksa/restorant-cafe    log --oneline -1    → e756804 (repo yang dikembangkan)
cat restorant-cafe2/.env.docker → DATABASE_URL=mysql://restaurant:***@mariadb:3306/restaurant_app
                                 REDIS_URL=redis://redis:6379
host: mariadb -uroot -p*** -N -e "select @@port,@@version"  → 3306 · 11.8.8-MariaDB
host: show databases → restaurant_app (+ prisma_migrate_shadow_db)
host: select user,host from mysql.user → root@localhost, reksa@%
HOST  restaurant_app: _prisma_migrations=27 · migrate status="up to date!" (exit 0)
      restaurant=2 · order=34 · customer=34 · table=11 · product=8 · reservation=0 · whatsappsession=1
DOCKER restaurant_app: _prisma_migrations → "Table ... doesn't exist"
      restaurant=1 · order=0 · customer=0 · table=10 · product=6 · whatsappsession=0 · reservation table absen
docker exec restaurant-worker node (TCP) → 172.18.0.1:3306 = OPEN · host.docker.internal = ENOTFOUND
docker network inspect … → gateway 172.18.0.1
docker volume ls → restorant-cafe2_{mariadb_data,redis_data,whatsapp_data}  (dibiarkan utuh)
```

## ADDENDUM — penyelesaian checklist item 1 (Dockerfile, .env.example)

**1. Tidak ada auto-migrate di mana pun (aman).** Baik `Dockerfile` repo ini maupun
`Dockerfile`/`Dockerfile.worker` di `/home/reksa/restorant-cafe2` **tidak** menjalankan
`prisma migrate deploy` / `db push` / `seed` (CMD hanya `node server.js` / `npx tsx src/workers/whatsapp.worker.ts`).
Tidak ada entrypoint script migrasi (`docker/` hanya berisi `nginx.conf`).
⇒ Recreate container **tidak akan** menyentuh schema, dan **tidak ada** `migrate reset` di jalur mana pun.

**2. RISIKO BARU untuk Opsi B (material).** Image yang berjalan dibangun dari commit lama `afaea19`:
- `restorant-cafe2/Dockerfile` & `Dockerfile.worker` menjalankan `npx prisma generate` **saat build**,
  memakai schema `afaea19` → **Prisma Client di dalam container hanya mengenal schema LAMA**.
- Jumlah migrasi: cafe2 = **19**, repo ini = **21** (tidak ada `20260915_add_reservation` /
  `20260920_add_floor_layout` di cafe2).
⇒ Opsi B berarti menjalankan **kode lama + Prisma Client lama terhadap DB schema BARU**.
Karena migrasi setelahnya sebagian besar aditif, kemungkinan besar tetap jalan, tetapi
**schema-drift tetap risiko nyata** (kolom/tabel yang berubah bisa memicu error runtime pada
jalur yang memakai model tersebut). Ini **memperkuat rekomendasi Opsi A** (worker dari repo ini,
kode & Prisma Client terkini, hanya membaca DB host).

**3. `.env.example` repo ini** menetapkan `DATABASE_URL="mysql://root:password@localhost:3306/restaurant_app"`
(host DB sebagai target dev) dan `WHATSAPP_SESSION_DIR` sebagai variabel kanonik — konsisten dengan
kesimpulan §3 (host DB = source of truth). Repo ini **tidak** punya `.env.docker`; file itu hanya ada di cafe2.

## SCOPE GUARD

Sesuai instruksi: **G2 (session ownership), migration `Reservation`, cleanup dead code, dan perubahan
reservation logic TIDAK dikerjakan.** Acceptance R7.0 berhenti pada:
`APP & WORKER → DATABASE_URL sama → schema sama → restaurantId ditemukan → tidak ada "Restaurant not found"`.
Pengiriman pesan yang sebenarnya masih menunggu G2 (`WhatsApp not connected`) dan itu **di luar R7.0**.
