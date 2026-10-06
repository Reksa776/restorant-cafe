# AUDIT — PHASE R7: WHATSAPP RESERVATION NOTIFICATION

> Mode: **AUDIT ONLY (read-only)**. Tidak ada kode diubah, tidak ada migration, tidak ada test/build dijalankan.
> Tanggal audit: 2026-10-06 · Branch: `main` · HEAD: `e756804`

## RINGKASAN EKSEKUTIF (baca ini dulu)

**Premis tugas ini sudah sebagian selesai.** Reservation → WhatsApp **SUDAH terhubung** ke
existing WhatsApp engine (BullMQ → worker → Baileys) dan **sudah aktif** — diimplementasikan
di commit sebelumnya (`reservation-whatsapp.ts`, `queueWhatsAppReservation`, dan
`notifyReservationWhatsApp` di `reservation.service.ts`).

Bukti runtime (payload nyata, bukan asumsi):

```
bull:whatsapp:reservation-<id>-PENDING
  data    : {"restaurantId":"...","type":"send_message","to":"6281399990002",
             "message":"Halo QA R65 E2E,\n\nReservasi Anda telah kami terima dengan
             kode R-HUEB6IPF...\n- Cabang: Main Outlet (MAIN)...\n- Status: Menunggu..."}
  atm     : 3   (3 percobaan, exponential backoff)
  failedReason: "Restaurant cmtois12y0000bzu8o894azsd not found"
```

Jadi masalahnya **BUKAN "belum ada notifikasi reservasi"**, melainkan:

1. **G1 — DB/lingkungan terpecah**: worker membaca database yang berbeda dari tempat
   reservasi dibuat → setiap job mati dengan `Restaurant ... not found`.
2. **G2 — session Baileys dimiliki proses yang salah** (web vs worker) → walau DB cocok,
   `sendMessage` tetap gagal (`WhatsApp not connected`).
3. **G3/G4 — tidak ada penanda durabilitas/idempotency di `Reservation`** dan kegagalan
   di-*prune* diam-diam (`removeOnFail: {count:50}`).

Kondisi nyata saat audit: `failed = 50`, `wait = 0`, **`completed = 0`** → **belum pernah ada
satu pun WhatsApp yang berhasil terkirim** (order maupun reservasi). Order READY memakai
pipeline yang sama, jadi ikut rusak.

---

## 1. EXISTING WHATSAPP FUNCTIONALITY

| Layer | File | Status |
| --- | --- | --- |
| Queue producer | `src/services/whatsapp/whatsapp.queue.ts` | BullMQ queue `whatsapp` (Redis `@/lib/redis`); `attempts:3`, backoff exponential 1000ms, `removeOnComplete:{count:100}`, `removeOnFail:{count:50}` |
| Worker/consumer | `src/workers/whatsapp.worker.ts` | `new Worker("whatsapp", …, {concurrency:5})`, koneksi IORedis standalone; handle `send_message` / `connect` / `disconnect`; `send_message` → validasi `restaurant` ada → `sessionManager.sendMessage` → tulis `WhatsAppMessage` (OUTGOING, `status:"sent"`) |
| Session manager | `src/services/whatsapp/session-manager.ts` | 1 provider per restoran **per proses** (`Map` in-memory); `connect/disconnect/getStatus/getQrCode/refreshQr/forceReconnect/sendMessage/isConnected/restoreSessions` |
| Baileys provider | `providers/baileys/baileys.provider.impl.ts` | `useMultiFileAuthState`, dir `WHATSAPP_SESSION_DIR \|\| WHATSAPP_SESSION_PATH \|\| /app/whatsapp-session`, path `restaurant-<id>/creds.json`; `sendMessage` **throw** bila socket tidak `CONNECTED` |
| Client wrapper | `src/services/whatsapp.service.ts` | axios tipis ke `/api/whatsapp/*` (dipakai halaman admin) |
| Admin API | `src/app/api/whatsapp/{connect,disconnect,status,qr,reconnect}/route.ts` | **memanggil `whatsappSessionManager` LANGSUNG di proses web** (bukan lewat queue) |
| Admin UI | `src/app/admin/whatsapp/page.tsx` | QR, status, dan angka antrian (waiting/active/completed/failed) |
| Model | `WhatsAppMessage` (schema.prisma L1201), `WhatsAppSession` (L1231), `Notification` (L1249) | ada |
| Process manager | `Dockerfile.worker` + service `worker` di `docker-compose.yml`; `npm run worker:dev` (`tsx src/workers/whatsapp.worker.ts`) | **Docker, bukan PM2** (tidak ada `ecosystem.config.js`/pm2 di dependency) |

Yang **benar-benar dipakai** hari ini hanya **2 jalur**:
1. **Order READY** → `queueWhatsAppNotification` (idempotency `notifiedAt` di Order + jobId `notification-<orderNumber>`).
2. **Reservation** → `queueWhatsAppReservation` (lihat §2).

Yang **dead code / belum tersambung** (penting, jangan dikira sudah jalan):
- `queueWhatsAppMessage` (L37) — tidak ada pemanggil.
- `queueWhatsAppConnect` (L142) & `queueWhatsAppDisconnect` (L164) — **tidak ada pemanggil**; handler `connect`/`disconnect` di worker jadi tidak pernah tereksekusi.
- `whatsappService.sendOrderReceived/Confirmed/PaymentRequest/PaymentSuccess/Processing/Completed/Cancelled` — **0 pemanggil**.
- `message.parser.ts#parseMessage` — 0 pemanggil.
- `notification.create` — 0 penulis (model `Notification` tidak terpakai).
- **Payment WhatsApp: TIDAK ada** (bertentangan dengan asumsi "existing payment WhatsApp notification").

---

### 1b. Checklist jawaban audit yang diminta

| Pertanyaan audit | Jawaban | Bukti |
| --- | --- | --- |
| `src/services/whatsapp/*` | Ada: `whatsapp.queue.ts`, `session-manager.ts`, `message.parser.ts` (mati), `providers/baileys/*`, `whatsapp.service.ts` (mati) | `ls src/services/whatsapp/` |
| Model `WhatsAppMessage` | **Ada** (L1201) — dipakai, tetapi `status` selalu `sent`; `failed/delivered/read` tidak pernah ditulis | schema.prisma |
| Model notification/queue | `Notification` **ada tapi 0 penulis**; **tidak ada** model antrian — antrian = Redis/BullMQ, bukan DB | `grep notification.create` → 0 |
| BullMQ | **Ya** (`bullmq ^6.3.2`), queue `whatsapp`, Redis `@/lib/redis` | package.json, `whatsapp.queue.ts` |
| WhatsApp notifier | **Ya** — `dispatchReservationWhatsApp` (reservasi) + enqueue order READY | §2, order.service L1558 |
| Baileys integration | **Ya** — `@whiskeysockets/baileys ^7.0.0-rc14`, `providers/baileys/baileys.provider.impl.ts` (`useMultiFileAuthState`) | package.json |
| Worker process | **Ya** — `src/workers/whatsapp.worker.ts`; container `restaurant-worker` **Up** & mengonsumsi job | `docker logs restaurant-worker` |
| PM2 | **TIDAK ada** (tidak ada `ecosystem.config.*`/dependency pm2). Proses dijalankan via **Docker** (`Dockerfile.worker` + service `worker`) atau `npm run worker:dev` (tsx) | repo root, docker-compose |
| API `/notify` | **TIDAK ADA endpoint `/notify`** (tidak pernah ada / tidak dipakai). Yang mengandung "notify" hanya: `notifyUrl` webhook iPaymu, `notifyShiftNotOpen` (UI), dan event internal Baileys `"notify"` | grep `notify` → tidak ada route |
| Order WhatsApp existing | **Ya, hanya pada status READY** (+ penanda DB `Order.notifiedAt`); status lain (PAID/PROCESSING/COMPLETED/dll) **tidak** mengirim | order.service.ts L1558 |
| Payment WhatsApp existing | **TIDAK tersambung** — method `sendPaymentRequest/Success` ada tapi **0 pemanggil** | grep → 0 |
| Reservation WhatsApp existing | **SUDAH ADA & aktif** (R7) | §2 + payload job BullMQ |
| Producer & consumer aktif? | **Keduanya aktif**: producer terbukti (job ter-enqueue dari app), consumer terbukti (worker log memproses + retry) | §3, Lampiran |
| Notifikasi bisa hilang bila worker mati? | **Ya.** Job tetap tersimpan di Redis, tetapi tanpa worker tidak ada pengirim; **tidak ada alert**. Bila Redis mati saat enqueue, `dispatchReservationWhatsApp` menelan error → **hilang senyap** (hanya log) | `dispatch…` catch |
| Duplicate notification path? | **Tidak ada duplikasi aktif.** Jalur aktif: order (`notification-<orderNumber>`) & reservasi (`reservation-<id>-<status>`). Duplikasi mungkin bila enqueue ulang terjadi **setelah** jobId ter-prune; jalur lain (connect/disconnect, sendOrder*, parser) mati | §10 |

## 2. EXISTING RESERVATION NOTIFICATION FUNCTIONALITY (SUDAH ADA)

| Bagian | Lokasi | Keterangan |
| --- | --- | --- |
| Message builder (pure) | `src/services/reservation/reservation-whatsapp.ts` → `buildReservationWhatsAppMessage` | Template per status: PENDING, CONFIRMED, CANCELLED (+`cancelReason`), SEATED, COMPLETED, NO_SHOW, default. Memakai helper display R4 (`formatReservationDate`, `formatTimeSlot`, `RESERVATION_STATUS_LABELS`) |
| Target resolver (pure) | `resolveReservationWhatsAppTarget` | Primer `guestPhone` → fallback `customer.phone`; `normalizePhone`; menolak placeholder `guest-*` |
| Dispatcher | `dispatchReservationWhatsApp` | `never throws` (best-effort, `catch` + `console.error`), lookup `restaurant.name`, lalu enqueue |
| Test seam | `reservationWhatsAppGateway.enqueue` | dipakai unit test untuk memaksa kegagalan enqueue |
| Queue | `queueWhatsAppReservation` | jobId **`reservation-<reservationId>-<status>`** (idempotency per event lifecycle) |
| Pemanggil | `reservation.service.ts` → `notifyReservationWhatsApp` (L308), dipanggil di **L934 (setelah create)** dan **L1303 (setelah transition)** | `await` + `catch` ⇒ WhatsApp **tidak pernah** menggagalkan/meroll-back reservasi |
| Unit test | `reservation-whatsapp.unit.test.ts` | **10 test**, gateway di-mock (tidak menyentuh BullMQ/Baileys/DB) |

Cakupan trigger (semua melewati service yang sama, jadi otomatis ter-notify):
- `POST /api/public/reservations` → PENDING (dibuat di host dev server → terbukti ter-enqueue, lihat bukti di Ringkasan).
- `POST /api/admin/reservations` (ADMIN) → PENDING **juga** (perlu keputusan bisnis: apakah walk-in staff boleh menotifikasi tamu).
- `PATCH /api/admin/reservations/[id]/status` + `[id]/cancel` → notifikasi status baru.
- `POST /api/public/customer/account/reservations/[code]/cancel` (customer self-cancel) → CANCELLED.

Kesimpulan §2: **tidak ada yang perlu "menghubungkan" lagi** — yang perlu adalah membuat
pengiriman benar-benar berhasil + hardening.

---

## 3. EXISTING QUEUE/WORKER ARCHITECTURE

```
 [Web process (Next.js)]                         [Worker process (tsx / Dockerfile.worker)]
  api/whatsapp/connect|qr|status  ──direct──►  session-manager(web)  ──► Baileys socket (WEB)
  order.service (READY) ─┐
  reservation.service ───┼─ enqueue ─► Redis "whatsapp" (BullMQ)
                         │                    └─► Worker("whatsapp") ─► session-manager(worker)
                         │                                              └─► Baileys socket (WORKER)
                         └───── idempotency: jobId (+ Order.notifiedAt)
```

- Redis nyata: container `restaurant-redis`, 6379 ter-publish → app host/dev (`localhost:6379`) **dan** container berbagi Redis yang sama.
- Worker nyata: container `restaurant-worker` (`restorant-cafe2-worker`, dibuat 2026-09-14), aktif dan **sedang mengonsumsi job** (log menunjukkan pemrosesan + retry).
- Retry: `attempts: 3` + exponential backoff — **terbukti bekerja** (`atm: 3`).
- Tidak ada dead-letter queue, tidak ada alert, tidak ada endpoint retry/requeue; angka `failed` tampil di `/admin/whatsapp` tetapi tanpa aksi.

---

## 4. PROCESS-SPLIT PROBLEM

**Ya, ada dan ini arsitektural (bukan sekadar config).**

1. **Connect/QR/status berjalan di proses WEB** (`api/whatsapp/*` memanggil `whatsappSessionManager` langsung).
   → Socket Baileys yang di-pair admin hidup di **memori proses web**.
2. **Kirim pesan berjalan di proses WORKER** (`whatsapp.worker.ts` → `session-manager`).
   `session-manager.sendMessage` hanya memakai provider **in-process**:
   ```ts
   const provider = this.sessions.get(restaurantId);
   if (!provider || provider.getConnectionStatus() !== "CONNECTED")
     throw new Error(`WhatsApp not connected for restaurant ${restaurantId}`);
   ```
   → Worker **tidak punya provider** ⇒ selalu throw.
3. **`restoreSessions()` TIDAK PERNAH dipanggil** (0 pemanggil di seluruh repo). Padahal fungsi ini
   disiapkan tepat untuk kasus ini (rehidrasi kredensial dari disk → `connect()`).
4. **`queueWhatsAppConnect/Disconnect` tidak dipakai** → desain "worker pemilik session" tidak pernah diselesaikan; jalur yang aktif justru kebalikannya.
5. Volume `whatsapp_data` **dibagi** app↔worker, tetapi **isinya kosong** (`creds.json` tidak ada) → belum pernah ada sesi ter-pair di stack docker.
6. Bukti tambahan: 1 baris `WhatsAppSession` di DB host berstatus **`ERROR`** (update terakhir 2026-09-09), `phone = null`.

**Konsekuensi:** jika dua proses sama-sama membuka `creds.json` yang sama, WhatsApp akan
mengambil-alih sesi (yang satu logout). Karena itu harus diputuskan: **satu proses saja**
yang memiliki socket per restoran — dan itu seharusnya **worker** (satu-satunya proses yang
perlu mengirim).

### 4b. Masalah kedua: env/DB terpecah (penyebab kegagalan nyata saat audit)

| Proses | DATABASE_URL | Isi DB |
| --- | --- | --- |
| Host dev/tests (`localhost:3306`) | `mysql://root:***@localhost:3306/restaurant_app` | **Native MariaDB host** — schema terkini (ada `reservation`), restoran `cmtois12y0000bzu8o894azsd` + data dev |
| container `restaurant-app` / `restaurant-worker` | `mysql://restaurant:***@mariadb:3306/restaurant_app` | container `restaurant-mariadb` (publish **3307**) — **DB lama**: hanya 1 restoran `cmu1f14te…`, dan **tidak ada tabel `reservation`** |

⇒ Reservasi dibuat & di-enqueue dari app host (Redis 6379 dibagi), lalu worker (DB docker)
mencari `restaurantId` itu → **tidak ketemu** → `Restaurant ... not found` ×3 → failed.
Selain itu citra worker/DB docker **tertinggal 3 minggu** (schema belum punya tabel reservasi),
jadi stack docker tidak dapat membuat reservasi sama sekali.

---

## 5. EXACT GAP

| # | Gap | Bukti | Dampak |
| --- | --- | --- | --- |
| **G1** | DB/lingkungan terpecah (worker ≠ app; DB docker basi tanpa tabel `reservation`) | `failedReason: "Restaurant cmtois12y0000bzu8o894azsd not found"`; docker DB: `show tables like 'reservation'` → kosong | **0 pesan terkirim** (`completed=0`, `failed=50`) |
| **G2** | Kepemilikan session Baileys terpecah web↔worker; `restoreSessions()` tidak pernah dipanggil; producer connect/disconnect tidak dipakai | kode `session-manager` + `sendMessage` throw + dir session kosong | Pesan **hilang** walau DB sudah benar |
| **G3** | Tidak ada penanda durabilitas/idempotency di `Reservation` (Order punya `notifiedAt`) | `Reservation` model: tidak ada kolom notifikasi | Job gagal/completed ter-*prune* (`removeOnFail:50`, `removeOnComplete:100`) → re-enqueue bisa kirim ulang; tidak ada cara tahu "sudah pernah dikirim" |
| **G4** | Tidak ada jejak kegagalan & tidak ada retry/requeue | worker hanya `console.error`; baris `WhatsAppMessage` ditulis **hanya saat sukses** | Kegagalan tak terlihat kecuali di log container |
| **G5** | Setengah desain yang mati: connect/disconnect tidak lewat queue; `sendOrder*`/`sendPayment*`, `parseMessage`, model `Notification` tanpa pemakai | grep 0 pemanggil | Salah persepsi "sudah jalan" |
| **G6** | Inkonsistensi env: `.env` pakai `WHATSAPP_SESSION_PATH`, `.env.example` menyebut `WHATSAPP_SESSION_DIR` sebagai kanonik | provider menerima keduanya (dir → path) | Footgun konfigurasi; mudah salah mount |
| **G7** | Payment WhatsApp **belum ada**; Order WA hanya pada READY | `payment.service.ts` tanpa WA; `sendPayment*` mati | Ekspektasi vs realita |

---

## 6. FILES YANG PERLU DIUBAH (rekomendasi, belum dikerjakan)

**Wajib (menutup G1–G2):**
1. `src/workers/whatsapp.worker.ts` — panggil `restoreSessions()` saat boot; (opsional) handler `failed` → catat kegagalan.
2. `src/app/api/whatsapp/{connect,disconnect,reconnect}` — **jangan** sentuh socket langsung; enqueue `queueWhatsAppConnect/Disconnect` (producer-nya sudah ada).
3. `src/app/api/whatsapp/{status,qr}` — baca status/QR dari sumber bersama (DB `WhatsAppSession` yang sudah disinkronkan worker + cache QR di Redis) alih-alih dari memori proses web.
4. `src/services/whatsapp/session-manager.ts` — pastikan hanya worker yang membuat provider; sediakan jalur publikasi QR (Redis) tanpa menyimpan socket di web.
5. `docker-compose.yml` / operasional — arahkan app & worker ke **DB yang sama** (dan terapkan migrasi ke DB docker), rebuild image worker dari kode terkini.

**Sangat disarankan (menutup G3–G4):**
6. `src/services/reservation/reservation.service.ts` / `reservation-whatsapp.ts` — cek penanda notifikasi sebelum dispatch (pola `Order.notifiedAt`).
7. `prisma/schema.prisma` — **opsional**: kolom penanda di `Reservation` (lihat §12).
8. `src/services/whatsapp/whatsapp.queue.ts` — retensi job reservasi (jangan ikut `removeOnComplete:100`) bila memilih idempotency berbasis jobId.

**Kebersihan (menutup G5–G6):**
9. Hapus/tandai dead code: `queueWhatsAppMessage`, `src/services/whatsapp/whatsapp.service.ts`, `message.parser.ts`, model `Notification` (atau pakai).
10. `.env.example`/`.env` — konsistenkan `WHATSAPP_SESSION_DIR`.

**Tidak boleh diubah** (sesuai instruksi): reservation availability, purchase gate, QR reservasi,
Audit Log, payment engine, business rule reservasi, customer auth.

---

## 7. DATABASE IMPACT

- Fitur notifikasi reservasi **tidak membutuhkan tabel/kolom baru** untuk sekadar enqueue
  (sudah jalan hari ini). `WhatsAppMessage` & `WhatsAppSession` sudah ada.
- Yang **belum terpakai**: `WhatsAppMessage.status` (`failed`/`delivered`/`read` tidak pernah ditulis),
  `WhatsAppMessage.metadata` (hanya INCOMING), model `Notification` (0 baris ditulis).
- Bila ingin durabilitas/idempotency selevel Order: **1 kolom nullable** di `Reservation`
  (mis. `waNotifiedAt DateTime?` atau `waNotifiedStatus String?`) → **migration kecil** (lihat §12).
- **Masalah DB saat ini bukan schema aplikasi host, melainkan DB docker yang basi** (tanpa tabel `reservation`).

## 8. API IMPACT

- **Tidak ada endpoint baru yang wajib.** Semua route reservasi (`public/reservations`, `admin/reservations/*`, `customer/account/reservations/*/cancel`) sudah memicu notifikasi secara transparan lewat service.
- Endpoint `/api/whatsapp/*` **berubah implementasi** (bukan kontrak): dari "connect di proses web" → "enqueue job". Bentuk respons `SessionInfo`/`{qrCode,status,message}` dipertahankan agar halaman admin tidak berubah.
- Tidak ada perubahan pada `POST /api/public/reservations` (payload/status code) dan tidak ada perubahan pada purchase gate/QR.

## 9. SECURITY IMPACT

- Pesan memuat **hanya data server-side** (nama, kode reservasi, cabang, tanggal, jam, jumlah orang, status, alasan batal) — **tanpa** id internal, tagihan, kredensial, info Redis/sesi. Sudah benar.
- Tidak ada data dari browser yang dipakai untuk menentukan target/isi pesan.
- Sesi Baileys (`creds.json`) = kredensial penuh akun WhatsApp: **tidak boleh** di-serve ke browser; QR hanya untuk pairing. Bila memindahkan kepemilikan sesi ke worker, pastikan QR di cache Redis ber-TTL pendek dan **scoped per restaurant**, bukan endpoint publik.
- `sanitizeError()` di session-manager sudah menyaring path/password/secret pada `lastError`.
- Catatan: `whatsapp.worker.ts` mencatat error mentah ke log; tidak ada API yang mengembalikannya ke klien.
- Tanpa perubahan izin: `/api/whatsapp/*` tetap `requireAdmin()`.

## 10. IDEMPOTENCY/RETRY STRATEGY

**Yang sudah ada**
- Retry: `attempts: 3`, exponential backoff 1000ms (terbukti `atm:3`).
- Dedup: BullMQ `jobId` — order `notification-<orderNumber>`; reservasi `reservation-<id>-<status>`.
- Order: penanda DB `Order.notifiedAt` (dicek sebelum enqueue) → tahan terhadap redelivery.
- Reservasi: transisi status tidak bisa diulang ke status yang sama (matriks + conditional update),
  jadi per-status unik per reservasi.

**Kelemahan**
- `removeOnComplete:{count:100}` / `removeOnFail:{count:50}` → `jobId` lama hilang; setelah itu
  enqueue ulang dengan key sama **akan mengirim lagi**.
- Reservasi tidak punya penanda DB ⇒ tidak bisa menjawab "sudah dikirim atau belum".
- Kegagalan permanen tidak disimpan (tidak ada baris `failed`).

**Rekomendasi**
1. Penanda di `Reservation` (pola `Order.notifiedAt`) sebagai sumber kebenaran idempotency.
2. Retensi job reservasi diperpanjang (mis. `removeOnComplete:{age: 7d}` / count besar) agar dedup BullMQ bertahan.
3. Handler `failed` di worker → tulis `WhatsAppMessage` dengan `status:"failed"` + `metadata` singkat (jobId, status reservasi) ⇒ durabilitas + dasar retry manual.
4. Retry operasional: endpoint admin re-enqueue **berdasarkan reservasi** (bukan job), aman karena §10.1.

## 11. RECOMMENDED MINIMAL IMPLEMENTATION

Prinsip: **pakai yang sudah ada** (queue `whatsapp`, worker, Baileys provider, `WhatsAppMessage`) —
tanpa engine/queue/Baileys client baru.

**Langkah 0 — operasional (tanpa kode):** samakan DB app & worker, terapkan migrasi ke DB tersebut,
rebuild image worker dari kode terkini. Ini sendirian sudah memindahkan `Restaurant not found` → terkirim **asalkan G2 tertutup**.

**Langkah 1 — samakan kepemilikan session (G2).** Pilih **satu**:
- **Rekomendasi (worker-owned):** worker memanggil `restoreSessions()` saat boot; route connect/disconnect
  memakai producer yang sudah ada (`queueWhatsAppConnect/Disconnect`); QR dipublikasikan worker ke Redis
  dengan TTL pendek dan dibaca `/api/whatsapp/qr`; status dibaca dari `WhatsAppSession` (sudah disinkronkan).
  Hapus pemakaian `whatsappSessionManager` langsung di proses web.
- **Alternatif (web-owned, lebih kecil tapi trade-off):** biarkan connect di web dan kirim dari web juga
  (lewati worker). Lebih cepat, tetapi kehilangan retry/durabilitas worker dan menyimpang dari desain
  Docker yang sudah ada. **Tidak direkomendasikan.**

**Langkah 2 — durabilitas/idempotency (G3).** Tambah penanda notifikasi pada `Reservation` (atau
memadukan dengan `WhatsAppMessage`), cek sebelum dispatch. Bila ingin **nol migration**: perpanjang
retensi job + catat kegagalan di `WhatsAppMessage`.

**Langkah 3 — observabilitas (G4).** Handler `failed` → baris `WhatsAppMessage(status:"failed")`;
tampilkan jumlah gagal + aksi retry di `/admin/whatsapp` (endpoint retry kecil).

**Langkah 4 — kebersihan (G5–G6).** Hapus/tandai dead code; konsistenkan `WHATSAPP_SESSION_DIR`.

**Eksplisit TIDAK dilakukan:** queue baru, engine WhatsApp baru, Baileys client baru,
perubahan order/payment engine, perubahan business rule reservasi/purchase gate/QR, login/OTP baru.

## 12. APAKAH PERLU MIGRATION ATAU TIDAK

| Skenario | Migration |
| --- | --- |
| Notifikasi reservasi → WhatsApp (enqueue + kirim) | **TIDAK perlu** — sudah berjalan; hanya butuh perbaikan proses/konfigurasi |
| Idempotency berbasis BullMQ `jobId` saja | **TIDAK perlu** |
| Idempotency/durabilitas level Order (`notifiedAt`) | **PERLU 1 migration kecil** (kolom nullable di `Reservation`), tanpa mengubah kolom/tabel lain |
| Mencatat kegagalan pengiriman | **TIDAK perlu** (`WhatsAppMessage.status` sudah ada) |

⇒ **Default: tanpa migration.** Migration hanya jika menyetujui penanda idempotency di `Reservation`.

## 13. RISIKO REGRESSION

| Risiko | Tingkat | Mitigasi |
| --- | --- | --- |
| Memindahkan kepemilikan session → halaman admin QR/pairing rusak | **Tinggi** | Pertahankan bentuk respons `/api/whatsapp/*`; uji pairing end-to-end setelah perubahan |
| Dua proses membuka `creds.json` yang sama → sesi saling mengambil alih (logout) | **Tinggi** | Pastikan **tepat satu** proses memiliki socket per restoran |
| Notifikasi order READY ikut terdampak (pipeline sama) | Sedang | Uji ulang jalur order READY setelah perubahan session |
| Pesan INCOMING berpindah penulis (kini di proses pemilik socket) | Rendah | Keduanya menulis DB yang sama |
| Perubahan kode menyentuh `reservation.service.ts` secara tak sengaja | Rendah | `reservation-whatsapp.ts` terisolasi; dispatch bersifat best-effort (tidak pernah menggagalkan reservasi) |
| Duplikasi pesan bila dedup jobId dihapus | Sedang | Jangan longgarkan `jobId`; tambah penanda DB sebelum mengubah retensi |
| Redis mati → enqueue throw (tertangkap) → notifikasi hilang senyap | Sedang | Catat kegagalan enqueue (log/DB) agar tidak silent |
| Notifikasi juga terkirim untuk reservasi buatan staff (ADMIN) | Rendah (perilaku) | Konfirmasi keputusan bisnis; mudah digate bila perlu |
| Regression pada R5.1 / purchase gate / QR | **Sangat rendah** | Tidak ada perubahan pada jalur tersebut di rekomendasi ini |

## 14. IMPLEMENTATION PLAN (usulan, bertahap)

**Fase 0 — Perbaikan lingkungan (tanpa kode, prasyarat)**
1. Satukan `DATABASE_URL` app & worker; jalankan `prisma migrate deploy` pada DB tersebut.
2. Rebuild & restart image app/worker dari commit terkini; pastikan volume `whatsapp_data` ter-mount jelas.
3. Verifikasi: order READY/reservasi palsu → job `completed ≥ 1` (Redis), atau paling tidak `failedReason` berubah dari "Restaurant not found".

**Fase 1 — Session ownership (G2)**
4. Worker memanggil `restoreSessions()` saat boot.
5. Route connect/disconnect/reconnect → `queueWhatsAppConnect/Disconnect` (producer existing).
6. Publikasi QR ke Redis (TTL pendek) + `/api/whatsapp/qr` membacanya; `/status` dari `WhatsAppSession`.
7. Hapus pemakaian langsung `whatsappSessionManager` di proses web.
8. Uji pairing end-to-end: scan QR → `WhatsAppSession.status = CONNECTED` → kirim pesan uji dari worker.
9. Uji ulang order READY (pipeline sama) agar tidak regresi.

**Fase 2 — Durabilitas & idempotency (G3)**
10. (Opsional, butuh migration) Penanda notifikasi di `Reservation`.
11. Perpanjang retensi job reservasi / cek penanda sebelum dispatch.

**Fase 3 — Observabilitas & kebersihan (G4–G6)**
12. `WhatsAppMessage(status:"failed")` pada handler gagal + tampilan + aksi retry di `/admin/whatsapp`.
13. Hapus/tandai dead code; konsistenkan env `WHATSAPP_SESSION_DIR`.
14. Uji: notifikasi PENDING/CONFIRMED/CANCELLED/SEATED/COMPLETED/NO_SHOW, nomor `guest-*` di-skip,
    tanpa nomor valid → skip (tanpa error), Redis mati → reservasi tetap sukses.

**Acceptance criteria R7**
- Reservasi publik baru → WA `PENDING` benar-benar terkirim (bukan hanya ter-enqueue).
- Tiap transisi status → tepat **satu** pesan; transisi berulang tidak mengirim ulang.
- Kegagalan terlihat (status `failed`) dan dapat di-retry.
- Reservasi tetap sukses walau WhatsApp/Redis gagal (best-effort tidak berubah).
- R5.1 / purchase gate / QR / Audit Log / payment tidak berubah.

---

## LAMPIRAN — bukti perintah audit (read-only)

```
docker logs restaurant-worker          → "Reservation …-PENDING failed: Restaurant <id> not found" (×3 attempts)
docker exec restaurant-redis redis-cli ZCARD bull:whatsapp:failed  → 50
docker exec restaurant-redis redis-cli ZCARD bull:whatsapp:completed → 0
redis-cli HGETALL bull:whatsapp:reservation-<id>-PENDING → atm=3, opts={attempts:3, backoff exponential,
      jobId:"reservation-<id>-PENDING", removeOnComplete:{count:100}, removeOnFail:{count:50}}
      data ← pesan reservasi lengkap & benar (template R7 berfungsi)
docker exec restaurant-mariadb mariadb … -e "show tables like 'reservation'" → (kosong)
docker exec restaurant-app/worker env | grep DATABASE_URL → mysql://restaurant:***@mariadb:3306/restaurant_app
docker exec restaurant-app/worker ls /app/whatsapp-session → kosong (belum pernah pairing)
host DB: WhatsAppSession { status: "ERROR", phone: null }, WhatsAppMessage OUTGOING = 0, INCOMING = 0
grep: restoreSessions / queueWhatsAppConnect / queueWhatsAppDisconnect / queueWhatsAppMessage /
      whatsappService.sendOrder* / parseMessage / notification.create → 0 pemanggil
```
