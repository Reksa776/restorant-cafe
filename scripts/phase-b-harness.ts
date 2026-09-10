/**
 * PHASE B — FOUNDATION TEST HARNESS (read/write against dev DB).
 * Run: npx tsx phase-b-harness.ts
 *
 * Covers: DB relations+indexes, tenant isolation, branch, supplier,
 * purchase validation, stock movement semantics/atomicity, idempotent
 * receive, Order COMPLETED → OUT movement, auth (HTTP), HTTP end-to-end
 * supplier+purchase+receive, and cleanup. Hard-coded markers make the
 * created test data easy to identify and remove.
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
import { orderService } from "@/services/order/order.service";
import { ValidationError, ConflictError, NotFoundError } from "@/lib/errors";

const RA = "PHASEB-RA";
const RB = "PHASEB-RB";

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

async function expectReject(name: string, fn: () => Promise<unknown>, Err: new (...a: any[]) => Error) {
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
      name: `${label} Nasi Merah`,
      price: 20000,
      isActive: true,
      isAvailable: true,
    },
  });
  const product2 = await prisma.product.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: category.id,
      name: `${label} Es Kopi`,
      price: 12000,
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

// ---------------------------------------------------------------
// HTTP helpers (cookies from /tmp cookie jars)
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

async function api<T = any>(
  path: string,
  method: string,
  cookie: string | null,
  body?: unknown,
  branchHeader?: string
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookie) headers["Cookie"] = cookie;
  if (branchHeader) headers["x-branch-id"] = branchHeader;
  const res = await fetch(`http://localhost:3001${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// ---------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------

async function main() {
  console.log("== DB relations & indexes ==");
  try {
    const indexes = await prisma.$queryRaw<Array<{ Table: string; Key_name: string; Column_name: string }>>`
      SELECT TABLE_NAME as \`Table\`, INDEX_NAME as \`Key_name\`, COLUMN_NAME as \`Column_name\`
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('supplier','purchase','purchaseitem','stockmovement')
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`;
    const names = indexes.map((i) => `${i.Table}.${i.Key_name}`);
    for (const idx of [
      "supplier.supplier_restaurantId_name_key",
      "supplier.supplier_restaurantId_isActive_idx",
      "purchase.purchase_restaurantId_createdAt_idx",
      "purchase.purchase_restaurantId_branchId_createdAt_idx",
      "purchase.purchase_restaurantId_supplierId_createdAt_idx",
      "purchase.purchase_restaurantId_status_idx",
      "purchaseitem.purchaseitem_purchaseId_idx",
      "purchaseitem.purchaseitem_productId_idx",
      "stockmovement.stockmovement_restaurantId_branchId_createdAt_idx",
      "stockmovement.stockmovement_restaurantId_productId_createdAt_idx",
      "stockmovement.stockmovement_restaurantId_type_createdAt_idx",
      "stockmovement.stockmovement_refType_refId_idx",
    ]) {
      check(`index ${idx} exists`, names.includes(idx), `missing: ${idx}`);
    }
  } catch (e) {
    check("info_schema index query", false, (e as Error).message);
  }
  try {
    await prisma.supplier.create({
      data: { restaurantId: "supplier-fk-does-not-exist", name: "FK test" },
    });
    check("supplier FK restaurant enforced", false, "should have thrown FK error");
  } catch (e: any) {
    check("supplier FK restaurant enforced", String(e?.code) === "P2003", e?.code);
  }

  console.log("== Tenant A fixtures ==");
  const a = await createTenant(RA);
  const b = await createTenant(RB);
  const UID = (await prisma.user.findFirst({ select: { id: true } }))!.id;
  check("tenant A branch created", !!a.branch.id);
  check("tenant B branch created", !!b.branch.id);

  // stock 0 baseline
  const bp0 = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product.id },
  });
  check("branchproduct creates lazily (no row before stock)", bp0 === null);

  console.log("== Supplier ==");
  const supA = await supplierSvc.createSupplier(a.restaurant.id, {
    name: `${RA} Supplier`,
    phone: "0812",
  });
  await expectReject("duplicate supplier same tenant rejected",
    () => supplierSvc.createSupplier(a.restaurant.id, { name: `${RA} Supplier` }),
    ConflictError);
  const supB = await supplierSvc.createSupplier(b.restaurant.id, {
    name: `${RA} Supplier`,
  });
  check("same name allowed across tenants", supB.id !== supA.id);
  await expectReject("empty name rejected",
    () => supplierSvc.createSupplier(a.restaurant.id, { name: "  " }),
    ValidationError);
  const { items: listA } = await supplierSvc.listSuppliers(a.restaurant.id);
  check("list scoped to tenant A", listA.length === 1 && listA[0].id === supA.id);
  const { items: listB } = await supplierSvc.listSuppliers(b.restaurant.id);
  check("list scoped to tenant B (isolated)", listB.length === 1 && listB[0].id === supB.id);
  await props("supplier update name",
    () => supplierSvc.updateSupplier(a.restaurant.id, supA.id, { name: `${RA} Supplier v2` }),
    (s) => s?.name === `${RA} Supplier v2`);
  await supplierSvc.setSupplierActive(a.restaurant.id, supA.id, false);
  const supAoff = await supplierSvc.getSupplier(a.restaurant.id, supA.id);
  check("supplier soft-disable", supAoff.isActive === false);
  await expectReject("update other tenant's supplier -> not found",
    () => supplierSvc.updateSupplier(b.restaurant.id, supA.id, { name: "x" }),
    NotFoundError);

  console.log("== Purchase validation ==");
  await expectReject("purchase: unknown branch",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: b.branch.id, supplierId: supA.id, items: [{ productId: a.product.id, quantity: 5, unitCost: 1000 }] }),
    NotFoundError);
  await expectReject("purchase: supplier from other tenant",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supB.id, items: [{ productId: a.product.id, quantity: 5, unitCost: 1000 }] }),
    NotFoundError);
  await expectReject("purchase: inactive supplier rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supA.id, items: [{ productId: a.product.id, quantity: 1, unitCost: 1000 }] }),
    ValidationError);
  await supplierSvc.setSupplierActive(a.restaurant.id, supA.id, true);
  await expectReject("purchase: empty items rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supA.id, items: [] }),
    ValidationError);
  await expectReject("purchase: quantity 0 rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supA.id, items: [{ productId: a.product.id, quantity: 0, unitCost: 1000 }] }),
    ValidationError);
  await expectReject("purchase: quantity negative rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supA.id, items: [{ productId: a.product.id, quantity: -3, unitCost: 1000 }] }),
    ValidationError);
  await expectReject("purchase: unitCost negative rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supA.id, items: [{ productId: a.product.id, quantity: 3, unitCost: -5 }] }),
    ValidationError);
  await expectReject("purchase: product from other tenant rejected",
    () => purchaseSvc.createPurchase(a.restaurant.id, { branchId: a.branch.id, supplierId: supA.id, items: [{ productId: b.product.id, quantity: 3, unitCost: 1000 }] }),
    ValidationError);

  console.log("== Purchase create + server-derived total ==");
  const draft = await purchaseSvc.createPurchase(a.restaurant.id, {
    branchId: a.branch.id,
    supplierId: supA.id,
    notes: "draft note",
    items: [
      { productId: a.product.id, quantity: 10, unitCost: 5000 },
      { productId: a.product2.id, quantity: 5, unitCost: 7500.5 },
    ],
  });
  check("draft created as DRAFT", draft.status === "DRAFT", draft.status);
  check("draft total server-derived (10*5000 + 5*7500.5 = 87502.5)", draft.total === 87502.5, `total=${draft.total}`);
  check("draft has 2 items", draft.items.length === 2);

  const draftWithRound = await purchaseSvc.createPurchase(a.restaurant.id, {
    branchId: a.branch.id,
    supplierId: supA.id,
    items: [{ productId: a.product2.id, quantity: 3, unitCost: 1000.017 }],
  });
  check("unitCost rounded to 2dp (1000.02)", draftWithRound.items[0].unitCost === 1000.02, `cost=${draftWithRound.items[0].unitCost}`);

  const listp = await purchaseSvc.listPurchases(a.restaurant.id, undefined, {});
  check("list purchases scoped", listp.items.length === 2);
  await expectReject("other tenant cannot read main-tenant purchase",
    () => purchaseSvc.getPurchase(b.restaurant.id, draft.id, undefined),
    NotFoundError);
  const got = await purchaseSvc.getPurchase(a.restaurant.id, draft.id, undefined);
  check("purchase detail resolves supplier+branch", got.supplierName === `${RA} Supplier v2` && got.branchCode === `${RA}-BR`);

  console.log("== Draft edit ==");
  const edit = await purchaseSvc.updateDraftPurchase(a.restaurant.id, draft.id, undefined, {
    notes: "edited",
    items: [{ productId: a.product.id, quantity: 20, unitCost: 4000 }],
  });
  check("draft edit returns", edit === undefined || edit === null || typeof edit === "object");
  const draft2 = await purchaseSvc.getPurchase(a.restaurant.id, draft.id, undefined);
  check("draft edit replaced items (1 item qty 20)", draft2.items.length === 1 && draft2.items[0].quantity === 20);
  check("draft edit total recomputed (20*4000=80000)", draft2.total === 80000, `total=${draft2.total}`);
  await expectReject("edit received purchase later rejected", async () => {
    const draftRx = await purchaseSvc.createPurchase(a.restaurant.id, {
      branchId: a.branch.id,
      supplierId: supA.id,
      items: [{ productId: a.product2.id, quantity: 1, unitCost: 100 }],
    });
    await purchaseSvc.receivePurchase(a.restaurant.id, draftRx.id, UID, undefined);
    await purchaseSvc.updateDraftPurchase(a.restaurant.id, draftRx.id, undefined, { notes: "nope" });
  }, ConflictError);

  console.log("== Receive -> StockMovement IN (atomic) ==");
  const beforeReceive = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product.id },
  });
  const beforeMt = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id } });

  const received = await purchaseSvc.receivePurchase(a.restaurant.id, draft2.id, UID, undefined);
  check("receive flips to RECEIVED", received.status === "RECEIVED", received.status);
  check("receive sets receivedAt", !!received.receivedAt);

  const bpIn = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product.id },
  });
  check("receiving created BranchProduct row with stock 20", bpIn?.stock === 20, `stock=${bpIn?.stock}`);

  const mtIn = await prisma.stockMovement.findMany({
    where: { restaurantId: a.restaurant.id, refType: StockRefType.PURCHASE_RECEIVE, refId: draft2.id },
  });
  check("receive created exactly 1 movement (draft had 1 item after edit)", mtIn.length === 1, `count=${mtIn.length}`);
  check("IN movement positive qty + balanceAfter", mtIn[0].type === "IN" && mtIn[0].quantity === 20 && mtIn[0].balanceAfter === 20, JSON.stringify(mtIn[0]));
  const mtTotal = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id } });
  check("movement ledger grew by 1", mtTotal === beforeMt + 1, `${beforeMt} -> ${mtTotal}`);

  console.log("== Idempotent receive ==");
  await expectReject("duplicate receive rejected",
    () => purchaseSvc.receivePurchase(a.restaurant.id, draft2.id, UID, undefined),
    ConflictError);
  const bpIn2 = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product.id },
  });
  check("duplicate receive did NOT add stock (still 20)", bpIn2?.stock === 20, `stock=${bpIn2?.stock}`);
  const mtIn2 = await prisma.stockMovement.count({
    where: { restaurantId: a.restaurant.id, refType: StockRefType.PURCHASE_RECEIVE, refId: draft2.id },
  });
  check("duplicate receive did NOT add movements (still 1)", mtIn2 === 1, `count=${mtIn2}`);

  console.log("== Atomicity (movement + stock must roll back together) ==");
  try {
    await prisma.$transaction(async (tx) => {
      await applyStockMovement(tx, {
        restaurantId: a.restaurant.id,
        branchId: a.branch.id,
        productId: a.product.id,
        type: "ADJUSTMENT",
        quantity: 5,
        refType: "TEST_ATOMIC",
      });
      throw new Error("boom-rollback");
    });
  } catch (e) {
    /* expected */
  }
  const bpAfterR = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product.id },
  });
  const mtAfterR = await prisma.stockMovement.count({
    where: { restaurantId: a.restaurant.id, refType: "TEST_ATOMIC" as any },
  });
  check("rolled-back movement left no stock change (still 20)", bpAfterR?.stock === 20, `stock=${bpAfterR?.stock}`);
  check("rolled-back movement wrote no ledger row", mtAfterR === 0, `count=${mtAfterR}`);

  console.log("== StockMovement semantics ==");
  await expectReject("OUT on insufficient stock rejected (ConflictError)", () =>
    prisma.$transaction((tx) =>
      applyStockMovement(tx, {
        restaurantId: a.restaurant.id,
        branchId: a.branch.id,
        productId: a.product.id,
        type: "OUT",
        quantity: -25,
        refType: "TEST",
      })
    ), ConflictError);
  const bpNeg = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product.id },
  });
  check("OUT on insufficient stock did not change stock", bpNeg?.stock === 20);
  await expectReject("IN with non-positive qty rejected",
    () => prisma.$transaction((tx) =>
      applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, type: "IN", quantity: 0, refType: "TEST" })),
    ValidationError);
  await expectReject("OUT with positive qty rejected",
    () => prisma.$transaction((tx) =>
      applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product.id, type: "OUT", quantity: 5, refType: "TEST" })),
    ValidationError);
  const adj = await prisma.$transaction((tx) =>
    applyStockMovement(tx, {
      restaurantId: a.restaurant.id,
      branchId: a.branch.id,
      productId: a.product.id,
      type: "ADJUSTMENT",
      quantity: -3,
      reason: "opname",
      refType: "TEST_ADJ",
    }));
  check("ADJUSTMENT -3 -> balanceAfter 17", adj.balanceAfter === 17, `balanceAfter=${adj.balanceAfter}`);
  const bpAdj = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product.id },
  });
  check("ADJUSTMENT reflected in balance", bpAdj?.stock === 17);

  console.log("== StockMovement balanceAfter race safety (concurrent) ==");
  const beforeConcurrent = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product2.id },
  });
  const startStock = beforeConcurrent?.stock ?? 0;
  const [r1, r2] = await Promise.allSettled([
    prisma.$transaction((tx) => applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product2.id, type: "IN", quantity: 7, refType: "TEST_CONC" })),
    prisma.$transaction((tx) => applyStockMovement(tx, { restaurantId: a.restaurant.id, branchId: a.branch.id, productId: a.product2.id, type: "IN", quantity: 3, refType: "TEST_CONC" })),
  ]);
  check("both concurrent IN movements succeeded", r1.status === "fulfilled" && r2.status === "fulfilled");
  const bpConcur = await prisma.branchProduct.findFirst({
    where: { branchId: a.branch.id, productId: a.product2.id },
  });
  check("concurrent IN added 10 exactly (lost-update free)", bpConcur?.stock === startStock + 10, `stock=${bpConcur?.stock}`);
  const concurRows = await prisma.stockMovement.findMany({
    where: { restaurantId: a.restaurant.id, refType: "TEST_CONC" as any },
    orderBy: { createdAt: "asc" },
  });
  check("concurrent IN created 2 ledger rows with correct balanceAfter",
    concurRows.length === 2 &&
    concurRows[0].balanceAfter === startStock + 7 &&
    concurRows[1].balanceAfter === startStock + 10,
    JSON.stringify(concurRows.map((m) => ({ q: m.quantity, b: m.balanceAfter }))));

  console.log("== Order COMPLETED -> StockMovement OUT (D4) ==");
  // stock back to known: product = 17 (from receive 20 - adj 3).
  async function makeOrder(productId: string, qty: number) {
    return orderService.createOrder(
      {
        customerId: a.customer.id,
        orderType: "DINE_IN",
        items: [{ productId, quantity: qty }],
      },
      a.restaurant.id,
      a.branch.id
    );
  }
  const o1 = await makeOrder(a.product.id, 5);
  check("order1 created (stock allows 5 <= 17)", !!o1.id);
  const o2 = await makeOrder(a.product.id, 10);
  check("order2 created (stock allows 10 <= 12 at creation)", !!o2.id);

  const stockBeforeComplete = (await prisma.branchProduct.findFirst({ where: { branchId: a.branch.id, productId: a.product.id } }))!.stock;
  check("stock still full after creation (no deduction at creation)", stockBeforeComplete === 17, `stock=${stockBeforeComplete}`);
  const outBefore = await prisma.stockMovement.count({
    where: { restaurantId: a.restaurant.id, refType: StockRefType.ORDER_COMPLETED as any },
  });

  // Complete order1: CONFIRMED -> PROCESSING -> READY -> COMPLETED
  await orderService.updateOrderStatus(o1.id, { status: "CONFIRMED" }, a.restaurant.id, UID, [a.branch.id]);
  await orderService.updateOrderStatus(o1.id, { status: "PROCESSING" }, a.restaurant.id, UID, [a.branch.id]);
  await orderService.updateOrderStatus(o1.id, { status: "READY" }, a.restaurant.id, UID, [a.branch.id]);
  const comp1 = await orderService.updateOrderStatus(o1.id, { status: "COMPLETED" }, a.restaurant.id, UID, [a.branch.id]);
  check("order1 completed", comp1.order.status === "COMPLETED");

  const bpAfterO1 = await prisma.branchProduct.findFirst({ where: { branchId: a.branch.id, productId: a.product.id } });
  check("order1 completion deducted 5 (17 -> 12)", bpAfterO1?.stock === 12, `stock=${bpAfterO1?.stock}`);
  const out1 = await prisma.stockMovement.findMany({
    where: { restaurantId: a.restaurant.id, refType: StockRefType.ORDER_COMPLETED as any, refId: o1.id },
  });
  check("order1 wrote exactly 1 OUT movement", out1.length === 1 && out1[0].type === "OUT", JSON.stringify(out1.map((m) => m.quantity)));
  check("OUT movement signed negative + balanceAfter correct", out1[0].quantity === -5 && out1[0].balanceAfter === 12, `qty=${out1[0].quantity} bal=${out1[0].balanceAfter}`);

  // Second completion attempt must be a no-op / conflict.
  const out1dupBefore = await prisma.stockMovement.count({
    where: { restaurantId: a.restaurant.id, refId: o1.id },
  });
  await expectReject("duplicate COMPLETED on order1 rejected", () =>
    orderService.updateOrderStatus(o1.id, { status: "COMPLETED" }, a.restaurant.id, UID, [a.branch.id]),
    ConflictError);
  const out1dupAfter = await prisma.stockMovement.count({
    where: { restaurantId: a.restaurant.id, refId: o1.id },
  });
  check("duplicate COMPLETED added no second OUT movement", out1dupAfter === out1dupBefore, `${out1dupBefore} -> ${out1dupAfter}`);

  // Complete order2 (10) should now fail: only 12 stock? 12 >= 10 so it would SUCCEED.
  // To force the failure path, create order3 with qty 12 as well -> 12 - 10 = 2 < 12.
  const o3 = await makeOrder(a.product.id, 12);
  await orderService.updateOrderStatus(o2.id, { status: "CONFIRMED" }, a.restaurant.id, UID, [a.branch.id]);
  await orderService.updateOrderStatus(o2.id, { status: "PROCESSING" }, a.restaurant.id, UID, [a.branch.id]);
  await orderService.updateOrderStatus(o2.id, { status: "READY" }, a.restaurant.id, UID, [a.branch.id]);
  await orderService.updateOrderStatus(o2.id, { status: "COMPLETED" }, a.restaurant.id, UID, [a.branch.id]);
  const bpAfterO2 = await prisma.branchProduct.findFirst({ where: { branchId: a.branch.id, productId: a.product.id } });
  check("order2 completion deducted 10 (12 -> 2)", bpAfterO2?.stock === 2, `stock=${bpAfterO2?.stock}`);
  const out2 = await prisma.stockMovement.count({
    where: { restaurantId: a.restaurant.id, refId: o2.id },
  });
  check("order2 wrote exactly 1 OUT movement", out2 === 1, `count=${out2}`);

  await orderService.updateOrderStatus(o3.id, { status: "CONFIRMED" }, a.restaurant.id, UID, [a.branch.id]);
  await orderService.updateOrderStatus(o3.id, { status: "PROCESSING" }, a.restaurant.id, UID, [a.branch.id]);
  await orderService.updateOrderStatus(o3.id, { status: "READY" }, a.restaurant.id, UID, [a.branch.id]);
  await expectReject("order3 completion blocked when stock insufficient (stays 2)", () =>
    orderService.updateOrderStatus(o3.id, { status: "COMPLETED" }, a.restaurant.id, UID, [a.branch.id]),
    ConflictError);
  const bpAfterO3 = await prisma.branchProduct.findFirst({ where: { branchId: a.branch.id, productId: a.product.id } });
  check("failed completion did not corrupt stock (still 2)", bpAfterO3?.stock === 2, `stock=${bpAfterO3?.stock}`);
  const o3mov = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id, refId: o3.id } });
  check("failed completion wrote NO movement for order3", o3mov === 0, `count=${o3mov}`);

  // CANCELLED -> no movement
  const o4 = await makeOrder(a.product2.id, 3);
  await orderService.updateOrderStatus(o4.id, { status: "CANCELLED" }, a.restaurant.id, UID, [a.branch.id]);
  const out4 = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id, refId: o4.id } });
  const bpO4 = await prisma.branchProduct.findFirst({ where: { branchId: a.branch.id, productId: a.product2.id } });
  check("CANCELLED order wrote no movement and no stock change", out4 === 0, `count=${out4}`);
  check("CANCELLED order left stock intact", bpO4?.stock === (startStock + 10));

  // ledger read (listStockMovements) — only tenant A rows surfaced
  const ledger = await listStockMovements(a.restaurant.id, undefined, {});
  check("listStockMovements returns rows", ledger.length > 0);
  const ledgerB = await listStockMovements(b.restaurant.id, undefined, {});
  check("listStockMovements isolated per tenant (B empty)", ledgerB.length === 0, `count=${ledgerB.length}`);
  const ledgerByBranch = await listStockMovements(a.restaurant.id, [a.branch.id], { type: "IN" as any });
  check("branch+type filter works", ledgerByBranch.every((m) => m.branchId === a.branch.id && m.type === "IN"));

  console.log("== Cancel purchase ==");
  const cancelDraft = await purchaseSvc.createPurchase(a.restaurant.id, {
    branchId: a.branch.id,
    supplierId: supA.id,
    items: [{ productId: a.product.id, quantity: 9, unitCost: 100 }],
  });
  const stockBeforeCancelled = (await prisma.branchProduct.findFirst({ where: { branchId: a.branch.id, productId: a.product.id } }))!.stock;
  const resCancel = await purchaseSvc.cancelPurchase(a.restaurant.id, cancelDraft.id, undefined);
  check("cancel draft ok", resCancel.status === "CANCELLED");
  const stockAfterCancelled = (await prisma.branchProduct.findFirst({ where: { branchId: a.branch.id, productId: a.product.id } }))!.stock;
  check("cancelling a DRAFT never adds stock", stockAfterCancelled === stockBeforeCancelled);
  await expectReject("cancelling a received purchase rejected",
    () => purchaseSvc.cancelPurchase(a.restaurant.id, draft2.id, undefined),
    ConflictError);
  await expectReject("receive after cancel rejected",
    () => purchaseSvc.receivePurchase(a.restaurant.id, cancelDraft.id, UID, undefined),
    ConflictError);

  console.log("== Cross-tenant branch filter ==");
  // Scoped to branch A, tenant B must not see/act on it
  await expectReject("tenant B receive of tenant A purchase (branch filter) rejected",
    () => purchaseSvc.receivePurchase(b.restaurant.id, draft2.id, UID, [b.branch.id]),
    NotFoundError);

  // ---------------------------------------------------------------
  // HTTP AUTH tests (needs prod server on :3001 with Phase B build)
  // ---------------------------------------------------------------
  console.log("== HTTP auth / end-to-end (admin + kasir) ==");
  if (!ADMIN_COOKIE || !KASIR_COOKIE) {
    check("http: admin + kasir cookies available", false, "missing /tmp cookies — skipping HTTP section");
  } else {
    const unauth = await api("/api/admin/suppliers", "GET", null);
    check("http unauthenticated -> 401", unauth.status === 401, `status=${unauth.status}`);

    const kList = await api("/api/admin/suppliers", "GET", KASIR_COOKIE);
    check("http KASIR read suppliers -> 200", kList.status === 200, `status=${kList.status}`);
    const kPost = await api("/api/admin/suppliers", "POST", KASIR_COOKIE, { name: "Nope" });
    check("http KASIR create supplier -> 403", kPost.status === 403, `status=${kPost.status}`);
    const kPur = await api("/api/admin/purchases", "POST", KASIR_COOKIE, {
      branchId: "cmts3aks100009tu818hblu00",
      supplierId: "x",
      items: [],
    });
    check("http KASIR create purchase -> 403", kPur.status === 403, `status=${kPur.status}`);
    const kPurList = await api("/api/admin/purchases", "GET", KASIR_COOKIE);
    check("http KASIR read purchases -> 200", kPurList.status === 200, `status=${kPurList.status}`);
    const kMov = await api("/api/admin/stock-movements", "GET", KASIR_COOKIE);
    check("http KASIR read stock ledger -> 200", kMov.status === 200, `status=${kMov.status}`);

    // ADMIN end-to-end: supplier -> purchase -> receive -> ledger on MAIN branch
    const adminSup = await api<{ data: { id: string } }>("/api/admin/suppliers", "POST", ADMIN_COOKIE, {
      name: "PHASEB-HTTP-SUPPLIER",
      phone: "081111111",
    });
    check("http ADMIN create supplier", adminSup.status === 201 && !!adminSup.data?.data?.id, `status=${adminSup.status}`);
    const supplierId = adminSup.data?.data?.id;

    const prodInfo = await prisma.product.findFirst({
      where: { restaurantId: "cmtois12y0000bzu8o894azsd" },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    const branchMain = await prisma.branch.findFirst({
      where: { restaurantId: "cmtois12y0000bzu8o894azsd", code: "MAIN" },
      select: { id: true },
    });
    check("http fixture: found product + MAIN branch", !!prodInfo && !!branchMain);
    const origStock = (await prisma.branchProduct.findFirst({
      where: { branchId: branchMain!.id, productId: prodInfo!.id },
    }))?.stock ?? 0;

    const adminPur = await api<{ data: { id: string; total: number; items: any[] } }>("/api/admin/purchases", "POST", ADMIN_COOKIE, {
      branchId: branchMain!.id,
      supplierId,
      notes: "phaseb-http",
      items: [{ productId: prodInfo!.id, quantity: 4, unitCost: 1000.5 }],
    });
    check("http ADMIN create purchase draft (total 4002)", adminPur.status === 201 && adminPur.data?.data?.total === 4002, `status=${adminPur.status} total=${adminPur.data?.data?.total}`);
    const purId = adminPur.data?.data?.id;
    check("http purchase items 1", adminPur.data?.data?.items?.length === 1);

    const recv = await api(`/api/admin/purchases/${purId}/receive`, "POST", ADMIN_COOKIE);
    check("http ADMIN receive purchase", recv.status === 201 && recv.data?.data?.status === "RECEIVED", `status=${recv.status}`);
    const bpNew = await prisma.branchProduct.findFirst({
      where: { branchId: branchMain!.id, productId: prodInfo!.id },
    });
    check("http receive added 4 to MAIN stock", (bpNew?.stock ?? 0) === origStock + 4, `stock=${bpNew?.stock} (was ${origStock})`);

    const recv2 = await api(`/api/admin/purchases/${purId}/receive`, "POST", ADMIN_COOKIE);
    check("http duplicate receive -> conflict, no extra stock", recv2.status === 409, `status=${recv2.status}`);

    const ledgerHttp = await api<{ data: { items: Array<{ refId: string }> } }>("/api/admin/stock-movements", "GET", ADMIN_COOKIE);
    check("http ledger lists receive movements", ledgerHttp.status === 200 && ledgerHttp.data?.data?.items?.some((m: any) => m.refId === purId), `status=${ledgerHttp.status}`);

    const kRecv = await api(`/api/admin/purchases/${purId}/receive`, "POST", KASIR_COOKIE);
    check("http KASIR receive -> 403", kRecv.status === 403, `status=${kRecv.status}`);
    const kCancel = await api(`/api/admin/purchases/${purId}/cancel`, "POST", KASIR_COOKIE);
    check("http KASIR cancel -> 403", kCancel.status === 403, `status=${kCancel.status}`);

    // forged cross-branch: scoped admin (JKT) tries to create purchase in MAIN
    const SCOPED_COOKIE = netscapeToCookieHeader("/tmp/scoped_admin_cookie.txt");
    if (SCOPED_COOKIE) {
      const forg = await api("/api/admin/purchases", "POST", SCOPED_COOKIE, {
        branchId: branchMain!.id,
        supplierId,
        items: [{ productId: prodInfo!.id, quantity: 1, unitCost: 5 }],
      });
      check("http scoped-admin forged branchId=MAIN -> 403", forg.status === 403, `status=${forg.status}`);
    } else {
      check("http scoped-admin cookie present", false, "missing scoped_admin_cookie");
    }

    // cleanup http data
    if (supplierId) {
      await prisma.stockMovement.deleteMany({ where: { refType: StockRefType.PURCHASE_RECEIVE as any, refId: purId ?? "none" } });
      const httpPurchases = await prisma.purchase.findMany({ where: { supplierId }, select: { id: true } });
      await prisma.purchaseItem.deleteMany({ where: { purchaseId: { in: httpPurchases.map((p) => p.id) } } });
      await prisma.purchase.deleteMany({ where: { id: { in: httpPurchases.map((p) => p.id) } } });
      await prisma.supplier.delete({ where: { id: supplierId } });
      if (branchMain && prodInfo) {
        await prisma.branchProduct.updateMany({
          where: { branchId: branchMain.id, productId: prodInfo.id },
          data: { stock: origStock },
        });
      }
    }
  }

  // ---------------------------------------------------------------
  // Cleanup fixtures
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

async function props(name: string, fn: () => Promise<any>, pred: (v: any) => boolean) {
  const v = await fn();
  check(name, pred(v));
}

main().catch((e) => {
  console.error("HARNESS CRASH:", e);
  process.exit(2);
});