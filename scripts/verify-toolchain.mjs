#!/usr/bin/env node
import { execSync } from "node:child_process";

const stripV = (s) => (s || "").toString().trim().replace(/^v/, "");

const nodev = process.version;
let npmv = "unknown";
try {
  npmv = execSync("npm -v", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {}

console.log(`Node: ${nodev}`);
console.log(`npm: ${npmv}`);

const major = Number(stripV(nodev).split(".")[0]);
if (!Number.isFinite(major) || major < 18) {
  console.error("❌ Node >= 18 required.");
  process.exit(1);
}
if (npmv !== "unknown") {
  const nmaj = Number(npmv.split(".")[0] || "0");
  if (!Number.isFinite(nmaj) || nmaj < 10) {
    console.error("❌ npm >= 10 required.");
    process.exit(1);
  }
}

console.log("✅ Toolchain OK (Node >= 18, npm >= 10)");
