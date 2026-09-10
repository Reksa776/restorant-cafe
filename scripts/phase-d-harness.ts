/**
 * PHASE D — REPORT + FINAL REGRESSION TEST HARNESS (read/write against dev DB).
 * Run: npx tsx scripts/phase-d-harness.ts
 *
 * Covers the Phase D report semantics on top of the Phase B/C foundation:
 *   - purchase report: DRAFT ≠ received stock, RECEIVED = stock in,
 *     CANCELLED never received; summary / detail / product / supplier
 *     breakdowns; status + supplier filters; cross-tenant isolation
 *   - inventory report: current stock ALWAYS from BranchProduct.stock
 *     (never a ledger replay); movement table from the ledger; summary
 *     in/out/adjustment; product stock summary; type/product/category/branch
 *     filters; opening the report NEVER creates movements or mutates stock
 *   - CSV helpers: UTF-8 BOM + CRLF + RFC 4180 + formula-injection guard
 *   - period resolution: invalid custom dates / inverted ranges -> 400-class
 *
 * Hard-coded markers (PHASED-*) identify the created test data. Tenants are
 * deleted at the end (no database reset, no production data touched).
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { applyStockMovement } from "@/services/stock/stock.service";
import * as supplierSvc from "@/services/supplier/supplier.service";
import * as purchaseSvc from "@/services/purchase/purchase.service";
import {
  reportService,
  resolveReportRange,
} from "@/services/report/report.service";
import { ValidationError } from "@/lib/errors";
import { csvCell, buildCsv } from "@/lib/csv";

const RA = "PHASED-A";
const RB = "PHASED-B";

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
  const category2 = await prisma.category.create({
    data: { restaurantId: restaurant.id, name: `${label} Cat2` },
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
      categoryId: category2.id,
      name: `${label} Es Teh`,
      price: 8000,
      isActive: true,
      isAvailable: true,
    },
  });
  return { restaurant, branch, category, category2, product, product2 };
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

const WIDE = { startDate: "2000-01-01", endDate: "2100-01-01" };

// ---------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------

async function main() {
  console.log("== Phase D fixtures ==");
  const a = await createTenant(RA);
  const b = await createTenant(RB);
  const UID = (await prisma.user.findFirst({ select: { id: true, name: true } }))!;

  const supA = await supplierSvc.createSupplier(a.restaurant.id, { name: `${RA} Supplier` });
  const supB = await supplierSvc.createSupplier(b.restaurant.id, { name: `${RB} Supplier` });

  // ---------------------------------------------------------------
  console.log("== Purchase report fixtures ==");
  // P1 DRAFT (never received): product1 x2 @1000
  const p1 = await purchaseSvc.createPurchase(a.restaurant.id, {
    branchId: a.branch.id,
    supplierId: supA.id,
    items: [{ productId: a.product.id, quantity: 2, unitCost: 1000 }],
  });
  // P2 RECEIVED: product1 x3 @1000 + product2 x1 @2000
  const p2 = await purchaseSvc.createPurchase(a.restaurant.id, {
    branchId: a.branch.id,
    supplierId: supA.id,
    items: [
      { productId: a.product.id, quantity: 3, unitCost: 1000 },
      { productId: a.product2.id, quantity: 1, unitCost: 2000 },
    ],
  });
  await purchaseSvc.receivePurchase(a.restaurant.id, p2.id, UID.id, undefined);
  // P3 CANCELLED: product1 x1 @1000
  const p3 = await purchaseSvc.createPurchase(a.restaurant.id, {
    branchId: a.branch.id,
    supplierId: supA.id,
    items: [{ productId: a.product.id, quantity: 1, unitCost: 1000 }],
  });
  await purchaseSvc.cancelPurchase(a.restaurant.id, p3.id, undefined);

  // Cross-tenant fixture: tenant B has its own RECEIVED purchase.
  const pb = await purchaseSvc.createPurchase(b.restaurant.id, {
    branchId: b.branch.id,
    supplierId: supB.id,
    items: [{ productId: b.product.id, quantity: 9, unitCost: 500 }],
  });
  await purchaseSvc.receivePurchase(b.restaurant.id, pb.id, UID.id, undefined);

  // ---------------------------------------------------------------
  console.log("== Purchase report — summary semantics ==");
  const purAll = await reportService.getPurchaseReport(a.restaurant.id, "custom", {
    ...WIDE,
    filters: {},
  });
  const s = purAll.summary;
  check("summary: totalPurchases = 3 (DRAFT + RECEIVED + CANCELLED)", s.totalPurchases === 3, `got ${s.totalPurchases}`);
  check("summary: totalValue = 8000 (2000+5000+1000)", s.totalValue === 8000, `got ${s.totalValue}`);
  check("summary: totalReceived = 1 (only RECEIVED counts as stock in)", s.totalReceived === 1, `got ${s.totalReceived}`);
  check("summary: totalCancelled = 1", s.totalCancelled === 1, `got ${s.totalCancelled}`);
  check("summary: totalItemsPurchased = 4 item rows", s.totalItemsPurchased === 4, `got ${s.totalItemsPurchased}`);
  check("summary: totalQuantity = 7 (2+3+1+1)", s.totalQuantity === 7, `got ${s.totalQuantity}`);

  // Detail rows
  const p1row = purAll.items.find((r) => r.id === p1.id);
  const p2row = purAll.items.find((r) => r.id === p2.id);
  const p3row = purAll.items.find((r) => r.id === p3.id);
  check("detail: DRAFT row has 1 item / qty 2 / total 2000 / no receivedAt",
    p1row?.itemCount === 1 && p1row?.totalQuantity === 2 && p1row?.total === 2000 && p1row?.receivedAt === null,
    JSON.stringify(p1row));
  check("detail: DRAFT row createdBy null (no receive movement)", p1row?.createdBy === null, `createdBy=${p1row?.createdBy}`);
  check("detail: RECEIVED row has 2 items / qty 4 / total 5000 / receivedAt set",
    p2row?.itemCount === 2 && p2row?.totalQuantity === 4 && p2row?.total === 5000 && !!p2row?.receivedAt,
    JSON.stringify(p2row));
  check("detail: RECEIVED row createdBy = receiving user",
    p2row?.createdBy === UID.name, `createdBy=${p2row?.createdBy}`);
  check("detail: CANCELLED row status + no receivedAt",
    p3row?.status === "CANCELLED" && p3row?.receivedAt === null, JSON.stringify(p3row));
  check("detail: supplier/branch names hydrated",
    p2row?.supplierName === `${RA} Supplier` && p2row?.branchCode === `${RA}-BR`, JSON.stringify(p2row));

  // Product breakdown (all statuses)
  const prod1 = purAll.productBreakdown.find((r) => r.productId === a.product.id);
  const prod2 = purAll.productBreakdown.find((r) => r.productId === a.product2.id);
  check("product breakdown: product1 qty 6 / cost 6000 / avg 1000 / 3 purchases",
    prod1?.quantityPurchased === 6 && prod1?.totalCost === 6000 && prod1?.averageUnitCost === 1000 && prod1?.numberOfPurchases === 3,
    JSON.stringify(prod1));
  check("product breakdown: product2 qty 1 / cost 2000 / avg 2000 / 1 purchase",
    prod2?.quantityPurchased === 1 && prod2?.totalCost === 2000 && prod2?.averageUnitCost === 2000 && prod2?.numberOfPurchases === 1,
    JSON.stringify(prod2));
  check("product breakdown: names hydrated", prod1?.name === `${RA} Nasi Goreng`, `name=${prod1?.name}`);

  // Supplier breakdown
  const supRow = purAll.supplierBreakdown.find((r) => r.supplierId === supA.id);
  check("supplier breakdown: 3 purchases / qty 7 / totalValue 8000",
    supRow?.numberOfPurchases === 3 && supRow?.quantity === 7 && supRow?.totalValue === 8000,
    JSON.stringify(supRow));

  // Status filter: only RECEIVED
  const purRecv = await reportService.getPurchaseReport(a.restaurant.id, "custom", {
    ...WIDE,
    filters: { status: "RECEIVED" },
  });
  check("status=RECEIVED: 1 purchase / value 5000 / received 1 / cancelled 0",
    purRecv.summary.totalPurchases === 1 && purRecv.summary.totalValue === 5000 &&
      purRecv.summary.totalReceived === 1 && purRecv.summary.totalCancelled === 0 &&
      purRecv.summary.totalQuantity === 4,
    JSON.stringify(purRecv.summary));
  check("status=RECEIVED: product breakdown only received qty (4)",
    purRecv.productBreakdown.reduce((sum, r) => sum + r.quantityPurchased, 0) === 4,
    JSON.stringify(purRecv.productBreakdown));

  // Supplier filter: exclude all rows (foreign supplier)
  const purSup = await reportService.getPurchaseReport(a.restaurant.id, "custom", {
    ...WIDE,
    filters: { supplierId: supB.id },
  });
  check("supplier filter (foreign supplier): 0 purchases", purSup.summary.totalPurchases === 0, `got ${purSup.summary.totalPurchases}`);

  // Cross-tenant isolation: tenant B's purchase never leaks into tenant A.
  const purB = await reportService.getPurchaseReport(b.restaurant.id, "custom", {
    ...WIDE,
    filters: {},
  });
  check("cross-tenant isolation: tenant B report sees only its own purchase",
    purB.summary.totalPurchases === 1 && purB.summary.totalValue === 4500,
    JSON.stringify(purB.summary));

  // ---------------------------------------------------------------
  console.log("== Inventory report — ledger + stock semantics ==");
  // Ledger so far (tenant A): 2 IN from P2 receive (+3 product1, +1 product2).
  // Add ADJUSTMENT +2 on product1 and OUT -1 on product1 (simulating order
  // completion, which the real order flow also writes as type OUT).
  await prisma.$transaction((tx) =>
    applyStockMovement(tx, {
      restaurantId: a.restaurant.id,
      branchId: a.branch.id,
      productId: a.product.id,
      type: "ADJUSTMENT",
      quantity: 2,
      reason: "PHASED adjust",
      userId: UID.id,
    })
  );
  await prisma.$transaction((tx) =>
    applyStockMovement(tx, {
      restaurantId: a.restaurant.id,
      branchId: a.branch.id,
      productId: a.product.id,
      type: "OUT",
      quantity: -1,
      reason: "PHASED order complete",
      userId: UID.id,
    })
  );

  const invBefore = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id } });
  const bpBefore = await prisma.branchProduct.findMany({ where: { branchId: a.branch.id } });

  const inv = await reportService.getInventoryReport(a.restaurant.id, "custom", {
    ...WIDE,
    filters: {},
  });

  const invAfter = await prisma.stockMovement.count({ where: { restaurantId: a.restaurant.id } });
  const bpAfter = await prisma.branchProduct.findMany({ where: { branchId: a.branch.id } });
  check("opening inventory report created NO movements", invAfter === invBefore, `before=${invBefore} after=${invAfter}`);
  check("opening inventory report did NOT mutate BranchProduct stock",
    JSON.stringify(bpAfter) === JSON.stringify(bpBefore), "branchproduct changed");

  const curP1 = await stockOf(a.branch.id, a.product.id);
  const curP2 = await stockOf(a.branch.id, a.product2.id);
  check("fixture stocks: product1 = 4 (0+3+2-1), product2 = 1 (0+1)",
    curP1 === 4 && curP2 === 1, `p1=${curP1} p2=${curP2}`);

  const is = inv.summary;
  check("inventory summary: totalStock = 5 (BranchProduct sum, NOT ledger replay)",
    is.totalStock === 5, `got ${is.totalStock} (branchproduct ${curP1 + curP2})`);
  check("inventory summary: stockIn = 4 (3+1)", is.stockIn === 4, `got ${is.stockIn}`);
  check("inventory summary: stockOut = -1 (signed)", is.stockOut === -1, `got ${is.stockOut}`);
  check("inventory summary: adjustment = +2", is.adjustment === 2, `got ${is.adjustment}`);
  check("inventory summary: movements = 4 (2 IN + 1 ADJ + 1 OUT)", is.movements === 4, `got ${is.movements}`);

  check("movement table: 4 rows newest-first with names",
    inv.items.length === 4 &&
      inv.items.every((m) => m.productName && (m.branchCode === `${RA}-BR`) && typeof m.userName === "string"),
    JSON.stringify(inv.items.map((m) => ({ t: m.type, q: m.quantity, b: m.balanceAfter }))));
  const outRow = inv.items.find((m) => m.type === "OUT");
  check("movement table: OUT row signed -1 + balanceAfter 4",
    outRow?.quantity === -1 && outRow?.balanceAfter === 4, JSON.stringify(outRow));
  const adjRow = inv.items.find((m) => m.type === "ADJUSTMENT");
  // Ledger chain for product1: IN +3 -> balanceAfter 3, ADJ +2 -> 5, OUT -1 -> 4.
  check("movement table: ADJUSTMENT +2 balanceAfter 5", adjRow?.quantity === 2 && adjRow?.balanceAfter === 5, JSON.stringify(adjRow));

  // Product stock summary — current stock from BranchProduct.
  const ps1 = inv.productStockSummary.find((r) => r.productId === a.product.id);
  const ps2 = inv.productStockSummary.find((r) => r.productId === a.product2.id);
  check("stock summary: product1 currentStock 4 (BranchProduct), in 3, out -1, adj 2",
    ps1?.currentStock === 4 && ps1?.stockIn === 3 && ps1?.stockOut === -1 && ps1?.adjustment === 2,
    JSON.stringify(ps1));
  check("stock summary: product2 currentStock 1, in 1, out 0, adj 0",
    ps2?.currentStock === 1 && ps2?.stockIn === 1 && ps2?.stockOut === 0 && ps2?.adjustment === 0,
    JSON.stringify(ps2));
  check("stock summary: lastMovement set for product1 (in range)",
    !!ps1?.lastMovement, `lastMovement=${ps1?.lastMovement}`);

  // Type filter
  const invAdj = await reportService.getInventoryReport(a.restaurant.id, "custom", {
    ...WIDE,
    filters: { type: "ADJUSTMENT" },
  });
  check("type=ADJUSTMENT: 1 movement, summary.adjustment = +2",
    invAdj.summary.movements === 1 && invAdj.summary.adjustment === 2 && invAdj.items.every((m) => m.type === "ADJUSTMENT"),
    JSON.stringify(invAdj.summary));

  // Product filter
  const invProd = await reportService.getInventoryReport(a.restaurant.id, "custom", {
    ...WIDE,
    filters: { productId: a.product2.id },
  });
  check("product filter: only product2 (1 IN movement)",
    invProd.summary.movements === 1 && invProd.items.every((m) => m.productId === a.product2.id),
    JSON.stringify(invProd.summary));

  // Category filter
  const invCat = await reportService.getInventoryReport(a.restaurant.id, "custom", {
    ...WIDE,
    filters: { categoryId: a.category.id },
  });
  check("category filter: only category-1 movements (3 of 4) + current stock 4",
    invCat.summary.movements === 3 && invCat.summary.totalStock === 4,
    JSON.stringify(invCat.summary));

  // Branch filter (foreign branch of same restaurant? none — tenant B branch)
  const invForeign = await reportService.getInventoryReport(b.restaurant.id, "custom", {
    ...WIDE,
    filters: {},
    branchFilters: [a.branch.id],
  });
  check("branchFilters for another tenant's branch: empty report",
    invForeign.summary.movements === 0 && invForeign.summary.totalStock === 0,
    JSON.stringify(invForeign.summary));

  // Idempotency: two consecutive reads return identical current stock.
  const inv2 = await reportService.getInventoryReport(a.restaurant.id, "custom", {
    ...WIDE,
    filters: {},
  });
  check("inventory report idempotent (totalStock stable across reads)",
    inv2.summary.totalStock === inv.summary.totalStock, `a=${inv.summary.totalStock} b=${inv2.summary.totalStock}`);

  // ---------------------------------------------------------------
  console.log("== CSV helpers — BOM/CRLF/escaping/formula guard ==");
  check("csvCell: number 123 untouched", csvCell(123) === "123", csvCell(123));
  check("csvCell: negative number -5 untouched", csvCell(-5) === "-5", csvCell(-5));
  check("csvCell: plain text untouched", csvCell("abc") === "abc", csvCell("abc"));
  check("csvCell: null -> empty", csvCell(null) === "");
  check("csvCell: comma quoted per RFC 4180", csvCell("a,b") === '"a,b"', csvCell("a,b"));
  check("csvCell: quote doubled", csvCell('say "hi"') === '"say ""hi"""', csvCell('say "hi"'));
  check("csvCell: = formula guarded", csvCell("=SUM(A1:A9)") === "'=SUM(A1:A9)", csvCell("=SUM(A1:A9)"));
  check("csvCell: + formula guarded", csvCell("+cmd|' /C calc") === "'+cmd|' /C calc", csvCell("+cmd|' /C calc"));
  check("csvCell: @ formula guarded", csvCell("@SUM(1)") === "'@SUM(1)", csvCell("@SUM(1)"));
  check("csvCell: - prefix guarded (text)", csvCell("-2+3") === "'-2+3", csvCell("-2+3"));
  check("csvCell: guarded value still escapes inner quotes",
    csvCell('="a"') === `"'=""a"""`, csvCell('="a"'));
  const csv = buildCsv(["A", "B"], [["x", 1]]);
  check("buildCsv: UTF-8 BOM prefix", csv.startsWith("\uFEFF"), JSON.stringify(csv.slice(0, 4)));
  check("buildCsv: CRLF line endings", csv.includes("\r\n"), JSON.stringify(csv));
  check("buildCsv: RFC 4180 row joins", csv.split("\r\n").length === 2, `${csv.split("\r\n").length} lines`);

  // ---------------------------------------------------------------
  console.log("== Period resolution ==");
  const okRange = resolveReportRange("custom", "2026-01-01", "2026-01-31");
  check("custom range resolves to [startOfDay, endOfDay]",
    okRange.start.getHours() === 0 && okRange.end.getHours() === 23,
    `${okRange.start} .. ${okRange.end}`);
  await expectReject("custom range invalid startDate throws ValidationError",
    () => Promise.resolve().then(() => resolveReportRange("custom", "not-a-date", "2026-01-31")),
    ValidationError);
  await expectReject("custom range start > end throws ValidationError",
    () => Promise.resolve().then(() => resolveReportRange("custom", "2026-02-01", "2026-01-01")),
    ValidationError);
  await expectReject("custom range missing endDate throws ValidationError",
    () => Promise.resolve().then(() => resolveReportRange("custom", "2026-01-01", undefined)),
    ValidationError);
  const today = resolveReportRange("today");
  check("today range starts at local midnight", today.start.getHours() === 0 && today.start.getMinutes() === 0);

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