#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PKGS = path.join(ROOT, "packages");
const dirs = (await fs.readdir(PKGS, { withFileTypes: true })).filter((d) => d.isDirectory());
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function looksSuspicious(p) {
  const lower = p.toLowerCase();
  return [
    "test",
    "__tests__",
    "spec",
    "bench",
    "coverage",
    "playground",
    "example",
    "examples",
    "demo",
    "sample",
  ].some((tag) => lower.includes(tag));
}

// Parse `npm pack --dry-run --json` if available; otherwise fallback to text scan.
function getPackedFiles(pkgDir) {
  const run = (args) => spawnSync(NPM, args, { cwd: pkgDir, encoding: "utf8" });

  // Try JSON (npm ≥7 generally supports this)
  let res = run(["pack", "--dry-run", "--json"]);
  if (res.status === 0 && res.stdout.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(res.stdout);
      // npm sometimes returns an array of one object with { files: [{ path, size, mode, type }, ...] }
      const files = (arr?.[0]?.files ?? []).map((f) => f.path).filter(Boolean);
      if (files.length) return { files, raw: res.stdout };
    } catch {
      // fall through to text parsing
    }
  } else if (res.status !== 0 && res.stdout.includes("This package has been marked as private")) {
    return { files: [], private: true, raw: res.stdout };
  }

  // Fallback: parse `npm notice …` lines
  res = run(["pack", "--dry-run"]);
  if (res.status !== 0) {
    if (res.stdout.includes("This package has been marked as private")) {
      return { files: [], private: true, raw: res.stdout };
    }
    throw new Error(res.stderr || res.stdout || "npm pack failed");
  }
  const lines = res.stdout.split("\n");
  const files = [];
  for (const s of lines) {
    if (!s.startsWith("npm notice ")) continue;
    const rest = s.slice("npm notice ".length).trim();
    if (rest.includes("===") || rest.includes(":")) continue; // headers/summary lines
    const parts = rest.split(" ").filter(Boolean);
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1];
    if (last.includes("/") || last.includes(".") || last.includes("-")) files.push(last);
  }
  return { files, raw: res.stdout };
}

let bad = [];
for (const d of dirs) {
  const pkgDir = path.join(PKGS, d.name);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(pkgJsonPath, "utf8"));
  } catch {
    console.log(`\n—— ${d.name} ——`);
    console.log("⚠️  No package.json, skipping.");
    continue;
  }
  if (pkg.private) {
    console.log(`\n—— ${pkg.name || d.name} ——`);
    console.log("ℹ️  private: true — skipping.");
    continue;
  }

  let files, isPrivate;
  try {
    const r = getPackedFiles(pkgDir);
    files = r.files;
    isPrivate = r.private;
  } catch (e) {
    console.error(`\n—— ${pkg.name || d.name} ——`);
    console.error("❌ npm pack failed");
    console.error(String(e).trim());
    process.exitCode = 1;
    continue;
  }

  const name = pkg.name || d.name;
  console.log(`\n—— ${name} ——`);
  if (isPrivate) {
    console.log("ℹ️  private: true — skipping.");
    continue;
  }
  console.log(`${files.length} files will be published.`);

  const suspicious = files.filter(looksSuspicious);
  if (suspicious.length) {
    console.log("⚠️  Suspicious files:");
    for (const f of suspicious) console.log(" - " + f);
    bad.push({ name, count: suspicious.length });
  } else {
    console.log("✅ Looks clean (no tests/benches/examples).");
  }
}

if (bad.length) {
  console.log("\nSummary:");
  for (const b of bad) console.log(` - ${b.name}: ${b.count} suspicious file(s)`);
  process.exitCode = 2;
} else {
  console.log("\n✅ All packages look clean.");
}
