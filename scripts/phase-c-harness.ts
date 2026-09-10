/**
 * PHASE C — PURCHASING + INVENTORY TEST HARNESS (read/write against dev DB).
 * Run: npx tsx phase-c-harness.ts
 *
 * Covers the Phase C concurrency/idempotency/security matrix on top of the
 * Phase B foundation:
 *   - concurrent purchase receive (1 success / 1 reject, stock +once)
 *   - purchase receive + order COMPLETED racing on the same product
 *   - concurrent stock adjustments (no lost update, consistent balanceAfter)
 *   - adjustment validations (zero rejected, reason required, delta 0 = no row)
 *   - D4: PAID order writes NO OUT movement; COMPLETED writes exactly one
 *   - inventory history surfaces IN/OUT/ADJUSTMENT + user name
 *   - security: unauthenticated 401, KASIR read 200 / mutate 403,
 *     ADMIN allowed, forged branch 403 (HTTP, when cookies available)
 *
 * Hard-coded markers (PHASEC-*) make the created test data easy to identify.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import * as supplierSvc from "@/services/supplier/supplier.service";
import * as purchaseSvc from "@/services/purchase/purchase.service";
import {
  applyStockMovement,
  listStockMovements,
  StockRefType,
} from "@/services/stock/stock.service";
import { branchService } from "@/services/branch/branch.service";
import { orderService } from "@/services/order/order.service";
import {
  ValidationError,
  ConflictError,
  NotFoundError,
} from "@/lib/errors";

const RA = "PHASEC-RA";
const RB = "PHASEC-RB";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectReject(
  name: string,
  fn: () => Promise<unknown>,
  Err: new (...a: never[]) => Error
) {
  try {
    await fn();
    check(name, false, "expected error was not thrown");
  } catch (e) {
    check(name, e instanceof Err, `got ${(e as Error).constructor.name}: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------

async function createTenant(label: string) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `${label}-Resto`, isActive: true },
  });
  const branch = await prisma.branch.create({
    data: { restaurantId: restaurant.id, code: `${label}-BR`, name: `${label} Branch` },
  });
  const category = await prisma.category.create({
    data: { restaurantId: restaurant.id, name: `${label} Cat` },
  });
  const product = await prisma.product.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: category.id,
      name: `${label} Nasi Goreng`,
      price: 25000,
      isActive: true,
      isAvailable: true,
    },
  });
  const product2 = await prisma.product.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: category.id,
      name: `${label} Es Teh`,
      price: 8000,
      isActive: true,
      isAvailable: true,
    },
  });
  const customer = await prisma.customer.create({
    data: { restaurantId: restaurant.id, name: `${label} Guest`, phone: `guest-${label}-1` },
  });
  return { restaurant, branch, category, product, product2, customer };
}

async function cleanupTenant(label: string) {
  const restaurants = await prisma.restaurant.findMany({ where: { name: { startsWith: `${label}-Resto` } } });
  for (const restaurant of restaurants) {
    await prisma.auditLog.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.stockMovement.deleteMany({ where: { restaurantId: restaurant.id } });
    const purchases = await prisma.purchase.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } });
    await prisma.purchaseItem.deleteMany({ where: { purchaseId: { in: purchases.map((p) => p.id) } } });
    await prisma.purchase.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.supplier.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.orderItem.deleteMany({ where: { order: { restaurantId: restaurant.id } } });
    await prisma.payment.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { order: { restaurantId: restaurant.id } } });
    await prisma.order.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.branchProduct.deleteMany({ where: { branch: { restaurantId: restaurant.id } } });
    await prisma.customer.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.productRecommendation.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.productAddon.deleteMany({ where: { product: { restaurantId: restaurant.id } } });
    await prisma.productOption.deleteMany({ where: { group: { product: { restaurantId: restaurant.id } } } });
    await prisma.productOptionGroup.deleteMany({ where: { product: { restaurantId: restaurant.id } } });
    await prisma.product.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.category.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.branch.deleteMany({ where: { restaurantId: restaurant.id } });
    await prisma.restaurant.delete({ where: { id: restaurant.id } });
  }
}

async function stockOf(branchId: string, productId: string): Promise<number> {
  const row = await prisma.branchProduct.findUnique({
    where: { branchId_productId: { branchId, productId } },
    select: { stock: true },
  });
  return row?.stock ?? 0;
}

async function makePurchase(restaurantId: string, branchId: string, supplierId: string, items: { productId: string; quantity: number; unitCost: number }[]) {
  return purchaseSvc.createPurchase(restaurantId, { branchId, supplierId, items });
}

async function completeOrder(orderId: string, restaurantId: string, userId: string, branchId: string) {
  for (const st of ["CONFIRMED", "PROCESSING", "READY"] as const) {
    await orderService.updateOrderStatus(orderId, { status: st }, restaurantId, userId, [branchId]);
  }
  return orderService.updateOrderStatus(orderId, { status: "COMPLETED" }, restaurantId, userId, [branchId]);
}

// ---------------------------------------------------------------
// HTTP helpers (cookies from /tmp cookie jars; same localhost domain
// across ports so jars captured against :3001 work on :3000 too)
// ---------------------------------------------------------------

function netscapeToCookieHeader(filePath: string): string | null {
  const fs = require("node:fs");
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const parts: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || (t.startsWith("#") && !t.startsWith("#HttpOnly_"))) continue;
    const [name, value] = t.split("\t").slice(5, 7);
    if (name && value) parts.push(`${name}=${value}`);
  }
  return parts.length ? parts.join("; ") : null;
}

const ADMIN_COOKIE = netscapeToCookieHeader("/tmp/admin_cookie.txt");
const KASIR_COOKIE = netscapeToCookieHeader("/tmp/cashier_cookie.txt");
const SCOPED_COOKIE = netscapeToCookieHeader("/tmp/scoped_admin_cookie.txt");
const BASE_URL = process.env.HARNESS_BASE_URL || "http://localhost:3001";

async function api<T = unknown>(
  path: string,
  method: string,
  cookie: string | null,
  body?: unknown,
  branchHeader?: string
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  if (branchHeader) headers["x-branch-id"] = branchHeader;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data: data as T };
}

// ---------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------

async function main() {
  console.log("== Phase C fixtures ==");
  const a = await createTenant(RA);
  const b = await createTenant(RB);
  const UID = (await prisma.user.findFirst({ select: { id: true } }))!.id;
  const supA = await supplierSvc.createSupplier(a.restaurant.id, { name: `${RA} Supplier` });
  const supB = await supplierSvc.createSupplier(b.restaurant.id, { name: `${RB} Supplier` });

  // ---------------------------------------------------------------
  console.log("== Concurrent receive (STEP 6/15) ==");
  const rc1 = await makePurchase(a.restaurant.id, a.branch.id, supA.id, [
    { productId: a.product.id, quantity: 5, unitCost: 1000 },
    { productId: a.product2.id, quantity: 3, unitCost: 2000 },
  ]);
  const beforeStock = await stockOf(a.branch.id, a.product.id);
  const [r1, r2] = await Promise.allSettled([
    purchaseSvc.receivePurchase(a.restaurant.id, rc1.id, UID, undefined),
    purchaseSvc.receivePurchase(a.restaurant.id, rc1.id, UID, undefined),
  ]);
  const okCount = [r1, r2].filter((r) => r.status === "fulfilled").length;
  const rejectCount = [r1, r2].filter((r) => r.status === "rejected").length;
  check("concurrent receive: exactly 1 fulfilled + 1 rejected", okCount === 1 && rejectCount === 1,
    `ok=${okCount} reject=${rejectCount}`);
  if (okCount === 1 && rejectCount === 1) {
    const rejected = [r1, r2].find((r) => r.status === "rejected") as PromiseRejectedResult;
    check("concurrent receive loser is ConflictError", rejected.reason instanceof ConflictError,
      String((rejected.reason as Error)?.message));
  }
  const afterStock = await stockOf(a.branch.id, a.product.id);
  check("concurrent receive added stock exactly ONCE (5)", afterStock === beforeStock + 5,
    `before=${beforeStock} after=${afterStock}`);
  const rc1Moves = await prisma.stockMovement.count({
    where: { restaurantId: a.restaurant.id, refType: StockRefType.PURCHASE_RECEIVE, refId: rc1.id },
  });
  check("concurrent receive wrote movements exactly once (2 items -> 2 rows)", rc1Moves === 2, `count=${rc1Moves}`);
  const rc1Status = await prisma.purchase.findUnique({ where: { id: rc1.id }, select: { status: true } });
  check("concurrent receive final status RECEIVED", rc1Status?.status === "RECEIVED");

  // ---------------------------------------------------------------
  console.log("== Receive + Order COMPLETED racing (STEP 15) ==");
  // product2 already holds +3 from rc1 (item 2). Seed +10, then purchase
  // IN +5 and order OUT -8 race → final = base + 5 - 8 regardless of order.
  await prisma.$transaction((tx) =>
    applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product2.id, type: "IN", quantity: 10, refType: "PHASEC_SEED" })
  );
  const raceBase = await stockOf(a.branch.id, a.product2.id);
  const rc2 = await makePurchase(a.restaurant.id, a.branch.id, supA.id, [
    { productId: a.product2.id, quantity: 5, unitCost: 1000 },
  ]);
  const o1 = await orderService.createOrder(
    { customerId: a.customer.id, orderType: "DINE_IN", items: [{ productId: a.product2.id, quantity: 8 }] },
    a.restaurant.id,
    a.branch.id
  );
  for (const st of ["CONFIRMED", "PROCESSING", "READY"] as const) {
    await orderService.updateOrderStatus(o1.id, { status: st }, a.restaurant.id, UID, [a.branch.id]);
  }
  const [raceA, raceB] = await Promise.allSettled([
    purchaseSvc.receivePurchase(a.restaurant.id, rc2.id, UID, undefined),
    orderService.updateOrderStatus(o1.id, { status: "COMPLETED" }, a.restaurant.id, UID, [a.branch.id]),
  ]);
  check("receive + order complete both succeed concurrently", raceA.status === "fulfilled" && raceB.status === "fulfilled",
    `receive=${raceA.status} complete=${raceB.status}`);
  const raceStock = await stockOf(a.branch.id, a.product2.id);
  check("race final stock = base + 5 - 8 (no lost update)", raceStock === raceBase + 5 - 8, `stock=${raceStock} (base ${raceBase})`);
  // Only the seed + race movements: rc1's earlier receive on product2 must
  // not be counted here.
  const raceMoves = await prisma.stockMovement.findMany({
    where: {
      restaurantId: a.restaurant.id,
      branchId: a.branch.id,
      productId: a.product2.id,
      OR: [{ refType: "PHASEC_SEED" }, { refId: { in: [rc2.id, o1.id] } }],
    },
    orderBy: { createdAt: "asc" },
  });
  const raceTypes = raceMoves.map((m) => m.type).join(",");
  check("race wrote IN + OUT ledger rows", raceMoves.length === 3 && raceMoves.some((m) => m.type === "IN") && raceMoves.some((m) => m.type === "OUT"),
    `types=${raceTypes} (1 seed IN + 1 receive IN + 1 OUT)`);
  const raceOut = raceMoves.find((m) => m.type === "OUT");
  const raceIn = raceMoves.filter((m) => m.type === "IN").pop();
  check("race OUT signed -8 and balanceAfter chains to final", raceOut?.quantity === -8 && raceOut?.balanceAfter === raceStock,
    JSON.stringify(raceOut));
  check("race IN +5 balanceAfter = OUT.balanceAfter + 8 (chained)", raceIn?.quantity === 5 && raceIn?.balanceAfter === raceOut!.balanceAfter + 8,
    JSON.stringify(raceIn));

  // ---------------------------------------------------------------
  console.log("== Concurrent adjustments (STEP 15) ==");
  // product holds +5 from rc1 (item 1); seed +3 → 8, then -3 and +5 run
  // concurrently → final = 8 - 3 + 5 = 10 regardless of order.
  await prisma.$transaction((tx) =>
    applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, type: "ADJUSTMENT", quantity: 3, reason: "seed", refType: "PHASEC_SEED" })
  );
  const adjBase = await stockOf(a.branch.id, a.product.id);
  const [adj1, adj2] = await Promise.allSettled([
    prisma.$transaction((tx) =>
      applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, type: "ADJUSTMENT", quantity: -3, reason: "opname -3", refType: StockRefType.STOCK_ADJUSTMENT })
    ),
    prisma.$transaction((tx) =>
      applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, type: "ADJUSTMENT", quantity: 5, reason: "opname +5", refType: StockRefType.STOCK_ADJUSTMENT })
    ),
  ]);
  check("concurrent adjustments both succeed", adj1.status === "fulfilled" && adj2.status === "fulfilled",
    `a=${adj1.status} b=${adj2.status}`);
  const adjStock = await stockOf(a.branch.id, a.product.id);
  check("concurrent adjustments final stock = base - 3 + 5 (no lost update)", adjStock === adjBase - 3 + 5, `stock=${adjStock} (base ${adjBase})`);
  const adjRows = await prisma.stockMovement.findMany({
    where: { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, refType: StockRefType.STOCK_ADJUSTMENT },
    orderBy: { createdAt: "asc" },
  });
  check("concurrent adjustments wrote 2 ledger rows with chained balanceAfter",
    adjRows.length === 2 &&
    adjRows[1].balanceAfter === adjStock &&
    (adjRows[0].balanceAfter === adjBase - 3 || adjRows[0].balanceAfter === adjBase + 5),
    JSON.stringify(adjRows.map((m) => ({ q: m.quantity, b: m.balanceAfter }))));

  // ---------------------------------------------------------------
  console.log("== Adjustment validations (STEP 9/18) ==");
  await expectReject("adjustment quantity 0 rejected",
    () => prisma.$transaction((tx) =>
      applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, type: "ADJUSTMENT", quantity: 0, refType: "T" })),
    ValidationError);
  await expectReject("adjustment driving stock below 0 rejected (ConflictError)",
    () => prisma.$transaction((tx) =>
      applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, type: "ADJUSTMENT", quantity: -100, refType: "T" })),
    ConflictError);
  const stockBeforeReason = await stockOf(a.branch.id, a.product.id);
  await expectReject("updateBranchProduct stock change without reason rejected",
    () => branchService.updateBranchProduct(a.restaurant.id, a.branch.id, a.product.id, UID, { stock: stockBeforeReason + 1 }),
    ValidationError);
  const stockAfterReason = await stockOf(a.branch.id, a.product.id);
  check("rejected reason-required adjustment changed nothing", stockAfterReason === stockBeforeReason,
    `stock=${stockAfterReason}`);
  const moveCountBeforeNoop = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id } });
  await branchService.updateBranchProduct(a.restaurant.id, a.branch.id, a.product.id, UID, {
    stock: stockBeforeReason,
    reason: "no-op same value",
  });
  const moveCountAfterNoop = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id } });
  check("stock change delta 0 writes NO movement", moveCountAfterNoop === moveCountBeforeNoop,
    `${moveCountBeforeNoop} -> ${moveCountAfterNoop}`);
  const bpAdjUp = await branchService.updateBranchProduct(a.restaurant.id, a.branch.id, a.product.id, UID, {
    stock: stockBeforeReason + 4,
    reason: "opname +4 via UI path",
  });
  check("updateBranchProduct positive adjustment applied (balanceAfter via ledger)", bpAdjUp.stock === stockBeforeReason + 4,
    `stock=${bpAdjUp.stock}`);
  const lastAdj = await prisma.stockMovement.findFirst({
    where: { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, refType: StockRefType.STOCK_ADJUSTMENT },
    orderBy: { createdAt: "desc" },
  });
  check("updateBranchProduct adjustment wrote ledger row with balanceAfter", lastAdj?.quantity === 4 && lastAdj?.balanceAfter === stockBeforeReason + 4,
    JSON.stringify(lastAdj));

  // ---------------------------------------------------------------
  console.log("== D4: PAID alone writes no OUT; COMPLETED writes exactly one ==");
  const o2 = await orderService.createOrder(
    { customerId: a.customer.id, orderType: "DINE_IN", items: [{ productId: a.product2.id, quantity: 2 }] },
    a.restaurant.id,
    a.branch.id
  );
  const stockBeforePaid = await stockOf(a.branch.id, a.product2.id);
  const movesBeforePaid = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id, refId: o2.id } });
  for (const st of ["CONFIRMED", "PROCESSING", "READY"] as const) {
    await orderService.updateOrderStatus(o2.id, { status: st }, a.restaurant.id, UID, [a.branch.id]);
  }
  // Simulate the payment engine marking the order PAID (payment engine itself
  // is out of Phase C scope — we only assert its stock side-effect is none).
  await prisma.order.update({ where: { id: o2.id }, data: { paymentStatus: "PAID" } });
  const stockAfterPaid = await stockOf(a.branch.id, a.product2.id);
  const movesAfterPaid = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id, refId: o2.id } });
  check("PAID (status READY) wrote no OUT movement", movesAfterPaid === movesBeforePaid && stockAfterPaid === stockBeforePaid,
    `moves=${movesAfterPaid} stock=${stockAfterPaid}`);
  await orderService.updateOrderStatus(o2.id, { status: "COMPLETED" }, a.restaurant.id, UID, [a.branch.id]);
  const stockAfterCompleted = await stockOf(a.branch.id, a.product2.id);
  const outRows = await prisma.stockMovement.findMany({ where: { restaurantId: a.restaurant.id, refId: o2.id } });
  check("COMPLETED wrote exactly 1 OUT movement with -2", outRows.length === 1 && outRows[0].type === "OUT" && outRows[0].quantity === -2,
    JSON.stringify(outRows));
  check("COMPLETED deducted stock by 2", stockAfterCompleted === stockAfterPaid - 2, `stock=${stockAfterCompleted}`);

  // ---------------------------------------------------------------
  console.log("== Inventory history (STEP 8) ==");
  const ledger = await listStockMovements(a.restaurant.id, undefined, { type: "OUT" as never });
  check("ledger surfaces OUT movements with user name", ledger.length > 0 && ledger.every((m) => typeof m.userName === "string" || m.userName === null),
    `rows=${ledger.length}`);
  const ledgerIn = await listStockMovements(a.restaurant.id, [a.branch.id], { type: "IN" as never });
  check("ledger branch+type filter (IN, branch A)", ledgerIn.length > 0 && ledgerIn.every((m) => m.branchId === a.branch.id && m.type === "IN"));
  const ledgerB = await listStockMovements(b.restaurant.id, undefined, {});
  check("ledger tenant-isolated (tenant B empty)", ledgerB.length === 0, `count=${ledgerB.length}`);

  // ---------------------------------------------------------------
  console.log("== Cross tenant / cross branch (STEP 14/18) ==");
  await expectReject("purchase with other-tenant branch rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: b.branch.id, supplierId: supA.id, items: [{ productId: a.product.id, quantity: 1, unitCost: 1 }] }),
    NotFoundError);
  await expectReject("purchase with other-tenant supplier rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supB.id, items: [{ productId: a.product.id, quantity: 1, unitCost: 1 }] }),
    NotFoundError);
  await expectReject("purchase with other-tenant product rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supA.id, items: [{ productId: b.product.id, quantity: 1, unitCost: 1 }] }),
    ValidationError);
  const rc3 = await makePurchase(a.restaurant.id, a.branch.id, supA.id, [
    { productId: a.product2.id, quantity: 1, unitCost: 100 },
  ]);
  await expectReject("tenant B receive of tenant A purchase (scoped to B) rejected",
    () => purchaseSvc.receivePurchase(b.restaurant.id, rc3.id, UID, [b.branch.id]),
    NotFoundError);
  await expectReject("scoped-to-B read of tenant A purchase rejected",
    () => purchaseSvc.getPurchase(b.restaurant.id, rc3.id, [b.branch.id]),
    NotFoundError);

  // ---------------------------------------------------------------
  // HTTP SECURITY MATRIX (needs running server + /tmp cookie jars)
  // ---------------------------------------------------------------
  console.log("== HTTP security matrix (STEP 14/18) ==");
  if (!ADMIN_COOKIE || !KASIR_COOKIE) {
    check("http: admin + kasir cookies available", false, "missing /tmp cookies — skipping HTTP section");
  } else {
    const unauth = await api("/api/admin/suppliers", "GET", null);
    check("http unauthenticated GET -> 401", unauth.status === 401, `status=${unauth.status}`);

    const kSuppliers = await api("/api/admin/suppliers", "GET", KASIR_COOKIE);
    check("http KASIR GET suppliers -> 200", kSuppliers.status === 200, `status=${kSuppliers.status}`);
    const kPurchases = await api("/api/admin/purchases", "GET", KASIR_COOKIE);
    check("http KASIR GET purchases -> 200", kPurchases.status === 200, `status=${kPurchases.status}`);
    const kMovements = await api("/api/admin/stock-movements", "GET", KASIR_COOKIE);
    check("http KASIR GET stock ledger -> 200", kMovements.status === 200, `status=${kMovements.status}`);

    const kSupPost = await api("/api/admin/suppliers", "POST", KASIR_COOKIE, { name: "KASIR-NOPE" });
    check("http KASIR POST supplier -> 403", kSupPost.status === 403, `status=${kSupPost.status}`);
    const kPurPost = await api("/api/admin/purchases", "POST", KASIR_COOKIE, {
      branchId: a.branch.id,
      supplierId: supA.id,
      items: [{ productId: a.product.id, quantity: 1, unitCost: 1 }],
    });
    check("http KASIR POST purchase -> 403", kPurPost.status === 403, `status=${kPurPost.status}`);
    const kSupPatch = await api(`/api/admin/suppliers/${supA.id}`, "PATCH", KASIR_COOKIE, { name: "HACK" });
    check("http KASIR PATCH supplier -> 403", kSupPatch.status === 403, `status=${kSupPatch.status}`);
    const kPurPatch = await api(`/api/admin/purchases/${rc3.id}`, "PATCH", KASIR_COOKIE, { notes: "HACK" });
    check("http KASIR PATCH purchase -> 403", kPurPatch.status === 403, `status=${kPurPatch.status}`);
    const kRecv = await api(`/api/admin/purchases/${rc3.id}/receive`, "POST", KASIR_COOKIE);
    check("http KASIR receive -> 403", kRecv.status === 403, `status=${kRecv.status}`);
    const kCancel = await api(`/api/admin/purchases/${rc3.id}/cancel`, "POST", KASIR_COOKIE);
    check("http KASIR cancel -> 403", kCancel.status === 403, `status=${kCancel.status}`);
    const kAdj = await api(
      `/api/admin/branches/${a.branch.id}/products/${a.product.id}`,
      "PUT",
      KASIR_COOKIE,
      { stock: 99, reason: "HACK" }
    );
    check("http KASIR stock adjustment (PUT stock) -> 403", kAdj.status === 403, `status=${kAdj.status}`);

    // ADMIN positive path — must run against the REAL restaurant of the admin
    // session (fixture branches belong to PHASEC tenants and are correctly 403).
    const adminSup = await api<{ data: { id: string } }>("/api/admin/suppliers", "POST", ADMIN_COOKIE, {
      name: "PHASEC-HTTP-SUPPLIER",
    });
    check("http ADMIN POST supplier -> 201", adminSup.status === 201 && !!adminSup.data?.data?.id, `status=${adminSup.status}`);
    const httpSupplierId = adminSup.data?.data?.id as string | undefined;

    const adminResto = await prisma.restaurant.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    const adminBranch = await prisma.branch.findFirst({
      where: { restaurantId: adminResto?.id, code: "MAIN" },
      select: { id: true },
    });
    const adminProduct = await prisma.product.findFirst({
      where: { restaurantId: adminResto?.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    check("http fixture: real restaurant MAIN branch + product found", !!adminBranch && !!adminProduct && !!httpSupplierId);

    if (httpSupplierId && adminBranch && adminProduct) {
      const adminPur = await api<{ data: { id: string } }>("/api/admin/purchases", "POST", ADMIN_COOKIE, {
        branchId: adminBranch.id,
        supplierId: httpSupplierId,
        notes: "phasec-http",
        items: [{ productId: adminProduct.id, quantity: 2, unitCost: 1500 }],
      });
      check("http ADMIN POST purchase -> 201", adminPur.status === 201 && !!adminPur.data?.data?.id, `status=${adminPur.status}`);
      const httpPurId = adminPur.data?.data?.id as string | undefined;
      if (httpPurId) {
        const recv = await api(`/api/admin/purchases/${httpPurId}/receive`, "POST", ADMIN_COOKIE);
        check("http ADMIN receive -> 201 + RECEIVED", recv.status === 201 && (recv.data as { data?: { status?: string } })?.data?.status === "RECEIVED",
          `status=${recv.status}`);
        const recv2 = await api(`/api/admin/purchases/${httpPurId}/receive`, "POST", ADMIN_COOKIE);
        check("http ADMIN duplicate receive -> 409", recv2.status === 409, `status=${recv2.status}`);
      }

      // forged branch: scoped admin (JKT) cannot touch MAIN — the branch DOES
      // belong to the same restaurant, so only the scope check can reject it.
      if (SCOPED_COOKIE) {
        const forged = await api("/api/admin/purchases", "POST", SCOPED_COOKIE, {
          branchId: adminBranch.id,
          supplierId: httpSupplierId,
          items: [{ productId: adminProduct.id, quantity: 1, unitCost: 1 }],
        });
        check("http scoped-admin forged branchId -> 403", forged.status === 403, `status=${forged.status}`);
        const forgedLedger = await api(`/api/admin/stock-movements?branchId=${adminBranch.id}`, "GET", SCOPED_COOKIE);
        check("http scoped-admin forged ledger branch filter -> 403", forgedLedger.status === 403, `status=${forgedLedger.status}`);
      } else {
        check("http scoped-admin cookie present", false, "missing scoped_admin_cookie");
      }
    }

    // cleanup http data (also restore the real restaurant's stock to what it
    // was before the receive test — Phase C must not mutate real data)
    if (httpSupplierId && adminBranch && adminProduct) {
      const realStockBefore = await prisma.branchProduct.findUnique({
        where: { branchId_productId: { branchId: adminBranch.id, productId: adminProduct.id } },
        select: { stock: true },
      });
      const httpPurchases = await prisma.purchase.findMany({ where: { supplierId: httpSupplierId }, select: { id: true } });
      await prisma.stockMovement.deleteMany({ where: { refType: StockRefType.PURCHASE_RECEIVE as never, refId: { in: httpPurchases.map((p) => p.id) } } });
      await prisma.purchaseItem.deleteMany({ where: { purchaseId: { in: httpPurchases.map((p) => p.id) } } });
      await prisma.purchase.deleteMany({ where: { id: { in: httpPurchases.map((p) => p.id) } } });
      await prisma.supplier.delete({ where: { id: httpSupplierId } });
      if (realStockBefore) {
        await prisma.branchProduct.update({
          where: { branchId_productId: { branchId: adminBranch.id, productId: adminProduct.id } },
          data: { stock: realStockBefore.stock },
        });
      }
    }
    // rc3 was received by KASIR test? No — KASIR receive was 403, so rc3 stays DRAFT. Leave for cleanup below.
  }

  // ---------------------------------------------------------------
  console.log("== Cleanup ==");
  await cleanupTenant(RA);
  await cleanupTenant(RB);

  console.log("\n====================");
  console.log(`PASS ${pass}  FAIL ${fail}`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("HARNESS CRASH:", e);
  process.exit(2);
});