// Verify: (1) product WITH image renders at 4:3 (temp imageUrl, then restore),
// (2) after adding a customized product the card shows Ubah + stepper.
import puppeteer from "puppeteer-core";
import { createConnection } from "mysql2/promise";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conn = await createConnection({
  host: "localhost",
  port: 3306,
  user: "root",
  password: "",
  database: "restaurant_app",
});

// Grab product id for "Minuman Caffe 1"
const [rows] = await conn.query(
  "SELECT id FROM Product WHERE name = ? AND isActive = 1 LIMIT 1",
  ["Minuman Caffe 1"]
);
const pid = rows[0]?.id;
if (!pid) {
  console.log("FAIL product not found");
  process.exit(1);
}

// Temporary image (existing project asset /file.svg — no new image created)
await conn.query("UPDATE Product SET imageUrl = ? WHERE id = ?", ["/file.svg", pid]);
console.log("Temp imageUrl set on", pid);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto("http://localhost:3000/menu", { waitUntil: "networkidle2" });
await sleep(2500);

const withImg = await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find(
    (h) => (h.textContent || "").trim() === "Minuman Caffe 1"
  );
  let el = h3;
  let card = null;
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains("rounded-xl")) {
      card = el;
      break;
    }
    el = el.parentElement;
  }
  if (!card) return null;
  const img = card.querySelector("img");
  const btn = [...card.querySelectorAll("button")].find((b) =>
    (b.textContent || "").includes("Pilih Produk")
  );
  const r = card.getBoundingClientRect();
  const ir = img ? img.getBoundingClientRect() : null;
  return {
    hasImg: !!img,
    imgSrc: img ? img.getAttribute("src") : null,
    imgRatio: ir ? +(ir.width / ir.height).toFixed(2) : null,
    imgClass: img ? img.className : null,
    cardH: Math.round(r.height),
    hasPilih: !!btn,
  };
});

console.log("WITH IMAGE:", JSON.stringify(withImg));
const imgOk = withImg && withImg.hasImg && withImg.imgSrc === "/file.svg" &&
  Math.abs(withImg.imgRatio - 1.333) < 0.02 && withImg.imgClass.includes("object-cover");
console.log((imgOk ? "PASS" : "FAIL") + "  Image renders 4:3 object-cover, card keeps Pilih Produk, height " + withImg?.cardH);

// Open modal -> accept defaults (Small/Less Sugar/Normal) -> add to cart
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
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    (b.textContent || "").includes("Tambah ke Keranjang")
  );
  if (btn) btn.click();
});
await sleep(1500);

const afterAdd = await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find(
    (h) => (h.textContent || "").trim() === "Minuman Caffe 1"
  );
  let el = h3;
  let card = null;
  while (el && el !== document.body) {
    if (el.classList && el.classList.contains("rounded-xl")) {
      card = el;
      break;
    }
    el = el.parentElement;
  }
  if (!card) return null;
  const ubah = [...card.querySelectorAll("button")].find((b) =>
    (b.textContent || "").trim() === "Ubah"
  );
  const dec = card.querySelector("button[aria-label*='Kurangi']");
  const inc = card.querySelector("button[aria-label*='Tambah']");
  return {
    hasUbah: !!ubah,
    hasDec: !!dec,
    hasInc: !!inc,
    qty: (card.textContent || "").match(/\b([0-9]+)\b/)?.[1],
    cardH: Math.round(card.getBoundingClientRect().height),
  };
});
console.log("AFTER ADD (image product):", JSON.stringify(afterAdd));
const ubahOk = afterAdd && afterAdd.hasUbah && afterAdd.hasDec && afterAdd.hasInc && afterAdd.qty === "1";
console.log((ubahOk ? "PASS" : "FAIL") + "  Card shows Ubah + [- 1 +] after custom add (qty 1)");

await page.screenshot({ path: "shots/menu-redesign-image-ubah.png" });
await browser.close();

// Restore original state (imageUrl was null)
await conn.query("UPDATE Product SET imageUrl = NULL WHERE id = ?", [pid]);
console.log("ImageUrl restored to NULL");
await conn.end();
