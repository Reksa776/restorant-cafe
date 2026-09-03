// E2E: drive the real Admin UI (/admin/menu) to create customization data
// for "Minuman Caffe 1" — Size/Sugar/Espresso option groups + Extra Shot addon.
// Uses puppeteer-core + installed Chrome. Idempotent: checks before creating.
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";
import path from "path";

const BASE = "http://localhost:3000";
const CHROME =
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shots");
import fs from "fs";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: false });
  console.log(`📸 ${name}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1440, height: 1000 },
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.setDefaultTimeout(15000);
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("error") || t.includes("Error")) console.log("[console]", t.slice(0, 300));
  });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

  // ---- 1. LOGIN ----
  console.log("→ Login to /login");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await sleep(1000);
  // Fill credentials form
  const inputs = await page.$$("input");
  for (const inp of inputs) {
    const type = await inp.evaluate((el) => el.type);
    if (type === "email") await inp.type("admin@restobahagia.com");
    if (type === "password") await inp.type("admin123");
  }
  await shot(page, "1-login-filled.png");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /masuk|login|sign in/i.test(b.textContent || "")
    );
    if (btn) btn.click();
  });
  // Wait for navigation away from /login
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 20000 });
  console.log("✅ Logged in, at", new URL(page.url()).pathname);
  await shot(page, "2-after-login.png");

  // ---- 2. OPEN ADMIN MENU ----
  console.log("→ Open /admin/menu");
  await page.goto(`${BASE}/admin/menu`, { waitUntil: "networkidle2" });
  await sleep(2000);

  // Click the "Produk" tab to show the product list
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button")].find((b) =>
      b.textContent && b.textContent.trim() === "Produk"
    );
    if (tab) tab.click();
  });
  await sleep(2000);
  await shot(page, "3-admin-menu-products.png");

  // Find the "Kustomisasi" button belonging to the row that contains
  // "Minuman Caffe 1" (walk up ancestors to find the row boundary).
  const clicked = await page.evaluate(() => {
    const kustomisasiButtons = [...document.querySelectorAll("button")].filter(
      (b) => /kustomisasi/i.test(b.textContent || "")
    );
    for (const btn of kustomisasiButtons) {
      // Walk up ancestors; the product row's text STARTS with the product
      // name (e.g. "Minuman Caffe 1MinumanRp23.000Kustomisasi"). Stop at the
      // first ancestor that starts with it — never match the whole list.
      let el = btn.parentElement;
      while (el) {
        const text = (el.textContent || "").trim();
        if (text.startsWith("Minuman Caffe 1") && text.includes("Kustomisasi")) {
          btn.click();
          return "clicked-for-minuman-caffe-1";
        }
        // If we've walked into the list container (multiple product rows),
        // give up on this button.
        if (/asdasd|Nasi Goreng|Es Teh/.test(text) && text.length > 120) break;
        el = el.parentElement;
      }
    }
    return "not-found";
  });
  console.log("Kustomisasi click:", clicked);
  if (clicked !== "clicked-for-minuman-caffe-1") {
    throw new Error("Could not locate Kustomisasi button for Minuman Caffe 1");
  }
  // Wait for the customization view to render ("← Kembali" + product name header)
  await page.waitForFunction(
    () => {
      const t = document.body.innerText || "";
      return t.includes("Minuman Caffe 1") && t.includes("Option Groups");
    },
    { timeout: 15000 }
  );
  await sleep(1500);
  await shot(page, "4-customization-view.png");

  const pageText = await page.evaluate(() => document.body.innerText);
  if (!pageText.includes("Minuman Caffe 1")) {
    throw new Error("Customization view did not open for Minuman Caffe 1");
  }

  // ---- 3. CREATE OPTION GROUPS ----
  const groups = [
    { name: "Size", type: "SINGLE", required: true, min: 1, max: 1, options: [["Small", 0], ["Large", 5000]] },
    { name: "Sugar", type: "SINGLE", required: true, min: 1, max: 1, options: [["Less Sugar", 0], ["Normal", 0]] },
    { name: "Espresso", type: "SINGLE", required: true, min: 1, max: 1, options: [["Normal", 0], ["Extra Espresso", 5000]] },
  ];

  const existingGroups = await page.evaluate(() => document.body.innerText);
  for (const group of groups) {
    if (existingGroups.includes(group.name)) {
      console.log(`⏭ Group "${group.name}" already exists — skip`);
      continue;
    }

    // Click "Tambah Group"
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /tambah group/i.test(b.textContent || "")
      );
      if (btn) btn.click();
    });
    await sleep(1200);
    await shot(page, `5a-group-dialog-${group.name}.png`);

    // Fill group name (input with placeholder "Contoh: Ukuran, Gula, Espresso")
    const filled = await page.evaluate((name) => {
      const inp = [...document.querySelectorAll("input")].find((i) =>
        (i.placeholder || "").includes("Ukuran")
      );
      if (!inp) return "no-input";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inp, name);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      return "filled";
    }, group.name);
    console.log(`Fill group name "${group.name}":`, filled);

    // Click Simpan in the open dialog
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const dlg = btns.find((b) => b.textContent && b.textContent.trim() === "Simpan");
      if (dlg) dlg.click();
    });
    await sleep(1500);
    await shot(page, `5b-group-saved-${group.name}.png`);

    // ---- 4. ADD OPTIONS for this group ----
    // Expand the group (click its chevron/toggle) if not expanded
    await page.evaluate((name) => {
      const els = [...document.querySelectorAll("div, span")];
      const header = els.find(
        (el) => el.textContent && el.textContent.trim() === name
      );
      if (header) {
        const row = header.closest("div");
        if (row) {
          const chev = row.querySelector("button");
          if (chev) chev.click();
        }
      }
    }, group.name);
    await sleep(1200);

    for (const [optName, adj] of group.options) {
      const hasOption = await page.evaluate(
        (n) => document.body.innerText.includes(n),
        optName
      );
      if (hasOption) {
        console.log(`⏭ Option "${optName}" already exists — skip`);
        continue;
      }

      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) =>
          /tambah option/i.test(b.textContent || "")
        );
        if (btn) btn.click();
      });
      await sleep(1000);
      await shot(page, `6a-option-dialog-${optName}.png`);

      const filled = await page.evaluate(
        (name, adj) => {
          const inputs = [...document.querySelectorAll("input")];
          const nameInput = inputs.find((i) => (i.placeholder || "").includes("Small"));
          if (!nameInput) return "no-name-input";
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(nameInput, name);
          nameInput.dispatchEvent(new Event("input", { bubbles: true }));
          nameInput.dispatchEvent(new Event("change", { bubbles: true }));

          // price input: first number input after the name input
          const numInput = inputs.find(
            (i) => i.type === "number" && i !== nameInput
          );
          if (numInput) {
            setter.call(numInput, String(adj));
            numInput.dispatchEvent(new Event("input", { bubbles: true }));
            numInput.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return "filled";
        },
        optName,
        adj
      );
      console.log(`Fill option "${optName}" (+${adj}):`, filled);

      await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button")];
        const dlg = btns.find((b) => b.textContent && b.textContent.trim() === "Simpan");
        if (dlg) dlg.click();
      });
      await sleep(1200);
      await shot(page, `6b-option-saved-${optName}.png`);
    }
  }

  // ---- 5. ADD ADDON ----
  const hasAddon = await page.evaluate(() => document.body.innerText.includes("Extra Shot"));
  if (hasAddon) {
    console.log("⏭ Addon Extra Shot already exists — skip");
  } else {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /tambah addon/i.test(b.textContent || "")
      );
      if (btn) btn.click();
    });
    await sleep(1000);
    await shot(page, "7a-addon-dialog.png");

    await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input")];
      const nameInput = inputs.find((i) => (i.placeholder || "").includes("Extra Shot"));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      if (nameInput) {
        setter.call(nameInput, "Extra Shot");
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const priceInput = inputs.find((i) => i.type === "number" && i !== nameInput);
      if (priceInput) {
        setter.call(priceInput, "5000");
        priceInput.dispatchEvent(new Event("input", { bubbles: true }));
        priceInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    console.log("Fill addon: Extra Shot +5000");

    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const dlg = btns.find((b) => b.textContent && b.textContent.trim() === "Simpan");
      if (dlg) dlg.click();
    });
    await sleep(1500);
    await shot(page, "7b-addon-saved.png");
  }

  // ---- 6. FINAL STATE ----
  await sleep(1500);
  const finalText = await page.evaluate(() => document.body.innerText);
  console.log("\n=== Final admin page contains ===");
  for (const t of ["Size", "Sugar", "Espresso", "Small", "Large", "Less Sugar", "Normal", "Extra Espresso", "Extra Shot"]) {
    console.log(`  ${finalText.includes(t) ? "✅" : "❌"} ${t}`);
  }
  await shot(page, "8-final-customization.png");
  console.log("\n🎉 Admin UI seeding complete");
} catch (err) {
  console.error("❌ E2E failed:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}