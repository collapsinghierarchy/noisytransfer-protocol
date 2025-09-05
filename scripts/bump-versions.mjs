#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const NEW = "0.2.1";
const ROOT = process.cwd();
const PKGS = path.join(ROOT, "packages");
const SCOPE = "@noisytransfer/";

for (const dir of fs.readdirSync(PKGS)) {
  const pkgPath = path.join(PKGS, dir, "package.json");
  if (!fs.existsSync(pkgPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const old = pkg.version;

  // bump version
  pkg.version = NEW;

  // align internal deps
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const bag = pkg[field];
    if (!bag) continue;
    for (const dep of Object.keys(bag)) {
      if (dep.startsWith(SCOPE)) bag[dep] = `^${NEW}`;
    }
  }

  // ensure private test helpers stay private
  if (pkg.name === "@noisytransfer/test-helpers") {
    pkg.private = true;
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${pkg.name}: ${old} -> ${NEW}`);
}
console.log('\nDone. Now run: git add -A && git commit -m "chore: bump to 0.2.1"');
