/**
 * STEP 2C.6-C1B — Migration Runner Safety Guard: unit tests (matrix T1–T16).
 *
 * These tests exercise `tools/preflight-migrations.mjs` through its real CLI
 * interface, in child processes, against **temporary fixture trees**. They
 * require **no database**, set no connection string, and never run a migration.
 *
 * The two collation simulations (T9/T10) do not need a different Node binary:
 * a `--require` preload shadows `String.prototype.localeCompare`, which is
 * exactly the primitive the guard (and the Prisma CLI) depend on. The guard
 * itself has no test hook and no bypass flag.
 *
 * Run: npx tsx --test tests/migration-ordering.unit.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(REPO_ROOT, "tools", "preflight-migrations.mjs");
const REAL_BASELINE = path.join(REPO_ROOT, "tools", "migration-order.baseline.json");

/** A small chain that already contains an ICU-vs-byte divergence. */
const FIXTURE_NAMES = [
  "0000_init_schema",
  "20260908_add_restaurant_branding",
  "20260908030144_add_branch_multi_cabang",
  "20260911_add_ingredient_f1",
  "20260911140000_add_purchasing_inventory_foundation",
];

const fixtureSql = (name: string) =>
  `-- fixture ${name}\nCREATE TABLE \`${name}\` (\n  \`id\` VARCHAR(191) NOT NULL,\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`;

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

const NO_ICU_PRELOAD = [
  "// Simulates a Node built without ICU (--with-intl=none): code-unit ordering.",
  "String.prototype.localeCompare = function (other) {",
  "  const a = String(this);",
  "  const b = String(other);",
  "  return a < b ? -1 : a > b ? 1 : 0;",
  "};",
  "",
].join("\n");

const EN_US_ONLY_PRELOAD = [
  "// Simulates a small-icu runtime (only en-US available).",
  "const orig = String.prototype.localeCompare;",
  "String.prototype.localeCompare = function (other, locales, options) {",
  '  return orig.call(String(this), String(other), "en-US", options);',
  "};",
  "",
].join("\n");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  preload?: string;
  env?: Record<string, string>;
  /** Remove DATABASE_URL from the child environment (proves DB-independence). */
  dropDatabaseUrl?: boolean;
}

function runGuard(args: string[], options: RunOptions = {}): RunResult {
  const nodeArgs: string[] = [];
  if (options.preload) nodeArgs.push("--require", options.preload);
  nodeArgs.push(GUARD, ...args);
  const env: NodeJS.ProcessEnv = { ...process.env, ...(options.env ?? {}) };
  if (options.dropDatabaseUrl) delete env.DATABASE_URL;
  const res = spawnSync(process.execPath, nodeArgs, { encoding: "utf8", env });
  return {
    status: res.status,
    stdout: typeof res.stdout === "string" ? res.stdout : String(res.stdout ?? ""),
    stderr: typeof res.stderr === "string" ? res.stderr : String(res.stderr ?? ""),
  };
}

interface GuardPayload {
  ok: boolean;
  mode: string;
  counts: { onDisk: number | null; baseline: number | null };
  prismaVersion: { installed: string | null; baseline: string | null };
  failures: Array<{ code: string; message: string }>;
  warnings: string[];
}

function parsePayload(result: RunResult): GuardPayload {
  assert.notEqual(result.stdout.trim(), "", `no stdout (stderr: ${result.stderr})`);
  return JSON.parse(result.stdout) as GuardPayload;
}

interface Fixture {
  root: string;
  migrationsDir: string;
  baselinePath: string;
  prismaPkgPath: string;
}

function makeFixture(
  names: string[],
  options: { prismaVersion?: string } = {}
): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "c1b-guard-"));
  const migrationsDir = path.join(root, "prisma", "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  for (const name of names) {
    mkdirSync(path.join(migrationsDir, name), { recursive: true });
    writeFileSync(path.join(migrationsDir, name, "migration.sql"), fixtureSql(name), "utf8");
  }
  const prismaPkgDir = path.join(root, "node_modules", "prisma");
  mkdirSync(prismaPkgDir, { recursive: true });
  const prismaPkgPath = path.join(prismaPkgDir, "package.json");
  writeFileSync(
    prismaPkgPath,
    JSON.stringify({ name: "prisma", version: options.prismaVersion ?? "7.10.0" }),
    "utf8"
  );
  mkdirSync(path.join(root, "tools"), { recursive: true });
  return {
    root,
    migrationsDir,
    baselinePath: path.join(root, "tools", "migration-order.baseline.json"),
    prismaPkgPath,
  };
}

function withFixture(
  names: string[],
  fn: (fix: Fixture) => void,
  options: { prismaVersion?: string } = {}
): void {
  const fix = makeFixture(names, options);
  try {
    fn(fix);
  } finally {
    rmSync(fix.root, { recursive: true, force: true });
  }
}

function generateBaseline(fix: Fixture): void {
  const r = runGuard(["--project-root", fix.root, "--update"]);
  assert.equal(r.status, 0, `update failed: ${r.stdout}${r.stderr}`);
}

interface Baseline {
  schemaVersion: number;
  prismaVersion: string;
  order: string[];
  checksums: Record<string, string>;
  [k: string]: unknown;
}

const readBaseline = (fix: Fixture): Baseline =>
  JSON.parse(readFileSync(fix.baselinePath, "utf8")) as Baseline;

const writeBaseline = (fix: Fixture, baseline: Baseline): void =>
  writeFileSync(fix.baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

function writePreload(fix: Fixture, filename: string, body: string): string {
  const file = path.join(fix.root, filename);
  writeFileSync(file, body, "utf8");
  return file;
}

/** Recursive file → sha256 map, used for the purity/idempotence assertions. */
function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[path.relative(root, full)] = sha256(readFileSync(full));
    }
  };
  walk(root);
  return out;
}

const codes = (payload: GuardPayload) => payload.failures.map((f) => f.code);

// ---------------------------------------------------------------------------
// T1 — happy path on the real repository tree
// ---------------------------------------------------------------------------

test("T1 happy path — the real repository tree matches its committed baseline", () => {
  const result = runGuard(["--project-root", REPO_ROOT, "--json"]);
  const payload = parsePayload(result);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.failures, []);
  assert.equal(payload.counts.onDisk, 22);
  assert.equal(payload.counts.baseline, 22);

  // The committed baseline really covers the 22 existing migration directories.
  const baseline = JSON.parse(readFileSync(REAL_BASELINE, "utf8")) as Baseline;
  const dirs = readdirSync(path.join(REPO_ROOT, "prisma", "migrations"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.equal(baseline.order.length, 22);
  assert.equal(Object.keys(baseline.checksums).length, 22);
  assert.deepEqual([...baseline.order].sort(), [...dirs].sort());
  assert.equal(baseline.prismaVersion, "7.10.0");

  // Every baseline checksum equals the on-disk file (independent re-hash).
  for (const name of baseline.order) {
    const file = path.join(REPO_ROOT, "prisma", "migrations", name, "migration.sql");
    assert.equal(baseline.checksums[name], sha256(readFileSync(file)), `checksum drift: ${name}`);
  }
});

// ---------------------------------------------------------------------------
// T2 / T3 — order mismatch
// ---------------------------------------------------------------------------

test("T2 order mismatch (reversed baseline) fails with F2", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const baseline = readBaseline(fix);
    baseline.order = [...baseline.order].reverse();
    writeBaseline(fix, baseline);

    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F2_ORDER"));
  });
});

test("T3 order mismatch (adjacent swap) fails with F2", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const baseline = readBaseline(fix);
    const i = baseline.order.indexOf("20260911_add_ingredient_f1");
    assert.ok(i > 0);
    [baseline.order[i - 1], baseline.order[i]] = [baseline.order[i], baseline.order[i - 1]];
    writeBaseline(fix, baseline);

    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F2_ORDER"));
  });
});

// ---------------------------------------------------------------------------
// T4 / T5 — missing / extra migration
// ---------------------------------------------------------------------------

test("T4 a migration directory missing on disk fails with F4", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    rmSync(path.join(fix.migrationsDir, "20260911_add_ingredient_f1"), {
      recursive: true,
      force: true,
    });
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F4_MISSING_MIGRATION"));
  });
});

test("T5 an unexpected migration directory on disk fails with F3", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    mkdirSync(path.join(fix.migrationsDir, "20990101_extra"), { recursive: true });
    writeFileSync(
      path.join(fix.migrationsDir, "20990101_extra", "migration.sql"),
      fixtureSql("extra"),
      "utf8"
    );
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F3_UNEXPECTED_MIGRATION"));
  });
});

// ---------------------------------------------------------------------------
// T6 / T7 — checksum mismatch, including a single newline
// ---------------------------------------------------------------------------

test("T6 checksum mismatch (added comment) fails with F5", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const target = path.join(fix.migrationsDir, "0000_init_schema", "migration.sql");
    writeFileSync(target, `${readFileSync(target, "utf8")}-- a harmless-looking edit\n`, "utf8");
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F5_CHECKSUM"));
  });
});

test("T7 checksum mismatch (a single trailing newline) fails with F5", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const target = path.join(fix.migrationsDir, "0000_init_schema", "migration.sql");
    writeFileSync(target, `${readFileSync(target, "utf8")}\n`, "utf8");
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F5_CHECKSUM"));
  });
});

// ---------------------------------------------------------------------------
// T8 / T9 / T10 / T11 — Node / ICU matrix
// ---------------------------------------------------------------------------

test("T8 full-ICU runtime passes (ICU canary satisfied)", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const result = runGuard(["--project-root", fix.root, "--json"]);
    const payload = parsePayload(result);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(payload.ok, true);
  });
});

test("T9 simulated small-ICU (en-US only) still passes", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const preload = writePreload(fix, "en-us-only.cjs", EN_US_ONLY_PRELOAD);
    const result = runGuard(["--project-root", fix.root, "--json"], { preload });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(parsePayload(result).ok, true);
  });
});

test("T10 simulated no-ICU runtime fails closed on the canary (F1)", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const preload = writePreload(fix, "no-icu.cjs", NO_ICU_PRELOAD);
    const result = runGuard(["--project-root", fix.root, "--json"], { preload });
    assert.equal(result.status, 1);
    const payload = parsePayload(result);
    assert.ok(codes(payload).includes("F1_CANARY"), JSON.stringify(payload.failures));
  });
});

test("T11 locale environment (LANG=C LC_ALL=C) does not change the order", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const result = runGuard(["--project-root", fix.root, "--json"], {
      env: { LANG: "C", LC_ALL: "C" },
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// T12 — no DATABASE_URL, and no database access
// ---------------------------------------------------------------------------

test("T12 runs with no DATABASE_URL and touches no database", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const result = runGuard(["--project-root", fix.root, "--json"], { dropDatabaseUrl: true });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(parsePayload(result).ok, true);
    assert.doesNotMatch(result.stdout + result.stderr, /DATABASE_URL|mysql|mariadb/i);
  });
});

test("T12b the guard imports only Node built-ins (no DB driver, no network, no Prisma API)", () => {
  const source = readFileSync(GUARD, "utf8");
  const imports = [...source.matchAll(/^import\s[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, "expected at least one import");
  for (const specifier of imports) {
    assert.ok(specifier.startsWith("node:"), `unexpected import: ${specifier}`);
  }
  assert.doesNotMatch(source, /PrismaClient|@prisma\//);
  assert.doesNotMatch(source, /\b(?:mysql|mariadb|mysql2|pg)\b/);
  assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\//);
});

// ---------------------------------------------------------------------------
// T13 — corrupt / missing baseline
// ---------------------------------------------------------------------------

test("T13a a corrupt baseline fails with F6", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    writeFileSync(fix.baselinePath, "{ not json", "utf8");
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F6_BASELINE"));
  });
});

test("T13b a missing baseline fails with F6", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F6_BASELINE"));
  });
});

test("T13c an unknown baseline schemaVersion fails with F6", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const baseline = readBaseline(fix);
    baseline.schemaVersion = 999;
    writeBaseline(fix, baseline);
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F6_BASELINE"));
  });
});

// ---------------------------------------------------------------------------
// T14 — empty migrations directory
// ---------------------------------------------------------------------------

test("T14 an empty migrations directory fails with F7", () => {
  withFixture([], (fix) => {
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F7_NO_MIGRATIONS"));
  });
});

// ---------------------------------------------------------------------------
// T15 — Prisma version mismatch (HARD FAIL)
// ---------------------------------------------------------------------------

test("T15 a Prisma version mismatch fails with F8 (hard fail)", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    writeFileSync(
      fix.prismaPkgPath,
      JSON.stringify({ name: "prisma", version: "7.11.0" }),
      "utf8"
    );
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F8_PRISMA_VERSION"));
  });
});

test("T15b a missing Prisma package is fail-closed (F8)", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    rmSync(fix.prismaPkgPath, { force: true });
    const result = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(result.status, 1);
    assert.ok(codes(parsePayload(result)).includes("F8_PRISMA_VERSION"));
  });
});

// ---------------------------------------------------------------------------
// T16 — purity / idempotence
// ---------------------------------------------------------------------------

test("T16 preflight is pure and idempotent (writes nothing, same output twice)", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const before = hashTree(fix.root);
    const first = runGuard(["--project-root", fix.root, "--json"]);
    const second = runGuard(["--project-root", fix.root, "--json"]);
    assert.equal(first.status, 0);
    assert.equal(second.status, 0);
    assert.equal(first.stdout, second.stdout);
    assert.deepEqual(hashTree(fix.root), before, "preflight must not modify any file");
  });
});

test("T16b a failing preflight does not rewrite the baseline", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const current = readFileSync(fix.baselinePath, "utf8");
    const baseline = readBaseline(fix);
    baseline.order = [...baseline.order].reverse();
    writeBaseline(fix, baseline);
    const tampered = readFileSync(fix.baselinePath, "utf8");
    assert.notEqual(tampered, current);

    const result = runGuard(["--project-root", fix.root]);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(fix.baselinePath, "utf8"), tampered);
  });
});

// ---------------------------------------------------------------------------
// Extra — `--update` refuses to freeze an untrustworthy order
// ---------------------------------------------------------------------------

test("E1 --update refuses to regenerate the baseline when the canary fails", () => {
  withFixture(FIXTURE_NAMES, (fix) => {
    generateBaseline(fix);
    const frozen = readFileSync(fix.baselinePath, "utf8");
    const preload = writePreload(fix, "no-icu.cjs", NO_ICU_PRELOAD);
    const result = runGuard(["--project-root", fix.root, "--update"], { preload });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(fix.baselinePath, "utf8"), frozen, "baseline must be untouched");
  });
});

test("E2 the guard code (comments stripped) has no bypass/force flag", () => {
  const code = readFileSync(GUARD, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /"--force"|"--skip"|"--ignore"|"--bypass"/);
  assert.doesNotMatch(code, /process\.env\.\w*BYPASS/);
});
