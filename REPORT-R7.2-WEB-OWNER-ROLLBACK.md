# REPORT R7.2 — ROLLBACK WORKER ARCHITECTURE + OPSI A (WEB = SOLE BAILEYS OWNER)

**Tanggal:** 2026-10-07
**Repo:** `/home/reksa/restorant-cafe` · branch `main` · HEAD `70226bc` (tidak berubah)
**Staged:** 0 · **Commit/Push/Deploy:** tidak dilakukan
**Scope:** rollback R7.2 Worker ownership + implementasi Opsi A (notifikasi WhatsApp dari Web process)
**Tidak dilakukan:** `git reset --hard`, `git checkout .`, `git restore .`, `git clean`, hapus untracked/report/`reservation-product-picker`, reset DB/migration, drop table, hapus session credentials, cleanup massal, refactor/redesign WhatsApp.

---

## 1. FILES CHANGED

**Rollback (kembali byte-identical ke HEAD → tidak muncul lagi di `git diff`):**
| File | Hasil |
|---|---|
| `src/app/api/whatsapp/connect/route.ts` | **identik HEAD** (0 diff) |
| `src/app/api/whatsapp/disconnect/route.ts` | **identik HEAD** (0 diff) |
| `src/app/api/whatsapp/reconnect/route.ts` | **identik HEAD** (0 diff) |
| `src/services/whatsapp/whatsapp.queue.ts` | **identik HEAD** (0 diff) |
| `package.json` | **identik HEAD** (0 diff) |
| `.env` (gitignored) | komentar owner diperbaiki; `WHATSAPP_SESSION_DIR` dipertahankan |

**Opsi A — file baru:**
| File | Baris |
|---|---|
| `src/services/whatsapp/whatsapp-notifier.ts` | 71 (baru) |
| `src/services/whatsapp/whatsapp-notifier.unit.test.ts` | 117 (baru) |

**Opsi A — file diedit (minimal, hanya seam notifikasi):**
| File | Perubahan | Catatan |
|---|---|---|
| `src/services/order/order.service.ts` | hanya blok trigger Order READY | seluruh perubahan Phase 1 tetap utuh (471 baris diff Phase 1 masih ada) |
| `src/services/reservation/reservation-whatsapp.ts` | import + gateway + call + komentar | 26 baris (14 insert/12 delete) |
| `src/services/reservation/reservation-whatsapp.unit.test.ts` | seam test `enqueue` → `send` | 53 baris |

**Tidak disentuh:** `session-manager.ts`, `providers/baileys/*`, `api/whatsapp/status/route.ts`, `api/whatsapp/qr/route.ts`, `docker-compose.yml`, `Dockerfile.worker`, `prisma/schema.prisma`, Phase 1 Reservation/Order/Payment files, `src/workers/whatsapp.worker.ts` (file tetap, tidak dijalankan).

---

## 2. EXACT R7.2 ROLLBACK PERFORMED

| # | Lokasi | Dari (R7.2) | Ke (original) |
|---|---|---|---|
| 1 | `connect/route.ts` | `await queueWhatsAppConnect(restaurantId)` + `getStatus()` | `const sessionInfo = await whatsappSessionManager.connect(restaurantId)` |
| 2 | `disconnect/route.ts` | `await queueWhatsAppDisconnect(restaurantId)` + `getStatus()` | `await whatsappSessionManager.disconnect(restaurantId)` |
| 3 | `reconnect/route.ts` | `await queueWhatsAppConnect(restaurantId, { force: true })` + `getStatus()` | `await whatsappSessionManager.forceReconnect(restaurantId)` |
| 4 | `whatsapp.queue.ts` | `queueWhatsAppConnect(restaurantId, options?: { force?: boolean })` + spread `force` di payload | `queueWhatsAppConnect(restaurantId)` (signature original) |
| 5 | `package.json` | `worker:dev` + `--env-file=.env`; `worker:start` baru | `worker:dev`: `tsx src/workers/whatsapp.worker.ts`; `worker:start` **dihapus** |
| 6 | `.env` | komentar "WORKER adalah satu-satunya owner" | komentar "WEB process adalah satu-satunya owner; tidak ada WhatsApp worker" |
| 7 | `whatsapp.worker.ts` | — | file **tidak diubah, tidak dijalankan** |

Dihapus juga: seluruh komentar R7.2 "the WORKER owns the socket", JSDoc R7.2 pada 3 route, dan label log `Connect/Reconnect` yang bergantung pada `options.force`.

**Verifikasi:** `git diff HEAD -- src/app/api/whatsapp/ src/services/whatsapp/whatsapp.queue.ts package.json` → **output kosong** (0 diff).

---

## 3. EXACT OPSI A IMPLEMENTATION

**Sender baru (`src/services/whatsapp/whatsapp-notifier.ts`):**

```
sendWhatsAppNotification(restaurantId, to, message): Promise<boolean>
```

- Langkah 1: `whatsappSessionManager.sendMessage(restaurantId, to, message)` — **method existing, tidak diubah**.
- Langkah 2: catat `prisma.whatsAppMessage.create({ direction: "OUTGOING", from: restaurant.phone || "system", to, content: message, type: "text", status: "sent" })` — paritas dengan job `send_message` milik worker lama.
- **Best-effort, tidak pernah throw.** `true` = benar-benar diserahkan ke socket CONNECTED; `false` = tidak terkirim (tidak ada session / belum CONNECTED / error kirim).
- **Tidak ada fake success:** row `sent` tidak ditulis kalau send gagal.
- Kalau send sukses tapi pencatatan gagal → tetap `true` (pesan sudah terkirim; gagal catat tidak boleh memicu kirim ulang).
- Tidak menerima trusted value dari client: `restaurantId`/`to` selalu dari domain server-side pemanggil.
- Alasan file ini ada (bukan "service baru" yang dilarang): dua producer (Order + Reservation) butuh operasi kirim+catat yang identik; tanpa helper ini logika yang sama harus diduplikasi di dua tempat. Tidak ada engine/session/socket/queue baru.

**Order READY (`order.service.ts`, blok `if (input.status === "READY")`):**
```
const { sendWhatsAppNotification } = await import("@/services/whatsapp/whatsapp-notifier");
const sent = await sendWhatsAppNotification(restaurantId, customerPhone, message);
if (sent) { prisma.order.update({ notifiedAt }); whatsappTriggered = true; log "sent" }
else { console.warn("not delivered ... (WhatsApp not connected)") }
```
- Tetap: template `buildOrderReadyMessage`, `restaurantId` existing, nomor pelanggan existing, guard idempotency `!order.notifiedAt`, `notifiedAt`, `whatsappTriggered`.
- Berubah: notifikasi ditandai berhasil **hanya setelah send benar-benar sukses** (`notifiedAt`/`whatsappTriggered`). Order status & payment state **tidak** diubah oleh send attempt. Blok tetap di dalam `try/catch` best-effort sehingga kegagalan WhatsApp tidak pernah menggagalkan update order.

**Reservation (`reservation-whatsapp.ts`):**
```
export const reservationWhatsAppGateway = { send: sendWhatsAppNotification };
...
return await reservationWhatsAppGateway.send(view.restaurantId, target, message);
```
- Tetap: `buildReservationWhatsAppMessage` (template tidak disentuh), `resolveReservationWhatsAppTarget` (recipient existing, server-side), `restaurantId` existing, best-effort + logging `false` (tidak menyentuh status reservasi / payment / order).
- Seam lama (`queueWhatsAppReservation` via `reservationWhatsAppGateway.enqueue`) diganti **di seam yang sama** — engine reservasi tidak diubah.

---

## 4. NOTIFICATION FLOW SEBELUM

```
Order READY (order.service.ts)
  └─ queueWhatsAppNotification → BullMQ "whatsapp" queue → whatsapp.worker.ts
                                                              └─ sessionManager.sendMessage()  ← Map worker KOSONG
                                                                 └─ GAGAL: "WhatsApp not connected"

Reservation (reservation-whatsapp.ts)
  └─ reservationWhatsAppGateway.enqueue = queueWhatsAppReservation → queue → worker → GAGAL sama
```
→ Pengiriman bergantung pada konsumen BullMQ; socket ada di proses WEB, konsumen ada di proses WORKER (Map kosong) = akar G2.

---

## 5. NOTIFICATION FLOW SESUDAH

```
Order READY
  └─ sendWhatsAppNotification()  [WEB process]
        ├─ whatsappSessionManager.sendMessage() → Baileys (socket WEB, satu-satunya owner)
        └─ catat whatsappmessage OUTGOING "sent" (hanya jika kirim sukses)

Reservation lifecycle
  └─ reservationWhatsAppGateway.send = sendWhatsAppNotification()  [WEB process] → sama
```
Admin flow: `Admin UI → /api/whatsapp/{connect,disconnect,reconnect,status,qr} → whatsappSessionManager → Baileys → WhatsApp`.
**Tidak ada Worker, tidak ada BullMQ consumer di jalur WhatsApp.**

---

## 6. REDIS / BULLMQ STATUS

- **Jalur WhatsApp (connect/disconnect/reconnect/QR/status) dan jalur notifikasi tidak lagi membutuhkan BullMQ consumer.**
- Redis **tidak dihapus** dan masih hidup; infrastruktur queue global tidak disentuh; model/database existing tidak dihapus.
- `/api/whatsapp/status` masih memanggil `getWhatsAppQueueStats()` (fungsi existing, tidak diubah) → response status tetap membawa blok `queue`. Aman/kosmetik.
- Kondisi queue saat ini (read-only, tidak diubah): `{active:0, completed:0, delayed:0, failed:50, prioritized:0, waiting:0, waiting-children:0}` (`failed:50` = sisa QA lama).

**Dead code yang dilaporkan (BELUM dihapus — menunggu scope approval):**
| Simbol | Lokasi | Status |
|---|---|---|
| `queueWhatsAppConnect` | `whatsapp.queue.ts` | tidak ada caller |
| `queueWhatsAppDisconnect` | `whatsapp.queue.ts` | tidak ada caller |
| `queueWhatsAppMessage` | `whatsapp.queue.ts` | tidak ada caller (sudah dead sebelum R7.2) |
| `queueWhatsAppNotification` | `whatsapp.queue.ts` | tidak ada caller (digantikan Opsi A) |
| `queueWhatsAppReservation` | `whatsapp.queue.ts` | tidak ada caller (digantikan Opsi A) |
| `getWhatsAppQueueStats` | `whatsapp.queue.ts` | **masih dipakai** `/api/whatsapp/status` |
| `whatsapp.worker.ts` | `src/workers/` | tidak dipakai sebagai runtime |
| dead code lama | `message.parser.ts`, `whatsapp/whatsapp.service.ts` | tetap dead (tidak disentuh) |
| dependency | `bullmq`, `ioredis` | masih diperlukan `/status` (queue stats) |

---

## 7. WORKER STATUS

- `ps -ef | grep whatsapp.worker` → **tidak ada proses** (3 proses `npm run worker:dev`/`tsx`/`node` dihentikan dengan SIGTERM/graceful).
- BullMQ `getWorkers()` pada queue `whatsapp` → **0**.
- Container `restaurant-worker` → **Exited (0)** (tidak dijalankan).
- `src/workers/whatsapp.worker.ts` → file tetap ada, tidak dijalankan, tidak dihapus (sesuai instruksi).

---

## 8. DATABASE IMPACT

- **Tidak ada perubahan schema, tidak ada DDL, tidak ada reset, tidak ada drop.**
- Tidak ada perubahan data yang dilakukan oleh proses implementasi ini.
- Tabel/row lama dibiarkan apa adanya (mis. 1 row `whatsappsession`).
- Satu-satunya penulisan DB baru adalah **perilaku runtime** yang memang diinginkan: row `whatsappmessage` OUTGOING `sent` saat notifikasi benar-benar terkirim (paritas dengan job `send_message` worker lama) — tidak ada penulisan `sent` saat gagal.

---

## 9. MIGRATION IMPACT

- **Tidak ada migration.** `prisma/schema.prisma` tidak diubah (`git diff` bersih). Tidak ada `prisma migrate`, `db push`, atau `migrate reset`.

---

## 10. PHASE 1 PRESERVATION CHECK

- File Phase 1 masih ada di working tree dengan diff besar yang utuh: `order.service.ts` (471 baris), `reservation.service.ts` (314), `reservation.purchase.test.ts` (697), `reservasi/page.tsx` (596), `reservation-flow.ts` (308), `reservation-flow.test.ts` (232), `reservation.purchase.fixtures.ts` (199), `reservation.types.ts` (19), `_public-dto.ts` (23), `purchase-eligibility/route.ts` (**masih deleted**), `reservation.{api,customer,customer-api,service}.test.ts`.
- `order.service.ts` **tidak** di-restore dari HEAD dan tidak di-overwrite; hanya blok notifikasi Order READY yang diedit.
- Untracked Phase 1 tetap ada: `reservation-product-picker.tsx` + 4 report lama.
- Total diff working tree: 18 file tracked, 1951 insertions / 1233 deletions (mayoritas = Phase 1).

---

## 11. TSC RESULT

```
$ rm -rf .next/dev/types .next/types && npx tsc --noEmit
TSC EXIT=0
```

## 12. BUILD RESULT

```
$ npm run build
BUILD EXIT=0
```
Semua route WhatsApp ter-build: `/api/whatsapp/connect|disconnect|reconnect|status|qr`.

## 13. TEST RESULT

```
$ npx tsx --test --test-force-exit src/services/whatsapp/whatsapp-notifier.unit.test.ts
tests 3 | pass 3 | fail 0          NOTIFIER EXIT=0
  ✔ returns false and records nothing when the session is not connected
  ✔ records one OUTGOING sent row when the send succeeds
  ✔ still reports true when only the bookkeeping write fails

$ npx tsx --test --test-force-exit src/services/reservation/reservation-whatsapp.unit.test.ts
tests 10 | pass 10 | fail 0        RESV-WA EXIT=0
```
(Stack trace yang tercetak pada tes reservasi adalah jalur kegagalan yang **sengaja** diuji — assertion-nya tetap `pass`.) Tidak ada test destructive, tidak ada reset database.

## 14. GIT DIFF --CHECK RESULT

```
$ git diff --check
EXIT=0
```

**Static ownership check (semua lulus):**
- `src/app/api/whatsapp/*` → **0** penggunaan `queueWhatsAppConnect`/`queueWhatsAppDisconnect`.
- Route kembali memakai `whatsappSessionManager.connect` / `.disconnect` / `.forceReconnect` (baris 26 / 19 / 11).
- `whatsapp.queue.ts` → **0** `options?: { force`.
- `bullmq active workers: 0`.
- Staged file: **0**; HEAD tetap `70226bc`.

---

## 15. REMAINING RISKS

| # | Risiko | Catatan / mitigasi |
|---|---|---|
| R1 | `WhatsAppSessionManager` = singleton per-proses dengan Map in-memory; HMR Next.js dev bisa me-reevaluasi modul → Map kosong → "WhatsApp not connected" | Jangan edit source saat demo; restart dev server setelah build. Perbaikan permanen (`globalThis`) di luar scope |
| R2 | Notifikasi yang gagal (WA belum CONNECTED) **tidak di-retry** otomatis — tidak ada worker/queue lagi | Sesuai keputusan (no worker). `notifiedAt` sengaja tidak di-set saat gagal sehingga transisi READY berikutnya boleh mencoba lagi; log `warn` menandai kegagalan |
| R3 | `whatsappTriggered` kini `false` saat send gagal | Perubahan perilaku yang disengaja (anti fake success) — admin UI tidak akan lagi melaporkan "terkirim" palsu |
| R4 | QR in-memory kedaluwarsa ~25s; `provider.onQrCode` belum diregister; tombol "Refresh QR" admin memakai `connect` (409 saat `QR_REQUIRED`) | Cacat lama (bukan R7.2), di luar scope. QR sekarang hidup di proses web sehingga alur pairing demo berfungsi |
| R5 | Multi-instance Next (scale/production) melanggar aturan single-owner | Tidak relevan untuk demo single-instance; batas arsitektur ini perlu didokumentasikan |
| R6 | Dead code queue (`queueWhatsAppConnect/Disconnect/Message/Notification/Reservation`) + `whatsapp.worker.ts` tetap ada | Sengaja dipertahankan; **tidak** dibersihkan tanpa scope approval (lihat §6) |
| R7 | `.env.example` masih membawa 5 baris komentar precedence Phase 0 (klasifikasi A) | Dokumentasi saja, tidak berdampak runtime |
| R8 | `whatsapp.worker.ts` masih memuat R7.2 (branch `force` + boot `restoreSessions()`), walaupun tidak dijalankan | Bila suatu saat dijalankan tanpa sengaja, ia akan mengambil socket → langgar single-owner. Dilarang menjalankan worker di demo |
| R9 | 50 job `failed` lama tetap di Redis | Sisa QA; tidak memengaruhi jalur WhatsApp, tidak dibersihkan |

---

## KESIMPULAN

1. Rollback R7.2 Worker ownership **selesai** — 3 route, `whatsapp.queue.ts`, dan `package.json` kembali identik HEAD.
2. Web/Next.js kini **satu-satunya owner Baileys**; tidak ada Worker runtime; BullMQ active workers = 0.
3. Notifikasi **Order READY** dan **Reservation** mengirim langsung dari Web process melalui `whatsappSessionManager.sendMessage()` (Opsi A) — template, engine, schema, dan DB tidak diubah.
4. Jalur WhatsApp tidak lagi bergantung pada BullMQ consumer; Redis tidak dihapus.
5. Phase 1 Reservation/Order/Payment utuh.
6. `tsc` 0 · `build` 0 · test 13/13 pass · `git diff --check` 0 · tanpa commit/push/deploy.

**STOP — menunggu review.**
