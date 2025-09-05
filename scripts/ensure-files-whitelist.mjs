#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PKGS = path.join(ROOT, "packages");
const MODE = process.argv.includes("--check") ? "check" : "write";

async function main() {
  const dirs = (await fs.readdir(PKGS, { withFileTypes: true })).filter((d) => d.isDirectory());
  const rows = [];
  let changed = 0;
  for (const d of dirs) {
    const p = path.join(PKGS, d.name, "package.json");
    try {
      const pkg = JSON.parse(await fs.readFile(p, "utf8"));
      const had = Array.isArray(pkg.files) && pkg.files.length > 0;
      if (!had) {
        pkg.files = ["src"];
        if (MODE === "write") {
          await fs.writeFile(p, JSON.stringify(pkg, null, 2) + "\n", "utf8");
          changed++;
        }
      }
      rows.push({
        name: pkg.name || d.name,
        hadFiles: had ? "yes" : "no",
        files: (pkg.files || []).join(", "),
      });
    } catch (e) {
      rows.push({ name: d.name, hadFiles: "error", files: e.message });
    }
  }
  console.table(rows);
  if (MODE === "write") console.log("Updated " + changed + " package.json file(s).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
