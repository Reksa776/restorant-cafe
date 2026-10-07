# AUDIT — R7.2 E2E ARTIFACTS (read-only)

Date: 2026-10-07 · Mode: AUDIT-ONLY (no source change, no commit/push/deploy, no migration, no DB change, no worker started)
HEAD: `70226bca064b717c5c5bee7ef9ca343ed7d3ed1a` · staged: 0 · app `http://localhost:3100` = HTTP 200
Restaurant: `cmtois12y0000bzu8o894azsd`

---

## 1. Customer test
- `customer.cmuxqhzhg00006aivtb4vkm1o` — name `E2E R7.2 Web Owner Test`, phone `6285183142697`, restaurantId `cmtois12y0000bzu8o894azsd`, createdAt `2026-10-07T06:36:13.156Z`. **EXISTS.**
- Only **1** customer created in the E2E window (≥ 06:00Z). No other customer row inserted/modified.

## 2. Order test
- `order.cmuxqi7ho0000mrivbm4uppx7` / `ORD-20261007-ZW6RV0` — status `READY`, orderType `TAKEAWAY`, branchId `null`, tableId `null`, `notifiedAt 2026-10-07T06:36:46.976Z`, createdAt `06:36:23.532Z`, updatedAt `06:36:46.982Z`. **EXISTS.**
- `orderitem.cmuxqi7hr0001mrivnamxnjvr` — product `cmtois1jn0006bzu8zri0yq5n` (Es Teh), qty 1, unitPrice `8000`, totalPrice `8000`.
- `orderstatushistory` — 4 rows: `cmuxqi7i70002mrivdsd3iz9b` PENDING `06:36:23.551Z`, `cmuxqih9h0003mrivzfv8diwz` CONFIRMED `06:36:36.197Z`, `cmuxqihfr0004mrivvnnzpw5f` PROCESSING `06:36:36.423Z`, `cmuxqiohi0005mriv00we2wbw` READY `06:36:45.558Z`.
- Payments for this order: **0 rows**. No stock movement.

## 3. Reservation test
- `reservation.cmuxqkzyc0007mrivh548dn60` / `R-W8FP38U2` — status `CONFIRMED`, branch `cmts9dbpe0000ravmnrjfknin` (MAIN), table `cmtois1k9000cbzu8pvgm0i1l` (Table 05), `orderId null`, createdAt `06:38:33.732Z`, confirmedAt `06:39:10.901Z`. **EXISTS.**
- Only **1** reservation created in the window. No link table/child rows observed (schema has a single `model Reservation`; no reservation-history model).

## 4. WhatsAppMessage hasil E2E (3 sent rows)
All `direction: OUTGOING`, `status: sent`, `type: text`, `from: +6281234567890`, `to: 6285183142697`, restaurantId `cmtois12y0000bzu8o894azsd`:
1. `cmuxqipkl0006mrivfs3gcmd6` — order READY — `06:36:46.965Z`
2. `cmuxql01s0008mrivtuni7w4w` — reservation PENDING — `06:38:33.856Z`
3. `cmuxqlsoa0009mrivimeq5qkd` — reservation CONFIRMED — `06:39:10.954Z`

**⚠ Additional rows (NOT part of the E2E, received after it):** `whatsappmessage` total is now **5**. Two **INCOMING** rows arrived on the live socket after the E2E:
- `cmuxqq5eu000amrivyuyx1tid` — `direction: INCOMING`, `from: 28815053074637@lid`, `status: received`, `06:42:34.086Z`
- `cmuxqqqe4000bmrivs1vuq69k` — `direction: INCOMING`, `from: 28815053074637@lid`, `status: received`, `06:43:01.277Z` (content includes an email/credential-like text)
These are inbound messages to the connected WhatsApp line, stored by the Web process. They are real inbound data, unrelated to the 3 E2E sends. Flagged for the operator's attention (possible spam/scam inbound).

## 5. Production / real-data impact
- Rows created in the whole E2E window (≥ 06:00Z): **1 customer, 1 order, 1 reservation, 0 payments, 0 stock movements, 3 outbound WhatsAppMessage** (the 2 inbound above arrived even later).
- Rows updated in the window: **only** the E2E order (`ORD-20261007-ZW6RV0`). No other order touched.
- No real/other customer, order, payment, table, shift, or product row was created or modified by the E2E.
- Totals now: customers 35, orders 35, reservations 1, payments 46, tables 11 (`AVAILABLE 5 / OCCUPIED 6` — unchanged vs the pre-E2E table dump).
- **Conclusion: no production/real customer data changed.**

## 6. WhatsAppSession
- `whatsappsession.cmts6ny0s0009ehvmhiukpzjy` — restaurantId `cmtois12y0000bzu8o894azsd`, status `CONNECTED`, phone `6285183142697`, isActive `true`, lastError `null`, lastActiveAt `2026-10-07T06:30:15.135Z`. **Only one session row.**
- Credentials present and **NOT deleted**: `whatsapp-session/restaurant-cmtois12y0000bzu8o894azsd/creds.json` (2901 B, 13:40) + 4030 files in the dir.

## 7. BullMQ
- Queue `whatsapp`: `{"active":0,"completed":0,"delayed":0,"failed":50,"waiting":0}` — the **50 failed jobs are still present and were not cleaned.** `getWorkers()` = 0.

## 8. Source / report artifacts
Present and untouched: `REPORT-R7.2-FINAL-E2E-VERIFICATION.md`, `REPORT-R7.2-WEB-OWNER-ROLLBACK.md`, `AUDIT-R7.2-ROLLBACK-WORKER-ARCHITECTURE.md` (+ the other AUDIT/REPORT files). HEAD unchanged, 0 staged, no source modifications.

## 9. Worker
- No `whatsapp.worker.ts` / `worker:dev` process; container `restaurant-worker` = `Exited (0)` — **worker not running.**

## 10. Database
- No writes performed by this audit (all probes read-only). No migration, no reset.

---

## Recommendations

### Safe to delete (pure E2E artifacts, no downstream references)
| Table (`@@map`) | Record(s) | Note |
|---|---|---|
| `orderstatushistory` | `cmuxqi7i7…`, `cmuxqih9h…`, `cmuxqihfr…`, `cmuxqiohi…` | delete after the order |
| `orderitem` | `cmuxqi7hr0001mrivnamxnjvr` | child of the order |
| `order` | `cmuxqi7ho0000mrivbm4uppx7` / `ORD-20261007-ZW6RV0` | no payments, no orderId back-ref from reservation |
| `reservation` | `cmuxqkzyc0007mrivh548dn60` / `R-W8FP38U2` | `orderId null`; safe once confirmed no external reference |
| `customer` | `cmuxqhzhg00006aivtb4vkm1o` | only after order is gone (order.customerId FK) |
| `whatsappmessage` | the 3 OUTGOING E2E rows `cmuxqipkl…`, `cmuxql01s…`, `cmuxqlsoa…` | optional — they are the proof of the E2E; deleting loses evidence |

Deletion order (FK-safe): orderstatushistory → orderitem → order → reservation → customer → (optional) 3 whatsappmessage.

### Must be preserved
- `whatsappsession.cmts6ny0s0009ehvmhiukpzjy` (CONNECTED) — do **not** delete while the demo session is live.
- `whatsapp-session/restaurant-cmtois12y0000bzu8o894azsd/` (credentials) — do **not** delete.
- All `AUDIT-*` / `REPORT-*` files, source files, and the `reservation-product-picker.tsx`/`whatsapp-notifier*` files.
- The 50 failed BullMQ jobs (leave as-is).
- The 2 INCOMING WhatsAppMessages — real inbound data; decide with the operator, do not silently purge.

### Do cleanup now, or leave it?
**Recommendation: leave it for now (do not clean up yet).**
- The rows are the evidence backing `REPORT-R7.2-FINAL-E2E-VERIFICATION.md`; deleting them invalidates the just-signed-off PASS.
- They are inert: order is `READY` (not COMPLETED → no stock/COGS effect), no payments, reservation-confirmed with no order link; they do not affect reports/global totals in a harmful way.
- Deleting requires cross-table FK ordering and touch the `orderstatushistory`/`orderitem` children — higher risk than the benefit for a demo dataset.
- If a clean environment is required later, do it as a separate, explicitly-approved step (ideally with a scoped script + backup), and keep at least the 3 `whatsappmessage` proof rows or a copy of this audit.

### Exact records / tables involved
- **Created:** `customer`×1, `order`×1, `orderitem`×1, `orderstatushistory`×4, `reservation`×1, `whatsappmessage`×3 (OUTGOING; +2 INCOMING unrelated).
- **Updated:** `whatsappsession`×1 (→ CONNECTED) and `order`×1 (status + notifiedAt).
- **Untouched:** `payment`, `stockmovement`, `table`, `branch`, `product`, `shift`, all other customers/orders, Redis failed jobs, source tree.
