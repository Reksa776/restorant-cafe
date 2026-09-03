// E2E fixup: the first seed run attached all options to the "Size" group.
// This script, driving the real Admin UI, removes the misplaced options from
// Size and re-adds them to the correct groups (Sugar, Espresso), using
// selectors scoped to each group container.
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

// Scoped helpers -----------------------------------------------------------
// Find the group container (div with border + rounded) that contains the
// group header with the given name.
async function getGroupContainer(page, groupName) {
  return page.evaluate((name) => {
    const els = [...document.querySelectorAll("div, span, button")];
    const header = els.find((el) => (el.textContent || "").trim() === name);
    if (!header) return null;
    let el = header.parentElement;
    while (el && el !== document.body) {
      if (
        el.tagName === "DIV" &&
        /border rounded-lg overflow-hidden/.test(el.className || "") &&
        (el.textContent || "").includes("Tambah Option")
      ) {
        return { found: true, text: (el.textContent || "").slice(0, 200) };
      }
      el = el.parentElement;
    }
    return null;
  }, groupName);
}

// Expand a group by clicking its chevron button in the header row.
async function expandGroup(page, groupName) {
  const done = await page.evaluate((name) => {
    const els = [...document.querySelectorAll("div, span, button")];
    const header = els.find((el) => (el.textContent || "").trim() === name);
    if (!header) return "no-header";
    let el = header.parentElement;
    while (el && el !== document.body) {
      const btns = [...el.querySelectorAll("button")];
      if (btns.length >= 4) {
        // chevron is the first button in the header row
        btns[0].click();
        return "expanded";
      }
      el = el.parentElement;
    }
    return "no-row";
  }, groupName);
  await sleep(1000);
  return done;
}

// Delete an option by name inside a specific group container.
async function deleteOption(page, groupName, optionName) {
  const done = await page.evaluate(
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
          const rows = [...el.querySelectorAll("div")].filter(
            (d) =>
              d.textContent &&
              d.textContent.trim() === oName
          );
          if (rows.length === 0) return "no-option";
          const row = rows[rows.length - 1];
          let r = row.parentElement;
          while (r && !r.querySelector("button")) r = r.parentElement;
          if (!r) return "no-row-btns";
          const btns = [...r.querySelectorAll("button")];
          if (btns.length === 0) return "no-btns";
          // Last button in the option row is delete (trash)
          btns[btns.length - 1].click();
          return "deleted";
        }
        el = el.parentElement;
      }
      return "no-container";
    },
    groupName,
    optionName
  );
  await sleep(800);
  if (done === "deleted") {
    // confirm dialog
    await page.evaluate(() => {
      const ok = [...document.querySelectorAll("button")].find(
        (b) => b.textContent && /^OK$/.test(b.textContent.trim())
      );
      if (ok) ok.click();
    });
    await sleep(1200);
  }
  return done;
}

// Add an option to a specific group via its "Tambah Option" button.
async function addOption(page, groupName, optionName, priceAdj) {
  const done = await page.evaluate(
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
      if (!nameInput) return "no-name-input";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(nameInput, name);
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));
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
  return done;
}

try {
  const page = await browser.newPage();
  await page.setDefaultTimeout(15000);
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

  // Open admin menu → Produk tab
  await page.goto(`${BASE}/admin/menu`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button")].find(
      (b) => b.textContent && b.textContent.trim() === "Produk"
    );
    if (tab) tab.click();
  });
  await sleep(1500);

  // Open customization for Minuman Caffe 1
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
    () => (document.body.innerText || "").includes("Minuman Caffe 1") && (document.body.innerText || "").includes("Option Groups"),
    { timeout: 15000 }
  );
  await sleep(1000);
  await shot(page, "fix-0-initial.png");

  // --- Step 1: delete misplaced options from Size group ---
  for (const opt of ["Less Sugar", "Normal", "Extra Espresso"]) {
    const r = await deleteOption(page, "Size", opt);
    console.log(`Delete "${opt}" from Size:`, r);
    await sleep(500);
  }
  await shot(page, "fix-1-size-cleaned.png");

  // --- Step 2: ensure Sugar group has Less Sugar + Normal ---
  await expandGroup(page, "Sugar");
  const sugarText = await page.evaluate(() => document.body.innerText);
  if (!sugarText.includes("Less Sugar")) {
    await addOption(page, "Sugar", "Less Sugar", 0);
    console.log("Added Less Sugar → Sugar");
  } else {
    console.log("⏭ Less Sugar already in Sugar");
  }
  if (!sugarText.includes("Normal")) {
    await addOption(page, "Sugar", "Normal", 0);
    console.log("Added Normal → Sugar");
  } else {
    console.log("⏭ Normal already in Sugar");
  }
  await shot(page, "fix-2-sugar-done.png");

  // --- Step 3: ensure Espresso group has Normal + Extra Espresso ---
  await expandGroup(page, "Espresso");
  const espressoText = await page.evaluate(() => document.body.innerText);
  if (!espressoText.includes("Extra Espresso")) {
    await addOption(page, "Espresso", "Extra Espresso", 5000);
    console.log("Added Extra Espresso → Espresso");
  } else {
    console.log("⏭ Extra Espresso already in Espresso");
  }
  if (!espressoText.includes("Normal")) {
    await addOption(page, "Espresso", "Normal", 0);
    console.log("Added Normal → Espresso");
  } else {
    console.log("⏭ Normal already in Espresso");
  }
  await shot(page, "fix-3-espresso-done.png");

  // Final state dump
  await sleep(1500);
  const finalText = await page.evaluate(() => document.body.innerText);
  console.log("\n=== Admin page contains ===");
  for (const t of ["Size", "Sugar", "Espresso", "Small", "Large", "Less Sugar", "Normal", "Extra Espresso", "Extra Shot"]) {
    console.log(`  ${finalText.includes(t) ? "✅" : "❌"} ${t}`);
  }
  await shot(page, "fix-4-final.png");
  console.log("\n🎉 Fixup complete");
} catch (err) {
  console.error("❌ Fixup failed:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}