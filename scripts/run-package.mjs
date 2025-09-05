#!/usr/bin/env node
/**
 * Run node:test for a single package, excluding RTC/E2E files by default.
 * Usage: node scripts/run-package.mjs <packageName> [--include-e2e]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const pkgName = process.argv[2];
if (!pkgName) {
  console.error("Usage: node scripts/run-package.mjs <packageName> [--include-e2e]");
  process.exit(2);
}
const includeE2E = process.argv.includes("--include-e2e");

const ROOT = process.cwd();
const base = path.join(ROOT, "packages", pkgName, "test");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const all = walk(base);

const E2E_PATTERNS = [
  /(^|\/)rtc_.*\.test\.(mjs|js)$/i,
  /(^|\/)webrtc_.*\.test\.(mjs|js)$/i,
  /(^|\/).*\.e2e\.test\.(mjs|js)$/i,
];

const files = all.filter((f) => {
  if (!/\.test\.(mjs|js)$/i.test(f)) return false;
  if (includeE2E) return true;
  return !E2E_PATTERNS.some((rx) => rx.test(f.replace(/\\/g, "/")));
});

if (files.length === 0) {
  console.log(`No test files found in ${pkgName}${includeE2E ? "" : " (after excluding E2E)"}.`);
  process.exit(0);
}

const args = ["--test", "--test-reporter=spec", ...files];
const { status } = spawnSync(process.execPath, args, { stdio: "inherit" });

process.exit(status ?? 1);
