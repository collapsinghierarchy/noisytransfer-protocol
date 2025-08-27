#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const PKGS = path.join(process.cwd(), "packages");

const FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta" // just in case
];

function changedSelfDeps(pkgJSON) {
  const name = pkgJSON.name;
  if (!name) return false;
  let changed = false;
  for (const f of FIELDS) {
    const bag = pkgJSON[f];
    if (bag && Object.prototype.hasOwnProperty.call(bag, name)) {
      delete bag[name];
      changed = true;
    }
  }
  return changed;
}

async function run() {
  const dirs = (await fs.readdir(PKGS, { withFileTypes: true })).filter(d => d.isDirectory());
  const rows = [];
  for (const d of dirs) {
    const pj = path.join(PKGS, d.name, "package.json");
    try {
      const j = JSON.parse(await fs.readFile(pj, "utf8"));
      const before = JSON.stringify(j);
      if (changedSelfDeps(j)) {
        await fs.writeFile(pj, JSON.stringify(j, null, 2) + "\n");
        rows.push({ package: j.name || d.name, fixed: "yes" });
      } else {
        rows.push({ package: j.name || d.name, fixed: "no" });
      }
    } catch (e) {
      rows.push({ package: d.name, fixed: "error: " + e.message });
    }
  }
  console.table(rows);
}

run().catch(e => { console.error(e); process.exit(1); });
