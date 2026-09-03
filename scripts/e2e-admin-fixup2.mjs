// E2E fixup v2: fixes option placement via the real Admin UI.
// 1) Expand Size, delete "Less Sugar", "Normal", "Extra Espresso" from it.
// 2) Expand Espresso, add "Normal" (scoped check: only inside Espresso container).
// Uses native dialog handling for window.confirm() and scoped selectors.
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

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
  console.log(`📸 ${name}`);
}

// Find the group container div for a group by its header name.
async function groupContainerHandle(page, groupName) {
  const found = await page.evaluate((name) => {
    const els = [...document.querySelectorAll("div, span, button")];
    const header = els.find((el) => (el.textContent || "").trim() === name);
    if (!header) return false;
    let el = header.parentElement;
    while (el && el !== document.body) {
      if (
        el.tagName === "DIV" &&
        /border rounded-lg overflow-hidden/.test(el.className || "")
      ) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }, groupName);
  return found;
}

// Expand a group (click chevron = first button in its header row).
async function expandGroup(page, groupName) {
  return page.evaluate((name) => {
    const els = [...document.querySelectorAll("div, span, button")];
    const header = els.find((el) => (el.textContent || "").trim() === name);
    if (!header) return "no-header";
    let el = header.parentElement;
    while (el && el !== document.body) {
      const btns = [...el.querySelectorAll("button")];
      if (btns.length >= 4 && /Active|Inactive/.test(el.textContent || "")) {
        btns[0].click();
        return "clicked";
      }
      el = el.parentElement;
    }
    return "no-row";
  }, groupName);
}

// Check whether an option name exists as a <span> inside the given group container.
async function optionExistsInGroup(page, groupName, optionName) {
  return page.evaluate(
    (gName, oName) => {
      const els = [...document.querySelectorAll("div, span, button")];
      const header = els.find((el) => (el.textContent || "").trim() === gName);
      if (!header) return false;
      let el = header.parentElement;
      while (el && el !== document.body) {
        if (
          el.tagName === "DIV" &&
          /border rounded-lg overflow-hidden/.test(el.className || "")
        ) {
          const span = [...el.querySelectorAll("span")].find(
            (s) => (s.textContent || "").trim() === oName
          );
          return !!span;
        }
        el = el.parentElement;
      }
      return false;
    },
    groupName,
    optionName
  );
}

// Delete an option (span with exact name) inside a group. Handles confirm dialog.
async function deleteOption(page, groupName, optionName) {
  const clicked = await page.evaluate(
    (gName, oName) => {
      const els = [...document.querySelectorAll("div, span, button")];
      const header = els.find((el) => (el.textContent || "").trim() === gName);
      if (!header) return "no-header";
      let el = header.parentElement;
      while (el && el !== document.body) {
        if (
          el.tagName === "DIV" &&
          /border rounded-lg overflow-hidden/.test(el.className || "")
        ) {
          const span = [...el.querySelectorAll("span")].find(
            (s) => (s.textContent || "").trim() === oName
          );
          if (!span) return "no-option";
          let row = span.parentElement;
          while (row && !(row.querySelectorAll("button").length >= 3)) {
            row = row.parentElement;
          }
          if (!row) return "no-row";
          const btns = [...row.querySelectorAll("button")];
          btns[btns.length - 1].click(); // delete = last button in option row
          return "clicked";
        }
        el = el.parentElement;
      }
      return "no-container";
    },
    groupName,
    optionName
  );
  if (clicked === "clicked") {
    await sleep(600);
    // confirm() should be auto-accepted by the dialog handler below
  }
  await sleep(800);
  return clicked;
}

// Add an option to a group via its scoped "Tambah Option" button.
async function addOption(page, groupName, optionName, priceAdj) {
  const opened = await page.evaluate(
    (gName) => {
      const els = [...document.querySelectorAll("div, span, button")];
      const header = els.find((el) => (el.textContent || "").trim() === gName);
      if (!header) return "no-header";
      let el = header.parentElement;
      while (el && el !== document.body) {
        if (
          el.tagName === "DIV" &&
          /border rounded-lg overflow-hidden/.test(el.className || "")
        ) {
          const btn = [...el.querySelectorAll("button")].find((b) =>
            /tambah option/i.test(b.textContent || "")
          );
          if (!btn) return "no-add-btn";
          btn.click();
          return "opened";
        }
        el = el.parentElement;
      }
      return "no-container";
    },
    groupName
  );
  await sleep(1000);

  await page.evaluate(
    (name, adj) => {
      const inputs = [...document.querySelectorAll("input")];
      const nameInput = inputs.find((i) => (i.placeholder || "").includes("Small"));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      if (nameInput) {
        setter.call(nameInput, name);
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const numInput = inputs.find((i) => i.type === "number" && i !== nameInput);
      if (numInput) {
        setter.call(numInput, String(adj));
        numInput.dispatchEvent(new Event("input", { bubbles: true }));
        numInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return "filled";
    },
    optionName,
    priceAdj
  );
  await sleep(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const save = btns.find((b) => b.textContent && b.textContent.trim() === "Simpan");
    if (save) save.click();
  });
  await sleep(1200);
  return opened;
}

try {
  const page = await browser.newPage();
  await page.setDefaultTimeout(15000);
  page.on("dialog", async (dlg) => {
    console.log("  [dialog]", dlg.message().slice(0, 80));
    await dlg.accept();
  });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

  // Login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await sleep(1000);
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll("input")];
    for (const i of inp) {
      if (i.type === "email") {
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        s.call(i, "admin@restobahagia.com");
        i.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (i.type === "password") {
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        s.call(i, "admin123");
        i.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /masuk|login|sign in/i.test(b.textContent || "")
    );
    if (btn) btn.click();
  });
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 20000 });

  await page.goto(`${BASE}/admin/menu`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button")].find(
      (b) => b.textContent && b.textContent.trim() === "Produk"
    );
    if (tab) tab.click();
  });
  await sleep(1500);

  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) =>
      /kustomisasi/i.test(b.textContent || "")
    );
    for (const btn of btns) {
      let el = btn.parentElement;
      while (el) {
        const text = (el.textContent || "").trim();
        if (text.startsWith("Minuman Caffe 1") && text.includes("Kustomisasi")) {
          btn.click();
          return "ok";
        }
        if (/asdasd|Nasi Goreng/.test(text) && text.length > 120) break;
        el = el.parentElement;
      }
    }
    return "not-found";
  });
  if (clicked !== "ok") throw new Error("Could not open Minuman Caffe 1 customization");
  await page.waitForFunction(
    () => (document.body.innerText || "").includes("Option Groups"),
    { timeout: 15000 }
  );
  await sleep(1000);

  // --- Step 1: clean misplaced options out of Size ---
  await expandGroup(page, "Size");
  await sleep(800);
  for (const opt of ["Less Sugar", "Normal", "Extra Espresso"]) {
    const exists = await optionExistsInGroup(page, "Size", opt);
    if (exists) {
      const r = await deleteOption(page, "Size", opt);
      console.log(`Delete "${opt}" from Size: ${r}`);
    } else {
      console.log(`⏭ "${opt}" not in Size`);
    }
    await sleep(500);
  }
  await shot(page, "fx2-1-size-cleaned.png");

  // --- Step 2: Sugar group should have Less Sugar + Normal (already correct) ---
  await expandGroup(page, "Sugar");
  await sleep(500);
  console.log("Sugar has Less Sugar:", await optionExistsInGroup(page, "Sugar", "Less Sugar"));
  console.log("Sugar has Normal:", await optionExistsInGroup(page, "Sugar", "Normal"));

  // --- Step 3: Espresso group needs Normal + Extra Espresso ---
  await expandGroup(page, "Espresso");
  await sleep(500);
  console.log("Espresso has Extra Espresso:", await optionExistsInGroup(page, "Espresso", "Extra Espresso"));
  const espressoHasNormal = await optionExistsInGroup(page, "Espresso", "Normal");
  console.log("Espresso has Normal:", espressoHasNormal);
  if (!espressoHasNormal) {
    await addOption(page, "Espresso", "Normal", 0);
    console.log("✅ Added Normal → Espresso");
  }
  await shot(page, "fx2-2-final.png");

  // Final summary from DB-perspective text
  await sleep(1200);
  const text = await page.evaluate(() => document.body.innerText);
  console.log("\n=== Contains ===");
  for (const t of ["Size", "Sugar", "Espresso", "Small", "Large", "Less Sugar", "Normal", "Extra Espresso", "Extra Shot"]) {
    console.log(`  ${text.includes(t) ? "✅" : "❌"} ${t}`);
  }
  console.log("\n🎉 Fixup v2 complete");
} catch (err) {
  console.error("❌ Fixup v2 failed:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}