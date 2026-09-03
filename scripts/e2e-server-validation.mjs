// Server-side validation tests for POST /api/public/orders.
// Proves the server recomputes prices from DB and rejects invalid
// customization payloads (wrong product's options/addons, missing required
// selections, exceeding maxSelect).
const BASE = "http://localhost:3000";

const PRODUCT_ID = "cmtk4qdgq0000guu87ygdlvlz"; // Minuman Caffe 1
const GROUP_SIZE = "cmtkxd7ht000ky49dzrliax3y";
const GROUP_SUGAR = "cmtkxdeje000ny49dq6x2j7i6";
const GROUP_ESPRESSO = "cmtkxdlol000qy49d24xvj46r";
// Minuman Caffe 1 options
const OPT_SMALL = "cmtkxdajb000ly49djxexkals";
const OPT_LARGE = "cmtkxdcgr000my49dnkiqwnqk";
const OPT_LESS_SUGAR = "cmtkxfzqb000ty49dmzf4ziaf";
const OPT_NORMAL_SUGAR = "cmtkxg1qp000uy49ddayxykxz";
const OPT_NORMAL_ESP = "cmtkxhm50000wy49dpvfig8pk";
const OPT_EXTRA_ESP = "cmtkxg4nf000vy49dw812xaqt";
// Addon
const ADDON_SHOT = "cmtkxdquc000sy49ducsyq7m8";
// asdasd's option + addon (different product)
const OTHER_OPTION = "cmtkx2luv000gy49dgj9f6wc4"; // asdasd Size Large
const OTHER_ADDON = "cmtkwsy0o000ay49dm36ub7a0"; // asdasd "Extrak Espresso"

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

async function postOrder(items) {
  const res = await fetch(`${BASE}/api/public/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Test Validation",
      customerPhone: null,
      orderType: "TAKEAWAY",
      items,
    }),
  });
  return { status: res.status, body: await res.json() };
}

// ---- 1. VALID customized order ----
// Large(+5000) + Less Sugar(0) + Extra Espresso(+5000) + Extra Shot(5000)
// unit = 23000+5000+5000+5000 = 38000, qty 2 → line total 76000
const valid = await postOrder([
  {
    productId: PRODUCT_ID,
    quantity: 2,
    selections: [
      { groupId: GROUP_SIZE, groupName: "Size", optionId: OPT_LARGE, optionName: "Large", priceAdjustment: 99999 }, // client price IGNORED
      { groupId: GROUP_SUGAR, groupName: "Sugar", optionId: OPT_LESS_SUGAR, optionName: "Less Sugar", priceAdjustment: 0 },
      { groupId: GROUP_ESPRESSO, groupName: "Espresso", optionId: OPT_EXTRA_ESP, optionName: "Extra Espresso", priceAdjustment: 99999 },
    ],
    addons: [{ addonId: ADDON_SHOT, name: "Extra Shot", price: 99999, quantity: 1 }],
    notes: "Es batu sedikit",
  },
]);
check("Valid order → 201", valid.status === 201, "status " + valid.status + " " + (valid.body?.message || ""));
// subtotal 76000 + tax 7600 + serviceCharge 3800 = 87400
// (Prisma serializes Decimals as strings, hence Number())
check(
  "Server recomputes unit price from DB (38.000)",
  Number(valid.body?.data?.grandTotal) === 87400,
  "grandTotal " + valid.body?.data?.grandTotal
);

// ---- 2. Invalid option (option not in this product's groups) ----
const badOption = await postOrder([
  {
    productId: PRODUCT_ID,
    quantity: 1,
    selections: [
      { groupId: GROUP_SIZE, groupName: "Size", optionId: "fake-option-id", optionName: "Fake", priceAdjustment: 0 },
    ],
  },
]);
check("Invalid optionId → rejected", badOption.status === 400, "status " + badOption.status);

// ---- 3. Option from ANOTHER product ----
const foreignOption = await postOrder([
  {
    productId: PRODUCT_ID,
    quantity: 1,
    selections: [
      { groupId: GROUP_SIZE, groupName: "Size", optionId: OTHER_OPTION, optionName: "Large", priceAdjustment: 5000 },
      { groupId: GROUP_SUGAR, groupName: "Sugar", optionId: OPT_LESS_SUGAR, optionName: "Less Sugar", priceAdjustment: 0 },
      { groupId: GROUP_ESPRESSO, groupName: "Espresso", optionId: OPT_NORMAL_ESP, optionName: "Normal", priceAdjustment: 0 },
    ],
  },
]);
check("Option from another product → rejected", foreignOption.status === 400, "status " + foreignOption.status);

// ---- 4. Invalid addon ----
const badAddon = await postOrder([
  {
    productId: PRODUCT_ID,
    quantity: 1,
    selections: [
      { groupId: GROUP_SIZE, groupName: "Size", optionId: OPT_SMALL, optionName: "Small", priceAdjustment: 0 },
      { groupId: GROUP_SUGAR, groupName: "Sugar", optionId: OPT_LESS_SUGAR, optionName: "Less Sugar", priceAdjustment: 0 },
      { groupId: GROUP_ESPRESSO, groupName: "Espresso", optionId: OPT_NORMAL_ESP, optionName: "Normal", priceAdjustment: 0 },
    ],
    addons: [{ addonId: "fake-addon", name: "Fake", price: 100, quantity: 1 }],
  },
]);
check("Invalid addonId → rejected", badAddon.status === 400, "status " + badAddon.status);

// ---- 5. Addon from ANOTHER product ----
const foreignAddon = await postOrder([
  {
    productId: PRODUCT_ID,
    quantity: 1,
    selections: [
      { groupId: GROUP_SIZE, groupName: "Size", optionId: OPT_SMALL, optionName: "Small", priceAdjustment: 0 },
      { groupId: GROUP_SUGAR, groupName: "Sugar", optionId: OPT_LESS_SUGAR, optionName: "Less Sugar", priceAdjustment: 0 },
      { groupId: GROUP_ESPRESSO, groupName: "Espresso", optionId: OPT_NORMAL_ESP, optionName: "Normal", priceAdjustment: 0 },
    ],
    addons: [{ addonId: OTHER_ADDON, name: "Extrak Espresso", price: 2000, quantity: 1 }],
  },
]);
check("Addon from another product → rejected", foreignAddon.status === 400, "status " + foreignAddon.status);

// ---- 6. Missing required selection ----
const missingRequired = await postOrder([
  {
    productId: PRODUCT_ID,
    quantity: 1,
    selections: [
      { groupId: GROUP_SIZE, groupName: "Size", optionId: OPT_SMALL, optionName: "Small", priceAdjustment: 0 },
      // Sugar + Espresso missing
    ],
  },
]);
check("Missing required selection → rejected", missingRequired.status === 400, "status " + missingRequired.status);

// ---- 7. Exceeding maxSelect (SINGLE group: 2 selections for Size) ----
const overMax = await postOrder([
  {
    productId: PRODUCT_ID,
    quantity: 1,
    selections: [
      { groupId: GROUP_SIZE, groupName: "Size", optionId: OPT_SMALL, optionName: "Small", priceAdjustment: 0 },
      { groupId: GROUP_SIZE, groupName: "Size", optionId: OPT_LARGE, optionName: "Large", priceAdjustment: 5000 },
      { groupId: GROUP_SUGAR, groupName: "Sugar", optionId: OPT_LESS_SUGAR, optionName: "Less Sugar", priceAdjustment: 0 },
      { groupId: GROUP_ESPRESSO, groupName: "Espresso", optionId: OPT_NORMAL_ESP, optionName: "Normal", priceAdjustment: 0 },
    ],
  },
]);
check("Exceeding maxSelect → rejected", overMax.status === 400, "status " + overMax.status);

// ---- 8. No selections at all but product has required groups ----
const noSelections = await postOrder([
  { productId: PRODUCT_ID, quantity: 1 },
]);
check("No selections with required groups → rejected", noSelections.status === 400, "status " + noSelections.status);

// ---- 9. Non-customizable product direct add still works ----
const simpleProduct = await postOrder([
  { productId: "cmtefc7f100058mu8wk5r2zd5", quantity: 1 }, // Es Jeruk
]);
check("Plain product (no customization) still works", simpleProduct.status === 201, "status " + simpleProduct.status);

console.log("\n===== RESULTS =====");
const failed = results.filter((r) => !r.ok);
console.log(`Pass: ${results.length - failed.length}/${results.length}`);
for (const r of failed) console.log(`  FAILED: ${r.name} ${r.detail}`);
console.log(failed.length === 0 ? "\n🎉 ALL SERVER VALIDATION TESTS PASSED" : `\n⚠️ ${failed.length} test(s) failed`);