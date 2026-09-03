// Browser verification for the customer /menu redesign (Phase 11.10).
// Drives the installed Chrome via puppeteer-core against the dev server.
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3000";
const CHROME =
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});

async function freshPage() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["image", "font", "media"].includes(req.resourceType())) req.abort();
    else req.continue();
  });
  return page;
}

// ---------- 1. Desktop 1280 ----------
{
  const page = await freshPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
  await sleep(2500);

  const info = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const chips = buttons
      .map((b) => (b.textContent || "").trim())
      .filter((t) => ["Semua", "Makanan", "Minuman", "Snack"].includes(t));
    const h2s = [...document.querySelectorAll("h2")].map((h) => ({
      text: (h.textContent || "").trim(),
      size: getComputedStyle(h).fontSize,
    }));
    const grids = [...document.querySelectorAll(".grid")].filter((g) =>
      g.querySelector("h3")
    );
    const cardsInGrids = grids.map((g) => g.querySelectorAll("h3").length);
    // columns = number of grid-template-columns (robust even for 1-row grids)
    const columnCount = grids.length
      ? getComputedStyle(grids[0]).gridTemplateColumns.split(" ").length
      : 0;
    const cardEls = [...grids[0].querySelectorAll(".bg-white.rounded-xl")];
    const cardHeights = cardEls.map((c) => c.getBoundingClientRect().height);
    const overX = document.documentElement.scrollWidth - window.innerWidth;
    return {
      chips,
      headings: h2s,
      gridCount: grids.length,
      cardsInGrids,
      columnCount,
      cardHeights,
      overX,
      docW: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      productButtons: {
        pilih: buttons.filter((b) => (b.textContent || "").includes("Pilih Produk")).length,
        tambah: buttons.filter((b) => (b.textContent || "").includes("+ Tambah")).length,
      },
      // name/price font sizes of a sample card
      sample: (() => {
        const card = cardEls[0];
        if (!card) return null;
        const h3 = card.querySelector("h3");
        const price = [...card.querySelectorAll("p")].find((p) =>
          (p.textContent || "").startsWith("Rp")
        );
        return {
          nameSize: h3 ? getComputedStyle(h3).fontSize : null,
          priceSize: price ? getComputedStyle(price).fontSize : null,
          cardH: card.getBoundingClientRect().height,
        };
      })(),
    };
  });

  check("No category filter chips (Semua/Makanan/Minuman/Snack buttons)", info.chips.length === 0, JSON.stringify(info.chips));
  check("Products grouped with category <h2> headings", info.headings.length >= 3, JSON.stringify(info.headings.map((h) => h.text)));
  check("Heading readable size >= 18px", info.headings.every((h) => parseFloat(h.size) >= 18), JSON.stringify(info.headings));
  const totalCards = info.cardsInGrids.reduce((a, b) => a + b, 0);
  check("All products rendered (>=8 cards across sections)", totalCards >= 8, `cards per grid: ${JSON.stringify(info.cardsInGrids)}`);
  check("Desktop = 4 columns", info.columnCount === 4, `rows detected: ${info.columnCount}`);
  check("No horizontal overflow at 1280", info.overX <= 0, `scrollW=${info.docW} vw=${info.vw}`);
  check("Customizable product shows 'Pilih Produk'", info.productButtons.pilih >= 1, `${info.productButtons.pilih} found`);
  check("Plain product shows '+ Tambah'", info.productButtons.tambah >= 1, `${info.productButtons.tambah} found`);
  check(
    "Card height comfortable (>=150px no-image content card)",
    info.cardHeights.length > 0 && info.cardHeights.every((h) => h >= 150 && h <= 420),
    `heights: ${JSON.stringify(info.cardHeights.slice(0, 6))}`
  );
  check("Name font >= 14px & price >= 15px", (() => {
    if (!info.sample) return false;
    return parseFloat(info.sample.nameSize) >= 14 && parseFloat(info.sample.priceSize) >= 15;
  })(), JSON.stringify(info.sample));

  await page.screenshot({ path: "shots/menu-redesign-desktop.png", fullPage: true });
  await page.close();
}

// ---------- 2. Mobile 390 — add plain product, stepper, cart bar, clearance ----------
{
  const page = await freshPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
  await sleep(2500);

  const info = await page.evaluate(() => {
    const grids = [...document.querySelectorAll(".grid")].filter((g) => g.querySelector("h3"));
    const first = grids[0];
    const rows = new Set();
    const cardEls = [...first.querySelectorAll(".bg-white.rounded-xl")];
    cardEls.slice(0, 4).forEach((c) => rows.add(Math.round(c.getBoundingClientRect().top)));
    return {
      columnCount: rows.size,
      overX: document.documentElement.scrollWidth - window.innerWidth,
      cardH: cardEls.length ? cardEls[0].getBoundingClientRect().height : 0,
    };
  });
  check("Mobile 390 = 2 columns", info.columnCount === 2, `cols=${info.columnCount}`);
  check("No horizontal overflow at 390", info.overX <= 0, `overX=${info.overX}`);
  check("Mobile card comfortable (>=140px)", info.cardH >= 140, `cardH=${info.cardH}`);

  // Add a plain product
  const added = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("+ Tambah")
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  check("Clicked '+ Tambah' on a plain product", added);
  await sleep(1500);

  const after = await page.evaluate(() => {
    const steppers = [...document.querySelectorAll("button")].filter((b) =>
      b.getAttribute("aria-label") && b.getAttribute("aria-label").startsWith("Kurangi")
    );
    const bar = [...document.querySelectorAll("div")].find((d) =>
      (d.textContent || "").includes("item") && (d.textContent || "").includes("Lihat") &&
      d.querySelector("a[href='/cart']") && getComputedStyle(d).position === "fixed"
    );
    return { stepperCount: steppers.length, hasCartBar: !!bar, total: (document.body.textContent || "").match(/(\d+) item/)?.[1] };
  });
  check("Cart shows stepper on that product card", after.stepperCount >= 1, `steppers=${after.stepperCount}`);
  check("Bottom cart bar appears", after.hasCartBar && after.total >= "1", JSON.stringify(after));

  // Scroll to bottom: last product must not be hidden behind the cart bar
  const clearance = await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    const cards = [...document.querySelectorAll(".bg-white.rounded-xl")];
    const last = cards[cards.length - 1];
    const bar = [...document.querySelectorAll("div")].find((d) =>
      d.querySelector("a[href='/cart']") && getComputedStyle(d).position === "fixed"
    );
    if (!last || !bar) return null;
    const c = last.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return { lastCardBottom: Math.round(c.bottom), barTop: Math.round(b.top), visible: c.bottom <= b.top };
  });
  check("Last product not hidden behind cart bar", clearance && clearance.visible, JSON.stringify(clearance));

  await page.screenshot({ path: "shots/menu-redesign-mobile-390.png", fullPage: true });

  // Open the customization modal for Minuman Caffe 1 (not the first 'Pilih Produk')
  await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find(
      (h) => (h.textContent || "").trim() === "Minuman Caffe 1"
    );
    let el = h3;
    while (el && el !== document.body) {
      const btn = [...el.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === "Pilih Produk"
      );
      if (btn) {
        btn.click();
        return;
      }
      el = el.parentElement;
    }
  });
  await sleep(1200);
  const modal = await page.evaluate(() => {
    const t = document.body.textContent || "";
    return {
      hasSize: t.includes("Size"),
      hasSugar: t.includes("Sugar"),
      hasEspresso: t.includes("Espresso"),
      hasShot: t.includes("Extra Shot"),
    };
  });
  check(
    "Modal opens with Size + Sugar + Espresso + Extra Shot",
    modal.hasSize && modal.hasSugar && modal.hasEspresso && modal.hasShot,
    JSON.stringify(modal)
  );
  await page.screenshot({ path: "shots/menu-redesign-modal-390.png" });
  await page.close();
}

// ---------- 3. Mobile 412 ----------
{
  const page = await freshPage();
  await page.setViewport({ width: 412, height: 915 });
  await page.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
  await sleep(2200);
  const info = await page.evaluate(() => {
    const grids = [...document.querySelectorAll(".grid")].filter((g) => g.querySelector("h3"));
    const cardEls = [...grids[0].querySelectorAll(".bg-white.rounded-xl")];
    return {
      overX: document.documentElement.scrollWidth - window.innerWidth,
      cardH: cardEls.length ? cardEls[0].getBoundingClientRect().height : 0,
      cols: grids.length ? getComputedStyle(grids[0]).gridTemplateColumns.split(" ").length : 0,
    };
  });
  check("Mobile 412 = 2 cols, no overflow, comfortable", info.cols === 2 && info.overX <= 0 && info.cardH >= 140, JSON.stringify(info));
  await page.close();
}

// ---------- 4. Tablet 768 ----------
{
  const page = await freshPage();
  await page.setViewport({ width: 768, height: 1024 });
  await page.goto(`${BASE}/menu`, { waitUntil: "networkidle2" });
  await sleep(2200);
  const info = await page.evaluate(() => {
    const grids = [...document.querySelectorAll(".grid")].filter((g) => g.querySelector("h3"));
    const cardEls = [...grids[0].querySelectorAll(".bg-white.rounded-xl")];
    return {
      overX: document.documentElement.scrollWidth - window.innerWidth,
      cardH: cardEls.length ? cardEls[0].getBoundingClientRect().height : 0,
      cols: grids.length ? getComputedStyle(grids[0]).gridTemplateColumns.split(" ").length : 0,
    };
  });
  check("Tablet 768 = 3 cols, no overflow", info.cols === 3 && info.overX <= 0, JSON.stringify(info));
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks PASSED ====`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(" | "));
