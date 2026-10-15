#!/usr/bin/env node
/**
 * tools/preflight-migrations.mjs — Migration Runner Safety Guard (STEP 2C.6-C1B)
 * =============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * Prisma 7.10.0 decides the *apply order* of migrations in the CLI, not in the
 * repository and not by file-name bytes:
 *
 *     // node_modules/prisma/build/cli.js  (migration-directory loader)
 *     let l = u.sort((p, f) => p.path.localeCompare(f.path));
 *     ...
 *     return this.engine.applyMigrations({ migrationsList: r, filters: ... });
 *
 * `String.prototype.localeCompare` is the ICU/CLDR collation of the *runtime*
 * that invokes the CLI. This repository's chain mixes 8-digit and 14-digit
 * directory prefixes, and CLDR gives `_` a LOWER primary weight than a digit
 * while byte comparison gives it a HIGHER one — so the two orderings differ
 * (12 of 22 positions; see STEP-2C-6-C1A). One cross-migration FK
 * (`purchaseingredient.ingredientId -> ingredient`) is satisfied only under the
 * ICU order, so a runtime whose `localeCompare` is not ICU-aware (for example a
 * Node built with --with-intl=none) would silently apply the chain in an order
 * that fails with P3018 / errno 1146.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * A STATIC, FAIL-CLOSED preflight that runs BEFORE `prisma migrate deploy`:
 *
 *   F1  ICU canary      — proves the runtime's `localeCompare` has CLDR
 *                         collation semantics (the primitive the CLI relies on).
 *   F2  effective order — reproduces the CLI's own one-line comparator over the
 *                         migration directories and requires it to equal the
 *                         frozen baseline, position by position.
 *   F3  set equality    — no UNEXPECTED migration directory on disk.
 *   F4  set equality    — no baseline migration directory MISSING from disk.
 *   F5  content identity— sha256 of every `migration.sql` equals the baseline.
 *   F6  baseline usable — the baseline exists, parses, and has a known schema.
 *   F7  non-empty       — the migrations directory exists with >= 1 directory.
 *   F8  Prisma version  — installed `prisma` version equals the baseline (HARD FAIL).
 *
 * It opens NO database connection, reads/writes NO ledger, executes NO SQL,
 * shells out to NO Prisma command and calls NO migration engine — it imports
 * only Node built-ins and writes nothing unless explicitly asked with --update.
 *
 * NO BYPASS: v1 intentionally has no --force / --skip flag. A failing preflight
 * means "use a compliant runtime or fix the tree", never "press on".
 *
 * The baseline is updated ONLY by an explicit, reviewed `--update` run
 * (`npm run db:baseline:update`). This script never updates the baseline as a
 * side effect of a failing preflight or deploy.
 *
 * USAGE
 *   node tools/preflight-migrations.mjs [--project-root DIR]
 *                                       [--migrations-dir DIR] [--baseline FILE]
 *                                       [--json] [--update] [--help]
 *
 * EXIT CODES
 *   0  PASS (or --update succeeded)
 *   1  FAIL (fail-closed) / usage error / unexpected error
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.dirname(SCRIPT_DIR);

const MIGRATIONS_REL = path.join("prisma", "migrations");
const BASELINE_REL = path.join("tools", "migration-order.baseline.json");
const PRISMA_PKG_REL = path.join("node_modules", "prisma", "package.json");
const MIGRATION_FILE = "migration.sql";

/**
 * Injectable comparator seam. Production uses the SAME one-line comparator the
 * Prisma CLI uses (`cli.js`: `u.sort((p, f) => p.path.localeCompare(f.path))`).
 * It is a named function only so tests can reason about it; it has no runtime
 * override knob (no flag, no env var) — a "no ICU" runtime is simulated in the
 * test suite by shadowing `String.prototype.localeCompare` in a preload module.
 */
function compareMigrationNames(a, b) {
  return a.localeCompare(b);
}

/**
 * The canary pairs are the *primitive* the whole guard rests on. They are
 * deliberately independent of the 22 real names so they also protect a future
 * chain: every pair is ordered differently by CLDR collation and by byte
 * comparison, and the expected result is the ICU one.
 */
const CANARY_PAIRS = [
  {
    a: "a_",
    b: "a0",
    why: "CLDR: '_' sorts before a digit; byte order sorts it after",
  },
  {
    a: "20260911_add_ingredient_f1",
    b: "20260911140000_add_purchasing_inventory_foundation",
    why: "F-7 critical pair: 8-digit prefix block must precede the 14-digit block",
  },
  {
    a: "20260908_add_restaurant_branding",
    b: "20260908030144_add_branch_multi_cabang",
    why: "same-width-vs-wider prefix ordering used by the real chain",
  },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sha256File = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Mirror of the CLI loader: readdir(withFileTypes) → keep directories → names. */
function listMigrationDirectories(migrationsDir) {
  const entries = readdirSync(migrationsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

function effectiveOrder(names) {
  return names.slice().sort(compareMigrationNames);
}

function firstDivergence(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

function getInstalledPrismaVersion(projectRoot) {
  const pkgPath = path.resolve(projectRoot, PRISMA_PKG_REL);
  if (!existsSync(pkgPath)) {
    return { version: null, path: pkgPath };
  }
  const parsed = readJson(pkgPath);
  if (!parsed.ok || !parsed.value || typeof parsed.value.version !== "string") {
    return { version: null, path: pkgPath };
  }
  return { version: parsed.value.version, path: pkgPath };
}

function runtimeMetadata() {
  const v = process.config?.variables ?? {};
  return {
    node: process.version,
    icu: process.versions.icu ?? null,
    unicode: process.versions.unicode ?? null,
    icuSmall: v.icu_small === true || v.icu_small === "true",
    i18nSupport: v.v8_enable_i18n_support ?? null,
    defaultLocale:
      typeof Intl === "object" && Intl.DateTimeFormat
        ? new Intl.DateTimeFormat().resolvedOptions().locale
        : null,
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function runCanary() {
  const failures = [];
  if (typeof Intl !== "object" || !Intl || typeof Intl.DateTimeFormat !== "function") {
    failures.push({
      code: "F1_CANARY",
      message:
        "Intl is unavailable in this runtime — `localeCompare` cannot be trusted " +
        "to reproduce the audited migration order.",
    });
  }
  for (const { a, b, why } of CANARY_PAIRS) {
    let result;
    try {
      result = compareMigrationNames(a, b);
    } catch (error) {
      failures.push({
        code: "F1_CANARY",
        message: `localeCompare threw for "${a}" vs "${b}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }
    if (!(result < 0)) {
      failures.push({
        code: "F1_CANARY",
        message:
          `canary failed: "${a}".localeCompare("${b}") = ${result} (expected < 0). ` +
          `This runtime's collation is NOT the ICU/CLDR ordering the chain was ` +
          `audited under. ${why}.`,
      });
    }
  }
  return failures;
}

function checkBaselineShape(baseline) {
  const failures = [];
  if (baseline === null || typeof baseline !== "object" || Array.isArray(baseline)) {
    failures.push({ code: "F6_BASELINE", message: "baseline is not a JSON object." });
    return failures;
  }
  if (baseline.schemaVersion !== SCHEMA_VERSION) {
    failures.push({
      code: "F6_BASELINE",
      message:
        `baseline schemaVersion is ${JSON.stringify(baseline.schemaVersion)}; ` +
        `this guard understands ${SCHEMA_VERSION}.`,
    });
  }
  if (!Array.isArray(baseline.order) || baseline.order.some((x) => typeof x !== "string")) {
    failures.push({ code: "F6_BASELINE", message: "baseline.order must be an array of strings." });
  }
  if (
    baseline.checksums === null ||
    typeof baseline.checksums !== "object" ||
    Array.isArray(baseline.checksums)
  ) {
    failures.push({ code: "F6_BASELINE", message: "baseline.checksums must be an object." });
  }
  if (typeof baseline.prismaVersion !== "string" || baseline.prismaVersion === "") {
    failures.push({
      code: "F6_BASELINE",
      message: "baseline.prismaVersion must be a non-empty string.",
    });
  }
  return failures;
}

/**
 * Run the full preflight. Pure: reads only, writes nothing.
 * @returns {{ failures: Array<{code:string,message:string}>, warnings: string[], result: object }}
 */
function preflight({ projectRoot, migrationsDir, baselinePath }) {
  const failures = [];
  const warnings = [];

  // --- F1: runtime collation canary -------------------------------------
  failures.push(...runCanary());

  // --- F7: migrations directory readable and non-empty -------------------
  let names = [];
  if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
    failures.push({
      code: "F7_NO_MIGRATIONS",
      message: `migrations directory not found: ${migrationsDir}`,
    });
  } else {
    try {
      names = listMigrationDirectories(migrationsDir);
    } catch (error) {
      failures.push({
        code: "F7_NO_MIGRATIONS",
        message: `could not read migrations directory ${migrationsDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    if (names.length === 0) {
      failures.push({
        code: "F7_NO_MIGRATIONS",
        message: `no migration directories found in ${migrationsDir}`,
      });
    }
  }

  const effective = effectiveOrder(names);

  // --- F6: baseline loadable --------------------------------------------
  let baseline = null;
  if (!existsSync(baselinePath)) {
    failures.push({ code: "F6_BASELINE", message: `baseline not found: ${baselinePath}` });
  } else {
    const parsed = readJson(baselinePath);
    if (!parsed.ok) {
      failures.push({
        code: "F6_BASELINE",
        message: `baseline is not valid JSON (${baselinePath}): ${parsed.error}`,
      });
    } else {
      baseline = parsed.value;
      failures.push(...checkBaselineShape(baseline));
    }
  }

  const baselineOrder = Array.isArray(baseline?.order) ? baseline.order : null;
  const baselineChecksums =
    baseline && typeof baseline.checksums === "object" && !Array.isArray(baseline.checksums)
      ? baseline.checksums
      : null;

  // --- F3 / F4 / F2: set equality then ordered equality -----------------
  if (baselineOrder) {
    const onDisk = new Set(names);
    const inBaseline = new Set(baselineOrder);
    const unexpected = names.filter((n) => !inBaseline.has(n)).sort();
    const missing = baselineOrder.filter((n) => !onDisk.has(n)).sort();

    if (unexpected.length > 0) {
      failures.push({
        code: "F3_UNEXPECTED_MIGRATION",
        message:
          `migration director${unexpected.length === 1 ? "y" : "ies"} present on disk but ` +
          `absent from the baseline: ${unexpected.join(", ")}. Update the baseline ` +
          `explicitly with \`npm run db:baseline:update\` and review the diff.`,
      });
    }
    if (missing.length > 0) {
      failures.push({
        code: "F4_MISSING_MIGRATION",
        message:
          `migration director${missing.length === 1 ? "y" : "ies"} in the baseline but ` +
          `missing on disk: ${missing.join(", ")}.`,
      });
    }

    if (unexpected.length === 0 && missing.length === 0) {
      const at = firstDivergence(effective, baselineOrder);
      if (at !== -1) {
        failures.push({
          code: "F2_ORDER",
          message:
            `effective migration order differs from the baseline at position ${at + 1}: ` +
            `runtime => ${JSON.stringify(effective[at] ?? null)}, ` +
            `baseline => ${JSON.stringify(baselineOrder[at] ?? null)}. ` +
            `The runtime cannot reproduce the audited order.`,
        });
      }
    }
  }

  // --- F5: per-file content identity ------------------------------------
  if (baselineChecksums) {
    for (const name of names) {
      const expected = baselineChecksums[name];
      if (typeof expected !== "string") continue; // covered by F3
      const file = path.join(migrationsDir, name, MIGRATION_FILE);
      let actual;
      try {
        actual = sha256File(file);
      } catch (error) {
        failures.push({
          code: "F5_CHECKSUM",
          message: `cannot read ${file}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        continue;
      }
      if (actual !== expected) {
        failures.push({
          code: "F5_CHECKSUM",
          message:
            `checksum mismatch for ${name}/${MIGRATION_FILE}: ` +
            `on-disk ${actual.slice(0, 16)}…, baseline ${expected.slice(0, 16)}…. ` +
            `An applied migration must never be edited (comments and newlines included).`,
        });
      }
    }
  }

  // --- F8: installed Prisma version (HARD FAIL) --------------------------
  const installed = getInstalledPrismaVersion(projectRoot);
  const expectedPrisma = typeof baseline?.prismaVersion === "string" ? baseline.prismaVersion : null;
  if (!installed.version) {
    failures.push({
      code: "F8_PRISMA_VERSION",
      message:
        `could not determine the installed Prisma version from ${installed.path}. ` +
        `The ordering comparator is Prisma-version-coupled, so this is fail-closed.`,
    });
  } else if (expectedPrisma && installed.version !== expectedPrisma) {
    failures.push({
      code: "F8_PRISMA_VERSION",
      message:
        `installed Prisma ${installed.version} != baseline Prisma ${expectedPrisma}. ` +
        `A Prisma change can change the migration loader/ordering; re-verify and, ` +
        `if appropriate, regenerate the baseline explicitly.`,
    });
  }

  const runtime = runtimeMetadata();
  if (baseline?.capturedWith?.icu && runtime.icu && baseline.capturedWith.icu !== runtime.icu) {
    warnings.push(
      `ICU version differs from the baseline capture ` +
        `(${runtime.icu} vs ${baseline.capturedWith.icu}) — informational only; ` +
        `the canary and order checks are authoritative.`,
    );
  }
  if (runtime.icuSmall) {
    warnings.push("this Node is built with small-icu (en-US only) — informational only.");
  }

  return {
    failures,
    warnings,
    result: {
      ok: failures.length === 0,
      schemaVersion: SCHEMA_VERSION,
      projectRoot,
      migrationsDir,
      baseline: baselinePath,
      prismaVersion: { installed: installed.version, baseline: expectedPrisma },
      runtime,
      counts: { onDisk: names.length, baseline: baselineOrder ? baselineOrder.length : null },
      effectiveOrder: effective,
      baselineOrder,
    },
  };
}

// ---------------------------------------------------------------------------
// --update  (explicit, reviewed only; never a side effect of a failing run)
// ---------------------------------------------------------------------------

function buildBaseline({ projectRoot, migrationsDir }) {
  const names = listMigrationDirectories(migrationsDir);
  if (names.length === 0) {
    throw new Error(`no migration directories found in ${migrationsDir}`);
  }
  const installed = getInstalledPrismaVersion(projectRoot);
  if (!installed.version) {
    throw new Error(
      `cannot record prismaVersion — ${installed.path} is missing or unreadable ` +
        `(run \`npm install\` first)`
    );
  }
  const order = effectiveOrder(names);
  const checksums = {};
  for (const name of order) {
    checksums[name] = sha256File(path.join(migrationsDir, name, MIGRATION_FILE));
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    description:
      "Frozen migration apply order + migration.sql sha256 for the Prisma runner guard. " +
      "Regenerate ONLY with `npm run db:baseline:update` and review the diff.",
    migrationsDir: path.relative(projectRoot, migrationsDir) || migrationsDir,
    prismaVersion: installed.version,
    generatedBy: "tools/preflight-migrations.mjs --update",
    capturedWith: runtimeMetadata(),
    order,
    checksums,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  return [
    "Usage: node tools/preflight-migrations.mjs [options]",
    "",
    "Options:",
    "  --project-root DIR     project root (default: the guard's parent directory)",
    "  --migrations-dir DIR   migrations directory (default: <root>/prisma/migrations)",
    "  --baseline FILE        baseline file (default: <root>/tools/migration-order.baseline.json)",
    "  --json                 machine-readable output",
    "  --update               regenerate the baseline from the tree (explicit + reviewed)",
    "  --help                 show this help",
    "",
    "Exit: 0 = PASS, 1 = FAIL (fail-closed). There is no bypass flag in v1.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    projectRoot: null,
    migrationsDir: null,
    baseline: null,
    json: false,
    update: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--project-root":
        args.projectRoot = argv[++i];
        break;
      case "--migrations-dir":
        args.migrationsDir = argv[++i];
        break;
      case "--baseline":
        args.baseline = argv[++i];
        break;
      case "--json":
        args.json = true;
        break;
      case "--update":
        args.update = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function resolvePaths(args) {
  const projectRoot = path.resolve(args.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const migrationsDir = args.migrationsDir
    ? path.resolve(projectRoot, args.migrationsDir)
    : path.join(projectRoot, MIGRATIONS_REL);
  const baselinePath = args.baseline
    ? path.resolve(projectRoot, args.baseline)
    : path.join(projectRoot, BASELINE_REL);
  return { projectRoot, migrationsDir, baselinePath };
}

function printHuman({ failures, warnings, result }, { update, baselinePath }) {
  const out = [];
  if (update) {
    out.push(`[preflight] baseline regenerated: ${baselinePath}`);
    out.push(`[preflight] order: ${result.counts.baseline} migrations, ` +
      `prisma ${result.prismaVersion.baseline}`);
    out.push("[preflight] review the diff and commit it with the migration change.");
    for (const w of warnings) out.push(`[preflight] WARN ${w}`);
    out.push("[preflight] PASS (update)");
    process.stdout.write(`${out.join("\n")}\n`);
    return;
  }
  out.push(`[preflight] project root : ${result.projectRoot}`);
  out.push(`[preflight] migrations   : ${result.migrationsDir}`);
  out.push(`[preflight] baseline     : ${result.baseline}`);
  out.push(
    `[preflight] runtime      : node ${result.runtime.node}, icu ${result.runtime.icu}, ` +
      `locale ${result.runtime.defaultLocale}, smallIcu ${result.runtime.icuSmall}`
  );
  out.push(
    `[preflight] prisma       : installed ${result.prismaVersion.installed}, ` +
      `baseline ${result.prismaVersion.baseline}`
  );
  out.push(
    `[preflight] migrations   : ${result.counts.onDisk} on disk, ` +
      `${result.counts.baseline} in baseline`
  );
  for (const w of warnings) out.push(`[preflight] WARN ${w}`);
  if (failures.length === 0) {
    out.push("[preflight] PASS — effective order matches the baseline and every checksum is identical.");
  } else {
    out.push(`[preflight] FAIL — ${failures.length} problem(s):`);
    for (const f of failures) out.push(`[preflight]   ${f.code}: ${f.message}`);
    out.push("[preflight] Refusing to continue. No migration may start. Fix the runtime or the tree.");
  }
  process.stdout.write(`${out.join("\n")}\n`);
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`[preflight] ${error instanceof Error ? error.message : error}\n`);
    process.stderr.write(`${usage()}\n`);
    return 1;
  }

  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const { projectRoot, migrationsDir, baselinePath } = resolvePaths(args);

  if (args.update) {
    // Explicit, reviewed regeneration. Refuses to freeze an order it cannot
    // trust, and is NEVER triggered by a failing preflight/deploy.
    let updateFailures = [];
    try {
      updateFailures = runCanary();
    } catch (error) {
      updateFailures = [{ code: "F1_CANARY", message: String(error) }];
    }
    if (updateFailures.length > 0) {
      const payload = { ok: false, mode: "update", failures: updateFailures };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.stderr.write(
        "[preflight] refusing to regenerate the baseline: the runtime collation canary failed.\n"
      );
      return 1;
    }
    let baseline;
    try {
      baseline = buildBaseline({ projectRoot, migrationsDir });
    } catch (error) {
      process.stderr.write(
        `[preflight] cannot regenerate baseline: ${error instanceof Error ? error.message : error}\n`
      );
      return 1;
    }
    mkdirSync(path.dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    const summary = {
      failures: [],
      warnings: [],
      result: {
        counts: { baseline: baseline.order.length },
        prismaVersion: { baseline: baseline.prismaVersion },
      },
    };
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, mode: "update", baseline }, null, 2)}\n`);
    } else {
      printHuman(summary, { update: true, baselinePath });
    }
    return 0;
  }

  let outcome;
  try {
    outcome = preflight({ projectRoot, migrationsDir, baselinePath });
  } catch (error) {
    process.stderr.write(
      `[preflight] unexpected error (fail-closed): ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return 1;
  }

  if (args.json) {
    const payload = {
      ok: outcome.failures.length === 0,
      mode: "preflight",
      migrationsDir,
      baseline: baselinePath,
      prismaVersion: outcome.result.prismaVersion,
      runtime: outcome.result.runtime,
      counts: outcome.result.counts,
      effectiveOrder: outcome.result.effectiveOrder,
      baselineOrder: outcome.result.baselineOrder,
      failures: outcome.failures,
      warnings: outcome.warnings,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printHuman(outcome, { update: false, baselinePath });
  }

  return outcome.failures.length === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
