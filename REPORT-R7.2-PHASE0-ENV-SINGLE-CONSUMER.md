# REPORT R7.2 — PHASE 0: ENV + SINGLE WHATSAPP WORKER CONSUMER

> Mode: **Phase 0 (environment/process preparation only)**. Tidak ada ownership Baileys yang dipindah,
> tidak ada connect/QR/pairing/send, tidak ada schema/migration/DB/Redis-application-key baru, tidak ada commit/push/deploy.
> Tanggal: 2026-10-07 · Repo aktif: `/home/reksa/restorant-cafe`
> Referensi: `AUDIT-R7.1-WHATSAPP-SESSION-OWNERSHIP.md` (disetujui), `AUDIT-R7.0-APP-WORKER-DATABASE-ENVIRONMENT.md` (G1 PASS).
> **Baileys ownership TIDAK dipindah** — web masih owner pada akhir Phase 0. Phase 1 belum dimulai.

---

## 1. FILES CHANGED

| File | Perubahan | Tracked di git? |
| --- | --- | --- |
| `package.json` | `worker:dev` diberi `--env-file=.env`; **ditambah** `worker:start` (`--env-file-if-exists=.env`) | **Ya** (modified) |
| `.env.example` | Dokumentasi presedensi `WHATSAPP_SESSION_DIR \|\| WHATSAPP_SESSION_PATH \|\| "/app/whatsapp-session"` + alias PATH dibuat komentar (tidak aktif) | **Ya** (modified) |
| `.env` | Tambah `WHATSAPP_SESSION_DIR="./whatsapp-session"` (kanonik); baris `WHATSAPP_SESSION_PATH` **dikomentari** (alias tetap terdokumentasi, tidak aktif) | **Tidak** — `.env` ada di `.gitignore` (`.gitignore:3`) sehingga perubahan ini **lokal saja** dan tidak muncul di `git diff` |
| `REPORT-R7.2-PHASE0-ENV-SINGLE-CONSUMER.md` | Dokumen ini (deliverable) | Tidak (untracked) |

Diff yang tracked:

```diff
-    "worker:dev": "tsx src/workers/whatsapp.worker.ts"
+    "worker:dev": "tsx --env-file=.env src/workers/whatsapp.worker.ts",
+    "worker:start": "tsx --env-file-if-exists=.env src/workers/whatsapp.worker.ts"
```

```diff
 # WhatsApp (Baileys)
 # Canonical session-dir variable (M8). WHATSAPP_SESSION_PATH is still honored
 # as a legacy alias by the Baileys provider, but new configs should use DIR.
+# Precedence in the provider:
+#   WHATSAPP_SESSION_DIR || WHATSAPP_SESSION_PATH || "/app/whatsapp-session"
+# Do not set both: keep WHATSAPP_SESSION_DIR active and leave PATH unset.
 WHATSAPP_SESSION_DIR="./whatsapp-session"
+# Legacy alias (kept for compatibility only; DIR wins when both are set):
+# WHATSAPP_SESSION_PATH="./whatsapp-session"
```

`.env` sebelum → sesudah (nilai non-secret; file ini gitignored):

```diff
 # WhatsApp (Baileys)
-WHATSAPP_SESSION_PATH="./whatsapp-session"
+# WhatsApp (Baileys)
+# Canonical session directory. The Baileys provider resolves
+#   WHATSAPP_SESSION_DIR || WHATSAPP_SESSION_PATH || "/app/whatsapp-session"
+# so DIR takes precedence; PATH is kept below only as a documented legacy
+# alias (not active). Phase 0 (R7.2) makes the WORKER's path deterministic --
+# the web process is still the Baileys owner until Phase 1.
+WHATSAPP_SESSION_DIR="./whatsapp-session"
+# Legacy alias -- kept for compatibility, NOT active (canonical DIR above wins):
+# WHATSAPP_SESSION_PATH="./whatsapp-session"
```

**Tidak diubah** (sesuai larangan): `src/services/whatsapp/session-manager.ts`, `providers/baileys/*`,
`src/workers/whatsapp.worker.ts`, semua route `/api/whatsapp/*`, `prisma/schema.prisma`, migration,
`docker-compose.yml`, `Dockerfile`, `Dockerfile.worker`, template pesan, job semantics BullMQ.

> Catatan transparansi: verifikasi env **hanya** mencetak boolean/path. Satu probe audit awal menampilkan
> baris-baris `.env` dengan masking hanya untuk `REDIS_URL`, sehingga value variabel lain (termasuk satu API
> key non-WhatsApp) sempat terlihat di output terminal sesi ini. Value tersebut **tidak** ditulis ke file
> mana pun, **tidak** di-commit, **tidak** dikirim ke mana pun, dan **tidak** diulang di laporan ini.

---

## 2. WORKER STARTUP COMMAND

| Keperluan | Command | Environment loading |
| --- | --- | --- |
| Dev / native (Phase 0–1) | `npm run worker:dev` → `tsx --env-file=.env src/workers/whatsapp.worker.ts` | `.env` repo dimuat eksplisit lewat flag Node `--env-file` (tsx meneruskan ke Node) |
| Native/production tanpa `.env` (env dari shell/orchestrator) | `npm run worker:start` → `tsx --env-file-if-exists=.env src/workers/whatsapp.worker.ts` | Jika `.env` ada → dimuat; jika tidak → memakai env proses (tidak hard-fail) |
| Docker (production, **tidak diubah**) | `CMD ["npx","tsx","src/workers/whatsapp.worker.ts"]` (`Dockerfile.worker`) | Env disuntik oleh `docker-compose.yml` (`environment:` blok worker) — **tidak menyentuh deployment** |

Verifikasi dukungan flag (sebelum mengubah script):

```
npx tsx --env-file=.env -e '...'            → EXIT 0   (DUARA: DATABASE_URL SET, REDIS_URL SET)
npx tsx --env-file-if-exists=.env -e '...'  → EXIT 0
```

Log startup nyata (setelah perubahan):

```
> restaurant-app@0.1.0 worker:dev
> tsx --env-file=.env src/workers/whatsapp.worker.ts

[WhatsApp Worker] Starting worker...
[WhatsApp Worker] Worker is ready and listening for jobs
```

**Blocker lama hilang:** `grep -c "DATABASE_URL environment variable is not set"` pada log = **0**.

---

## 3. ENVIRONMENT LOADING

Akar masalah lama: `tsx` **tidak** memuat `.env` otomatis (berbeda dari Next.js yang memuat `.env` sendiri),
sementara `npm run worker:dev` sebelumnya memanggil `tsx` tanpa flag env → `DATABASE_URL` unset → `@/lib/prisma`
throw `"DATABASE_URL environment variable is not set"`, dan `WHATSAPP_SESSION_DIR`/`PATH` juga unset sehingga
provider jatuh ke fallback absolut `/app/whatsapp-session`.

Perbaikan minimal: **hanya flag CLI** pada script (tidak ada config loader baru, tidak mengubah kode worker).

Hasil resolusi env dengan flag yang sama dengan `worker:dev` (hanya boolean/path, tanpa value):

| Variabel | Status |
| --- | --- |
| `DATABASE_URL` | **SET** |
| `REDIS_URL` | **SET** |
| `WHATSAPP_SESSION_DIR` | **SET** |
| `WHATSAPP_SESSION_PATH` (alias lama) | MISSING (dikomentari — memang diniatkan) |

Presedensi kode provider tidak diubah: `WHATSAPP_SESSION_DIR || WHATSAPP_SESSION_PATH || "/app/whatsapp-session"`.
Dengan `DIR` aktif dan `PATH` tidak aktif, hasilnya **deterministik** dan tidak ada dua variabel yang sama-sama aktif.

---

## 4. WHATSAPP_SESSION_DIR DECISION

**Keputusan:** `WHATSAPP_SESSION_DIR="./whatsapp-session"` (native development) sebagai **satu-satunya variabel aktif**.

**Compatibility decision (Phase 0):**
- Alias `WHATSAPP_SESSION_PATH` **tidak dihapus dari kode** (provider masih menghormatinya) — penghapusan alias
  ditunda, sesuai instruksi Phase 0.
- Di `.env` alias tersebut **dikomentari** (tetap ada di file sebagai dokumentasi) supaya tidak ada dua variabel
  yang sama-sama aktif. Karena `DIR` menang atas `PATH` di kode, menonaktifkan alias **tidak mengubah hasil**
  (keduanya menunjuk path yang sama).
- `.env.example` kini menyatakan presedensi + bucket aturan "jangan set keduanya".

**Resolusi path (deterministik, diverifikasi):**

| Konteks | Sebelum Phase 0 | Sesudah Phase 0 |
| --- | --- | --- |
| Web (Next.js) | `<repo>/whatsapp-session` | `<repo>/whatsapp-session` (tidak berubah) |
| **Worker native (`worker:dev`)** | **`/app/whatsapp-session`** (fallback absolut — bocor) | **`/home/reksa/restorant-cafe/whatsapp-session`** |
| Path contoh | — | `/home/reksa/restorant-cafe/whatsapp-session/restaurant-<restaurantId>` |

**Ownership (WAJIB dicatat):** Phase 0 **tidak** memindahkan kepemilikan socket. Web **masih owner Baileys**.
Direktori `./whatsapp-session` **belum dibuat** dan **tidak** dibuka oleh siapa pun selama Phase 0
(lihat §10 bukti: direktori tidak ada, worker tidak membuat socket). Pada **Phase 1**, worker akan mengambil
alih ownership dan pada saat itulah web harus berhenti memakai direktori tersebut — sampai itu terjadi,
tidak ada dua proses yang membuka session yang sama.

---

## 5. ACTIVE WORKER PROCESS

Dijalankan dari repo aktif: `cd /home/reksa/restorant-cafe && npm run worker:dev` (log: `/tmp/r72-phase0-worker.log`).

| Item | Nilai |
| --- | --- |
| PID npm | `65404` |
| PID tsx wrapper | `65416` |
| **PID proses worker (node)** | **`65427`** |
| Command | `node .../tsx --env-file=.env src/workers/whatsapp.worker.ts` |
| Working directory | `/home/reksa/restorant-cafe` |
| Queue | `whatsapp` |
| Status saat laporan | **running (idle; wait=0 active=0 prioritized=0 delayed=0)** |

Proses pendukung: `npm run worker:dev` (65404) → `node …/.bin/tsx` (65416) → `node … --env-file=.env src/workers/whatsapp.worker.ts` (65427) = **satu worker logis**.

> Catatan: `pgrep -f "whatsapp.worker.ts" | wc -l` bisa menampilkan angka lebih besar **hanya** karena shell
> yang menjalankan probe ikut cocok dengan pola. Hitungan otoritatif konsumer ada di §9 (BullMQ `getWorkers()` = 1).

Cara menghentikan: `kill 65404` (atau `pkill -f "src/workers/whatsapp.worker.ts"`). Cara menjalankan lagi: `npm run worker:dev`.

---

## 6. DOCKER WORKER STATUS

| Container | Status |
| --- | --- |
| `restaurant-worker` | **Exited (0)** — 20 jam lalu. **Tetap STOPPED** (sesuai acceptance; konsumer adalah worker native repo ini) |
| `restaurant-app` | `Exited (143)` — **tidak disentuh** (start/stop tidak diperlukan) |

Tidak ada worker dari clone `restorant-cafe2` yang dijalankan; tidak ada `docker start`, tidak ada `docker compose up`, volume tidak disentuh.

---

## 7. REDIS STATUS

| Item | Nilai |
| --- | --- |
| Container | `restaurant-redis` — **Up 3 hours (healthy)** → KEEP RUNNING ✔ |
| Koneksi | `PING` → `PONG` (tanpa auth) |
| BullMQ version (meta) | `bullmq:6.3.2` |
| Queue | hanya `whatsapp` (consumer); queue lain (`inventory`, dll.) hanya punya `meta` |

**Baseline (sebelum worker dijalankan) → Sesudah Phase 0:**

| Key/state | Sebelum | Sesudah |
| --- | --- | --- |
| `bull:whatsapp:wait` | 0 | 0 |
| `bull:whatsapp:active` | 0 | 0 |
| `bull:whatsapp:prioritized` | **133** | **0** |
| `bull:whatsapp:delayed` | 0 | 0 |
| `bull:whatsapp:failed` | 50 (cap) | 50 (cap) |
| `bull:whatsapp:completed` | 0 | 0 |
| Hash job (`bull:whatsapp:<jobId>`) | ±190 | 50 |
| Fixed keys | events, failed, id, marker, meta, pc, prioritized | events, failed, id, meta, **stalled-check** |
| Total `bull:*` (semua queue) | 195 | 60 |

**Penjelasan wajib (jujur):** menjalankan consumer memicu lifecycle internal BullMQ. 133 job `prioritized`
yang menumpuk **drain** dan berakhir `failed`. Log worker: **399 attempt** untuk 133 job (tepat 3 attempt/job
sesuai `attempts: 3`), **semuanya** gagal dengan `"Restaurant <restaurantId> not found"`
(`cmuxl7d6k0000wuivn3rkj3bk`, `cmuxl890r0000c8ivnutvgv3o9`, dst. — **restaurant fixture QA yang sudah dihapus**
oleh sesi pengujian Phase 1 sebelumnya). ⇒ **Tidak ada notifikasi nyata/produksi yang hilang**; yang terbuang
adalah sampah uji. Job `reservation-*` yang benar-benar milik restoran produksi
(`cmtois12y0000bzu8o894azsd`) tidak ikut ter-drain karena memang tidak ada di antrean (hanya 1 job-nya yang
sudah gagal di baseline G2).

**Key aplikasi baru: TIDAK ADA.** Tidak ada key QR/session/lock/status. Perubahan hanya lifecycle internal
BullMQ (`prioritized`/`marker`/`pc` hilang karena antrean kosong, `stalled-check` muncul karena ada worker aktif).
Tidak ada key yang dibuat manual.

---

## 8. MARIADB STATUS

| Item | Nilai |
| --- | --- |
| Container | `restaurant-mariadb` — **Up 3 hours (healthy)** → KEEP RUNNING ✔ |
| DB yang dipakai worker | **DB host yang sama dengan app** (`.env` repo: `localhost:3306/restaurant_app`) — konsisten dengan kesimpulan R7.0/G1 |
| Query worker saat start | Worker berhasil `prisma.restaurant.findUnique(...)` (bukti: kegagalan berhenti di tahap `send_message`, bukan di koneksi DB) |
| Tulis DB | **NOL.** `whatsappmessage` = **0** baris (sebelum & sesudah), `whatsappsession` = **1** baris (tidak berubah: baris `ERROR` lama dari 2026-09-09) |
| Schema/migration | **Tidak ada** perubahan; `prisma/schema.prisma` tidak disentuh |

---

## 9. QUEUE CONSUMER COUNT

| Metrik | Nilai | Cara ukur |
| --- | --- | --- |
| Konsumer terdaftar pada queue `whatsapp` | **1** | `new Queue("whatsapp").getWorkers()` (BullMQ, read-only) → `[{ name: "whatsapp", addr: "172.18.0.1:40750" }]` |
| Worker native (repo aktif) | **1** (1 worker logis) | proses §5 |
| Worker docker (`restaurant-worker`) | 0 (Exited) | `docker ps -a` |
| Worker dari `restorant-cafe2` | 0 | tidak dijalankan |
| PM2 | tidak terpasang | `command -v pm2` |
| Duplikat native | **tidak ada** | `ps`/`pgrep` sebelum & sesudah start |

⇒ **Exactly one active WhatsApp worker consumer.** Redis & MariaDB tetap running; DB container tidak disentuh.

---

## 10. VERIFICATION

Semua dijalankan **hanya** verifikasi yang relevan Phase 0 (sesuai STEP 10). `npx tsc --noEmit`, `npm run build`,
dan full test suite **tidak dijalankan** (tidak ada perubahan perilaku source selain startup/env).

| # | Verifikasi | Perintah | Hasil |
| --- | --- | --- | --- |
| 1 | Worker startup | `npm run worker:dev` (BACKGROUND) | `[WhatsApp Worker] Starting worker...` + `Worker is ready and listening for jobs` |
| 2 | `DATABASE_URL` unset hilang | `grep -c "DATABASE_URL environment variable is not set" /tmp/r72-phase0-worker.log` | **0** |
| 3 | Env presence (boolean) | `tsx --env-file=.env -e '…'` | `DATABASE_URL: SET`, `REDIS_URL: SET`, `WHATSAPP_SESSION_DIR: SET`, `PATH: MISSING` |
| 4 | Session path deterministik | resolusi `DIR \|\| PATH \|\| "/app/..."` | `/home/reksa/restorant-cafe/whatsapp-session` (bukan lagi `/app/whatsapp-session`) |
| 5 | Process count | `ps` + `/proc/<pid>/cwd` | 1 worker logis, cwd `/home/reksa/restorant-cafe`, cmd memuat `--env-file=.env` |
| 6 | Queue consumer count | BullMQ `getWorkers()` | **1** |
| 7 | **Tidak ada socket Baileys** | `grep -cE '\[Baileys\]\|QR\|creds' log` | **0** |
| 8 | **Tidak ada QR** | idem + tidak ada direktori session | **0 / tidak ada** |
| 9 | **Tidak ada session dir dibuat** | `ls whatsapp-session` | `No such file or directory` |
| 10 | **Tidak ada pesan terkirim** | `whatsappmessage` count | **0** (tidak berubah) |
| 11 | **Tidak ada DB write** | `whatsappmessage`=0, `whatsappsession`=1 | tidak berubah |
| 12 | Docker worker tetap stopped | `docker ps -a` | `restaurant-worker  Exited (0)` |
| 13 | Redis & MariaDB running | `docker ps` | keduanya **Up (healthy)** |
| 14 | Tidak ada key aplikasi Redis baru | `keys bull:whatsapp:*` | hanya key internal BullMQ; tidak ada QR/session/lock |
| 15 | Whitespace/conflict check | `git diff --check` | **EXIT 0** |
| 16 | Tidak commit / push / deploy | `git log --oneline -1`, `git status` | HEAD tetap `70226bc`; tidak ada staging/commit/push |

STEP 9 (no functional WhatsApp test) dipatuhi: **tidak** connect, **tidak** scan QR, **tidak** kirim pesan,
**tidak** membuat reservasi/order, **tidak** memicu notifikasi. Satu-satunya aktivitas WhatsApp adalah
konsumer yang memproses **job lama yang sudah ada** — dan semua gagal sebelum menyentuh socket (§7).

### ACCEPTANCE CRITERIA

- [x] `npm run worker:dev` tidak lagi gagal karena `DATABASE_URL` unset
- [x] `DATABASE_URL` loaded
- [x] `REDIS_URL` loaded
- [x] `WHATSAPP_SESSION_DIR` deterministik (`/home/reksa/restorant-cafe/whatsapp-session`)
- [x] canonical env variable documented (`.env`, `.env.example`, laporan ini)
- [x] tidak ada duplicate WhatsApp worker (1 konsumer; docker worker stopped)
- [x] `restaurant-worker` Docker tetap stopped
- [x] `restaurant-redis` tetap running
- [x] `restaurant-mariadb` tetap running
- [x] tidak ada Baileys socket dibuat (0 baris `[Baileys]`)
- [x] tidak ada QR generated
- [x] tidak ada WhatsApp message sent (`whatsappmessage` = 0)
- [x] tidak ada DB/schema/migration change
- [x] tidak ada Redis application key baru
- [x] `git diff --check` PASS (EXIT 0)
- [x] tidak commit · [x] tidak push · [x] tidak deploy

### ROLLBACK (bila diperlukan)

1. `package.json`: kembalikan `"worker:dev": "tsx src/workers/whatsapp.worker.ts"` dan hapus `worker:start`.
2. `.env.example`: hapus blok presedensi + kembalikan baris `WHATSAPP_SESSION_PATH` aktif (opsional).
3. `.env` (gitignored): kembalikan ke `WHATSAPP_SESSION_PATH="./whatsapp-session"` dan hapus `WHATSAPP_SESSION_DIR`.
4. Hentikan worker: `kill 65404`.
Tidak ada rollback DB, tidak reset Docker volume, tidak menghapus session WhatsApp (tidak ada yang dibuat).

---

## 11. REMAINING RISKS

| Risiko | Tingkat | Catatan / mitigasi |
| --- | --- | --- |
| Web **masih** owner Baileys (G2 belum diperbaiki) | **Tinggi (diketahui)** | Sesuai desain Phase 0; `send_message` masih akan gagal `"WhatsApp not connected"`. Diselesaikan di Phase 1 |
| Worker kini memakai path session yang **sama** dengan web (`./whatsapp-session`) | Sedang | Aman **selama** Phase 0 karena worker tidak pernah membuat socket (terbukti: direktori tidak dibuat, 0 baris Baileys). **Wajib** dipastikan satu owner sebelum worker menjalankan `connect`/`restoreSessions` (Phase 1) — jangan pernah membiarkan web & worker membuka `creds.json` yang sama |
| 133 job lama ter-drain menjadi `failed` | Rendah | Semuanya job QA/uji dengan restoran yang sudah dihapus (399 attempt, 100% `Restaurant <id> not found`). Tidak ada notifikasi produksi yang hilang. `jobId` dedup membuat job lama tidak bisa di-enqueue ulang — tidak relevan karena datanya sudah tidak ada |
| `bull:whatsapp:failed` mentok di cap 50 | Rendah | Kegagalan baru bisa mendorong keluar riwayat lama. Visibilitas kegagalan belum ada di UI (temuan R7.1 §7) — kandidat Phase 1/4 |
| Worker native tidak auto-start (tidak ada systemd/pm2) | Sedang | Restart VPS → worker harus dijalankan manual (`npm run worker:dev`). Phase 1 perlu keputusan supervisor (systemd/pm2) — **di luar** Phase 0 |
| `.env` gitignored | Rendah | Konfigurasi kanonik hanya ada di `.env.example` (tracked) + komentar `.env` lokal. Operator baru harus menyalin dari `.env.example` |
| `.env` berisi secret non-WhatsApp | Rendah | Tidak ada secret yang tertulis ke file/report; verifikasi memakai boolean/path saja |
| `worker:start` adalah script baru | Rendah | Aditif; tidak mengubah deployment (Dockerfile.worker & compose tidak disentuh) |

---

## 12. R7.2 PHASE 1 READINESS

Prasyarat Phase 0 → **terpenuhi:**

- [x] Worker bisa start dari repo aktif tanpa error env.
- [x] `DATABASE_URL` + `REDIS_URL` + `WHATSAPP_SESSION_DIR` deterministik.
- [x] Tepat satu konsumer queue `whatsapp` (worker docker tetap stopped; Redis/MariaDB running).
- [x] Tidak ada socket/QR/pesan yang dibuat selama Phase 0.
- [x] Baseline Redis tercatat (§7) untuk membandingkan Phase 1.
- [x] Worker idle & siap menerima job (wait=0, active=0).

Yang **belum** dan memang menjadi pekerjaan Phase 1 (di luar Phase 0):

1. Worker memanggil `restoreSessions()` saat boot (R7.1 §10).
2. Worker menjadi owner `connect`/`disconnect`/`reconnect` → route web hanya enqueue
   (`queueWhatsAppConnect`/`queueWhatsAppDisconnect` — sudah ada, 0 pemanggil).
3. `provider.onQrCode` → publish QR ke Redis ber-TTL pendek; `/api/whatsapp/qr` membaca Redis.
4. `/api/whatsapp/status` membaca status dari DB (bukan memori provider).
5. **Handoff ownership**: web berhenti membuat socket → pada saat itu worker menjadi **satu-satunya** pemakai
   `./whatsapp-session` (menutup risiko baris 2 di §11).
6. Pairing WhatsApp (diizinkan hanya setelah Phase 1) + verifikasi Order READY & Reservation notification.

Status Phase 0: **PASS** — berhenti di sini, menunggu persetujuan sebelum Phase 1.
