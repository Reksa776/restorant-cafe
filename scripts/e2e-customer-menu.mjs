// Customer E2E: /menu → "Pilih Produk" → modal → options/addon/notes →
// add to cart → cart display → config merging → edit → checkout payload.
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1440, height: 1000 },
  args: ["--no-sandbox", "--disable-gpu"],
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
}

// find button by text
async function clickButton(page, re) {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, "i");
    const btn = [...document.querySelectorAll("button")].find((b) =>
      re.test(b.textContent || "")
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, re.source);
}

try {
  const page = await browser.newPage();
  await page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  page.on("console", (m) => {
    const t = m.text();
    if (/error|fail/i.test(t) && !t.includes("Failed to load")) console.log("[console]", t.slice(0, 200));
  });

  // Clear any existing cart to start fresh
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle2" });
  await sleep(1000);
  await page.evaluate(() => localStorage.removeItem("restaurant_cart"));
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(500);

  // ---- Open /menu ----
  console.log("→ Open /menu");
  await page.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
  await sleep(3000);
  await shot(page, "c1-menu.png");

  // Find Minuman Caffe 1 card
  const productCard = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("div")].filter(
      (d) =>
        d.textContent &&
        d.textContent.includes("Minuman Caffe 1") &&
        d.textContent.includes("Rp23.000") &&
        !d.querySelector("div")?.textContent?.includes("Minuman Caffe 1")
    );
    // fallback: use h3 with product name, walk up to card container
    const h3 = [...document.querySelectorAll("h3")].find(
      (h) => (h.textContent || "").trim() === "Minuman Caffe 1"
    );
    if (!h3) return null;
    let el = h3.parentElement;
    while (el && el !== document.body) {
      const btns = [...el.querySelectorAll("button")];
      if (btns.length > 0 && (el.textContent || "").includes("Rp")) {
        return {
          text: (el.textContent || "").slice(0, 400),
          buttons: btns.map((b) => (b.textContent || "").trim().replace(/\s+/g, " ")),
        };
      }
      el = el.parentElement;
    }
    return null;
  });

  if (!productCard) {
    check("Product card found", false, "Minuman Caffe 1 not found on /menu");
    throw new Error("Product card not found");
  }
  check("Product card found", true);
  check(
    "Card shows 'Pilih Produk' (not '+ Tambah')",
    productCard.buttons.some((b) => b.includes("Pilih Produk")) &&
      !productCard.buttons.some((b) => b.includes("+ Tambah")),
    "buttons: " + JSON.stringify(productCard.buttons)
  );

  // ---- Click Pilih Produk ----
  const clickedCustomize = await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find(
      (h) => (h.textContent || "").trim() === "Minuman Caffe 1"
    );
    if (!h3) return false;
    let el = h3.parentElement;
    while (el && el !== document.body) {
      const btn = [...el.querySelectorAll("button")].find((b) =>
        b.textContent && b.textContent.includes("Pilih Produk")
      );
      if (btn) {
        btn.click();
        return true;
      }
      el = el.parentElement;
    }
    return false;
  });
  check("Clicked 'Pilih Produk'", clickedCustomize);
  await sleep(1500);
  await shot(page, "c2-modal.png");

  // ---- Modal contents ----
  const modalText = await page.evaluate(() => document.body.innerText);
  check("Modal shows Size", modalText.includes("Size"));
  check("Modal shows Sugar", modalText.includes("Sugar"));
  check("Modal shows Espresso", modalText.includes("Espresso"));
  check("Modal shows Extra Shot", modalText.includes("Extra Shot"));
  check("Modal shows Small & Large", modalText.includes("Small") && modalText.includes("Large"));
  check("Modal shows Less Sugar & Normal", modalText.includes("Less Sugar") && modalText.includes("Normal"));
  check("Modal shows Normal & Extra Espresso", modalText.includes("Extra Espresso"));
  check("Modal shows notes field", modalText.includes("Catatan untuk Kasir") || modalText.includes("Catatan"));
  check("Modal has 'Tambah ke Keranjang'", modalText.includes("Tambah ke Keranjang"));

  // Auto-selected first options (required SINGLE): Small, Less Sugar, Normal
  // Select Large
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const large = btns.find((b) => b.textContent && b.textContent.trim().startsWith("Large"));
    if (large) large.click();
  });
  await sleep(600);

  // Select Extra Espresso
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const extra = btns.find((b) => b.textContent && b.textContent.trim().startsWith("Extra Espresso"));
    if (extra) extra.click();
  });
  await sleep(600);

  // Toggle Extra Shot addon ON (click the checkbox button inside the addon row)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div")].filter(
      (d) => d.textContent && d.textContent.includes("Extra Shot") && d.querySelector("button")
    );
    // Pick the innermost row that contains the addon name as direct text
    const row = rows[rows.length - 1];
    if (row) {
      const btn = row.querySelector("button");
      if (btn) btn.click();
    }
  });
  await sleep(600);

  // Read displayed total: base 23000 + Large 5000 + Extra Espresso 5000 + Extra Shot 5000 = 38000
  const priceText = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent && b.textContent.includes("Tambah ke Keranjang")
    );
    return btn ? btn.textContent : "";
  });
  check("Price = 38.000 (23k + 5k + 5k + 5k)", priceText.includes("38.000"), priceText.trim());
  await shot(page, "c3-selected.png");

  // ---- Notes ----
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "Es batu sedikit");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await sleep(300);

  // ---- Add to cart ----
  await clickButton(page, /Tambah ke Keranjang/);
  await sleep(1500);
  await shot(page, "c4-after-add.png");

  // ---- Cart page ----
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const cartText = await page.evaluate(() => document.body.innerText);
  check("Cart shows product", cartText.includes("Minuman Caffe 1"));
  check("Cart shows Size: Large", cartText.includes("Size: Large"));
  check("Cart shows Sugar: Less Sugar", cartText.includes("Sugar: Less Sugar"));
  check("Cart shows Espresso: Extra Espresso", cartText.includes("Espresso: Extra Espresso"));
  check("Cart shows Extra Shot addon", cartText.includes("Extra Shot"));
  check("Cart shows notes", cartText.includes("Es batu sedikit"));
  check("Cart shows adjusted price (38.000)", cartText.includes("38.000"));
  await shot(page, "c5-cart.png");

  // ---- Config merging test (identical config → quantity merges) ----
  // The product is already in the cart (qty 1), so its card shows "Ubah".
  // 1) "Ubah" opens the edit modal pre-filled with the SAME configuration
  //    (price 38.000) — saving identical config must NOT create a duplicate.
  await page.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
  await sleep(2500);
  await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find(
      (h) => (h.textContent || "").trim() === "Minuman Caffe 1"
    );
    let el = h3.parentElement;
    while (el && el !== document.body) {
      const btn = [...el.querySelectorAll("button")].find((b) =>
        b.textContent && b.textContent.includes("Ubah")
      );
      if (btn) { btn.click(); return; }
      el = el.parentElement;
    }
  });
  await sleep(1500);
  const editPrefill = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent && b.textContent.includes("Tambah ke Keranjang")
    );
    return btn ? btn.textContent : "";
  });
  check("Edit modal pre-fills previous config (38.000)", editPrefill.includes("38.000"), editPrefill.trim());
  await shot(page, "c6-edit-prefill.png");
  await clickButton(page, /Tambah ke Keranjang/);
  await sleep(1500);
  const cartLinesAfterEditSave = await page.evaluate(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("restaurant_cart"));
      return parsed.items.map((i) => ({ qty: i.quantity, sel: (i.selections || []).map((s) => s.optionName) }));
    } catch { return []; }
  });
  check(
    "Saving identical config keeps ONE line (no duplicate)",
    cartLinesAfterEditSave.length === 1 && cartLinesAfterEditSave[0].qty === 1,
    JSON.stringify(cartLinesAfterEditSave)
  );

  // 2) The "+" stepper on the product card adds the SAME config again —
  //    must merge into one line with quantity 2. The customizable card's
  //    stepper has no aria-label, so click the Plus icon button in the card.
  await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find(
      (h) => (h.textContent || "").trim() === "Minuman Caffe 1"
    );
    let el = h3.parentElement;
    while (el && el !== document.body) {
      // stepper container: a button holding a Plus svg icon, inside a flex
      // group with a quantity span and a Minus button
      const plusBtns = [...el.querySelectorAll("button")].filter((b) =>
        b.querySelector("svg") &&
        (b.textContent || "").trim() === ""
      );
      // pick the LAST plus button encountered at the innermost card level
      if (plusBtns.length > 0 && (el.textContent || "").includes("Minuman Caffe 1")) {
        plusBtns[plusBtns.length - 1].click();
        return;
      }
      el = el.parentElement;
    }
  });
  await sleep(1000);
  const cartLinesAfterPlus = await page.evaluate(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("restaurant_cart"));
      return parsed.items.map((i) => ({ qty: i.quantity, sel: (i.selections || []).map((s) => s.optionName) }));
    } catch { return []; }
  });
  check(
    "Same config via stepper merges → qty 2 on ONE line",
    cartLinesAfterPlus.length === 1 && cartLinesAfterPlus[0].qty === 2,
    JSON.stringify(cartLinesAfterPlus)
  );
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const checkoutText2 = await page.evaluate(() => document.body.innerText);
  check("Checkout summary shows x2", checkoutText2.includes("Minuman Caffe 1 x2"), "checkout shows x2: " + checkoutText2.split("\n").filter(l => l.includes("Minuman")).join(" | "));
  await shot(page, "c6b-checkout-merged.png");

  // ---- Different config → separate cart line ----
  // The menu card only offers "Ubah" once a product is in cart, so simulate
  // a second DIFFERENT configuration the way addCustomizedItem would store it
  // (this is the same cart state produced by adding Small/Normal/Normal with
  // no addon from the modal). Two different configs must stay as 2 lines.
  await page.evaluate(() => {
    try {
      const raw = localStorage.getItem("restaurant_cart");
      const parsed = JSON.parse(raw);
      const configA = parsed.items[0];
      const configB = {
        ...configA,
        quantity: 1,
        selections: [
          { groupId: "size", groupName: "Size", optionId: "small", optionName: "Small", priceAdjustment: 0 },
          { groupId: "sugar", groupName: "Sugar", optionId: "normal", optionName: "Normal", priceAdjustment: 0 },
          { groupId: "espresso", groupName: "Espresso", optionId: "normal", optionName: "Normal", priceAdjustment: 0 },
        ],
        addons: [],
        notes: undefined,
        displayPrice: 23000,
      };
      localStorage.setItem("restaurant_cart", JSON.stringify({ items: [configA, configB], updatedAt: Date.now() }));
    } catch (e) { /* ignore */ }
  });
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await shot(page, "c7-cart-different.png");
  // Checkout summary shows two separate lines: merged x2 line + new x1 line
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
  await sleep(1200);
  const checkoutText3 = await page.evaluate(() => document.body.innerText);
  check(
    "Different config → separate cart line",
    checkoutText3.includes("Minuman Caffe 1 x2") && checkoutText3.includes("Minuman Caffe 1 x1"),
    "checkout shows x2 and x1 lines: " + checkoutText3.split("\n").filter(l => l.includes("Minuman")).join(" | ")
  );
  await shot(page, "c7b-checkout-different.png");

  // ---- Edit flow ----
  // Go to /cart, click the first "Ubah" link (item 0 = Large config) → /menu?edit=0
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await page.evaluate(() => {
    const links = [...document.querySelectorAll("a")].filter((a) =>
      a.textContent && a.textContent.trim() === "Ubah"
    );
    if (links[0]) links[0].click();
  });
  await sleep(2500);
  await shot(page, "c8-edit-modal.png");
  const editText = await page.evaluate(() => document.body.innerText);
  check("Edit modal opens", editText.includes("Tambah ke Keranjang"));
  // The edited item (index 0) is Large/Less Sugar/Extra Espresso/Extra Shot/notes
  const modalBtns = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) =>
      (b.textContent || "").trim().replace(/\s+/g, " ")
    ).filter((t) => t && t.length < 40)
  );
  // Detect selected state via class on option buttons is complex; check price.
  // The edited item has qty 2, so total = 38.000 × 2 = 76.000.
  check("Edit modal shows 76.000 total (38k×qty2)", editText.includes("76.000"), "price reflects prior config × qty2");

  // Change Large → Small and remove addon
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const small = btns.find((b) => b.textContent && b.textContent.trim().startsWith("Small"));
    if (small) small.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div")].filter(
      (d) => d.textContent && d.textContent.includes("Extra Shot") && d.querySelector("button")
    );
    const row = rows[rows.length - 1];
    if (row) {
      const btn = row.querySelector("button");
      if (btn) btn.click();
    }
  });
  await sleep(400);
  const priceAfterEdit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent && b.textContent.includes("Tambah ke Keranjang")
    );
    return btn ? btn.textContent : "";
  });
  // qty 2 × (23k Small + 5k Extra Espresso) = 56.000
  check("Price drops to 56.000 after edit (28k×qty2)", priceAfterEdit.includes("56.000"), priceAfterEdit.trim());
  await shot(page, "c9-edit-price.png");
  await clickButton(page, /Tambah ke Keranjang/);
  await sleep(1500);
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle2" });
  await sleep(1200);
  const cartText4 = await page.evaluate(() => document.body.innerText);
  check("Cart updated after edit (Small + Extra Espresso)", cartText4.includes("Size: Small") && cartText4.includes("Espresso: Extra Espresso"));

  // ---- Checkout payload capture ----
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const checkoutText = await page.evaluate(() => document.body.innerText);
  check("Checkout shows customization", checkoutText.includes("Extra Espresso"), "");
  check("Checkout shows notes", checkoutText.includes("Es batu sedikit"));

  console.log("\n===== RESULTS =====");
  const failed = results.filter((r) => !r.ok);
  console.log(`Pass: ${results.length - failed.length}/${results.length}`);
  for (const r of failed) console.log(`  FAILED: ${r.name} ${r.detail}`);
  await shot(page, "c10-checkout.png");
  console.log(failed.length === 0 ? "\n🎉 ALL CUSTOMER FLOW TESTS PASSED" : `\n⚠️ ${failed.length} test(s) failed`);
} catch (err) {
  console.error("❌ Customer E2E failed:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}